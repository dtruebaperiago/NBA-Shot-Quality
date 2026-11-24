"""Export the archive with retrospective estimates and frozen holdout scores for local development."""

import json
from pathlib import Path
import sys
from tempfile import NamedTemporaryFile

from joblib import load
import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "src"))
from final_evaluation import FINAL, predict_specialist, prepare_final_rows  # noqa: E402
from play_by_play_context import COURT, EVENT_CONTEXT_COLUMNS, FAMILY, court_zone, link_shot_types  # noqa: E402


KEY = ["GAME_ID", "player_id", "SHOT_NUMBER"]
TEAMS = {
    "ATL": ("Atlanta", "Hawks", "#a53843"),
    "BKN": ("Brooklyn", "Nets", "#3e454a"),
    "BOS": ("Boston", "Celtics", "#276048"),
    "CHA": ("Charlotte", "Hornets", "#4b4089"),
    "CHI": ("Chicago", "Bulls", "#a53744"),
    "CLE": ("Cleveland", "Cavaliers", "#854058"),
    "DAL": ("Dallas", "Mavericks", "#326591"),
    "DEN": ("Denver", "Nuggets", "#2b4b6f"),
    "DET": ("Detroit", "Pistons", "#9a344c"),
    "GSW": ("Golden State", "Warriors", "#315b92"),
    "HOU": ("Houston", "Rockets", "#ab4134"),
    "IND": ("Indiana", "Pacers", "#344e6c"),
    "LAC": ("Los Angeles", "Clippers", "#495b92"),
    "LAL": ("Los Angeles", "Lakers", "#674993"),
    "MEM": ("Memphis", "Grizzlies", "#476486"),
    "MIA": ("Miami", "Heat", "#963948"),
    "MIL": ("Milwaukee", "Bucks", "#38634f"),
    "MIN": ("Minnesota", "Timberwolves", "#345e73"),
    "NOP": ("New Orleans", "Pelicans", "#3d4a70"),
    "NYK": ("New York", "Knicks", "#3e6193"),
    "OKC": ("Oklahoma City", "Thunder", "#2e678a"),
    "ORL": ("Orlando", "Magic", "#365f89"),
    "PHI": ("Philadelphia", "76ers", "#35618a"),
    "PHX": ("Phoenix", "Suns", "#60487f"),
    "POR": ("Portland", "Trail Blazers", "#a13946"),
    "SAC": ("Sacramento", "Kings", "#644782"),
    "SAS": ("San Antonio", "Spurs", "#435054"),
    "TOR": ("Toronto", "Raptors", "#9f394e"),
    "UTA": ("Utah", "Jazz", "#3a594a"),
    "WAS": ("Washington", "Wizards", "#374b73"),
}
ZONES = {
    "At rim": "Rim", "Outside paint": "Midrange", "Left corner three": "Corner three",
    "Right corner three": "Corner three", "Above-the-break three": "Above the break",
}


def number(value, cast=float):
    return cast(value) if pd.notna(value) else None


def label(value, fallback="Unknown"):
    return value if pd.notna(value) and value else fallback


def archive_scores(shots, context, holdout, final_model):
    settings = final_model["settings"]
    cutoff = settings["cutoff"]
    earlier = shots["GAME_DATE"].lt(cutoff)
    if holdout.empty or holdout["GAME_DATE"].min() != cutoff:
        raise ValueError("The saved model cutoff must match the holdout export")
    metadata = context[[*KEY, "match_method", FAMILY, *COURT, *EVENT_CONTEXT_COLUMNS]]
    results = []
    with threadpool_limits(limits=3):
        for value, bundle in sorted(final_model["models"].items()):
            print(f"Rebuilding {value}PT features for archive scoring", flush=True)
            rows, linked, tracking, enriched = prepare_final_rows(
                shots.loc[earlier], shots.loc[~earlier], value, settings["history"], metadata, cutoff,
            )
            if tracking != bundle["tracking_columns"] or enriched != bundle["enriched_columns"]:
                raise ValueError(f"The {value}PT feature columns do not match the saved model")
            _, probabilities = predict_specialist(bundle, rows, linked)
            results.append(rows[[*KEY, "GAME_DATE"]].assign(
                probability=probabilities, play_by_play_linked=rows.index.isin(linked.index),
            ))

    scored = pd.concat(results, ignore_index=True)
    if len(scored) != len(shots) or not scored["probability"].between(0, 1).all():
        raise ValueError("Expected one valid probability per archived attempt")
    replay = scored.loc[scored["GAME_DATE"].ge(cutoff)].merge(
        holdout, on=[*KEY, "GAME_DATE"], suffixes=("", "_saved"), validate="one_to_one",
    )
    if len(replay) != len(holdout) or len(replay) != (~earlier).sum():
        raise ValueError("Holdout replay coverage differs from the saved evaluation")
    np.testing.assert_array_equal(replay["play_by_play_linked"], replay["play_by_play_linked_saved"])
    np.testing.assert_allclose(replay["probability"], replay[FINAL], atol=1e-12, rtol=0)
    # Keep the published probabilities exactly as exported by the evaluation.
    return pd.concat([
        scored.loc[scored["GAME_DATE"].lt(cutoff)], holdout.rename(columns={FINAL: "probability"}),
    ], ignore_index=True).drop(columns="GAME_DATE"), cutoff


def main():
    processed = ROOT / "data/processed"
    raw = pd.read_csv(ROOT / "data/raw/shot_logs.csv", usecols=[*KEY, "MATCHUP"], dtype={"GAME_ID": str})
    raw["GAME_ID"] = raw["GAME_ID"].str.zfill(10)
    matchup = raw["MATCHUP"].str.extract(r" - ([A-Z]{2,3}) (?:vs\.?|@) ([A-Z]{2,3})$")
    raw["team"], raw["opponent"] = matchup[0], matchup[1]

    shots = pd.concat([
        pd.read_csv(processed / "modeling" / name, dtype={"GAME_ID": str})
        for name in ("train.csv", "validation.csv", "holdout.csv")
    ], ignore_index=True)
    shots["GAME_ID"] = shots["GAME_ID"].str.zfill(10)
    shots = shots.merge(raw[[*KEY, "team", "opponent"]], on=KEY, how="left", validate="one_to_one")
    if not shots["team"].isin(TEAMS).all() or not shots["opponent"].isin(TEAMS).all():
        raise ValueError("Every archive attempt must resolve to two known teams")
    # Link whole games first so event pairs see every candidate for the matchup.
    print(f"Linking {len(shots):,} attempts to the play-by-play cache", flush=True)
    context = link_shot_types(shots, ROOT / "data/raw/nba-play-by-play-v3", include_context=True)
    holdout = pd.read_csv(processed / "final-evaluation/holdout-predictions.csv", usecols=[*KEY, FINAL, "play_by_play_linked", "GAME_DATE"], dtype={"GAME_ID": str})
    holdout["GAME_ID"] = holdout["GAME_ID"].str.zfill(10)
    scores, scored_start = archive_scores(shots, context, holdout, load(ROOT / "models/final-shot-quality.joblib"))
    context = context.merge(scores, on=KEY, how="left", validate="one_to_one")
    if context["probability"].isna().any():
        raise ValueError("Some archive attempts did not receive a probability")
    context = context.sort_values(["GAME_DATE", "GAME_ID", "player_id", "SHOT_NUMBER"], ascending=[False, True, True, True])
    records = []
    for row in context.itertuples(index=False):
        conflict = pd.notna(row.match_outcome_agrees) and not row.match_outcome_agrees
        x, y = (None, None) if conflict else (row.COURT_X, row.COURT_Y)
        family = "Unknown" if conflict else label(row.SHOT_FAMILY)
        zone = court_zone(x, y, row.PTS_TYPE)
        records.append({
            "id": f"{row.GAME_ID}-{row.player_id}-{row.SHOT_NUMBER}", "game": row.GAME_ID,
            "date": row.GAME_DATE, "player": row.player_name.title().replace("Mcdaniels", "McDaniels"),
            "team": row.team, "opponent": label(row.opponent), "period": row.PERIOD,
            "gameClock": int(row.PERIOD_SECONDS), "shotClock": number(row.SHOT_CLOCK),
            "defender": number(row.CLOSE_DEF_DIST), "basketDistance": number(row.SHOT_DIST_CLEAN),
            "value": row.PTS_TYPE, "made": bool(row.FGM),
            "probability": number(row.probability),
            **({"retrospective": True} if row.GAME_DATE < scored_start else {}),
            "trackingOnly": number(row.probability) is not None and not bool(row.play_by_play_linked),
            "x": number(x, int), "y": number(y, int),
            **({"contextConflict": True} if conflict else {}),
            "zone": ZONES.get(zone, zone),
            "family": "Jump shot" if family == "Generic jump shot" else family,
        })

    if not records or not any(row["player"] == "Stephen Curry" for row in records):
        raise ValueError("No expected preview shots were found in the archive")
    dataset = {
        "source": "archive", "label": "2014–15 archive preview", "start": min(row["date"] for row in records),
        "end": max(row["date"] for row in records), "scoredStart": scored_start,
        "defaultPlayer": "Stephen Curry", "teams": {
            code: {"name": f"{city} {nickname}", "city": city, "color": color, "mark": code}
            for code, (city, nickname, color) in TEAMS.items()
        }, "shots": records,
    }
    target = ROOT / "frontend/.local/archive.json"
    target.parent.mkdir(exist_ok=True)
    with NamedTemporaryFile(mode="w", dir=target.parent, encoding="utf-8", delete=False) as temporary:
        temporary_path = Path(temporary.name)
    try:
        temporary_path.write_text(json.dumps(dataset, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
        temporary_path.replace(target)
    finally:
        temporary_path.unlink(missing_ok=True)
    print(f"Wrote {len(records):,} attempts with {len(scores) - len(holdout):,} retrospective estimates and {len(holdout):,} unchanged holdout predictions to {target}")


if __name__ == "__main__":
    main()
