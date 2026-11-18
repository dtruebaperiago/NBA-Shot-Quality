"""Fit January specialists with league, shooter, and defender histories built by shot type."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits
import torch

from bayesian_shot_model import fit_bayesian_shot_model
from build_modeling_dataset import HISTORY_COLUMNS, SHOT_KEY, TARGET, smoothed_shooter_rate
from fit_baselines import choose_shrinkage, diagnostic_scores, game_bootstrap, load_development
from play_by_play_context import SHOT_VALUE
from compare_shot_type_routes import BAYESIAN, add_blends, fit_specialists, load_model_settings, score_by_type
from shot_history import build_specialist_data


LEAGUE = "League average / by type"
SHOOTER = "Shooter history / by type"
BEST = "Best fully separate model by type"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/shot-type-comparison"))
    args = parser.parse_args()
    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    keys = [*SHOT_KEY, "GAME_DATE", SHOT_VALUE, TARGET]
    previous = pd.read_csv(args.output / "january-expanded-predictions.csv", dtype={"GAME_ID": "string"})
    pd.testing.assert_frame_equal(previous[keys], validation[keys])
    settings, logistic = load_model_settings(args.comparison)
    bayesian = settings[BAYESIAN]
    torch.set_num_threads(3)

    combined, winners, diagnostics, baseline_weights = {}, {}, {}, {}
    with threadpool_limits(limits=3), ThreadPoolExecutor(max_workers=1) as pool:
        bayes_by_type = {
            value: pool.submit(
                fit_bayesian_shot_model, train.loc[train[SHOT_VALUE].eq(value)], rows,
                bayesian["warmup_per_chain"], bayesian["draws_per_chain"],
            )
            for value, rows in validation.groupby(SHOT_VALUE)
        }
        for value, rows in validation.groupby(SHOT_VALUE):
            training, scoring = build_specialist_data(train, validation, value)
            pd.testing.assert_frame_equal(scoring[keys].reset_index(drop=True), rows[keys].reset_index(drop=True))
            print(f"Fitting {value}PT specialists on {len(training):,} attempts", flush=True)
            predictions = fit_specialists(training, scoring, settings, logistic)
            predictions[BAYESIAN], diagnostics[value] = bayes_by_type[value].result()
            add_blends(predictions)
            scores = diagnostic_scores(rows[TARGET], predictions)
            winners[value] = scores.iloc[0]["baseline"]
            predictions[BEST] = predictions[winners[value]]
            baseline_weights[value] = choose_shrinkage(scoring)
            predictions[LEAGUE] = scoring[HISTORY_COLUMNS[2]].to_numpy()
            predictions[SHOOTER] = smoothed_shooter_rate(scoring, baseline_weights[value]).to_numpy()
            for name, probabilities in predictions.items():
                combined.setdefault(name, np.empty(len(validation)))[rows.index] = probabilities
            print(scores[["baseline", "log_loss", "brier_score"]].to_string(index=False), flush=True)

    scores = score_by_type(validation, combined, "Fully separate")
    previous_by_type = {
        name: previous[f"Separate / {name}"].to_numpy()
        for name in combined if name not in (BEST, LEAGUE, SHOOTER)
    }
    previous_scores = score_by_type(validation, previous_by_type, "Pooled defender history")
    scores = scores.merge(
        previous_scores[["baseline", "shot_type", "log_loss"]].rename(columns={"log_loss": "previous_log_loss"}),
        on=["baseline", "shot_type"], how="left", validate="one_to_one",
    )
    scores["log_loss_delta_vs_pooled_defender"] = scores["log_loss"] - scores["previous_log_loss"]
    scores["bayesian_max_rhat"] = scores["shot_type"].map({
        f"{value}PT": result["max_rhat"] for value, result in diagnostics.items()
    }).where(scores["baseline"].eq(BAYESIAN))
    scores["shooter_baseline_weight"] = scores["shot_type"].map({
        f"{value}PT": weight for value, weight in baseline_weights.items()
    }).where(scores["baseline"].eq(SHOOTER))
    routed = scores["baseline"].eq(BEST)
    scores.loc[routed, "model_2pt"] = winners[2]
    scores.loc[routed, "model_3pt"] = winners[3]
    reference = "Prior best pooled route"
    comparison = {reference: previous["Routed / Best pooled by type"].to_numpy(), BEST: combined[BEST]}
    interval = game_bootstrap(validation, comparison, reference).loc[BEST]
    overall_route = routed & scores["shot_type"].eq("All")
    scores.loc[overall_route, interval.index] = interval.to_numpy()
    scores.to_csv(args.output / "january-fully-separate-scores.csv", index=False)
    pd.concat([validation[keys], pd.DataFrame(combined)], axis=1).to_csv(
        args.output / "january-fully-separate-predictions.csv", index=False,
    )
    print(scores[["shot_type", "baseline", "log_loss", "previous_log_loss"]].to_string(index=False), flush=True)


if __name__ == "__main__":
    main()
