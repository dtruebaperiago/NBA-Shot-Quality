"""Validate a local copy of Dan Becker's NBA shot log and report holdout support."""

import argparse
from collections import Counter
import csv
from datetime import date, datetime
import json
import math
from pathlib import Path


REQUIRED_COLUMNS = {
    "GAME_ID", "MATCHUP", "GAME_CLOCK", "SHOT_NUMBER", "SHOT_CLOCK", "TOUCH_TIME",
    "player_id", "PTS_TYPE", "SHOT_RESULT", "FGM", "PTS", "CLOSE_DEF_DIST",
}
CONTEST_BUCKETS = ("under_2_ft", "2_to_under_4_ft", "4_to_under_6_ft", "6_ft_or_more")


def contest_bucket(distance):
    if distance < 2:
        return CONTEST_BUCKETS[0]
    if distance < 4:
        return CONTEST_BUCKETS[1]
    if distance < 6:
        return CONTEST_BUCKETS[2]
    return CONTEST_BUCKETS[3]


def audit(path, holdout_start, player_id):
    games = {}
    shot_keys = set()
    results = Counter()
    issues = Counter(dict.fromkeys((
        "zero_defender_distance", "defender_distance_over_25_ft", "negative_touch_time",
        "missing_shot_clock", "missing_shot_clock_with_over_24_seconds_in_period",
    ), 0))
    shooters = {split: Counter() for split in ("history", "holdout")}
    split_games = {split: set() for split in shooters}
    player_threes = {split: Counter(dict.fromkeys(CONTEST_BUCKETS, 0)) for split in shooters}

    with path.open(newline="", encoding="utf-8-sig") as source:
        rows = csv.DictReader(source, strict=True)
        header = rows.fieldnames or []
        missing = REQUIRED_COLUMNS.difference(header)
        if missing:
            raise ValueError(f"Missing columns: {', '.join(sorted(missing))}")
        if len(header) != len(set(header)):
            raise ValueError("Duplicate column names")

        for row in rows:
            try:
                if None in row or any(value is None for value in row.values()):
                    raise ValueError("Row length differs from header")
                game_id = row["GAME_ID"]
                shooter_id = int(row["player_id"])
                shot_number = int(row["SHOT_NUMBER"])
                shot_key = (game_id, shooter_id, shot_number)
                if not game_id.isdigit() or shooter_id <= 0 or shot_number <= 0:
                    raise ValueError("Invalid game, shooter, or shot identifier")
                if shot_key in shot_keys:
                    raise ValueError(f"Duplicate shot key {shot_key}")

                played = datetime.strptime(row["MATCHUP"].split(" - ", 1)[0], "%b %d, %Y").date()
                if games.setdefault(game_id, played) != played:
                    raise ValueError(f"Conflicting dates for game {game_id}")

                outcome = row["SHOT_RESULT"]
                made = int(row["FGM"])
                shot_value = int(row["PTS_TYPE"])
                if outcome not in {"made", "missed"} or made != int(outcome == "made"):
                    raise ValueError("SHOT_RESULT and FGM must agree")
                if shot_value not in {2, 3} or int(row["PTS"]) != made * shot_value:
                    raise ValueError("Invalid shot value or points scored")

                distance = float(row["CLOSE_DEF_DIST"])
                touch_time = float(row["TOUCH_TIME"])
                minutes, seconds = map(int, row["GAME_CLOCK"].split(":"))
                if not math.isfinite(distance) or distance < 0:
                    raise ValueError("Invalid closest-defender distance")
                if not math.isfinite(touch_time) or minutes < 0 or not 0 <= seconds < 60:
                    raise ValueError("Invalid touch time or game clock")
            except ValueError as error:
                raise ValueError(f"CSV line {rows.line_num}: {error}") from error

            shot_keys.add(shot_key)
            results[outcome] += 1
            issues["zero_defender_distance"] += distance == 0
            issues["defender_distance_over_25_ft"] += distance > 25
            issues["negative_touch_time"] += touch_time < 0
            if not row["SHOT_CLOCK"].strip():
                issues["missing_shot_clock"] += 1
                issues["missing_shot_clock_with_over_24_seconds_in_period"] += minutes * 60 + seconds > 24

            split = "holdout" if played >= holdout_start else "history"
            split_games[split].add(game_id)
            shooters[split][shooter_id] += 1
            if shooter_id == player_id and shot_value == 3:
                player_threes[split][contest_bucket(distance)] += 1

    if not shot_keys:
        raise ValueError("Shot log contains no attempts")

    return {
        "attempts": len(shot_keys),
        "games": len(games),
        "shooters": len(shooters["history"].keys() | shooters["holdout"].keys()),
        "first_game_date": min(games.values()).isoformat(),
        "last_game_date": max(games.values()).isoformat(),
        "outcomes": results,
        "quality_flags": issues,
        "holdout_start_inclusive": holdout_start.isoformat(),
        "holdout_shooters_without_history": len(shooters["holdout"].keys() - shooters["history"].keys()),
        "focus_player_id": player_id,
        "splits": {
            split: {
                "attempts": sum(counts.values()),
                "games": len(split_games[split]),
                "shooters": len(counts),
                "focus_player_attempts": counts[player_id],
                "focus_player_threes_by_contest": player_threes[split],
            }
            for split, counts in shooters.items()
        },
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path, help="Path to the extracted shot_logs.csv")
    parser.add_argument("--holdout-start", type=date.fromisoformat, default="2015-02-01", metavar="YYYY-MM-DD")
    parser.add_argument("--player-id", type=int, default=201939, help="Shooter to inspect (default: Stephen Curry)")
    args = parser.parse_args()
    try:
        report = audit(args.csv, args.holdout_start, args.player_id)
    except (OSError, ValueError, csv.Error) as error:
        parser.exit(1, f"Shot log audit failed: {error}\n")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
