"""Audit missing 2014–15 shot clocks against official NBA play-by-play."""

import argparse
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import re
from threading import Event, Lock
from time import monotonic, sleep

import pandas as pd
import requests
from nba_api.stats.library.http import NBAStatsHTTP


HOLDOUT_START = "2015-02-01"
CONTROL_START = "2015-01-01"
MATCH_TOLERANCE_SECONDS = 6
PBP_ENDPOINT = "https://stats.nba.com/stats/playbyplayv3"
CLOCK_BAND_EDGES = [-1, 5, 24, 60, float("inf")]
CLOCK_BAND_LABELS = ["0–5 s", "6–24 s", "25–60 s", "61+ s"]


def period_seconds(clock):
    match = re.fullmatch(r"PT(\d+)M([\d.]+)S", clock)
    if match:
        return 60 * int(match[1]) + float(match[2])
    return None


def fetch_games(game_ids, cache):
    """Cache complete responses and pause the batch on access or rate limits."""
    cache.mkdir(parents=True, exist_ok=True)
    lock = Lock()
    stop = Event()
    next_request = 0.0

    def fetch(game_id):
        nonlocal next_request
        path = cache / f"{game_id}.json"
        for attempt in range(2):
            with lock:
                if stop.is_set():
                    return "paused"
                sleep(max(0, next_request - monotonic()))
                next_request = monotonic() + 0.45
            try:
                response = requests.get(
                    PBP_ENDPOINT, params={"GameID": game_id, "StartPeriod": 0, "EndPeriod": 0},
                    headers=NBAStatsHTTP.headers, timeout=8,
                )
                if response.status_code in {403, 429}:
                    stop.set()
                    return f"HTTP {response.status_code}"
                response.raise_for_status()
                game = response.json()["game"]
                if game["gameId"] != game_id or not game["actions"]:
                    raise ValueError("Empty or mismatched play-by-play response")
                temporary = path.with_suffix(".tmp")
                temporary.write_text(json.dumps(game, separators=(",", ":")), encoding="utf-8")
                temporary.replace(path)
                return "fetched"
            except (requests.RequestException, ValueError, KeyError):
                if attempt == 0:
                    sleep(1)
        return "failed"

    pending = [game for game in game_ids if not (cache / f"{game}.json").exists()]
    with ThreadPoolExecutor(max_workers=5) as pool:
        counts = Counter()
        for i, status in enumerate(pool.map(fetch, pending), 1):
            counts[status] += 1
            if i % 50 == 0:
                print(f"Fetched batch progress {i}/{len(pending)} {dict(counts)}", flush=True)
    print(f"Fetch results {dict(counts)}", flush=True)


def shot_signature(action):
    return action["personId"], action["period"], action["shotValue"], action["shotResult"].lower()


def match_shots(rows, actions):
    """Reject ambiguous matches and collisions with any other source attempt."""
    by_signature = defaultdict(list)
    for i, action in enumerate(actions):
        clock = period_seconds(action["clock"])
        if action["isFieldGoal"] and clock is not None:
            by_signature[shot_signature(action)].append((i, clock))

    matches = {}
    claims = Counter()
    for row in rows:
        signature = row.player_id, row.PERIOD, row.PTS_TYPE, row.SHOT_RESULT
        candidates = [
            i for i, clock in by_signature[signature]
            if abs(clock - row.period_seconds) <= MATCH_TOLERANCE_SECONDS
        ]
        matches[row.Index] = candidates
        claims.update(candidates)
    return matches, claims


def from_possession_start(start, end, action, reason):
    if start <= 24:
        return "likely_off", reason, None, action["actionNumber"]
    if 0 < start - end < 24:
        return "estimated", reason, round(24 - (start - end), 2), action["actionNumber"]
    return "unresolved", "elapsed_time_outside_range", None, None


def classify_clock(actions, i):
    """Require an observable possession start and a continuous event sequence."""
    shot = actions[i]
    if i < 1:
        return "unresolved", "no_prior_event", None, None
    previous = actions[i - 1]
    start = period_seconds(previous["clock"])
    end = period_seconds(shot["clock"])
    if previous["period"] != shot["period"] or start is None or end is None or start < end:
        return "unresolved", "period_or_clock_discontinuity", None, None

    same_team = previous["teamId"] == shot["teamId"]
    opposing_make = (
        previous["teamId"] and not same_team and previous["isFieldGoal"]
        and previous["shotResult"].lower() == "made"
    )
    # Within the stopped-clock window, both clocks restart on the inbound touch.
    stopped_clock_window = 60 if shot["period"] <= 3 else 120
    if opposing_make and start < stopped_clock_window:
        return from_possession_start(start, end, previous, "opponent_make_stopped_clock")

    if i >= 2 and same_team and "STEAL" in previous["description"].upper():
        turnover = actions[i - 2]
        if (
            turnover["period"] == shot["period"] and turnover["teamId"]
            and turnover["teamId"] != shot["teamId"] and turnover["clock"] == previous["clock"]
            and turnover["actionNumber"] == previous["actionNumber"]
            and re.search(r"\b(?:Bad Pass|Lost Ball) Turnover\b", turnover["description"], re.IGNORECASE)
        ):
            return from_possession_start(start, end, previous, "paired_live_ball_steal")

    if i < 2 or not same_team or "REBOUND" not in previous["description"].upper():
        return "unresolved", "no_immediate_defensive_rebound", None, None
    missed_shot = actions[i - 2]
    miss_clock = period_seconds(missed_shot["clock"])
    # The cumulative Off/Def counts in a rebound description do not identify this rebound.
    if (
        missed_shot["period"] != shot["period"] or not missed_shot["isFieldGoal"]
        or not missed_shot["teamId"] or missed_shot["teamId"] == shot["teamId"]
        or missed_shot["shotResult"].lower() != "missed"
        or miss_clock is None or not 0 <= miss_clock - start <= 5
    ):
        return "unresolved", "rebound_possession_not_confirmed", None, None

    return from_possession_start(start, end, previous, "immediate_defensive_rebound")


def inspect_game(game_id, game_rows, selected_ids, cache):
    rows = list(game_rows.itertuples())
    path = cache / f"{game_id}.json"
    actions = []
    if path.is_file():
        game = json.loads(path.read_text(encoding="utf-8"))
        if game["gameId"] != game_id:
            raise ValueError(f"Mismatched cached game ID in {path}")
        actions = game["actions"]
    matches, claims = match_shots(rows, actions)

    for row in rows:
        if row.Index not in selected_ids:
            continue
        result = {
            "game_id": game_id, "matchup": row.MATCHUP, "player_id": row.player_id,
            "player_name": row.player_name, "shot_number": row.SHOT_NUMBER,
            "period": row.PERIOD, "csv_game_clock": row.GAME_CLOCK,
            "csv_period_seconds": row.period_seconds, "recorded_shot_clock": row.SHOT_CLOCK,
            "nba_event": None, "nba_game_clock": None, "event_description": None,
            "context": None, "status": "unresolved", "reason": "no_candidate",
            "estimated_shot_clock": None, "possession_start_event": None,
            "nba_play_by_play": f"https://www.nba.com/game/{game_id}/play-by-play",
        }
        candidates = matches[row.Index]
        if not actions:
            result["reason"] = "game_not_cached"
        elif len(candidates) > 1 or (candidates and claims[candidates[0]] > 1):
            result["reason"] = "ambiguous_event_match"
        elif candidates:
            i = candidates[0]
            shot = actions[i]
            status, reason, estimate, start_event = classify_clock(actions, i)
            result.update(
                nba_event=shot["actionNumber"], nba_game_clock=shot["clock"],
                event_description=shot["description"], status=status, reason=reason,
                estimated_shot_clock=estimate, possession_start_event=start_event,
                context=" | ".join(
                    f"{event['clock']} {event['teamTricode']} {event['description']}"
                    for event in actions[max(0, i - 4):i]
                ),
            )
        yield result


def summarize(missing, controls):
    estimated = controls.loc[controls["status"].eq("estimated")]
    error = estimated["estimated_shot_clock"] - estimated["recorded_shot_clock"]
    absolute = error.abs()
    by_rule = absolute.groupby(estimated["reason"]).agg(attempts="size", mae_seconds="mean")
    return {
        "missing_rows": len(missing), "missing_games": int(missing["game_id"].nunique()),
        "cached_games": int(missing.loc[missing["reason"].ne("game_not_cached"), "game_id"].nunique()),
        "missing_status": missing["status"].value_counts().to_dict(),
        "unresolved_reasons": missing.loc[missing["status"].eq("unresolved"), "reason"].value_counts().to_dict(),
        "missing_matched": int(missing["nba_event"].notna().sum()),
        "control_rows": len(controls), "control_status": controls["status"].value_counts().to_dict(),
        "control_likely_off_with_recorded_clock": int(controls["status"].eq("likely_off").sum()),
        "control_mae_seconds": None if error.empty else round(float(absolute.mean()), 3),
        "control_median_error_seconds": None if error.empty else round(float(absolute.median()), 3),
        "control_p90_error_seconds": None if error.empty else round(float(absolute.quantile(0.9)), 3),
        "control_mean_signed_error_seconds": None if error.empty else round(float(error.mean()), 3),
        "control_share_within_1_second": None if error.empty else round(float(absolute.le(1).mean()), 3),
        "control_estimates_by_rule": by_rule.round(3).to_dict(orient="index"),
    }


def review_queue(missing):
    """Choose a small review sample from matched unresolved cases across clock bands."""
    unresolved = missing.loc[missing["status"].eq("unresolved") & missing["nba_event"].notna()]
    bands = clock_band(unresolved)
    return unresolved.sample(frac=1, random_state=42).groupby(bands, observed=True).head(2)


def clock_band(rows):
    return pd.cut(rows["csv_period_seconds"], CLOCK_BAND_EDGES, labels=CLOCK_BAND_LABELS)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("--cache", type=Path, default=Path("data/raw/nba-play-by-play-v3"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/shot-clock-review"))
    parser.add_argument("--fetch", action="store_true", help="Fetch games absent from the cache")
    args = parser.parse_args()

    shots = pd.read_csv(args.csv, dtype={"GAME_ID": "string"})
    date = pd.to_datetime(shots["MATCHUP"].str.split(" - ", n=1).str[0], format="%b %d, %Y")
    shots = shots.loc[date.lt(HOLDOUT_START)].assign(game_date=date)
    shots["GAME_ID"] = shots["GAME_ID"].str.zfill(10)
    clock = shots["GAME_CLOCK"].str.split(":", expand=True).astype(int)
    shots["period_seconds"] = clock[0] * 60 + clock[1]
    missing = shots.loc[shots["SHOT_CLOCK"].isna()]
    game_ids = sorted(missing["GAME_ID"].unique())
    if args.fetch:
        fetch_games(game_ids, args.cache)

    known = shots.loc[
        shots["game_date"].ge(CONTROL_START) & shots["SHOT_CLOCK"].notna() & shots["GAME_ID"].isin(game_ids)
    ]
    controls = known.sample(n=min(len(known), 2_000), random_state=42)
    selected = set(missing.index) | set(controls.index)
    results = pd.DataFrame(
        item for game_id, game_rows in shots.loc[shots["GAME_ID"].isin(game_ids)].groupby("GAME_ID")
        for item in inspect_game(game_id, game_rows, selected, args.cache)
    )
    results[["nba_event", "possession_start_event"]] = results[
        ["nba_event", "possession_start_event"]
    ].astype("Int64")
    missing_results = results.loc[results["recorded_shot_clock"].isna()]
    control_results = results.loc[results["recorded_shot_clock"].notna()]
    args.output.mkdir(parents=True, exist_ok=True)
    missing_results.to_csv(args.output / "missing-shot-clocks.csv", index=False)
    control_results.to_csv(args.output / "masked-clock-controls.csv", index=False)
    review_queue(missing_results).to_csv(args.output / "review-queue.csv", index=False)
    pd.crosstab(clock_band(missing_results), missing_results["status"]).to_csv(
        args.output / "status-by-clock-band.csv"
    )
    summary = json.dumps(summarize(missing_results, control_results), indent=2)
    (args.output / "summary.json").write_text(summary + "\n", encoding="utf-8")
    print(summary)


if __name__ == "__main__":
    main()
