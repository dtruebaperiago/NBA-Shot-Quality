"""Compare half leaf budgets with existing fully separate tree models on January."""

import argparse
import copy
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import log_loss
from threadpoolctl import threadpool_limits

from build_modeling_dataset import SHOT_KEY, TARGET
from shot_history import build_specialist_data, FEATURES, with_defender_weight
from fit_baselines import diagnostic_scores, fit_context, game_bootstrap, load_development
from compare_shot_type_models import MODELS
from play_by_play_context import SHOT_VALUE
from compare_shot_type_routes import add_blends, fit_fixed_catboost, load_model_settings
from compare_tree_extensions import TREES


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/shot-type-comparison"))
    args = parser.parse_args()
    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    keys = [*SHOT_KEY, "GAME_DATE", SHOT_VALUE, TARGET]
    saved = pd.read_csv(args.output / "january-fully-separate-predictions.csv", dtype={"GAME_ID": "string"})
    pd.testing.assert_frame_equal(saved[keys], validation[keys])
    settings, _ = load_model_settings(args.comparison)
    smaller = copy.deepcopy(settings)
    smaller["Histogram gradient boosting"]["parameters"]["max_leaf_nodes"] //= 2
    smaller["XGBoost"]["parameters"]["max_depth"] -= 1
    smaller["CatBoost"]["depth"] -= 1
    columns = [column for column in FEATURES if column != SHOT_VALUE]
    predictions = {name: saved[name].to_numpy() for name in TREES}
    reduced = {name: np.empty(len(validation)) for name in TREES}
    with threadpool_limits(limits=3):
        for value, rows in validation.groupby(SHOT_VALUE):
            training, scoring = build_specialist_data(train, validation, value)
            pd.testing.assert_frame_equal(scoring[keys].reset_index(drop=True), rows[keys].reset_index(drop=True))
            for policy, configs, target in (("Original", settings, predictions), ("Half leaf budget", smaller, reduced)):
                for name, estimator in MODELS.items():
                    config = configs[name]
                    probabilities = fit_context(
                        with_defender_weight(training, config["defender_weight"]),
                        with_defender_weight(scoring, config["defender_weight"]),
                        config["shooter_weight"], columns, estimator(**config["parameters"]),
                    )
                    if policy == "Original":
                        np.testing.assert_allclose(probabilities, saved.loc[rows.index, name], rtol=0, atol=1e-7)
                    target[name][rows.index] = probabilities
                probabilities = fit_fixed_catboost(training, scoring, configs["CatBoost"], columns)
                if policy == "Original":
                    np.testing.assert_allclose(probabilities, saved.loc[rows.index, "CatBoost"], rtol=0, atol=1e-12)
                target["CatBoost"][rows.index] = probabilities
                print(f"{value}PT {policy}: " + ", ".join(
                    f"{name}={log_loss(rows[TARGET], target[name][rows.index]):.7f}" for name in TREES
                ), flush=True)
    for models in (predictions, reduced):
        models.update({name: saved[name].to_numpy() for name in ("TabM", "Gated TabM")})
        add_blends(models)
    results = []
    candidates = [name for name in reduced if name not in ("TabM", "Gated TabM")]
    groups = [("All", validation), *((f"{value}PT", rows) for value, rows in validation.groupby(SHOT_VALUE))]
    for label, rows in groups:
        for name in candidates:
            pair = {"Original": predictions[name][rows.index], "Half leaf budget": reduced[name][rows.index]}
            scores = diagnostic_scores(rows[TARGET], pair).set_index("baseline")
            interval = game_bootstrap(rows, pair, "Original").loc["Half leaf budget"]
            record = scores.loc["Half leaf budget"].to_dict()
            record.update(interval.to_dict())
            record.update(model=name, shot_type=label, original_log_loss=scores.at["Original", "log_loss"])
            record["log_loss_delta"] = record["log_loss"] - record["original_log_loss"]
            results.append(record)
    scores = pd.DataFrame(results)
    scores.to_csv(args.output / "january-tree-pruning-scores.csv", index=False)
    pd.concat([validation[keys], pd.DataFrame({name: reduced[name] for name in candidates})], axis=1).to_csv(
        args.output / "january-tree-pruning-predictions.csv", index=False,
    )
    print(scores[["shot_type", "model", "original_log_loss", "log_loss", "log_loss_delta"]].to_string(index=False))


if __name__ == "__main__":
    main()
