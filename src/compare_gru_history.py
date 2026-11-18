"""Compare same-type shot sequences, recent summaries, and January blends."""

import argparse
import copy
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss
from threadpoolctl import threadpool_limits
import torch
from torch import nn
from torch.nn.utils.rnn import pack_padded_sequence

from build_modeling_dataset import SHOT_KEY, TARGET
from shot_history import build_specialist_data, FEATURES, model_inputs, sequence_data
from fit_baselines import context_preprocessor, diagnostic_scores, game_bootstrap, load_development
from tree_models import fit_catboost
from compare_shot_type_routes import load_model_settings


class ShotGRU(nn.Module):
    def __init__(self, context_width, sequence_width):
        super().__init__()
        self.recurrent = nn.GRU(sequence_width, 16, batch_first=True)
        self.head = nn.Sequential(nn.Linear(context_width + 16, 32), nn.ReLU(), nn.Dropout(0.1), nn.Linear(32, 1))

    def forward(self, context, sequence, lengths):
        packed = pack_padded_sequence(sequence, lengths.clamp(min=1), batch_first=True, enforce_sorted=False)
        _, state = self.recurrent(packed)
        history = state[-1] * lengths.gt(0)[:, None]
        return self.head(torch.cat([context, history], dim=1)).squeeze(-1)


def fit_gru(context, sequence, lengths, labels, before_january, seed, *, max_epochs=30, patience=5):
    torch.manual_seed(seed)
    model = ShotGRU(context.shape[1], sequence.shape[2])
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.0001)
    context = torch.tensor(context, dtype=torch.float32)
    sequence = torch.tensor(sequence, dtype=torch.float32)
    lengths = torch.tensor(lengths)
    labels = torch.tensor(labels, dtype=torch.float32)
    train_ids = torch.tensor(np.flatnonzero(before_january))
    validation_ids = torch.tensor(np.flatnonzero(~before_january))
    best = float("inf"), 0, None
    clipped, steps, max_norm = 0, 0, 0.0
    for epoch in range(1, max_epochs + 1):
        model.train()
        for batch in train_ids[torch.randperm(len(train_ids))].split(512):
            optimizer.zero_grad()
            logits = model(context[batch], sequence[batch], lengths[batch])
            nn.functional.binary_cross_entropy_with_logits(logits, labels[batch]).backward()
            norm = nn.utils.clip_grad_norm_(model.parameters(), max_norm=2.0, error_if_nonfinite=True)
            clipped += int(norm > 2.0)
            steps += 1
            max_norm = max(max_norm, float(norm))
            optimizer.step()
        model.eval()
        with torch.inference_mode():
            probabilities = torch.cat([
                model(context[batch], sequence[batch], lengths[batch]).sigmoid()
                for batch in validation_ids.split(1024)
            ]).numpy().astype(float)
        loss = log_loss(labels[validation_ids].numpy(), probabilities)
        if loss < best[0]:
            best = loss, epoch, probabilities.copy()
        if epoch - best[1] >= patience:
            break
    return best[2], {
        "seed": seed, "best_epoch": best[1], "epochs_run": epoch, "log_loss": best[0],
        "max_epochs": max_epochs, "patience": patience,
        "clip_max_norm": 2.0, "clipped_steps": clipped, "steps": steps, "max_gradient_norm_before_clipping": max_norm,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/shot-type-comparison"))
    args = parser.parse_args()
    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    keys = [*SHOT_KEY, "GAME_DATE", "PTS_TYPE", TARGET]
    saved = pd.read_csv(args.output / "january-fully-separate-predictions.csv", dtype={"GAME_ID": "string"})
    pd.testing.assert_frame_equal(saved[keys], validation[keys])
    settings, _ = load_model_settings(args.comparison)
    columns = [column for column in FEATURES if column != "PTS_TYPE"]
    predictions, training_log = {}, []
    torch.set_num_threads(3)
    with threadpool_limits(limits=3):
        for value, rows in validation.groupby("PTS_TYPE"):
            training, scoring = build_specialist_data(train, validation, value)
            pd.testing.assert_frame_equal(scoring[keys].reset_index(drop=True), rows[keys].reset_index(drop=True))
            shots = pd.concat([training, scoring], ignore_index=True)
            before = np.arange(len(shots)) < len(training)
            train_x, scoring_x = model_inputs(training, scoring, settings["TabM"], columns)
            preprocess = context_preprocessor(train_x.columns)
            context = np.concatenate([preprocess.fit_transform(train_x), preprocess.transform(scoring_x)])
            for window in (10, 20):
                sequence, lengths, summary = sequence_data(shots, before, window)
                for model_name in ("CatBoost", "Histogram gradient boosting"):
                    config = settings[model_name]
                    tx, vx = model_inputs(training, scoring, config, columns)
                    tx, vx = (frame.reset_index(drop=True) for frame in (tx, vx))
                    tx = pd.concat([tx, summary.loc[before].reset_index(drop=True)], axis=1)
                    vx = pd.concat([vx, summary.loc[~before].reset_index(drop=True)], axis=1)
                    if model_name == "CatBoost":
                        prob, _ = fit_catboost(
                            tx, training[TARGET], vx, scoring[TARGET], depths=(config["depth"],),
                            iterations=config["rounds"], learning_rate=config["learning_rate"],
                            early_stopping_rounds=None,
                        )
                    else:
                        parameters = copy.deepcopy(config["parameters"])
                        parameters["max_leaf_nodes"] = 12
                        proc = context_preprocessor(tx.columns)
                        estimator = HistGradientBoostingClassifier(**parameters).fit(proc.fit_transform(tx), training[TARGET])
                        prob = estimator.predict_proba(proc.transform(vx))[:, 1]
                    name = f"{model_name} + last {window} summaries"
                    predictions.setdefault(name, np.empty(len(validation)))[rows.index] = prob
                for seed in (42, 43, 44):
                    prob, log = fit_gru(context, sequence, lengths, shots[TARGET].to_numpy(), before, seed)
                    name = f"GRU last {window} seed {seed}"
                    predictions.setdefault(name, np.empty(len(validation)))[rows.index] = prob
                    training_log.append(dict(shot_type=value, window=window, **log))
                    print(f"{value}PT {name}: loss {log['log_loss']:.7f}, best epoch {log['best_epoch']}, "
                          f"clipped {log['clipped_steps']}/{log['steps']} steps", flush=True)
    records, blend_predictions = [], {}
    for value, rows in validation.groupby("PTS_TYPE"):
        reference = saved.loc[rows.index, "Best fully separate model by type"].to_numpy()
        candidates = {name: prob[rows.index] for name, prob in predictions.items()}
        for window in (10, 20):
            # Score each seed separately, then report their mean metrics.
            for seed in (42, 43, 44):
                name = f"GRU last {window} seed {seed}"
                candidates[f"CatBoost + Histogram + {name}"] = (
                    saved.loc[rows.index, "CatBoost"].to_numpy() +
                    saved.loc[rows.index, "Histogram gradient boosting"].to_numpy() + candidates[name]
                ) / 3
        pair = {"Reference": reference, **candidates}
        scores = diagnostic_scores(rows[TARGET], pair).set_index("baseline")
        scores["log_loss_delta"] = scores["log_loss"] - scores.at["Reference", "log_loss"]
        scores = scores.join(game_bootstrap(rows, pair, "Reference")).reset_index().assign(shot_type=value)
        records.append(scores)
        print(scores[["baseline", "log_loss", "calibration_error_10_bins"]].to_string(index=False), flush=True)
        for name, prob in candidates.items():
            blend_predictions.setdefault(name, np.empty(len(validation)))[rows.index] = prob
    predictions.update(blend_predictions)
    pd.concat(records, ignore_index=True).to_csv(args.output / "january-gru-scores.csv", index=False)
    pd.DataFrame(training_log).to_csv(args.output / "january-gru-training.csv", index=False)
    pd.concat([validation[keys], pd.DataFrame(predictions)], axis=1).to_csv(
        args.output / "january-gru-predictions.csv", index=False,
    )


if __name__ == "__main__":
    main()
