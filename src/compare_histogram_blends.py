"""Replace only Histogram with its 12-leaf version in saved January blends."""

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

from build_modeling_dataset import SHOT_KEY, TARGET
from fit_baselines import diagnostic_scores, game_bootstrap, load_development
from compare_shot_type_routes import BLENDS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/shot-type-comparison"))
    args = parser.parse_args()
    _, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    original = pd.read_csv(args.output / "january-fully-separate-predictions.csv", dtype={"GAME_ID": "string"})
    smaller = pd.read_csv(args.output / "january-tree-pruning-predictions.csv", dtype={"GAME_ID": "string"})
    keys = [*SHOT_KEY, "GAME_DATE", "PTS_TYPE", TARGET]
    for saved in (original, smaller):
        pd.testing.assert_frame_equal(saved[keys], validation[keys])
    predictions = {}
    for name, members in BLENDS.items():
        predictions[name] = np.mean([
            (smaller if member == "Histogram gradient boosting" else original)[member].to_numpy()
            for member in members
        ], axis=0)
        np.testing.assert_allclose(original[members].mean(axis=1), original[name], rtol=0, atol=1e-8)
    records = []
    groups = [("All", validation), *((f"{value}PT", rows) for value, rows in validation.groupby("PTS_TYPE"))]
    for label, rows in groups:
        for name, probabilities in predictions.items():
            pair = {"Original": original.loc[rows.index, name].to_numpy(), "12-leaf Histogram": probabilities[rows.index]}
            scores = diagnostic_scores(rows[TARGET], pair).set_index("baseline")
            record = scores.loc["12-leaf Histogram"].to_dict()
            record.update(game_bootstrap(rows, pair, "Original").loc["12-leaf Histogram"].to_dict())
            record.update(model=name, shot_type=label, original_log_loss=scores.at["Original", "log_loss"])
            record["log_loss_delta"] = record["log_loss"] - record["original_log_loss"]
            records.append(record)
    results = pd.DataFrame(records)
    results.to_csv(args.output / "january-histogram-blend-scores.csv", index=False)
    pd.concat([validation[keys], pd.DataFrame(predictions)], axis=1).to_csv(
        args.output / "january-histogram-blend-predictions.csv", index=False,
    )
    print(results[["shot_type", "model", "original_log_loss", "log_loss", "log_loss_delta",
                   "game_bootstrap_ci_low", "game_bootstrap_ci_high"]].to_string(index=False))


if __name__ == "__main__":
    main()
