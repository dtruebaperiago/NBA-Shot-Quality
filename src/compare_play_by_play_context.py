"""Compare four PlayByPlayV3 feature groups on the linked January attempts."""

import argparse
import json
from pathlib import Path

import pandas as pd
from threadpoolctl import threadpool_limits

from build_modeling_dataset import SHOT_KEY, VALIDATION_START
from play_by_play_context import (
    CONTEXT_GROUPS, COURT, EVENT_CONTEXT_COLUMNS, FAMILY, link_shot_types, OPPONENT_PRIOR_COLUMNS,
    OUTPUT_COLUMNS,
)
from shot_history import (
    add_family_history, add_opponent_history, OPENING_RATES, OPPONENT_PRIOR_WEIGHT,
    prepare_specialist_rows,
)
from compare_shot_family_models import evaluate
from tree_models import fit_probabilities, HISTOGRAM
from fit_baselines import load_development


REFERENCE = "Existing enriched model"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--cache", type=Path, default=Path("data/raw/nba-play-by-play-v3"))
    parser.add_argument("--settings", type=Path, default=Path("data/processed/retraining-50-10/settings.json"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/play-by-play-context"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    train, validation = load_development(args.data)
    config = json.loads(args.settings.read_text(encoding="utf-8"))["tree_settings"][HISTOGRAM]
    settings = {**config["parameters"], "max_leaf_nodes": 12}
    linked = link_shot_types(pd.concat([train, validation], ignore_index=True), args.cache, include_context=True)
    metadata_columns = ["match_method", "SHOT_SUBTYPE", FAMILY, *COURT, *EVENT_CONTEXT_COLUMNS]
    metadata = linked[[*SHOT_KEY, *metadata_columns]]
    inputs = [column for group in CONTEXT_GROUPS.values() for column in group]
    scores, predictions, exports = [], [], []
    with threadpool_limits(limits=3):
        for value in (2, 3):
            rows, columns = prepare_specialist_rows(train, validation, value, config, metadata)
            eligible = rows[[FAMILY, *COURT]].notna().all(axis=1)
            matched = add_opponent_history(rows.loc[eligible], OPENING_RATES[value])
            reference_columns = [*columns, *COURT, FAMILY]
            if value == 2:
                matched = add_family_history(matched, OPENING_RATES[value])
                reference_columns.extend(["FAMILY_PRIOR_ATTEMPTS", "FAMILY_PRIOR_RATE"])
            before = matched["GAME_DATE"].lt(VALIDATION_START)
            training, scoring = matched.loc[before], matched.loc[~before]
            models = {
                REFERENCE: reference_columns,
                **{name: [*reference_columns, *group] for name, group in CONTEXT_GROUPS.items()},
                "All new groups": [*reference_columns, *inputs],
            }
            probabilities = {}
            print(f"{value}PT with {len(training):,} training shots and {len(scoring):,} January shots", flush=True)
            for name, features in models.items():
                probabilities[name] = fit_probabilities(training, scoring, features, settings)
            scores.append(evaluate(scoring, probabilities, REFERENCE, "Play-by-play context"))
            predictions.append(scoring[OUTPUT_COLUMNS].assign(**probabilities))
            exports.append(rows[[*OUTPUT_COLUMNS[:-1], *metadata_columns]].join(matched[OPPONENT_PRIOR_COLUMNS]))

    results = pd.concat(scores, ignore_index=True)
    results.to_csv(args.output / "january-scores.csv", index=False)
    pd.concat(predictions).sort_values(["GAME_DATE", *SHOT_KEY]).to_csv(args.output / "january-predictions.csv", index=False)
    pd.concat(exports).sort_values(["GAME_DATE", *SHOT_KEY]).to_csv(args.output / "development-features.csv", index=False)
    settings_record = {
        "parameters": settings,
        "reference_2pt_includes_shooter_family_history": True,
        "reference_3pt_includes_shooter_family_history": False,
        "opponent_history_weight": OPPONENT_PRIOR_WEIGHT,
        "added_groups": CONTEXT_GROUPS,
    }
    (args.output / "settings.json").write_text(json.dumps(settings_record, indent=2) + "\n", encoding="utf-8")
    print(results[[
        "shot_value", "baseline", "log_loss", "brier_score",
        "delta_vs_reference", "game_bootstrap_ci_low", "game_bootstrap_ci_high",
    ]].to_string(index=False), flush=True)


if __name__ == "__main__":
    main()
