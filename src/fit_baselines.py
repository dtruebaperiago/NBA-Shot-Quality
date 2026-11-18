"""Compare three make-probability baselines on the January validation split."""

import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.optimize import minimize_scalar
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, balanced_accuracy_score, brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from build_modeling_dataset import (
    CONTEXT_COLUMNS, HISTORY_COLUMNS, HOLDOUT_START, SHOT_KEY, TARGET,
    VALIDATION_START, smoothed_shooter_rate,
)


def choose_shrinkage(validation):
    """Select the equivalent league attempts by minimizing log loss on the given rows."""
    result = minimize_scalar(
        lambda log_weight: log_loss(
            validation[TARGET], smoothed_shooter_rate(validation, np.exp(log_weight))
        ),
        bounds=(np.log(0.01), np.log(100_000)),
        method="bounded",
    )
    if not result.success:
        raise RuntimeError(f"Shrinkage optimization failed: {result.message}")
    return float(np.exp(result.x))


def context_inputs(shots, weight, context_columns):
    history_rate = "SHOOTER_SMOOTHED_FG_RATE"
    columns = [*context_columns, HISTORY_COLUMNS[0], history_rate]
    return shots.assign(**{history_rate: smoothed_shooter_rate(shots, weight)})[columns]


def context_preprocessor(columns, *, extra_categorical=()):
    categorical = [
        column for column in ("PTS_TYPE", "PERIOD", "LOCATION", *extra_categorical) if column in columns
    ]
    numeric = [column for column in columns if column not in categorical]
    return ColumnTransformer([
        ("numeric", make_pipeline(SimpleImputer(strategy="median"), StandardScaler()), numeric),
        ("categorical", OneHotEncoder(handle_unknown="ignore"), categorical),
    ], sparse_threshold=0)


def fit_context(train, validation, weight, context_columns=CONTEXT_COLUMNS, estimator=None):
    train_features = context_inputs(train, weight, context_columns)
    validation_features = context_inputs(validation, weight, context_columns)
    if estimator is None:
        estimator = LogisticRegression(max_iter=1000)
    model = make_pipeline(context_preprocessor(train_features.columns), estimator)
    model.fit(train_features, train[TARGET])
    return model.predict_proba(validation_features)[:, 1]


def calibration_table(target, probabilities, bin_count, *, right_closed):
    p = np.asarray(probabilities)
    if right_closed:
        band = pd.cut(p, np.linspace(0, 1, bin_count + 1), labels=False, include_lowest=True)
    else:
        band = np.minimum(np.floor(p * bin_count).astype(int), bin_count - 1)
    grouped = pd.DataFrame({"band": band, "probability": p, "made": np.asarray(target)})
    grouped = grouped.groupby("band").agg(
        attempts=("made", "size"), makes=("made", "sum"),
        predicted_rate=("probability", "mean"), expected_makes=("probability", "sum"),
    ).reindex(range(bin_count))
    grouped["attempts"] = grouped["attempts"].fillna(0).astype(int)
    grouped["makes"] = grouped["makes"].fillna(0).astype(int)
    grouped["expected_makes"] = grouped["expected_makes"].fillna(0)
    grouped["observed_rate"] = grouped["makes"].div(grouped["attempts"].replace(0, np.nan))
    return grouped


def save_calibration(target, predictions, path):
    figure, (rates, counts) = plt.subplots(
        2, 1, figsize=(8, 8), sharex=True, layout="constrained",
        gridspec_kw={"height_ratios": [3, 1]},
    )
    rates.plot([0, 1], [0, 1], "--", color="0.5", label="Perfect calibration")
    for name, probabilities in predictions.items():
        calibration = calibration_table(target, probabilities, 10, right_closed=True)
        calibration = calibration.loc[calibration["attempts"].gt(0)]
        line, = rates.plot(calibration["predicted_rate"], calibration["observed_rate"], "o-", label=name)
        counts.plot(calibration["predicted_rate"], calibration["attempts"], "o-", color=line.get_color())
    rates.set(title="January 2015 calibration", ylabel="Observed make rate", xlim=(0, 1), ylim=(0, 1))
    rates.legend()
    counts.set(xlabel="Mean predicted make probability in bin", ylabel="Attempts", yscale="log")
    figure.savefig(path, dpi=160)
    plt.close(figure)


def load_development(data):
    train = pd.read_csv(data / "train.csv", dtype={"GAME_ID": "string"})
    validation = pd.read_csv(data / "validation.csv", dtype={"GAME_ID": "string"})
    if (
        train.empty or validation.empty
        or not train["GAME_DATE"].between("2014-10-01", VALIDATION_START, inclusive="left").all()
        or not validation["GAME_DATE"].between(VALIDATION_START, HOLDOUT_START, inclusive="left").all()
        or not set(train["GAME_ID"]).isdisjoint(validation["GAME_ID"])
        or train.duplicated(SHOT_KEY).any()
        or validation.duplicated(SHOT_KEY).any()
    ):
        raise ValueError("Expected disjoint October–December and January shots")
    return train, validation


def score_predictions(target, predictions):
    return pd.DataFrame([
        {
            "baseline": name,
            "attempts": len(target),
            "log_loss": log_loss(target, probabilities, labels=[0, 1]),
            "brier_score": brier_score_loss(target, probabilities, pos_label=1),
        }
        for name, probabilities in predictions.items()
    ])


def diagnostic_scores(target, predictions, *, include_calibration=True):
    scores = score_predictions(target, predictions).set_index("baseline")
    observed = np.asarray(target)
    fifth = len(observed) // 5
    for name, probabilities in predictions.items():
        probabilities = np.asarray(probabilities, dtype=float)
        classes = probabilities >= 0.5
        order = np.argsort(probabilities, kind="stable")
        scores.loc[name, "accuracy_at_0_5"] = accuracy_score(observed, classes)
        scores.loc[name, "balanced_accuracy_at_0_5"] = balanced_accuracy_score(observed, classes)
        scores.loc[name, "roc_auc"] = roc_auc_score(observed, probabilities)
        scores.loc[name, "mean_predicted_make_rate"] = probabilities.mean()
        scores.loc[name, "observed_make_rate"] = observed.mean()
        if include_calibration:
            calibration = calibration_table(observed, probabilities, 10, right_closed=True)
            gap = calibration["expected_makes"] - calibration["makes"]
            scores.loc[name, "calibration_error_10_bins"] = gap.abs().sum() / len(observed)
        scores.loc[name, "lowest_probability_fifth_make_rate"] = observed[order[:fifth]].mean()
        scores.loc[name, "highest_probability_fifth_make_rate"] = observed[order[-fifth:]].mean()
    return scores.sort_values("log_loss").reset_index()


def game_bootstrap(shots, predictions, reference="CatBoost"):
    """Resample whole games and compare each candidate with the same reference predictions."""
    probabilities = pd.DataFrame(predictions, index=shots.index)
    likelihood = probabilities.where(shots[TARGET].eq(1), 1 - probabilities, axis=0)
    losses = -np.log(likelihood.clip(lower=np.finfo(float).eps))
    difference = losses.subtract(losses[reference], axis=0)
    by_game = difference.groupby(shots["GAME_ID"])
    sums, sizes = by_game.sum(), by_game.size()
    sampled = np.random.default_rng(42).integers(len(sizes), size=(5000, len(sizes)))
    deltas = sums.to_numpy()[sampled].sum(axis=1) / sizes.to_numpy()[sampled].sum(axis=1)[:, None]
    return pd.DataFrame(
        np.quantile(deltas, [0.025, 0.975], axis=0).T,
        index=losses.columns, columns=["game_bootstrap_ci_low", "game_bootstrap_ci_high"],
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/baselines"))
    args = parser.parse_args()

    train, validation = load_development(args.data)
    weight = choose_shrinkage(validation)
    predictions = {
        "League average": validation[HISTORY_COLUMNS[2]],
        "Shooter history": smoothed_shooter_rate(validation, weight),
        "Shooter history + context": fit_context(train, validation, weight),
    }
    target = validation[TARGET]
    scores = score_predictions(target, predictions)
    args.output.mkdir(parents=True, exist_ok=True)
    scores.to_csv(args.output / "january-scores.csv", index=False)
    save_calibration(target, predictions, args.output / "january-calibration.png")
    print(f"January-selected shrinkage weight: {weight:.6f} equivalent attempts")
    print(scores.to_string(index=False))


if __name__ == "__main__":
    main()
