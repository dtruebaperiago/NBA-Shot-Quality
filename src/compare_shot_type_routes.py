"""Compare pooled models, shot-type specialists, and routing on January shots."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from threadpoolctl import threadpool_limits
import torch

from bayesian_shot_model import fit_bayesian_shot_model
from build_modeling_dataset import HISTORY_COLUMNS, SHOT_KEY, TARGET, VALIDATION_START, smoothed_shooter_rate
from shot_history import (
    add_defender_history, FEATURES, model_inputs, OPENING_RATES, with_defender_weight,
)
from fit_baselines import (
    choose_shrinkage, diagnostic_scores, fit_context, game_bootstrap, load_development,
)
from tree_models import fit_catboost
from compare_model_families import fit_tabm
from compare_shot_type_models import MODELS
from play_by_play_context import SHOT_VALUE
from compare_tabm_gate import GATED, GATED_BLEND, TABM_BLEND, TWO_TREES, ShotFeatureGate
from compare_tree_extensions import ATTEMPTS, BLEND, LEAGUE_RATE, MAKES, RATE, TREES, WITH_HISTORY, add_shot_type_history
from select_model import RECORDED


BAYESIAN = "Hierarchical Bayesian logistic"
LOGISTIC = "Logistic regression"
BLENDS = {
    TABM_BLEND: [*TREES[:2], "TabM"],
    GATED_BLEND: [*TREES[:2], GATED],
    TWO_TREES: TREES[:2],
    BLEND: TREES,
}


def add_blends(predictions):
    predictions.update({
        name: np.mean([predictions[member].astype(float) for member in members], axis=0)
        for name, members in BLENDS.items()
    })


def same_type_inputs(shots):
    return shots.assign(**{
        column: shots[source] for column, source in zip(HISTORY_COLUMNS, (ATTEMPTS, MAKES, LEAGUE_RATE))
    })


def baseline_predictions(validation, weight):
    separate = same_type_inputs(validation)
    return {
        "2013–14 league rate by type": validation[SHOT_VALUE].map(OPENING_RATES).to_numpy(),
        "League average / pooled": validation[HISTORY_COLUMNS[2]].to_numpy(),
        "League average / by type": separate[HISTORY_COLUMNS[2]].to_numpy(),
        "Shooter history / pooled": smoothed_shooter_rate(validation, weight).to_numpy(),
        "Shooter history / by type": smoothed_shooter_rate(separate, weight).to_numpy(),
    }


def fit_fixed_catboost(train, validation, config, columns):
    train_x, scoring_x = model_inputs(train, validation, config, columns)
    probabilities, _ = fit_catboost(
        train_x, train[TARGET], scoring_x, validation[TARGET],
        depths=(config["depth"],), iterations=config["rounds"],
        learning_rate=config["learning_rate"], early_stopping_rounds=None,
    )
    return probabilities


def fit_catboost_with_type_history(train, validation, config):
    train, validation = (
        shots.assign(**{RATE: smoothed_shooter_rate(same_type_inputs(shots), config["shooter_weight"])})
        for shots in (train, validation)
    )
    return fit_fixed_catboost(train, validation, config, [*FEATURES, ATTEMPTS, RATE])


def fit_specialists(train, validation, settings, logistic):
    columns = [column for column in FEATURES if column != SHOT_VALUE]
    predictions = {}
    for name, estimator in {**MODELS, LOGISTIC: LogisticRegression}.items():
        config = logistic if name == LOGISTIC else settings[name]
        predictions[name] = fit_context(
            with_defender_weight(train, config["defender_weight"]),
            with_defender_weight(validation, config["defender_weight"]),
            config["shooter_weight"], columns, estimator(**config["parameters"]),
        )

    predictions["CatBoost"] = fit_fixed_catboost(train, validation, settings["CatBoost"], columns)

    tabm = settings["TabM"]
    train_x, scoring_x = model_inputs(train, validation, tabm, columns)
    for name, gate in (("TabM", None), (GATED, ShotFeatureGate)):
        print(f"Training {name} on {train[SHOT_VALUE].iat[0]}PT attempts", flush=True)
        predictions[name], _ = fit_tabm(
            train_x, train[TARGET], scoring_x, validation[TARGET], widths=(tabm["width"],), gate_factory=gate,
        )
    return predictions


def score_by_type(validation, predictions, training):
    groups = [("All", validation), *((f"{value}PT", rows) for value, rows in validation.groupby(SHOT_VALUE))]
    return pd.concat([
        diagnostic_scores(rows[TARGET], {name: values[rows.index] for name, values in predictions.items()})
        .assign(training=training, shot_type=label)
        for label, rows in groups
    ], ignore_index=True)


def route(validation, pooled, specialists):
    combined = {
        f"{training} / {name}": probabilities
        for training, models in (("Pooled", pooled), ("Separate", specialists))
        for name, probabilities in models.items()
    }
    reference = min(pooled, key=lambda name: log_loss(validation[TARGET], pooled[name]))
    selected, labels = {}, []
    for label, candidates in (
        ("Best pooled by type", {name: values for name, values in combined.items() if name.startswith("Pooled /")}),
        ("Best specialists by type", {name: values for name, values in combined.items() if name.startswith("Separate /")}),
        ("Best available by type", combined),
    ):
        probabilities = np.empty(len(validation))
        choices = {}
        for value, rows in validation.groupby(SHOT_VALUE):
            choice = min(candidates, key=lambda name: log_loss(rows[TARGET], candidates[name][rows.index]))
            choices[f"{value}PT"] = choice
            probabilities[rows.index] = candidates[choice][rows.index]
        selected[label] = probabilities
        labels.append({"baseline": label, "model_2pt": choices["2PT"], "model_3pt": choices["3PT"]})
    scores = score_by_type(validation, selected, "Routed").merge(pd.DataFrame(labels), on="baseline", validate="many_to_one")
    intervals = game_bootstrap(validation, {reference: pooled[reference], **selected}, reference)
    overall = scores["shot_type"].eq("All")
    scores.loc[overall, "reference"] = reference
    scores.loc[overall, "log_loss_delta"] = scores.loc[overall, "log_loss"] - log_loss(validation[TARGET], pooled[reference])
    scores.loc[overall, intervals.columns] = intervals.reindex(scores.loc[overall, "baseline"]).to_numpy()
    return scores, selected


def write_comparison(output, validation, baselines, pooled, specialists, rhat):
    specialist_scores = score_by_type(validation, specialists, "Separate")
    specialist_scores["bayesian_max_rhat"] = specialist_scores["shot_type"].map(rhat).where(specialist_scores["baseline"].eq(BAYESIAN))
    route_scores, routed = route(validation, pooled, specialists)
    results = pd.concat([
        score_by_type(validation, baselines, "Baseline"),
        score_by_type(validation, pooled, "Pooled"),
        specialist_scores, route_scores,
    ], ignore_index=True)
    output.mkdir(parents=True, exist_ok=True)
    results.to_csv(output / "january-expanded-scores.csv", index=False)
    keys = [*SHOT_KEY, "GAME_DATE", SHOT_VALUE, TARGET]
    prediction_columns = {
        f"{training} / {name}": probabilities
        for training, models in (("Baseline", baselines), ("Pooled", pooled), ("Separate", specialists), ("Routed", routed))
        for name, probabilities in models.items()
    }
    pd.concat([validation[keys], pd.DataFrame(prediction_columns)], axis=1).to_csv(
        output / "january-expanded-predictions.csv", index=False,
    )
    return results


def load_model_settings(comparison):
    settings = json.loads((comparison / "settings.json").read_text(encoding="utf-8"))
    selection = pd.read_csv(comparison.parent / "model-selection" / "january-best-by-model-and-clock.csv")
    logistic = selection.loc[selection["baseline"].eq(LOGISTIC) & selection["training_clock"].eq(RECORDED)].iloc[0].to_dict()
    logistic["parameters"] = {"C": float(logistic["settings"].removeprefix("C=")), "max_iter": 1000}
    return settings, logistic


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/shot-type-comparison"))
    args = parser.parse_args()
    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    keys = [*SHOT_KEY, "GAME_DATE", SHOT_VALUE, TARGET]
    saved = pd.read_csv(args.comparison / "january-predictions.csv", dtype={"GAME_ID": "string"})
    pd.testing.assert_frame_equal(saved[keys], validation[keys])
    settings, logistic = load_model_settings(args.comparison)
    pooled = {name: saved[name].to_numpy() for name in [*TREES, "TabM", BAYESIAN]}
    weight = choose_shrinkage(validation)
    torch.set_num_threads(3)

    shots = add_shot_type_history(pd.concat([train, validation], ignore_index=True), weight)
    baseline_shots = shots.loc[shots["GAME_DATE"].ge(VALIDATION_START)].reset_index(drop=True)
    baselines = baseline_predictions(baseline_shots, weight)
    baseline_scores = score_by_type(validation, baselines, "Baseline")
    print(f"Shooter baseline shrinkage: {weight:.6f} attempts", flush=True)
    print(baseline_scores[["shot_type", "baseline", "log_loss"]].to_string(index=False), flush=True)

    specialists = {}
    rhat = {}
    bayesian = settings[BAYESIAN]
    with threadpool_limits(limits=3), ThreadPoolExecutor(max_workers=1) as pool:
        bayes_by_type = {
            value: pool.submit(
                fit_bayesian_shot_model, train.loc[train[SHOT_VALUE].eq(value)], rows,
                bayesian["warmup_per_chain"], bayesian["draws_per_chain"],
            )
            for value, rows in validation.groupby(SHOT_VALUE)
        }
        shots = add_defender_history(shots)
        before_january = shots["GAME_DATE"].lt(VALIDATION_START)
        training, scoring = shots.loc[before_january], shots.loc[~before_january].reset_index(drop=True)
        pd.testing.assert_frame_equal(scoring[keys], validation[keys])
        pooled[LOGISTIC] = fit_context(
            with_defender_weight(training, logistic["defender_weight"]),
            with_defender_weight(scoring, logistic["defender_weight"]),
            logistic["shooter_weight"], FEATURES, LogisticRegression(**logistic["parameters"]),
        )
        pooled[WITH_HISTORY] = fit_catboost_with_type_history(training, scoring, settings["CatBoost"])
        tabm = settings["TabM"]
        train_x, scoring_x = model_inputs(training, scoring, tabm, FEATURES)
        print("Reproducing pooled gated TabM with seed 42", flush=True)
        pooled[GATED], _ = fit_tabm(
            train_x, training[TARGET], scoring_x, scoring[TARGET], widths=(tabm["width"],), gate_factory=ShotFeatureGate,
        )
        add_blends(pooled)
        previous = pd.read_csv(args.comparison / "january-tabm-gate.csv").set_index(["seed", "baseline"])
        np.testing.assert_allclose(log_loss(scoring[TARGET], pooled[GATED]), previous.at[(42, GATED), "log_loss"], rtol=0, atol=1e-8)
        pooled_scores = score_by_type(validation, pooled, "Pooled")
        print(pooled_scores[["shot_type", "baseline", "log_loss"]].to_string(index=False), flush=True)
        for value, rows in scoring.groupby(SHOT_VALUE):
            print(f"Fitting separate {value}PT models", flush=True)
            same_type_train = training.loc[training[SHOT_VALUE].eq(value)]
            predictions = fit_specialists(same_type_inputs(same_type_train), same_type_inputs(rows), settings, logistic)
            for name, probabilities in predictions.items():
                specialists.setdefault(name, np.empty(len(validation)))[rows.index] = probabilities

        for value, rows in scoring.groupby(SHOT_VALUE):
            probabilities, diagnostics = bayes_by_type[value].result()
            specialists.setdefault(BAYESIAN, np.empty(len(validation)))[rows.index] = probabilities
            rhat[f"{value}PT"] = diagnostics["max_rhat"]

    add_blends(specialists)
    results = write_comparison(args.output, validation, baselines, pooled, specialists, rhat)
    print(results[["training", "shot_type", "baseline", "log_loss"]].to_string(index=False), flush=True)


if __name__ == "__main__":
    main()
