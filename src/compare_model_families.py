"""Compare tree, neural and hierarchical Bayesian models on January attempts."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import log_loss
from tabm import TabM
from threadpoolctl import threadpool_limits
import torch
from torch.nn import functional as F

from bayesian_shot_model import fit_bayesian_shot_model
from build_modeling_dataset import HISTORY_COLUMNS, SHOT_KEY, TARGET, VALIDATION_START
from shot_history import add_defender_history, FEATURES, with_defender_weight
from compare_shot_type_models import MODELS
from play_by_play_context import SHOT_VALUE
from fit_baselines import (
    context_inputs, context_preprocessor, diagnostic_scores, fit_context, load_development,
    save_calibration, score_predictions,
)
from tree_models import fit_catboost


def fit_tabm(
    train_x, train_y, validation_x, validation_y, *,
    widths=(64, 128), seed=42, gate_factory=None,
    max_epochs=40, patience=6, clip_norm=None,
):
    preprocess = context_preprocessor(train_x.columns)
    training = torch.tensor(preprocess.fit_transform(train_x), dtype=torch.float32)
    scoring = torch.tensor(preprocess.transform(validation_x), dtype=torch.float32)
    labels = torch.tensor(train_y.to_numpy(), dtype=torch.float32)
    candidates = []
    training_logs = {}
    for width in widths:
        torch.manual_seed(seed)
        model = TabM.make(
            n_num_features=training.shape[1], d_out=1, k=8, n_blocks=2, d_block=width, dropout=0.1,
        )
        if gate_factory is not None:
            # Keep the TabM initialization, batch order, and dropout draws paired.
            with torch.random.fork_rng(devices=[]):
                gate = gate_factory(preprocess.get_feature_names_out())
            model = torch.nn.Sequential(gate, model)
        optimizer = torch.optim.AdamW(model.parameters(), lr=0.002)
        best = (float("inf"), 0, None)
        clipped, steps, maximum_norm = 0, 0, 0.0
        for epoch in range(1, max_epochs + 1):
            model.train()
            for batch in torch.randperm(len(training)).split(1024):
                logits = model(training[batch]).squeeze(-1)
                targets = labels[batch, None].expand_as(logits)
                optimizer.zero_grad()
                F.binary_cross_entropy_with_logits(logits, targets).backward()
                if clip_norm is not None:
                    norm = torch.nn.utils.clip_grad_norm_(model.parameters(), clip_norm, error_if_nonfinite=True)
                    clipped += int(norm > clip_norm)
                    maximum_norm = max(maximum_norm, float(norm))
                steps += 1
                optimizer.step()
            model.eval()
            with torch.inference_mode():
                probabilities = torch.cat([
                    model(batch).sigmoid().mean(dim=1).squeeze(-1) for batch in scoring.split(2048)
                ]).numpy()
            loss = log_loss(validation_y, probabilities)
            if loss < best[0]:
                best = loss, epoch, probabilities
            if epoch - best[1] >= patience:
                break
        training_logs[width] = {
            "epochs_run": epoch, "max_epochs": max_epochs, "patience": patience,
            "clip_max_norm": clip_norm, "clipped_steps": clipped, "steps": steps,
            "max_gradient_norm_before_clipping": maximum_norm if clip_norm is not None else None,
        }
        candidates.append((*best, width))
        print(f"TabM width {width} best epoch {best[1]} log loss {best[0]:.6f}", flush=True)
    loss, epoch, probabilities, width = min(candidates, key=lambda candidate: candidate[0])
    return probabilities, {
        "width": width, "epoch": epoch, "ensemble_members": 8, "validation_log_loss": loss,
        **training_logs[width],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--tuned", type=Path, default=Path("data/processed/tree-tuning/january-best.csv"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--warmup", type=int, default=750)
    parser.add_argument("--draws", type=int, default=1000)
    args = parser.parse_args()
    if args.warmup < 0 or args.draws < 4:
        parser.error("Warmup must be nonnegative and draws must be at least four")
    train, validation = load_development(args.data)
    train = train.sort_values(["GAME_DATE", *SHOT_KEY])
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    tuned = pd.read_csv(args.tuned).set_index("baseline", verify_integrity=True)
    torch.set_num_threads(3)
    settings = {}

    with threadpool_limits(limits=3), ThreadPoolExecutor(max_workers=1) as pool:
        print("Starting Bayesian shooter and closest-defender chains", flush=True)
        bayesian = pool.submit(fit_bayesian_shot_model, train, validation, args.warmup, args.draws)
        shots = add_defender_history(pd.concat([train, validation], ignore_index=True))
        before_january = shots["GAME_DATE"].lt(VALIDATION_START)
        train = shots.loc[before_january]
        validation = shots.loc[~before_january].reset_index(drop=True)
        predictions = {}
        for name, estimator in MODELS.items():
            config = tuned.loc[name]
            parameters = json.loads(config["parameters"])
            settings[name] = dict(
                parameters=parameters, shooter_weight=float(config["shooter_weight"]), defender_weight=float(config["defender_weight"]),
            )
            predictions[name] = fit_context(
                with_defender_weight(train, config["defender_weight"]),
                with_defender_weight(validation, config["defender_weight"]),
                config["shooter_weight"], FEATURES, estimator(**parameters),
            )
        reference = tuned.loc["Histogram gradient boosting"]
        train_x, validation_x = (
            context_inputs(with_defender_weight(split, reference["defender_weight"]), reference["shooter_weight"], FEATURES)
            for split in (train, validation)
        )
        for name, fit in (("CatBoost", fit_catboost), ("TabM", fit_tabm)):
            print(f"Fitting {name}", flush=True)
            predictions[name], settings[name] = fit(train_x, train[TARGET], validation_x, validation[TARGET])
            settings[name].update(
                shooter_weight=float(reference["shooter_weight"]), defender_weight=float(reference["defender_weight"]),
            )
            print(settings[name], flush=True)
        predictions["Hierarchical Bayesian logistic"], settings["Hierarchical Bayesian logistic"] = bayesian.result()

    scores = score_predictions(validation[TARGET], predictions).sort_values("log_loss")
    by_type = [
        score_predictions(rows[TARGET], {name: values[rows.index] for name, values in predictions.items()})
        .assign(shot_type=f"{value}PT")
        for value, rows in validation.groupby(SHOT_VALUE)
    ]
    args.output.mkdir(parents=True, exist_ok=True)
    scores.to_csv(args.output / "january-scores.csv", index=False)
    with_league = {"League average": validation[HISTORY_COLUMNS[2]].to_numpy(), **predictions}
    diagnostic_scores(validation[TARGET], with_league).to_csv(args.output / "january-diagnostics.csv", index=False)
    pd.concat([
        validation[[*SHOT_KEY, "GAME_DATE", SHOT_VALUE, TARGET]], pd.DataFrame(with_league),
    ], axis=1).to_csv(args.output / "january-predictions.csv", index=False)
    pd.concat(by_type, ignore_index=True).to_csv(args.output / "january-shot-type-scores.csv", index=False)
    (args.output / "settings.json").write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
    save_calibration(validation[TARGET], predictions, args.output / "january-calibration.png")
    print(scores.to_string(index=False))
    print(settings["Hierarchical Bayesian logistic"])


if __name__ == "__main__":
    main()
