"""Compare a small TabM feature gate and equal-weight blends on January shots."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits
import torch
from torch import nn

from build_modeling_dataset import HISTORY_COLUMNS, SHOT_KEY, TARGET, VALIDATION_START
from shot_history import add_defender_history, CLOCK, DEFENDER_HISTORY, FEATURES, with_defender_weight
from fit_baselines import context_inputs, diagnostic_scores, game_bootstrap, load_development
from compare_model_families import fit_tabm
from compare_tree_extensions import BLEND, TREES


GATED = "Gated TabM"
TWO_TREES = "CatBoost + Histogram"
TABM_BLEND = "CatBoost + Histogram + TabM"
GATED_BLEND = "CatBoost + Histogram + gated TabM"
FEATURE_GROUPS = (
    ("SHOT_DIST_CLEAN", "CLOSE_DEF_DIST"),
    ("TOUCH_TIME_CLEAN", "DRIBBLES", "PERIOD_SECONDS", CLOCK),
    (HISTORY_COLUMNS[0], "SHOOTER_SMOOTHED_FG_RATE", DEFENDER_HISTORY),
)


class ShotFeatureGate(nn.Module):
    """Condition three feature-group multipliers on the same shot's inputs."""

    def __init__(self, columns):
        super().__init__()
        group_count = len(FEATURE_GROUPS)
        indices = {name: group for group, names in enumerate(FEATURE_GROUPS) for name in names}
        numeric_names = [name.removeprefix("numeric__") for name in columns]
        if not indices.keys() <= set(numeric_names):
            raise ValueError("TabM gate is missing one or more input features")
        self.register_buffer("groups", torch.tensor([indices.get(name, group_count) for name in numeric_names]))
        self.excitation = nn.Sequential(nn.Linear(len(columns), 8), nn.ReLU(), nn.Linear(8, group_count))
        nn.init.zeros_(self.excitation[-1].weight)
        nn.init.zeros_(self.excitation[-1].bias)

    def forward(self, inputs):
        # Multipliers start at one. Categorical features pass through unchanged.
        scales = 2 * self.excitation(inputs).sigmoid()
        scales = torch.cat([scales, torch.ones_like(scales[:, :1])], dim=1)
        return inputs * scales[:, self.groups]


def score_run(validation, saved, plain, gated, seed, plain_epoch, gated_epoch):
    tree_pair = saved[TREES[:2]].to_numpy().sum(axis=1)
    predictions = {
        "League average": saved["League average"].to_numpy(),
        "TabM": plain,
        GATED: gated,
        BLEND: saved[TREES].mean(axis=1).to_numpy(),
        TWO_TREES: tree_pair / 2,
        TABM_BLEND: (tree_pair + plain) / 3,
        GATED_BLEND: (tree_pair + gated) / 3,
    }
    scores = diagnostic_scores(validation[TARGET], predictions).set_index("baseline")
    scores["best_epoch"] = pd.Series({"TabM": plain_epoch, GATED: gated_epoch}, dtype="Int64")
    scores["seed"] = seed
    for reference, names in (("TabM", [GATED]), (BLEND, [TWO_TREES, TABM_BLEND, GATED_BLEND])):
        intervals = game_bootstrap(validation, {name: predictions[name] for name in [reference, *names]}, reference)
        scores.loc[names, "reference"] = reference
        scores.loc[names, "log_loss_delta"] = scores.loc[names, "log_loss"] - scores.loc[reference, "log_loss"]
        scores.loc[names, intervals.columns] = intervals.loc[names]
    return scores.reset_index()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--seeds", nargs="+", type=int, default=[42, 43, 44])
    args = parser.parse_args()

    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    saved = pd.read_csv(args.comparison / "january-predictions.csv", dtype={"GAME_ID": "string"})
    keys = [*SHOT_KEY, "GAME_DATE", "PTS_TYPE", TARGET]
    pd.testing.assert_frame_equal(saved[keys], validation[keys])
    config = json.loads((args.comparison / "settings.json").read_text(encoding="utf-8"))["TabM"]
    torch.set_num_threads(3)

    runs = []
    with threadpool_limits(limits=3):
        shots = add_defender_history(pd.concat([train, validation], ignore_index=True))
        shots = with_defender_weight(shots, config["defender_weight"])
        before_january = shots["GAME_DATE"].lt(VALIDATION_START)
        train, scoring = shots.loc[before_january], shots.loc[~before_january]
        pd.testing.assert_frame_equal(scoring[keys].reset_index(drop=True), validation[keys])
        train_x, scoring_x = (context_inputs(split, config["shooter_weight"], FEATURES) for split in (train, scoring))
        for seed in args.seeds:
            print(f"Training plain TabM with seed {seed}", flush=True)
            plain, plain_settings = fit_tabm(
                train_x, train[TARGET], scoring_x, scoring[TARGET], widths=(config["width"],), seed=seed,
            )
            if seed == 42:
                np.testing.assert_array_equal(plain, saved["TabM"].to_numpy(dtype=np.float32))
            print(f"Training gated TabM with seed {seed}", flush=True)
            gated, gated_settings = fit_tabm(
                train_x, train[TARGET], scoring_x, scoring[TARGET],
                widths=(config["width"],), seed=seed, gate_factory=ShotFeatureGate,
            )
            scores = score_run(validation, saved, plain, gated, seed, plain_settings["epoch"], gated_settings["epoch"])
            runs.append(scores)
            print(scores[["baseline", "log_loss", "calibration_error_10_bins"]].to_string(index=False), flush=True)
    pd.concat(runs, ignore_index=True).to_csv(args.comparison / "january-tabm-gate.csv", index=False)


if __name__ == "__main__":
    main()
