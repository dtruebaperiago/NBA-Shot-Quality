"""Select a model and test training-only clock estimates on January shots."""

import argparse
from itertools import product
from pathlib import Path

import pandas as pd
from sklearn.base import clone
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from threadpoolctl import threadpool_limits
from xgboost import XGBClassifier

from build_modeling_dataset import TARGET, VALIDATION_START
from shot_history import add_defender_history, CLOCK, DEFENDER_SHRINKAGE, FEATURES, with_defender_weight
from fit_baselines import choose_shrinkage, fit_context, load_development, save_calibration, score_predictions


RECORDED = "Recorded + period fallback"
ESTIMATED = "Possession estimates in training only"


def candidates():
    return {
        "Logistic regression": {
            "C=1": LogisticRegression(max_iter=1000),
            "C=0.01": LogisticRegression(C=0.01, max_iter=1000),
        },
        "XGBoost": {
            f"depth={depth}, rounds={rounds}": XGBClassifier(
                max_depth=depth, n_estimators=rounds, learning_rate=0.05,
                tree_method="hist", n_jobs=2, random_state=42,
            )
            for depth, rounds in [(3, 150), (5, 250), (7, 250)]
        },
        "HistGradientBoosting": {
            f"leaves={leaves}, rounds={rounds}": HistGradientBoostingClassifier(
                max_leaf_nodes=leaves, max_iter=rounds, learning_rate=0.05,
                early_stopping=False, random_state=42,
            )
            for leaves, rounds in [(8, 150), (24, 250), (48, 250)]
        },
    }


def evaluate(train, validation, models, initial_weight):
    results = []
    winning_predictions = {}
    paired_scores = []
    train_inputs = {
        RECORDED: train,
        ESTIMATED: train.assign(**{CLOCK: train["SHOT_CLOCK_CLEAN"]}),
    }

    def trial(family, settings, estimator, policy, shooter_weight, defender_weight, stage):
        training = with_defender_weight(train_inputs[policy], defender_weight)
        scoring = with_defender_weight(validation, defender_weight)
        probabilities = fit_context(training, scoring, shooter_weight, FEATURES, clone(estimator))
        score = score_predictions(validation[TARGET], {family: probabilities}).iloc[0].to_dict()
        result = dict(
            **score, settings=settings, training_clock=policy, stage=stage,
            shooter_weight=shooter_weight, defender_weight=defender_weight,
        )
        results.append(result)
        return result, probabilities

    # Screen model complexity with common histories and clock policy. Keep it fixed for clock comparisons.
    for family, settings_options in models.items():
        print(f"Comparing {family}", flush=True)
        screen = [
            trial(family, settings, estimator, RECORDED, initial_weight, DEFENDER_SHRINKAGE, "model settings")[0]
            for settings, estimator in settings_options.items()
        ]
        settings = min(screen, key=lambda row: row["log_loss"])["settings"]
        estimator = settings_options[settings]
        best_by_policy = {}
        for policy in train_inputs:
            grid = product([0.5, 5, initial_weight, 500, 5000], [0.5, 5, DEFENDER_SHRINKAGE, 500, 5000])
            best, probabilities = min(
                (trial(family, settings, estimator, policy, s, d, "shrinkage") for s, d in grid),
                key=lambda item: item[0]["log_loss"],
            )
            best_by_policy[policy] = best
            winning_predictions[f"{family} / {policy}"] = probabilities

        # Match weights as well as model settings to isolate the training-clock change.
        recorded = best_by_policy[RECORDED]
        estimated = next(
            row for row in results
            if row["baseline"] == family and row["training_clock"] == ESTIMATED
            and row["shooter_weight"] == recorded["shooter_weight"]
            and row["defender_weight"] == recorded["defender_weight"]
        )
        paired_scores.extend([recorded, estimated])
        print(pd.DataFrame(best_by_policy.values()).to_string(index=False), flush=True)

    return pd.DataFrame(results), pd.DataFrame(paired_scores), winning_predictions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/model-selection"))
    args = parser.parse_args()
    train, validation = load_development(args.data)
    if not train["CLOCK_SOURCE"].eq("possession_estimate").any():
        parser.error("Build the modeling dataset with the reconstruction report first")
    initial_weight = choose_shrinkage(validation)

    with threadpool_limits(limits=2):
        print("Building defender residuals from strictly earlier dates", flush=True)
        shots = add_defender_history(pd.concat([train, validation], ignore_index=True))
        before_january = shots["GAME_DATE"].lt(VALIDATION_START)
        train, validation = shots.loc[before_january], shots.loc[~before_january]
        trials, paired, predictions = evaluate(train, validation, candidates(), initial_weight)

    ranked = trials.loc[trials["stage"].eq("shrinkage")].sort_values("log_loss")
    best = ranked.drop_duplicates(["baseline", "training_clock"])
    args.output.mkdir(parents=True, exist_ok=True)
    trials.to_csv(args.output / "january-trials.csv", index=False)
    best.to_csv(args.output / "january-best-by-model-and-clock.csv", index=False)
    paired.to_csv(args.output / "january-matched-clock-comparison.csv", index=False)
    save_calibration(validation[TARGET].reset_index(drop=True), predictions, args.output / "january-calibration.png")
    print(best.to_string(index=False))


if __name__ == "__main__":
    main()
