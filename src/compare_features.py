"""Compare defender distance, shot clock, and defender history on January shots."""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

from build_modeling_dataset import CONTEXT_COLUMNS, HISTORY_COLUMNS, SHOT_KEY, TARGET, VALIDATION_START
from fit_baselines import choose_shrinkage, fit_context, load_development, save_calibration, score_predictions
from shot_history import CLOCK, DEFENDER, DEFENDER_HISTORY, DEFENDER_SUPPORT, add_defender_history


DISTANCE = "CLOSE_DEF_DIST"


def score_slices(validation, predictions):
    groups = {
        "Shot value": validation["PTS_TYPE"],
        "Defender distance (ft)": pd.cut(validation[DISTANCE], [0, 2, 4, 6, np.inf], right=False),
        "Shooter prior attempts": pd.cut(validation[HISTORY_COLUMNS[0]], [0, 1, 20, 100, np.inf], right=False),
        "Clock source": validation["CLOCK_SOURCE"],
        "Defender prior scored attempts": pd.cut(validation[DEFENDER_SUPPORT], [0, 1, 50, 100, np.inf], right=False),
    }
    scores = []
    for dimension, group in groups.items():
        for value, rows in validation.groupby(group, observed=True):
            scores.append(score_predictions(
                rows[TARGET], {name: values[rows.index] for name, values in predictions.items()},
            ).assign(slice=dimension, value=str(value)))
    tight_threes = validation.loc[
        validation["player_id"].eq(203081) & validation["PTS_TYPE"].eq(3) & validation[DISTANCE].lt(2)
    ]
    if not tight_threes.empty:
        scores.append(score_predictions(
            tight_threes[TARGET], {name: values[tight_threes.index] for name, values in predictions.items()},
        ).assign(slice="Damian Lillard", value="Threes under 2 ft"))
    return pd.concat(scores, ignore_index=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/feature-comparisons"))
    args = parser.parse_args()
    train, validation = load_development(args.data)
    if not validation["CLOCK_SOURCE"].eq("possession_estimate").any():
        parser.error("Build the modeling dataset with the reconstruction report before running this comparison")

    weight = choose_shrinkage(validation)
    without_distance = [column for column in CONTEXT_COLUMNS if column != DISTANCE]
    variants = {
        "Neither": without_distance,
        "Defender distance": CONTEXT_COLUMNS,
        "Shot clock": [*without_distance, CLOCK],
        "Defender distance + shot clock": [*CONTEXT_COLUMNS, CLOCK],
        "Defender distance + reconstructed clock": [*CONTEXT_COLUMNS, "SHOT_CLOCK_CLEAN"],
    }
    with threadpool_limits(limits=1):
        predictions = {
            name: fit_context(train, validation, weight, columns)
            for name, columns in variants.items()
        }
        scores = score_predictions(validation[TARGET], predictions)
        print(scores.to_string(index=False), flush=True)

        # Use the better January model among the two with distance and an outcome-independent clock policy.
        eligible = scores["baseline"].isin(["Defender distance", "Defender distance + shot clock"])
        parent = scores.loc[eligible].sort_values("log_loss").iloc[0]["baseline"]
        print(f"Building earlier-date defender history for comparison against: {parent}", flush=True)
        development = add_defender_history(pd.concat([train, validation], ignore_index=True))
        before_january = development["GAME_DATE"].lt(VALIDATION_START)
        train_history = development.loc[before_january]
        validation_history = development.loc[~before_january]
        # Match the baseline predictions to the feature rows even if the input was reordered.
        validation_history = validation[SHOT_KEY].merge(validation_history, on=SHOT_KEY, validate="one_to_one")
        predictions["Selected context + defender history"] = fit_context(
            train_history, validation_history, weight, [*variants[parent], DEFENDER_HISTORY],
        )
        reconstructed = "Defender distance + reconstructed clock"
        reconstructed_history = f"{reconstructed} + defender history"
        predictions[reconstructed_history] = fit_context(
            train_history, validation_history, weight, [*variants[reconstructed], DEFENDER_HISTORY],
        )

    history_predictions = {
        name: predictions[name]
        for name in (parent, "Selected context + defender history", reconstructed, reconstructed_history)
    }
    history_scores = score_predictions(validation[TARGET], history_predictions)
    args.output.mkdir(parents=True, exist_ok=True)
    scores.to_csv(args.output / "january-context-scores.csv", index=False)
    history_scores.to_csv(args.output / "january-defender-history-scores.csv", index=False)
    score_slices(validation_history, predictions).to_csv(args.output / "january-slice-scores.csv", index=False)
    development[[*SHOT_KEY, "GAME_DATE", DEFENDER, DEFENDER_SUPPORT, DEFENDER_HISTORY]].to_csv(
        args.output / "defender-history.csv", index=False,
    )
    save_calibration(validation[TARGET], predictions, args.output / "january-calibration.png")
    print(history_scores.to_string(index=False))


if __name__ == "__main__":
    main()
