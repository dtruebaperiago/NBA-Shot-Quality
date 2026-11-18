"""Compare pooled and separate two- and three-point models on January shots."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from xgboost import XGBClassifier

from build_modeling_dataset import TARGET, VALIDATION_START
from shot_history import add_defender_history, FEATURES, with_defender_weight
from fit_baselines import fit_context, load_development, save_calibration, score_predictions
from play_by_play_context import SHOT_VALUE


MODELS = {
    "Histogram gradient boosting": HistGradientBoostingClassifier,
    "XGBoost": XGBClassifier,
}


def compare(train, validation, settings):
    predictions = {}
    for model, estimator in MODELS.items():
        config = settings.loc[model]
        parameters = json.loads(config["parameters"])
        training = with_defender_weight(train, config["defender_weight"])
        scoring = with_defender_weight(validation, config["defender_weight"])
        weight = config["shooter_weight"]
        predictions[f"{model} / pooled"] = fit_context(
            training, scoring, weight, FEATURES, estimator(**parameters),
        )

        # Within either specialist, shot value is constant.
        specialist_columns = [column for column in FEATURES if column != SHOT_VALUE]
        specialist = np.empty(len(scoring))
        for value in (2, 3):
            mask = scoring[SHOT_VALUE].eq(value)
            specialist[mask] = fit_context(
                training.loc[training[SHOT_VALUE].eq(value)], scoring.loc[mask],
                weight, specialist_columns, estimator(**parameters),
            )
        predictions[f"{model} / separate"] = specialist
    return predictions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--tuned", type=Path, default=Path("data/processed/tree-tuning/january-best.csv"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/shot-type-comparison"))
    args = parser.parse_args()
    train, validation = load_development(args.data)
    if any(set(split[SHOT_VALUE]) != {2, 3} for split in (train, validation)):
        parser.error("Expected only two- and three-point attempts, with both values in each split")
    settings = pd.read_csv(args.tuned).set_index("baseline", verify_integrity=True)

    with threadpool_limits(limits=2):
        print("Building defender history from completed dates", flush=True)
        shots = add_defender_history(pd.concat([train, validation], ignore_index=True))
        before_january = shots["GAME_DATE"].lt(VALIDATION_START)
        train = shots.loc[before_january]
        validation = shots.loc[~before_january].reset_index(drop=True)
        predictions = compare(train, validation, settings)

    scores = score_predictions(validation[TARGET], predictions).assign(shot_type="All")
    by_type = [
        score_predictions(
            rows[TARGET], {name: values[rows.index] for name, values in predictions.items()},
        ).assign(shot_type=f"{value}PT")
        for value, rows in validation.groupby(SHOT_VALUE)
    ]
    results = pd.concat([scores, *by_type], ignore_index=True)
    args.output.mkdir(parents=True, exist_ok=True)
    results.to_csv(args.output / "january-scores.csv", index=False)
    save_calibration(validation[TARGET], predictions, args.output / "january-calibration.png")
    print(results.to_string(index=False))


if __name__ == "__main__":
    main()
