"""Fine-tune XGBoost and histogram gradient boosting using January log loss."""

import argparse
from itertools import product
import json
from pathlib import Path

import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from threadpoolctl import threadpool_limits
from xgboost import XGBClassifier

from build_modeling_dataset import HISTORY_COLUMNS, TARGET, VALIDATION_START
from shot_history import add_defender_history, FEATURES, with_defender_weight
from fit_baselines import choose_shrinkage, fit_context, load_development, save_calibration, score_predictions


def tune(train, validation, name, estimator, base, alternatives, weights):
    trials = []
    predictions = []

    def trial(settings, shooter_weight, defender_weight):
        probabilities = fit_context(
            with_defender_weight(train, defender_weight),
            with_defender_weight(validation, defender_weight),
            shooter_weight, FEATURES, estimator(**settings),
        )
        score = score_predictions(validation[TARGET], {name: probabilities}).iloc[0].to_dict()
        trials.append(dict(
            **score, parameters=json.dumps(settings, sort_keys=True),
            shooter_weight=shooter_weight, defender_weight=defender_weight,
        ))
        predictions.append(probabilities)

    shooter_weights, defender_weights = weights
    initial_shooter, initial_defender = shooter_weights[1], defender_weights[1]
    for change in ({}, *alternatives):
        trial({**base, **change}, initial_shooter, initial_defender)
    best_index = min(range(len(trials)), key=lambda i: trials[i]["log_loss"])
    settings = json.loads(trials[best_index]["parameters"])
    for shooter_weight, defender_weight in product(shooter_weights, defender_weights):
        if (shooter_weight, defender_weight) != (initial_shooter, initial_defender):
            trial(settings, shooter_weight, defender_weight)

    best_index = min(range(len(trials)), key=lambda i: trials[i]["log_loss"])
    return trials, trials[best_index], predictions[best_index]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/tree-tuning"))
    args = parser.parse_args()
    train, validation = load_development(args.data)
    initial_shooter = choose_shrinkage(validation)
    with threadpool_limits(limits=2):
        print("Building defender history from completed dates", flush=True)
        shots = add_defender_history(pd.concat([train, validation], ignore_index=True))
        before_january = shots["GAME_DATE"].lt(VALIDATION_START)
        train = shots.loc[before_january]
        validation = shots.loc[~before_january].reset_index(drop=True)

        searches = {
            "XGBoost": (
                XGBClassifier,
                dict(max_depth=3, n_estimators=150, learning_rate=0.05, tree_method="hist", n_jobs=2, random_state=42),
                [
                    {"max_depth": 2, "n_estimators": 400},
                    {"max_depth": 3, "n_estimators": 300},
                    {"max_depth": 4, "n_estimators": 150},
                    {"max_depth": 4, "n_estimators": 300},
                    {"max_depth": 5, "n_estimators": 150, "min_child_weight": 10},
                    {"max_depth": 4, "n_estimators": 300, "min_child_weight": 10, "reg_lambda": 5},
                    {"max_depth": 4, "n_estimators": 450, "learning_rate": 0.03, "subsample": 0.8},
                ],
                ([15, initial_shooter, 150], [15, 50, 150]),
            ),
            "Histogram gradient boosting": (
                HistGradientBoostingClassifier,
                dict(max_leaf_nodes=24, max_iter=250, learning_rate=0.05, early_stopping=False, random_state=42),
                [
                    {"max_leaf_nodes": 12, "max_iter": 350},
                    {"max_leaf_nodes": 18, "max_iter": 250},
                    {"max_leaf_nodes": 24, "max_iter": 150},
                    {"max_leaf_nodes": 24, "max_iter": 350},
                    {"max_leaf_nodes": 32, "max_iter": 200},
                    {"max_leaf_nodes": 24, "min_samples_leaf": 60, "l2_regularization": 2},
                    {"max_leaf_nodes": 32, "max_iter": 400, "learning_rate": 0.03, "min_samples_leaf": 40},
                ],
                ([150, 500, 1500], [15, 50, 150]),
            ),
        }
        results, winners = [], []
        predictions = {"League average": validation[HISTORY_COLUMNS[2]]}
        for name, search in searches.items():
            print(f"Tuning {name}", flush=True)
            trials, best, probabilities = tune(train, validation, name, *search)
            results.extend(trials)
            winners.append(best)
            predictions[name] = probabilities
            print(best, flush=True)

    args.output.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(results).to_csv(args.output / "january-trials.csv", index=False)
    pd.DataFrame(winners).sort_values("log_loss").to_csv(args.output / "january-best.csv", index=False)
    save_calibration(validation[TARGET], predictions, args.output / "january-calibration.png")
    print(score_predictions(validation[TARGET], predictions).to_string(index=False))


if __name__ == "__main__":
    main()
