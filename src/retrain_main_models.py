"""Retrain fully separate models and soft-voting ensembles with a 50/10 neural schedule."""

import argparse
import copy
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from threadpoolctl import threadpool_limits
import torch

from bayesian_shot_model import fit_bayesian_shot_model
from build_modeling_dataset import SHOT_KEY, TARGET
from shot_history import (
    build_specialist_data, FEATURES_WITHOUT_TYPE, model_inputs, sequence_data, with_defender_weight,
)
from compare_gru_history import fit_gru
from tree_models import fit_catboost, HISTOGRAM
from compare_model_families import fit_tabm
from compare_shot_type_models import MODELS
from compare_shot_type_routes import BAYESIAN, LOGISTIC, fit_fixed_catboost, load_model_settings, score_by_type
from compare_tabm_gate import ShotFeatureGate
from fit_baselines import context_preprocessor, fit_context, load_development


SEEDS = (42, 43, 44)


def recent_models(training, scoring, settings, summary, before):
    predictions = {}
    for name in ("CatBoost", HISTOGRAM):
        config = settings[name]
        train_x, scoring_x = model_inputs(training, scoring, config, FEATURES_WITHOUT_TYPE)
        train_x = pd.concat([train_x.reset_index(drop=True), summary.loc[before].reset_index(drop=True)], axis=1)
        scoring_x = pd.concat([scoring_x.reset_index(drop=True), summary.loc[~before].reset_index(drop=True)], axis=1)
        if name == "CatBoost":
            probabilities, _ = fit_catboost(
                train_x, training[TARGET], scoring_x, scoring[TARGET],
                depths=(config["depth"],), iterations=config["rounds"],
                learning_rate=config["learning_rate"], early_stopping_rounds=None,
            )
        else:
            parameters = copy.deepcopy(config["parameters"])
            parameters["max_leaf_nodes"] = 12
            preprocess = context_preprocessor(train_x.columns)
            estimator = HistGradientBoostingClassifier(**parameters).fit(preprocess.fit_transform(train_x), training[TARGET])
            probabilities = estimator.predict_proba(preprocess.transform(scoring_x))[:, 1]
        predictions[name] = probabilities
    return predictions


def vote(predictions, names):
    return np.mean([predictions[name].astype(float) for name in names], axis=0)


def add_votes(predictions, members):
    predictions.update({name: vote(predictions, names) for name, names in members.items()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/retraining-50-10"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    settings, logistic = load_model_settings(args.comparison)
    keys = [*SHOT_KEY, "GAME_DATE", "PTS_TYPE", TARGET]
    torch.set_num_threads(3)
    combined, logs, bayesian_logs, votes = {}, [], {}, {}

    with threadpool_limits(limits=3), ThreadPoolExecutor(max_workers=1) as pool:
        bayes = {
            value: pool.submit(
                fit_bayesian_shot_model, train.loc[train.PTS_TYPE.eq(value)], rows,
                settings[BAYESIAN]["warmup_per_chain"], settings[BAYESIAN]["draws_per_chain"],
            )
            for value, rows in validation.groupby("PTS_TYPE")
        }
        for value, rows in validation.groupby("PTS_TYPE"):
            training, scoring = build_specialist_data(train, validation, value)
            pd.testing.assert_frame_equal(scoring[keys].reset_index(drop=True), rows[keys].reset_index(drop=True))
            predictions = {}
            for name, estimator in {**MODELS, LOGISTIC: LogisticRegression}.items():
                config = logistic if name == LOGISTIC else settings[name]
                predictions[name] = fit_context(
                    with_defender_weight(training, config["defender_weight"]),
                    with_defender_weight(scoring, config["defender_weight"]),
                    config["shooter_weight"], FEATURES_WITHOUT_TYPE, estimator(**config["parameters"]),
                )
            predictions["CatBoost"] = fit_fixed_catboost(training, scoring, settings["CatBoost"], FEATURES_WITHOUT_TYPE)
            config = settings[HISTOGRAM]
            parameters = copy.deepcopy(config["parameters"])
            parameters["max_leaf_nodes"] = 12
            predictions["Histogram 12 leaves"] = fit_context(
                with_defender_weight(training, config["defender_weight"]),
                with_defender_weight(scoring, config["defender_weight"]), config["shooter_weight"],
                FEATURES_WITHOUT_TYPE, HistGradientBoostingClassifier(**parameters),
            )
            predictions[BAYESIAN], bayesian_logs[value] = bayes[value].result()
            config = settings["TabM"]
            train_x, scoring_x = model_inputs(training, scoring, config, FEATURES_WITHOUT_TYPE)
            preprocess = context_preprocessor(train_x.columns)
            context = np.concatenate([preprocess.fit_transform(train_x), preprocess.transform(scoring_x)])
            for family, gate in (("TabM", None), ("Gated TabM", ShotFeatureGate)):
                for seed in SEEDS:
                    name = f"{family} seed {seed}"
                    print(f"Training {value}PT {name}", flush=True)
                    predictions[name], log = fit_tabm(
                        train_x, training[TARGET], scoring_x, scoring[TARGET],
                        widths=(config["width"],), seed=seed, gate_factory=gate,
                        max_epochs=50, patience=10, clip_norm=2.0,
                    )
                    logs.append(dict(shot_type=value, model=family, seed=seed, **log))
                predictions[f"{family} seed average"] = vote(predictions, [f"{family} seed {seed}" for seed in SEEDS])

            shots = pd.concat([training, scoring], ignore_index=True)
            before = np.arange(len(shots)) < len(training)
            for window in (10, 20):
                sequence, lengths, summary = sequence_data(shots, before, window)
                for family, prob in recent_models(training, scoring, settings, summary, before).items():
                    predictions[f"{family} + last {window} summaries"] = prob
                for seed in SEEDS:
                    family = f"GRU last {window}"
                    name = f"{family} seed {seed}"
                    predictions[name], log = fit_gru(
                        context, sequence, lengths, shots[TARGET].to_numpy(), before, seed,
                        max_epochs=50, patience=10,
                    )
                    logs.append(dict(shot_type=value, model=family, **log))
                    print(f"{value}PT {name}: loss {log['log_loss']:.7f}, best epoch {log['best_epoch']}", flush=True)
                predictions[f"GRU last {window} seed average"] = vote(
                    predictions, [f"GRU last {window} seed {seed}" for seed in SEEDS],
                )

            votes = {
                "Vote CatBoost + Histogram": ["CatBoost", HISTOGRAM],
                "Vote three trees": ["CatBoost", HISTOGRAM, "XGBoost"],
                "Vote trees with Histogram 12": ["CatBoost", "Histogram 12 leaves", "XGBoost"],
                "Vote recent-summary trees": ["CatBoost + last 10 summaries", f"{HISTOGRAM} + last 10 summaries"],
            }
            for family in ("TabM", "Gated TabM", "GRU last 10", "GRU last 20"):
                for seed in (*SEEDS, "average"):
                    member = f"{family} seed {seed}"
                    votes[f"Vote CatBoost + Histogram + {member}"] = ["CatBoost", HISTOGRAM, member]
                votes[f"Vote recent trees + {family}"] = [
                    "CatBoost", f"{HISTOGRAM} + last 10 summaries", f"{family} seed average",
                ]
            votes["Vote all main families"] = [
                LOGISTIC, BAYESIAN, "CatBoost", HISTOGRAM, "XGBoost",
                "TabM seed average", "Gated TabM seed average", "GRU last 20 seed average",
            ]
            add_votes(predictions, votes)
            for name, probabilities in predictions.items():
                combined.setdefault(name, np.full(len(validation), np.nan))[rows.index] = probabilities
            # Preserve each completed shot type and its training record during the run.
            pd.DataFrame(logs).to_csv(args.output / "training.csv", index=False)
            pd.concat([validation[keys], pd.DataFrame(combined)], axis=1).to_csv(
                args.output / "january-predictions.csv", index=False,
            )
            print(f"Finished {value}PT models and votes", flush=True)

    scores = score_by_type(validation, combined, "Fully separate 50/10")
    scores["kind"] = np.where(scores["baseline"].isin(votes), "Soft vote", "Standalone")
    scores.to_csv(args.output / "january-scores.csv", index=False)
    (args.output / "settings.json").write_text(json.dumps({
        "neural_max_epochs": 50, "neural_patience": 10, "gradient_clip_max_norm": 2.0,
        "seeds": SEEDS, "tree_settings": settings, "logistic": logistic,
        "bayesian_diagnostics": bayesian_logs, "equal_weight_votes": votes,
        "history_rule": "Same shot type, strictly earlier dates. January history updates after completed dates.",
    }, indent=2, default=str) + "\n", encoding="utf-8")
    for value in ("2PT", "3PT"):
        print(scores.loc[scores.shot_type.eq(value)].sort_values("log_loss")[
            ["baseline", "log_loss", "brier_score", "calibration_error_10_bins"]
        ].head(12).to_string(index=False), flush=True)


if __name__ == "__main__":
    main()
