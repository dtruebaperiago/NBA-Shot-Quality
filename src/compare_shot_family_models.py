"""Compare recorded shot families, family histories, and specialists on January shots."""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from threadpoolctl import threadpool_limits

from build_modeling_dataset import SHOT_KEY, TARGET, VALIDATION_START
from fit_baselines import diagnostic_scores, game_bootstrap, load_development
from shot_history import add_family_history, OPENING_RATES, prepare_specialist_rows
from tree_models import fit_probabilities, HISTOGRAM
from play_by_play_context import SHOT_VALUE, FAMILY, BROAD, COURT, PROXY, OUTPUT_COLUMNS, link_shot_types


MIN_ROUTE_ATTEMPTS = 500
MIN_ROUTE_OUTCOMES = 100


def fit_specialists(train, validation, columns, settings, route, fallback):
    probabilities = fallback.copy()
    trained = []
    for name, training in train.groupby(route, sort=True):
        positives = int(training[TARGET].sum())
        if len(training) < MIN_ROUTE_ATTEMPTS or min(positives, len(training) - positives) < MIN_ROUTE_OUTCOMES:
            continue
        scoring = validation[route].eq(name)
        if scoring.any():
            probabilities[scoring.to_numpy()] = fit_probabilities(training, validation.loc[scoring], columns, settings)
            trained.append(name)
    return probabilities, trained


def evaluate(rows, predictions, reference, experiment, group="All", route_groups=None):
    results = diagnostic_scores(rows[TARGET], predictions)
    intervals = game_bootstrap(rows, predictions, reference)
    result = results.merge(intervals, left_on="baseline", right_index=True)
    result["delta_vs_reference"] = result["log_loss"] - results.set_index("baseline").at[reference, "log_loss"]
    return result.assign(
        shot_value=int(rows[SHOT_VALUE].iloc[0]), experiment=experiment, group=group,
        specialist_available=group in (route_groups or ()),
    )


def compare_families(rows, columns, settings):
    rows = rows.dropna(subset=[FAMILY, *COURT])
    rows = add_family_history(rows, OPENING_RATES[int(rows[SHOT_VALUE].iloc[0])])
    training = rows["GAME_DATE"].lt(VALIDATION_START)
    train, validation = rows.loc[training], rows.loc[~training]
    court_columns = [*columns, *COURT]
    detailed_columns = [*court_columns, FAMILY]
    feature_sets = {
        "Tracking only": columns,
        "Court coordinates": court_columns,
        "Broad shot family": [*court_columns, BROAD],
        "Detailed shot family": detailed_columns,
        "Detailed family + shooter history": [*detailed_columns, "FAMILY_PRIOR_ATTEMPTS", "FAMILY_PRIOR_RATE"],
    }
    predictions = {name: fit_probabilities(train, validation, features, settings) for name, features in feature_sets.items()}
    reference = "Detailed shot family"
    predictions["Shot family specialists"], trained = fit_specialists(
        train, validation, detailed_columns, settings, FAMILY, predictions[reference],
    )
    summaries = [evaluate(validation, predictions, reference, "Recorded family")]
    for family in validation[FAMILY].unique():
        mask = validation[FAMILY].eq(family)
        group = validation.loc[mask]
        if len(group) >= 20 and group[TARGET].nunique() == 2:
            summaries.append(evaluate(
                group, {name: values[mask.to_numpy()] for name, values in predictions.items()},
                reference, "Recorded family", family, trained,
            ))
    print(f"Recorded {rows[SHOT_VALUE].iat[0]}PT specialist families: {', '.join(trained)}", flush=True)
    return summaries, validation[[*OUTPUT_COLUMNS, "SHOT_SUBTYPE", FAMILY, "match_method"]].assign(**predictions)


def compare_release_proxy(rows, columns, settings):
    # Zero-dribble quick releases are a tracking proxy for catch-and-shoot attempts.
    proxy = np.select(
        [rows["DRIBBLES"].gt(0), rows["DRIBBLES"].eq(0) & rows["TOUCH_TIME_CLEAN"].le(2)],
        ["Dribbled", "Quick no-dribble"], default="Other",
    )
    rows = rows.assign(**{PROXY: proxy})
    training = rows["GAME_DATE"].lt(VALIDATION_START)
    train, validation = rows.loc[training], rows.loc[~training]
    features = [*columns, PROXY]
    reference = "Tracking only"
    predictions = {
        reference: fit_probabilities(train, validation, columns, settings),
        "Release proxy feature": fit_probabilities(train, validation, features, settings),
    }
    predictions["Release proxy specialists"], trained = fit_specialists(
        train, validation, features, settings, PROXY, predictions["Release proxy feature"],
    )
    print(f"Tracking-proxy 3PT specialist groups: {', '.join(trained)}", flush=True)
    return evaluate(validation, predictions, reference, "Tracking release proxy")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--cache", type=Path, default=Path("data/raw/nba-play-by-play-v3"))
    parser.add_argument("--settings", type=Path, default=Path("data/processed/retraining-50-10/settings.json"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/shot-family-comparison"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    train, validation = load_development(args.data)
    config = json.loads(args.settings.read_text(encoding="utf-8"))["tree_settings"][HISTOGRAM]
    settings = {**config["parameters"], "max_leaf_nodes": 12}
    linked = link_shot_types(pd.concat([train, validation], ignore_index=True), args.cache)
    linked = linked.assign(split=np.where(linked["GAME_DATE"].lt(VALIDATION_START), "Train", "January"))
    coverage = (
        linked.assign(match_method=linked["match_method"].fillna("unmatched"))
        .groupby(["split", SHOT_VALUE, "match_method"])[TARGET].agg(attempts="size", makes="sum")
    )
    coverage["outcome_agreement"] = linked.groupby(["split", SHOT_VALUE, "match_method"])["match_outcome_agrees"].mean()
    coverage.to_csv(args.output / "match-coverage.csv")
    counts = linked.groupby(["split", SHOT_VALUE, FAMILY, "SHOT_SUBTYPE"])[TARGET].agg(attempts="size", makes="sum")
    counts.to_csv(args.output / "subtype-counts.csv")
    metadata = [*SHOT_KEY, "SHOT_SUBTYPE", FAMILY, BROAD, *COURT, "match_method"]
    linked[["GAME_DATE", SHOT_VALUE, *metadata]].to_csv(args.output / "development-shot-types.csv", index=False)
    scores, predictions = [], []
    print(coverage.to_string(), flush=True)
    with threadpool_limits(limits=3):
        for value in (2, 3):
            rows, columns = prepare_specialist_rows(train, validation, value, config, linked[metadata])
            trials, probabilities = compare_families(rows, columns, settings)
            scores.extend(trials)
            predictions.append(probabilities)
            if value == 3:
                scores.append(compare_release_proxy(rows, columns, settings))
    result = pd.concat(scores, ignore_index=True)
    result.to_csv(args.output / "january-scores.csv", index=False)
    pd.concat(predictions).sort_values(["GAME_DATE", *SHOT_KEY]).to_csv(args.output / "january-predictions.csv", index=False)
    print(result.loc[result["group"].eq("All"), [
        "shot_value", "experiment", "baseline", "attempts", "log_loss", "brier_score", "delta_vs_reference",
    ]].to_string(index=False), flush=True)


if __name__ == "__main__":
    main()
