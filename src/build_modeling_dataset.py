"""Build chronological shot-level datasets from the local 2014–15 archive."""

import argparse
import json
from math import isfinite
from pathlib import Path

import pandas as pd


VALIDATION_START = "2015-01-01"
HOLDOUT_START = "2015-02-01"
SHOT_KEY = ["GAME_ID", "player_id", "SHOT_NUMBER"]
TARGET = "FGM"
OPENING_DAY_FG_RATE = 0.454
HISTORY_COLUMNS = ["SHOOTER_PRIOR_ATTEMPTS", "SHOOTER_PRIOR_MAKES", "LEAGUE_PRIOR_FG_RATE"]
CONTEXT_COLUMNS = [
    "SHOT_DIST_CLEAN", "CLOSE_DEF_DIST", "TOUCH_TIME_CLEAN",
    "DRIBBLES", "PERIOD", "PERIOD_SECONDS", "PTS_TYPE", "LOCATION",
]
OUTPUT_COLUMNS = [
    *SHOT_KEY, "GAME_DATE", "player_name", "CLOSEST_DEFENDER_PLAYER_ID",
    TARGET, *CONTEXT_COLUMNS, "SHOT_DIST", "SHOT_DIST_SOURCE", "TOUCH_TIME",
    "SHOT_CLOCK", "SHOT_CLOCK_WITH_PERIOD_FALLBACK", "SHOT_CLOCK_CLEAN", "CLOCK_SOURCE",
]
# Notebook 01 documents the review behind each correction.
BASKET_DISTANCE_CORRECTIONS = {
    ("0021400589", 201600, 5): "layup_distance_estimate",
    ("0021400378", 201163, 6): "layup_distance_estimate",
    ("0021400671", 201601, 10): "nba_play_by_play",
    ("0021400702", 201596, 5): "layup_distance_estimate",
}


def normalize_keys(rows):
    if not rows["GAME_ID"].str.fullmatch(r"[0-9]{1,10}").fillna(False).all():
        raise ValueError("Expected a numeric GAME_ID of at most 10 digits")
    rows["GAME_ID"] = rows["GAME_ID"].str.zfill(10)
    for column in ("player_id", "SHOT_NUMBER"):
        if not (rows[column].notna() & rows[column].gt(0) & rows[column].mod(1).eq(0)).all():
            raise ValueError(f"Expected positive integer values for {column}")
    if rows.duplicated(SHOT_KEY).any():
        raise ValueError("Duplicate shot keys after GAME_ID normalization")


def reconstruction_estimates(report):
    audit = pd.read_csv(
        report, dtype={"game_id": "string"},
        usecols=["game_id", "player_id", "shot_number", "status", "estimated_shot_clock"],
    ).rename(columns={"game_id": "GAME_ID", "shot_number": "SHOT_NUMBER"})
    normalize_keys(audit)
    seconds = pd.to_numeric(audit["estimated_shot_clock"], errors="coerce")
    return audit.assign(estimate=seconds).loc[
        audit["status"].eq("estimated") & seconds.between(0, 24),
    ].set_index(SHOT_KEY)["estimate"]


def add_shooter_history(shots, opening_rate=OPENING_DAY_FG_RATE):
    """Count supplied attempts and makes from completed dates."""
    daily = shots.groupby(["player_id", "GAME_DATE"], sort=True)[TARGET].agg(
        attempts="size", makes="sum",
    )
    totals = daily.groupby(level="player_id").cumsum() - daily
    totals.columns = HISTORY_COLUMNS[:2]
    league_daily = daily.groupby(level="GAME_DATE", sort=True).sum()
    league_prior = league_daily.cumsum() - league_daily
    league_rate = league_prior["makes"].div(
        league_prior["attempts"].where(league_prior["attempts"].ne(0))
    ).fillna(opening_rate)
    totals[HISTORY_COLUMNS[2]] = league_rate.reindex(totals.index.get_level_values("GAME_DATE")).to_numpy()
    return shots.join(totals, on=["player_id", "GAME_DATE"], validate="many_to_one")


def smoothed_shooter_rate(shots, prior_attempts):
    """Weight the earlier league rate as a positive number of prior attempts."""
    if not isfinite(prior_attempts) or prior_attempts <= 0:
        raise ValueError("Shrinkage strength must be finite and positive")
    attempts, makes, league_rate = HISTORY_COLUMNS
    return (shots[makes] + prior_attempts * shots[league_rate]) / (shots[attempts] + prior_attempts)


def build_datasets(raw_path, report):
    shots = pd.read_csv(raw_path, dtype={"GAME_ID": "string"})
    normalize_keys(shots)
    shots["GAME_DATE"] = pd.to_datetime(
        shots["MATCHUP"].str.split(" - ", n=1).str[0], format="%b %d, %Y",
    )
    if shots["GAME_DATE"].isna().any():
        raise ValueError("Missing game date")
    if shots.groupby("GAME_ID")["GAME_DATE"].nunique().gt(1).any():
        raise ValueError("A GAME_ID has conflicting dates")
    if not shots[TARGET].isin([0, 1]).all():
        raise ValueError("FGM must be 0 or 1")
    clock = shots["GAME_CLOCK"].str.extract(r"^([0-9]+):([0-5][0-9])$")
    if clock.isna().any(axis=None):
        raise ValueError("Invalid period clock. Expected minutes:seconds")
    shots["PERIOD_SECONDS"] = clock[0].astype(int) * 60 + clock[1].astype(int)

    keys = pd.MultiIndex.from_frame(shots[SHOT_KEY])
    correction_sources = pd.Series(BASKET_DISTANCE_CORRECTIONS).reindex(keys)
    corrected = correction_sources.notna().to_numpy()
    if corrected.sum() != len(BASKET_DISTANCE_CORRECTIONS) or not shots.loc[corrected, "SHOT_DIST"].eq(0).all():
        raise ValueError("Expected the four reviewed basket-distance keys to match recorded zeros")
    shots["SHOT_DIST_CLEAN"] = shots["SHOT_DIST"].mask(corrected, 2.0)
    shots["SHOT_DIST_SOURCE"] = correction_sources.fillna("recorded").to_numpy()
    shots["TOUCH_TIME_CLEAN"] = shots["TOUCH_TIME"].mask(shots["TOUCH_TIME"].lt(0))

    recorded = shots["SHOT_CLOCK"]
    period_proxy = recorded.isna() & shots["PERIOD_SECONDS"].le(24)
    shots["SHOT_CLOCK_WITH_PERIOD_FALLBACK"] = recorded.mask(period_proxy, shots["PERIOD_SECONDS"])
    shots["SHOT_CLOCK_CLEAN"] = shots["SHOT_CLOCK_WITH_PERIOD_FALLBACK"]
    shots["CLOCK_SOURCE"] = "unresolved"
    shots.loc[recorded.notna(), "CLOCK_SOURCE"] = "recorded"
    shots.loc[period_proxy, "CLOCK_SOURCE"] = "period_proxy"
    if report is not None:
        estimates = reconstruction_estimates(report).reindex(keys)
        use_estimate = recorded.isna() & shots["GAME_DATE"].lt(HOLDOUT_START) & estimates.notna().to_numpy()
        shots.loc[use_estimate, "SHOT_CLOCK_CLEAN"] = estimates.to_numpy()[use_estimate]
        shots.loc[use_estimate, "CLOCK_SOURCE"] = "possession_estimate"

    shots = shots[OUTPUT_COLUMNS].sort_values(["GAME_DATE", *SHOT_KEY])
    before_holdout = shots["GAME_DATE"].lt(HOLDOUT_START)
    development = add_shooter_history(shots.loc[before_holdout])
    before_validation = development["GAME_DATE"].lt(VALIDATION_START)
    splits = {
        "train": development.loc[before_validation],
        "validation": development.loc[~before_validation],
        "holdout": shots.loc[~before_holdout],
    }
    if any(split.empty for split in splits.values()):
        raise ValueError("Expected attempts in all three chronological splits")
    return splits


def summarize(split):
    return {
        "attempts": len(split),
        "games": int(split["GAME_ID"].nunique()),
        "first_game_date": split["GAME_DATE"].min().date().isoformat(),
        "last_game_date": split["GAME_DATE"].max().date().isoformat(),
        "clock_sources": split["CLOCK_SOURCE"].value_counts().to_dict(),
        "late_period_proxies_replaced": int(
            (split["CLOCK_SOURCE"].eq("possession_estimate") & split["PERIOD_SECONDS"].le(24)).sum()
        ),
        "negative_touch_times_cleared": int(split["TOUCH_TIME"].lt(0).sum()),
        "basket_distance_corrections": int(split["SHOT_DIST_SOURCE"].ne("recorded").sum()),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, nargs="?", default=Path("data/raw/shot_logs.csv"))
    clocks = parser.add_mutually_exclusive_group()
    clocks.add_argument("--reconstruction-report", type=Path, default=Path(
        "data/processed/shot-clock-review/missing-shot-clocks.csv"
    ))
    clocks.add_argument("--period-clock-only", action="store_true", help="Build without retrospective estimates")
    parser.add_argument("--output", type=Path, default=Path("data/processed/modeling"))
    args = parser.parse_args()
    report = None if args.period_clock_only else args.reconstruction_report
    if report is not None and not report.is_file():
        parser.error(
            f"Missing reconstruction report: {report}. Run src/reconstruct_shot_clock.py with the "
            "source CSV and local cache, or use --period-clock-only for a build without estimates."
        )

    try:
        splits = build_datasets(args.csv, report)
        manifest = {
            "source_csv": args.csv.as_posix(),
            "reconstruction_report": report.as_posix() if report is not None else None,
            "validation_start": VALIDATION_START,
            "holdout_start": HOLDOUT_START,
            "shot_key": SHOT_KEY,
            "target": TARGET,
            "baseline_context_columns": CONTEXT_COLUMNS,
            "development_history_columns": HISTORY_COLUMNS,
            "opening_day_league_fg_rate": OPENING_DAY_FG_RATE,
            "outcome_independent_clock_candidate": "SHOT_CLOCK_WITH_PERIOD_FALLBACK",
            "retrospective_clock_for_audit": "SHOT_CLOCK_CLEAN",
            "splits": {
                name: {"file": f"{name}.csv", **summarize(split)} for name, split in splits.items()
            },
        }
        args.output.mkdir(parents=True, exist_ok=True)
        for name, split in splits.items():
            split.to_csv(args.output / f"{name}.csv", index=False, date_format="%Y-%m-%d")
        summary = json.dumps(manifest, indent=2)
        (args.output / "manifest.json").write_text(summary + "\n", encoding="utf-8")
    except (OSError, ValueError, KeyError) as error:
        parser.exit(1, f"Modeling dataset build failed: {error}\n")
    print(summary)


if __name__ == "__main__":
    main()
