"""Test an equal-weight tree blend and shot-type shooter history on January shots."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

from build_modeling_dataset import SHOT_KEY, TARGET, VALIDATION_START
from shot_history import add_defender_history, FEATURES, OPENING_RATES, with_defender_weight
from fit_baselines import context_inputs, diagnostic_scores, game_bootstrap, load_development
from tree_models import fit_catboost


SHOT_TYPE = "PTS_TYPE"
ATTEMPTS = "SHOOTER_PRIOR_SAME_TYPE_ATTEMPTS"
MAKES = "SHOOTER_PRIOR_SAME_TYPE_MAKES"
LEAGUE_RATE = "LEAGUE_PRIOR_SAME_TYPE_FG_RATE"
RATE = "SHOOTER_SMOOTHED_SAME_TYPE_FG_RATE"
# 2013–14 regular season, Table 1 of https://doi.org/10.3390/ijerph20031924.
TREES = ["CatBoost", "Histogram gradient boosting", "XGBoost"]
BLEND = "Equal-weight tree blend"
WITH_HISTORY = "CatBoost + shot-type shooter history"


def add_shot_type_history(shots, weight):
    """Count attempts and makes on earlier dates at the player and league levels."""
    player_keys = ["player_id", SHOT_TYPE, "GAME_DATE"]
    league_keys = [SHOT_TYPE, "GAME_DATE"]
    daily = shots.groupby(player_keys, sort=True)[TARGET].agg(attempts="size", makes="sum")
    prior = daily.groupby(level=player_keys[:2]).cumsum() - daily
    league_daily = daily.groupby(level=league_keys, sort=True).sum()
    league_prior = league_daily.groupby(level=SHOT_TYPE).cumsum() - league_daily
    league_rate = league_prior["makes"].div(league_prior["attempts"].replace(0, np.nan))
    fallback = league_rate.index.get_level_values(SHOT_TYPE).map(OPENING_RATES)
    league_rate = league_rate.where(league_rate.notna(), fallback)
    prior[LEAGUE_RATE] = league_rate.reindex(prior.index.droplevel("player_id")).to_numpy()
    prior[RATE] = (prior["makes"] + weight * prior[LEAGUE_RATE]) / (prior["attempts"] + weight)
    features = prior.rename(columns={"attempts": ATTEMPTS, "makes": MAKES})
    return shots.join(features, on=player_keys, validate="many_to_one")




def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    args = parser.parse_args()

    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    saved = pd.read_csv(args.comparison / "january-predictions.csv", dtype={"GAME_ID": "string"})
    keys = [*SHOT_KEY, "GAME_DATE", SHOT_TYPE, TARGET]
    pd.testing.assert_frame_equal(saved[keys], validation[keys])
    predictions = {name: saved[name].to_numpy() for name in TREES}
    predictions[BLEND] = saved[TREES].mean(axis=1).to_numpy()
    config = json.loads((args.comparison / "settings.json").read_text(encoding="utf-8"))["CatBoost"]
    weight = config["shooter_weight"]

    with threadpool_limits(limits=3):
        shots = add_defender_history(pd.concat([train, validation], ignore_index=True))
        shots = with_defender_weight(shots, config["defender_weight"])
        shots = add_shot_type_history(shots, weight)
        before_january = shots["GAME_DATE"].lt(VALIDATION_START)
        training, scoring = shots.loc[before_january], shots.loc[~before_january]
        pd.testing.assert_frame_equal(scoring[keys].reset_index(drop=True), validation[keys])
        for name, columns in (("CatBoost", FEATURES), (WITH_HISTORY, [*FEATURES, ATTEMPTS, RATE])):
            probabilities, _ = fit_catboost(
                context_inputs(training, weight, columns), training[TARGET],
                context_inputs(scoring, weight, columns), scoring[TARGET],
                depths=(config["depth"],), iterations=config["rounds"],
                learning_rate=config["learning_rate"], early_stopping_rounds=None,
            )
            if name == "CatBoost":
                np.testing.assert_allclose(probabilities, predictions[name], rtol=0, atol=1e-12)
            predictions[name] = probabilities

    scores = []
    by_type = [(f"{shot_type}PT", rows) for shot_type, rows in validation.groupby(SHOT_TYPE)]
    for label, rows in [("All", validation), *by_type]:
        probabilities = {name: values[rows.index] for name, values in predictions.items()}
        metrics = diagnostic_scores(rows[TARGET], probabilities).set_index("baseline")
        metrics["log_loss_delta_vs_catboost"] = metrics["log_loss"] - metrics.loc["CatBoost", "log_loss"]
        scores.append(metrics.join(game_bootstrap(rows, probabilities)).assign(shot_type=label))
    results = pd.concat(scores).reset_index()
    results.to_csv(args.comparison / "january-tree-extensions.csv", index=False)
    print(results[[
        "shot_type", "baseline", "log_loss", "log_loss_delta_vs_catboost",
        "game_bootstrap_ci_low", "game_bootstrap_ci_high",
    ]].to_string(index=False, float_format=lambda value: f"{value:.7f}"))


if __name__ == "__main__":
    main()
