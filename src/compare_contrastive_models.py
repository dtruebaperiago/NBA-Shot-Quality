"""Compare BCE, masked-view InfoNCE, and semi-hard triplet objectives on January."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import log_loss
from threadpoolctl import threadpool_limits
import torch
from torch import nn
from torch.nn import functional as F

from build_modeling_dataset import SHOT_KEY, TARGET
from shot_history import build_specialist_data, FEATURES, model_inputs, sequence_data
from fit_baselines import context_preprocessor, diagnostic_scores, game_bootstrap, load_development
from compare_shot_type_routes import load_model_settings


SEEDS = (42, 43, 44)
OBJECTIVES = {"BCE": 0.0, "InfoNCE 0.01": 0.01, "InfoNCE 0.05": 0.05, "Triplet 0.01": 0.01, "Triplet 0.05": 0.05}


def feature_groups(names):
    labels = []
    for name in names:
        column = name.split("__", 1)[1]
        if column.startswith("PERIOD_"):
            label = "PERIOD"
        elif column.startswith("LOCATION_"):
            label = "LOCATION"
        elif column.startswith("SHOOTER_"):
            label = "SHOOTER_HISTORY"
        elif column.startswith("RECENT_"):
            label = "RECENT_HISTORY"
        elif column.endswith("_MISSING"):
            label = column.removesuffix("_MISSING")
        else:
            label = column
        labels.append(label)
    return torch.tensor(pd.factorize(np.asarray(labels))[0])


class ContrastiveShotModel(nn.Module):
    def __init__(self, width, groups):
        super().__init__()
        self.register_buffer("groups", groups)
        self.group_count = int(groups.max()) + 1
        self.encoder = nn.Sequential(
            nn.Linear(width + self.group_count, 128), nn.LayerNorm(128), nn.ReLU(),
            nn.Linear(128, 64), nn.LayerNorm(64), nn.ReLU(),
        )
        self.projection = nn.Sequential(nn.Linear(64, 64), nn.ReLU(), nn.Linear(64, 32))
        self.probability = nn.Sequential(nn.Dropout(0.1), nn.Linear(64, 1))

    def encode(self, values, mask=None):
        if mask is None:
            mask = torch.zeros(len(values), self.group_count)
        return self.encoder(torch.cat([values * (1 - mask[:, self.groups]), mask], dim=1))

    def forward(self, values):
        representation = self.encode(values)
        return self.probability(representation).squeeze(-1), F.normalize(self.projection(representation), dim=1)


def masked_views(model, values, generator):
    embeddings = []
    for _ in range(2):
        mask = torch.rand(len(values), model.group_count, generator=generator).lt(0.1)
        # Give every view at least one masked group.
        empty = ~mask.any(dim=1)
        chosen = torch.randint(model.group_count, (int(empty.sum()),), generator=generator)
        mask[torch.nonzero(empty, as_tuple=True)[0], chosen] = True
        embeddings.append(F.normalize(model.projection(model.encode(values, mask.float())), dim=1))
    return embeddings


def info_nce(first, second, temperature=0.2):
    embeddings = torch.cat([first, second])
    similarities = embeddings @ embeddings.T / temperature
    similarities.fill_diagonal_(-torch.inf)
    batch = len(first)
    targets = (torch.arange(2 * batch) + batch) % (2 * batch)
    return F.cross_entropy(similarities, targets)


def semi_hard_triplets(embeddings, labels, generator, margin=0.2):
    distances = (2 - 2 * embeddings @ embeddings.T).clamp(min=0)
    same = labels[:, None].eq(labels)
    same.fill_diagonal_(False)
    random_scores = torch.rand(same.shape, generator=generator).masked_fill(~same, -1)
    positive = random_scores.argmax(dim=1)
    positive_distance = distances[torch.arange(len(labels)), positive]
    eligible = ~labels[:, None].eq(labels) & (
        distances.detach() > positive_distance.detach()[:, None]
    ) & (distances.detach() < positive_distance.detach()[:, None] + margin)
    negative = distances.detach().masked_fill(~eligible, torch.inf).argmin(dim=1)
    valid = same.any(dim=1) & eligible.any(dim=1)
    loss = (positive_distance - distances[torch.arange(len(labels)), negative] + margin).relu()
    return loss[valid].mean() if valid.any() else embeddings.sum() * 0, int(valid.sum())


def fit_model(training, target, scoring, observed, groups, objective, weight, seed):
    torch.manual_seed(seed)
    model = ContrastiveShotModel(training.shape[1], groups)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001, weight_decay=0.0001)
    augmentation = torch.Generator().manual_seed(seed + 1000)
    order = torch.Generator().manual_seed(seed + 2000)
    train_x, score_x = (torch.tensor(values, dtype=torch.float32) for values in (training, scoring))
    labels = torch.tensor(target, dtype=torch.float32)
    best, history = (float("inf"), 0, None), []
    clipped, steps, maximum_norm = 0, 0, 0.0
    for epoch in range(1, 51):
        model.train()
        auxiliary_total, triplets = 0.0, 0
        for batch in torch.randperm(len(training), generator=order).split(512):
            optimizer.zero_grad()
            logits, embeddings = model(train_x[batch])
            classification = F.binary_cross_entropy_with_logits(logits, labels[batch])
            auxiliary = logits.sum() * 0
            if objective.startswith("InfoNCE"):
                auxiliary = info_nce(*masked_views(model, train_x[batch], augmentation))
            elif objective.startswith("Triplet") and epoch > 5:
                auxiliary, valid = semi_hard_triplets(embeddings, labels[batch], augmentation)
                triplets += valid
            loss = classification + weight * auxiliary
            loss.backward()
            norm = nn.utils.clip_grad_norm_(model.parameters(), 2.0, error_if_nonfinite=True)
            maximum_norm = max(maximum_norm, float(norm))
            clipped += int(norm > 2)
            steps += 1
            optimizer.step()
            auxiliary_total += float(auxiliary.detach()) * len(batch)
        model.eval()
        with torch.inference_mode():
            probabilities = torch.cat([model(batch)[0].sigmoid() for batch in score_x.split(1024)]).numpy().astype(float)
        validation_loss = log_loss(observed, probabilities)
        history.append(dict(epoch=epoch, log_loss=validation_loss,
                            auxiliary_loss=auxiliary_total / len(training), valid_triplets=triplets))
        if validation_loss < best[0]:
            best = validation_loss, epoch, probabilities.copy()
        if epoch - best[1] >= 10:
            break
    return best[2], {
        "objective": objective, "weight": weight, "seed": seed, "best_epoch": best[1],
        "epochs_run": epoch, "log_loss": best[0], "clipped_steps": clipped, "steps": steps,
        "max_gradient_norm_before_clipping": maximum_norm, "history": history,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--reference", type=Path, default=Path("data/processed/retraining-50-10/january-predictions.csv"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/contrastive-comparison"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    keys = [*SHOT_KEY, "GAME_DATE", "PTS_TYPE", TARGET]
    reference = pd.read_csv(args.reference, dtype={"GAME_ID": "string"})
    pd.testing.assert_frame_equal(reference[keys], validation[keys])
    settings, _ = load_model_settings(args.comparison)
    predictions, logs, records = {}, [], []
    torch.set_num_threads(3)
    with threadpool_limits(limits=3):
        for value, rows in validation.groupby("PTS_TYPE"):
            training, scoring = build_specialist_data(train, validation, value)
            pd.testing.assert_frame_equal(scoring[keys].reset_index(drop=True), rows[keys].reset_index(drop=True))
            shots = pd.concat([training, scoring], ignore_index=True)
            before = np.arange(len(shots)) < len(training)
            _, _, summary = sequence_data(shots, before, 10, include_sequence=False)
            train_x, score_x = model_inputs(training, scoring, settings["TabM"], [name for name in FEATURES if name != "PTS_TYPE"])
            all_x = pd.concat([train_x, score_x], ignore_index=True)
            all_x = pd.concat([all_x, summary], axis=1)
            for column in list(all_x.columns):
                if all_x.loc[before, column].isna().any():
                    all_x[f"{column}_MISSING"] = all_x[column].isna().astype(float)
            preprocess = context_preprocessor(all_x.columns)
            encoded_train = preprocess.fit_transform(all_x.loc[before])
            encoded_score = preprocess.transform(all_x.loc[~before])
            groups = feature_groups(preprocess.get_feature_names_out())
            candidates = {}
            for objective, weight in OBJECTIVES.items():
                for seed in SEEDS:
                    name = f"{objective} seed {seed}"
                    probability, log = fit_model(
                        encoded_train, training[TARGET].to_numpy(), encoded_score, scoring[TARGET].to_numpy(),
                        groups, objective, weight, seed,
                    )
                    candidates[name] = probability
                    logs.append(dict(shot_type=value, **log))
                    print(f"{value}PT {name}: loss {log['log_loss']:.7f}, best epoch {log['best_epoch']}, "
                          f"clipped {log['clipped_steps']}/{log['steps']}", flush=True)
                    (args.output / "training.json").write_text(json.dumps(logs, indent=2), encoding="utf-8")
                candidates[f"{objective} seed average"] = np.mean([candidates[f"{objective} seed {seed}"] for seed in SEEDS], axis=0)
            tree_pair = reference.loc[rows.index, [
                "CatBoost + last 10 summaries", "Histogram gradient boosting + last 10 summaries",
            ]].to_numpy().sum(axis=1)
            candidates["Reference soft vote"] = tree_pair / 2
            for objective in OBJECTIVES:
                candidates[f"Trees + {objective}"] = (tree_pair + candidates[f"{objective} seed average"]) / 3
            scores = diagnostic_scores(rows[TARGET], candidates).set_index("baseline")
            scores = scores.join(game_bootstrap(rows, candidates, "Reference soft vote"))
            scores["delta_vs_reference"] = scores["log_loss"] - scores.at["Reference soft vote", "log_loss"]
            records.append(scores.reset_index().assign(shot_type=value))
            for name, probabilities in candidates.items():
                predictions.setdefault(name, np.full(len(validation), np.nan))[rows.index] = probabilities
            pd.concat(records, ignore_index=True).to_csv(args.output / "january-scores.csv", index=False)
            pd.concat([validation[keys], pd.DataFrame(predictions)], axis=1).to_csv(args.output / "january-predictions.csv", index=False)
            print(scores[["log_loss", "calibration_error_10_bins"]].head(10).to_string(), flush=True)
    (args.output / "settings.json").write_text(json.dumps({
        "objectives": OBJECTIVES, "seeds": SEEDS, "max_epochs": 50, "patience": 10, "gradient_clip_max_norm": 2.0,
        "info_nce_temperature": 0.2, "mask_probability": 0.1,
        "triplet_squared_distance_margin": 0.2, "triplet_warmup_epochs": 5,
        "encoder_widths": [128, 64], "projection_width": 32, "batch_size": 512,
        "history": "Same shot type, strictly earlier dates",
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
