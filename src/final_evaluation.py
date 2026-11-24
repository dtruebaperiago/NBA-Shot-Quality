"""Refit the frozen shot-quality models and evaluate the reserved archive."""

import argparse
from hashlib import sha256
import json
from pathlib import Path
import platform
from tempfile import TemporaryDirectory

from catboost import CatBoostClassifier, __version__ as catboost_version
from joblib import dump, load
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import PercentFormatter
import numpy as np
import pandas as pd
import sklearn
from threadpoolctl import threadpool_limits

from build_modeling_dataset import (
    HISTORY_COLUMNS, HOLDOUT_START, SHOT_KEY, TARGET, VALIDATION_START, smoothed_shooter_rate,
)
from fit_baselines import calibration_table, choose_shrinkage, diagnostic_scores, game_bootstrap, load_development
from play_by_play_context import CONTEXT_GROUPS, COURT, EVENT_CONTEXT_COLUMNS, FAMILY, OUTPUT_COLUMNS, SHOT_VALUE, link_shot_types
from reconstruct_shot_clock import fetch_games
from shot_history import OPENING_RATES, add_family_history, add_opponent_history, prepare_specialist_rows
from tree_models import CATBOOST_DEFAULTS, catboost_inputs, fit_histogram


HISTOGRAM = dict(max_iter=150, max_leaf_nodes=12, learning_rate=.05, random_state=42, early_stopping=False)
CATBOOST = dict(depth=4, iterations=463, learning_rate=.05, **CATBOOST_DEFAULTS)
HISTORY = dict(shooter_weight=150, defender_weight=50)
GAME_CONTEXT = [column for group in CONTEXT_GROUPS.values() for column in group]
FAMILY_HISTORY = ["FAMILY_PRIOR_ATTEMPTS", "FAMILY_PRIOR_RATE"]
FINAL = "Final model"
TRACKING = "Tracking-only vote"
MODELS = [FINAL, TRACKING, "Shooter history", "League history"]
METADATA = ["player_name", "CLOSE_DEF_DIST"]
PREDICTIONS_FILE = "holdout-predictions.csv"
PENDING_FILE = ".pending-model.json"


def fit_specialist(training, linked_training, tracking_columns, enriched_columns):
    histogram = fit_histogram(training, tracking_columns, HISTOGRAM)
    catboost_x, categorical = catboost_inputs(training[tracking_columns])
    catboost = CatBoostClassifier(**CATBOOST).fit(
        catboost_x, training[TARGET], cat_features=categorical,
    )
    enriched = fit_histogram(linked_training, enriched_columns, HISTOGRAM)
    return {"histogram": histogram, "catboost": catboost, "enriched": enriched,
            "tracking_columns": tracking_columns, "enriched_columns": enriched_columns}


def predict_specialist(bundle, scoring, linked_scoring):
    columns = bundle["tracking_columns"]
    catboost_x, _ = catboost_inputs(scoring[columns])
    tracking = (
        bundle["histogram"].predict_proba(scoring[columns])[:, 1]
        + bundle["catboost"].predict_proba(catboost_x)[:, 1]
    ) / 2
    probabilities = pd.Series(tracking.copy(), index=scoring.index)
    if not linked_scoring.empty:
        probabilities.loc[linked_scoring.index] = bundle["enriched"].predict_proba(
            linked_scoring[bundle["enriched_columns"]],
        )[:, 1]
    return tracking, probabilities.to_numpy()


def prepare_final_rows(train, scoring, value, history, metadata, cutoff):
    rows, tracking_columns = prepare_specialist_rows(train, scoring, value, history, metadata, cutoff=cutoff)
    eligible = rows[[*COURT, FAMILY]].notna().all(axis=1)
    matched = add_opponent_history(rows.loc[eligible], OPENING_RATES[value])
    columns = [*tracking_columns, *COURT, FAMILY]
    if value == 2:
        matched = add_family_history(matched, OPENING_RATES[value])
        columns.extend(FAMILY_HISTORY)
    columns.extend(GAME_CONTEXT)
    return rows, matched, tracking_columns, columns


def evaluate_models(rows, mode):
    predictions = {name: rows[name].to_numpy() for name in MODELS}
    results = diagnostic_scores(rows[TARGET], predictions, include_calibration=False)
    paired = game_bootstrap(rows, predictions, TRACKING)
    results = results.merge(paired, left_on="baseline", right_index=True)
    results["log_loss_delta_vs_tracking"] = results["log_loss"] - results.set_index("baseline").at[TRACKING, "log_loss"]
    return results.assign(group=mode)


def calibration_bins(scored):
    tables = []
    for shot_type, rows in [("All", scored), *scored.groupby(SHOT_VALUE)]:
        for name in MODELS:
            grouped = calibration_table(rows[TARGET], rows[name], 20, right_closed=False)
            tables.append(grouped.reset_index().assign(
                shot_value=shot_type, model=name, bin_low=grouped.index / 20, bin_high=(grouped.index + 1) / 20,
            ))
    return pd.concat(tables, ignore_index=True)


def plot_calibration(calibration, path):
    figure, axes = plt.subplots(2, 2, figsize=(10, 8), height_ratios=[3, 1], layout="constrained")
    figure.suptitle("February–March 2015 holdout calibration", fontweight="bold", fontsize=16)
    for index, value in enumerate((2, 3)):
        plot, counts = axes[:, index]
        plot.plot([0, 1], [0, 1], "--", color="#8694a2", label="Perfect calibration")
        for name, color in [(FINAL, "#0d6b73"), (TRACKING, "#a34b2c")]:
            rows = calibration.loc[calibration["shot_value"].eq(value) & calibration["model"].eq(name)]
            plot.plot(rows["predicted_rate"], rows["observed_rate"], "o-", ms=4, label=name, color=color)
            counts.stairs(rows["attempts"], np.linspace(0, 1, 21), color=color)
        plot.set(title=f"{value}-pointers", ylabel="Observed make rate", xlim=(0, 1), ylim=(0, 1))
        plot.yaxis.set_major_formatter(PercentFormatter(1))
        plot.legend(frameon=False, fontsize=8)
        counts.set(xlabel="Predicted make probability", ylabel="Attempts", xlim=(0, 1))
        for axis in (plot, counts):
            axis.xaxis.set_major_formatter(PercentFormatter(1))
            axis.grid(alpha=.2)
    figure.savefig(path, dpi=170)
    plt.close(figure)


def slice_scores(scored):
    scored = scored.assign(
        defender_band=pd.cut(scored["CLOSE_DEF_DIST"], [0, 2, 4, 6, np.inf], right=False),
        shot_family=scored[FAMILY].fillna("Unavailable"),
    )
    tables = []
    for dimension in ("defender_band", "shot_family"):
        for (value, label), rows in scored.groupby([SHOT_VALUE, dimension], observed=True):
            p = rows[FINAL].to_numpy()
            made = rows[TARGET].to_numpy()
            predicted_outcome = np.where(made == 1, p, 1 - p)
            tables.append({
                "shot_value": value, "dimension": dimension, "slice": str(label), "attempts": len(rows),
                "games": rows["GAME_ID"].nunique(), "expected_makes": p.sum(), "actual_makes": made.sum(),
                "log_loss": -np.log(predicted_outcome.clip(np.finfo(float).eps)).mean(),
                "brier_score": ((p - made) ** 2).mean(),
            })
    return pd.DataFrame(tables)


def assert_january_replay(scored, data):
    settings_dir = data.parent
    frames = [
        (settings_dir / "play-by-play-context/january-predictions.csv", "All new groups", FINAL,
         scored.loc[scored["play_by_play_linked"]]),
        (settings_dir / "retraining-50-10/january-predictions.csv", "Vote recent-summary trees", TRACKING, scored),
    ]
    for path, expected, actual, rows in frames:
        saved = pd.read_csv(path, usecols=[*SHOT_KEY, expected], dtype={"GAME_ID": "string"})
        aligned = rows.merge(saved, on=SHOT_KEY, validate="one_to_one")
        if len(aligned) != len(rows) or len(aligned) != len(saved):
            raise ValueError(f"January replay changed coverage relative to {path}")
        np.testing.assert_allclose(aligned[actual], aligned[expected], rtol=0, atol=1e-12)
    print("January replay matched both saved probability columns.", flush=True)


def check_output_paths(output, models):
    if models.resolve().parent == output.resolve() and models.name in (
        PREDICTIONS_FILE, PENDING_FILE, "holdout-scores.csv", "holdout-calibration.csv",
        "holdout-slices.csv", "holdout-calibration.png", "settings.json",
    ):
        raise ValueError("The model path must be distinct from the report files.")
    if (output / PREDICTIONS_FILE).exists():
        raise ValueError("Final report already exists. Choose fresh output and model paths for a reproduction.")
    if models.exists():
        pending = output / PENDING_FILE
        record = json.loads(pending.read_text(encoding="utf-8")) if pending.is_file() else {}
        digest = sha256(models.read_bytes()).hexdigest()
        if record.get("path") == str(models.resolve()) and digest in record.get("sha256", ()):
            return digest
        raise ValueError("Model path is already occupied. Choose a fresh path for the fitted models.")
    return None


def save_results(output, models, settings, bundles, verification, metrics, calibration, predictions):
    output.mkdir(parents=True, exist_ok=True)
    models.parent.mkdir(parents=True, exist_ok=True)
    # Publication assumes one writer per output and model pair.
    with TemporaryDirectory(dir=output) as report_dir, TemporaryDirectory(dir=models.parent) as model_dir:
        report = Path(report_dir)
        staged_model = Path(model_dir) / models.name
        dump({"settings": settings, "models": bundles}, staged_model, compress=3)
        restored = load(staged_model)
        with threadpool_limits(limits=3):
            for value, (scored, linked_scored, expected) in verification.items():
                _, again = predict_specialist(restored["models"][value], scored, linked_scored)
                np.testing.assert_allclose(again, expected, atol=1e-12, rtol=0)
        metrics.to_csv(report / "holdout-scores.csv", index=False)
        calibration.to_csv(report / "holdout-calibration.csv", index=False)
        slice_scores(predictions).to_csv(report / "holdout-slices.csv", index=False)
        plot_calibration(calibration, report / "holdout-calibration.png")
        (report / "settings.json").write_text(json.dumps(settings, indent=2) + "\n", encoding="utf-8")
        predictions.to_csv(report / PREDICTIONS_FILE, index=False)
        existing = check_output_paths(output, models)
        hashes = [sha256(staged_model.read_bytes()).hexdigest()]
        if existing:
            hashes.append(existing)
        for path in report.iterdir():
            if path.name != PREDICTIONS_FILE:
                path.replace(output / path.name)
        (report / PENDING_FILE).write_text(json.dumps({"path": str(models.resolve()), "sha256": hashes}), encoding="utf-8")
        (report / PENDING_FILE).replace(output / PENDING_FILE)
        staged_model.replace(models)
        (report / PREDICTIONS_FILE).replace(output / PREDICTIONS_FILE)
        (output / PENDING_FILE).unlink()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--january-check", action="store_true", help="Replay the saved January predictions")
    modes.add_argument("--final", action="store_true", help="Refit on development and score February–March")
    modes.add_argument("--fetch-holdout", action="store_true", help="Cache official play-by-play for the reserved games")
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--cache", type=Path, default=Path("data/raw/nba-play-by-play-v3"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/final-evaluation"))
    parser.add_argument("--models", type=Path, default=Path("models/final-shot-quality.joblib"))
    args = parser.parse_args()

    if args.fetch_holdout:
        games = pd.read_csv(args.data / "holdout.csv", usecols=["GAME_ID"], dtype={"GAME_ID": "string"})
        game_ids = games["GAME_ID"].drop_duplicates().tolist()
        fetch_games(game_ids, args.cache)
        covered = sum((args.cache / f"{game}.json").is_file() for game in game_ids)
        print(f"Reserved games cached {covered}/{len(game_ids)}", flush=True)
        return

    train, january = load_development(args.data)
    scoring = january
    cutoff = VALIDATION_START
    if args.final:
        train = pd.concat([train, january], ignore_index=True)
        scoring = pd.read_csv(args.data / "holdout.csv", dtype={"GAME_ID": "string"})
        cutoff = HOLDOUT_START
        if (
            scoring.empty or not scoring["GAME_DATE"].between(cutoff, "2015-03-04").all()
            or not set(train["GAME_ID"]).isdisjoint(scoring["GAME_ID"])
            or scoring.duplicated(SHOT_KEY).any()
            or not scoring[TARGET].isin([0, 1]).all()
            or not scoring[SHOT_VALUE].isin([2, 3]).all()
        ):
            raise ValueError("Expected disjoint February–March holdout shots")
        check_output_paths(args.output, args.models)
    combined = pd.concat([train, scoring], ignore_index=True)
    print(f"Linking {len(combined):,} attempts through {scoring['GAME_DATE'].max()}", flush=True)
    linked = link_shot_types(combined, args.cache, include_context=True)
    metadata = linked[[*SHOT_KEY, "match_method", FAMILY, *COURT, *EVENT_CONTEXT_COLUMNS]]
    shot_metadata = linked[[*SHOT_KEY, *METADATA]]
    bundles, results, verification = {}, [], {}
    with threadpool_limits(limits=3):
        for value in (2, 3):
            rows, matched, tracking_columns, columns = prepare_final_rows(train, scoring, value, HISTORY, metadata, cutoff)
            earlier = rows["GAME_DATE"].lt(cutoff)
            matched_earlier = matched["GAME_DATE"].lt(cutoff)
            training, scored = rows.loc[earlier], rows.loc[~earlier]
            linked_training, linked_scored = matched.loc[matched_earlier], matched.loc[~matched_earlier]
            january_rows = rows.loc[rows["GAME_DATE"].between(VALIDATION_START, HOLDOUT_START, inclusive="left")]
            shooter_weight = choose_shrinkage(january_rows)
            print(f"{value}PT fit {len(training):,} · score {len(scored):,} · linked {len(linked_scored):,}", flush=True)
            bundle = fit_specialist(training, linked_training, tracking_columns, columns)
            bundle["shooter_baseline_weight"] = shooter_weight
            tracking, final = predict_specialist(bundle, scored, linked_scored)
            results.append(scored[[*OUTPUT_COLUMNS, "match_method", FAMILY]].assign(
                play_by_play_linked=scored.index.isin(linked_scored.index),
                **{TRACKING: tracking, FINAL: final,
                   "Shooter history": smoothed_shooter_rate(scored, shooter_weight),
                   "League history": scored[HISTORY_COLUMNS[2]]},
            ))
            bundles[value] = bundle
            verification[value] = (scored, linked_scored, final)

    predictions = pd.concat(results).sort_values(["GAME_DATE", *SHOT_KEY]).merge(
        shot_metadata, on=SHOT_KEY, validate="one_to_one",
    )
    if len(predictions) != len(scoring) or predictions.duplicated(SHOT_KEY).any():
        raise ValueError("Every reserved attempt must have exactly one prediction")
    if args.january_check:
        assert_january_replay(predictions, args.data)
        return

    metrics = pd.concat([
        evaluate_models(rows, name)
        for name, rows in [
            ("All", predictions),
            ("2PT", predictions.loc[predictions[SHOT_VALUE].eq(2)]),
            ("3PT", predictions.loc[predictions[SHOT_VALUE].eq(3)]),
            ("Linked", predictions.loc[predictions["play_by_play_linked"]]),
            ("Fallback", predictions.loc[~predictions["play_by_play_linked"]]),
        ] if rows[TARGET].nunique() == 2
    ], ignore_index=True)
    calibration = calibration_bins(predictions)
    weights = calibration["attempts"] * (calibration["predicted_rate"] - calibration["observed_rate"]).abs()
    ece = calibration.assign(error=weights).groupby(["shot_value", "model"])[["error", "attempts"]].sum()
    for group, value in [("All", "All"), ("2PT", 2), ("3PT", 3)]:
        mask = metrics["group"].eq(group)
        metrics.loc[mask, "calibration_error_20_bins"] = metrics.loc[mask, "baseline"].map(
            ece.loc[value]["error"] / ece.loc[value]["attempts"],
        )
    settings = {
        "cutoff": cutoff, "histogram": HISTOGRAM, "catboost": CATBOOST, "history": HISTORY,
        "versions": {"python": platform.python_version(), "scikit_learn": sklearn.__version__,
                     "catboost": catboost_version, "numpy": np.__version__, "pandas": pd.__version__},
        "cached_holdout_games": sum((args.cache / f"{game}.json").is_file() for game in scoring["GAME_ID"].unique()),
        "holdout_games": int(scoring["GAME_ID"].nunique()),
        "linked_holdout_attempts": int(predictions["play_by_play_linked"].sum()),
        "holdout_attempts": len(predictions),
        "by_shot_value": {value: {key: bundle[key] for key in
                          ("tracking_columns", "enriched_columns", "shooter_baseline_weight")}
                          for value, bundle in bundles.items()},
    }
    save_results(args.output, args.models, settings, bundles, verification, metrics, calibration, predictions)
    print(metrics[["group", "baseline", "attempts", "log_loss", "brier_score", "calibration_error_20_bins"]],
          flush=True)


if __name__ == "__main__":
    main()
