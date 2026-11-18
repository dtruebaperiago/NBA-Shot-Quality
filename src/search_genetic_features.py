"""Evolve same-type shot features using pre-January chronological fitness."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path

# Apply the limit before numerical libraries initialize worker-thread runtimes.
os.environ["OMP_NUM_THREADS"] = "1"

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import log_loss
from threadpoolctl import threadpool_limits

from build_modeling_dataset import SHOT_KEY, TARGET
from shot_history import build_specialist_data, FEATURES, HISTORICAL, model_inputs, sequence_indices
from fit_baselines import diagnostic_scores, game_bootstrap, load_development
from compare_shot_type_routes import load_model_settings


OPERATORS = ("add", "sub", "mul", "div", "log")
CONSTANTS = (0.5, 1.0, 2.0, 5.0)


def feature_bank(shots, config):
    context, _ = model_inputs(shots, shots.iloc[:1], config, [name for name in FEATURES if name != "PTS_TYPE"])
    bank = pd.get_dummies(context, columns=["PERIOD", "LOCATION"], dtype=float)
    earlier_context = context.loc[shots.GAME_DATE.lt("2015-01-01")]
    training_columns = pd.get_dummies(earlier_context, columns=["PERIOD", "LOCATION"], dtype=float).columns
    bank = bank.reindex(columns=training_columns)
    base_columns = list(bank.columns)
    dates = pd.to_datetime(shots.GAME_DATE).to_numpy(dtype="datetime64[D]").astype(int)
    for window in (5, 10, 20):
        indices = sequence_indices(shots, window)
        valid = indices >= 0
        safe = np.maximum(indices, 0)
        count = valid.sum(axis=1)
        bank[f"LAST_{window}_ATTEMPTS"] = count
        bank[f"LAST_{window}_FG_RATE"] = np.divide(
            (shots[TARGET].to_numpy()[safe] * valid).sum(axis=1), count,
            out=np.full(len(shots), np.nan), where=count > 0,
        )
        for column in HISTORICAL:
            values = shots[column].to_numpy()[safe]
            observed = valid & np.isfinite(values)
            denominator = observed.sum(axis=1)
            bank[f"LAST_{window}_{column}"] = np.divide(
                np.where(observed, values, 0).sum(axis=1), denominator,
                out=np.full(len(shots), np.nan), where=denominator > 0,
            )
        bank[f"LAST_{window}_LOG_DAYS"] = np.divide(
            np.where(valid, np.log1p(np.maximum(dates[:, None] - dates[safe], 0)), 0).sum(axis=1),
            count, out=np.full(len(shots), np.nan), where=count > 0,
        )
    summary_columns = [name for name in bank if name.startswith("LAST_10_")]
    for name in list(bank):
        if bank.loc[shots.GAME_DATE.lt("2015-01-01"), name].isna().any():
            bank[f"{name}_MISSING"] = bank[name].isna().astype(float)
    return bank, base_columns, summary_columns


def random_tree(rng, width, depth=0):
    if depth >= 3 or rng.random() < 0.45:
        return int(rng.integers(width)) if rng.random() < 0.9 else float(rng.choice(CONSTANTS))
    operator = rng.choice(OPERATORS)
    children = [random_tree(rng, width, depth + 1) for _ in range(1 if operator == "log" else 2)]
    return (str(operator), *children)


def size(tree):
    return 1 + sum(size(child) for child in tree[1:]) if isinstance(tree, tuple) else 1


def evaluate_tree(tree, values):
    if isinstance(tree, int):
        return values[:, tree]
    if isinstance(tree, float):
        return np.full(len(values), tree)
    operator, left, *right = tree
    a = evaluate_tree(left, values)
    if operator == "log":
        return np.log1p(np.abs(a))
    b = evaluate_tree(right[0], values)
    if operator == "add":
        result = a + b
    elif operator == "sub":
        result = a - b
    elif operator == "mul":
        result = a * b
    else:
        result = np.divide(a, b, out=np.zeros_like(a), where=np.abs(b) >= 0.1)
    return np.clip(result, -1e6, 1e6)


def tree_paths(tree, path=()):
    return [path] + ([p for i, child in enumerate(tree[1:], 1) for p in tree_paths(child, (*path, i))]
                     if isinstance(tree, tuple) else [])


def subtree(tree, path):
    return subtree(tree[path[0]], path[1:]) if path else tree


def replace_subtree(tree, path, replacement):
    if not path:
        return replacement
    children = list(tree)
    children[path[0]] = replace_subtree(children[path[0]], path[1:], replacement)
    return tuple(children)


def depth(tree):
    return 1 + max(depth(child) for child in tree[1:]) if isinstance(tree, tuple) else 0


def make_candidate(rng, width):
    columns = tuple(np.flatnonzero(rng.random(width) < rng.uniform(0.4, 1.0)).tolist())
    return columns or (0,), tuple(random_tree(rng, width) for _ in range(int(rng.integers(4))))


def breed(rng, first, second, width):
    columns = {column for column in set(first[0]) | set(second[0]) if rng.random() < 0.75}
    for column in range(width):
        if rng.random() < 1 / width:
            columns.symmetric_difference_update([column])
    formulas = list(first[1])
    if formulas and second[1] and rng.random() < 0.7:
        i = int(rng.integers(len(formulas)))
        donor = second[1][int(rng.integers(len(second[1])))]
        paths = tree_paths(formulas[i])
        donor_paths = tree_paths(donor)
        changed = replace_subtree(formulas[i], paths[int(rng.integers(len(paths)))], subtree(donor, donor_paths[int(rng.integers(len(donor_paths)))]))
        if depth(changed) <= 3:
            formulas[i] = changed
    if rng.random() < 0.5:
        new = random_tree(rng, width)
        if formulas:
            i = int(rng.integers(len(formulas)))
            paths = tree_paths(formulas[i])
            changed = replace_subtree(formulas[i], paths[int(rng.integers(len(paths)))], new)
            formulas[i] = changed if depth(changed) <= 3 else new
        elif len(formulas) < 3:
            formulas.append(new)
    if rng.random() < 0.2 and len(formulas) < 3:
        formulas.append(random_tree(rng, width))
    if rng.random() < 0.15 and formulas:
        formulas.pop(int(rng.integers(len(formulas))))
    return tuple(sorted(columns)) or (0,), tuple(formulas)


def transform(candidate, values):
    columns, formulas = candidate
    return np.column_stack([values[:, columns], *[evaluate_tree(tree, values) for tree in formulas]])


def fitness(candidate, folds, parameters):
    total, attempts = 0.0, 0
    for training, target, validation, observed in folds:
        model = HistGradientBoostingClassifier(**parameters).fit(transform(candidate, training), target)
        total += len(observed) * log_loss(observed, model.predict_proba(transform(candidate, validation))[:, 1])
        attempts += len(observed)
    loss = total / attempts
    penalty = 0.00001 * sum(size(tree) for tree in candidate[1]) + 0.000001 * len(candidate[0])
    return loss + penalty, loss


def describe(candidate, names):
    def expression(tree):
        if isinstance(tree, int):
            return names[tree]
        if isinstance(tree, float):
            return str(tree)
        return f"{tree[0]}(" + ", ".join(expression(child) for child in tree[1:]) + ")"
    return {"columns": [names[i] for i in candidate[0]], "formulas": [expression(tree) for tree in candidate[1]]}


def search(folds, parameters, names, base, summary, value, output):
    rng = np.random.default_rng(42)
    width = len(names)
    baseline = (tuple(names.index(name) for name in [*base, *summary]), ())
    population = [baseline, (tuple(range(width)), ())]
    population.extend(make_candidate(rng, width) for _ in range(38))
    cache, history = {}, []
    with ThreadPoolExecutor(max_workers=4) as workers:
        for generation in range(15):
            new = list(dict.fromkeys(item for item in population if item not in cache))
            results = workers.map(lambda item: fitness(item, folds, parameters), new)
            cache.update(zip(new, results))
            population.sort(key=lambda item: cache[item][0])
            best = population[0]
            history.append(dict(shot_type=value, generation=generation, evaluations=len(cache),
                                fitness=cache[best][0], log_loss=cache[best][1]))
            print(f"{value}PT generation {generation + 1}/15: loss {cache[best][1]:.7f}, unique {len(cache)}", flush=True)
            pd.DataFrame(history).to_csv(output / f"generations-{value}pt.csv", index=False)
            elites = population[:2]
            def parent():
                contestants = [population[int(rng.integers(len(population)))] for _ in range(4)]
                return min(contestants, key=lambda item: cache[item][0])
            population = elites + [breed(rng, parent(), parent(), width) for _ in range(38)]
        winner = min(cache, key=lambda item: cache[item][0])
        random_rng = np.random.default_rng(2042)
        random_candidates = set()
        while len(random_candidates) < len(cache):
            random_candidates.add(make_candidate(random_rng, width))
        random_candidates = sorted(random_candidates, key=repr)
        random_results = list(workers.map(lambda item: fitness(item, folds, parameters), random_candidates))
        random_best = min(zip(random_candidates, random_results), key=lambda item: item[1][0])
    records = [
        {"search": label, "fitness": score[0], "log_loss": score[1], **describe(candidate, names)}
        for label, candidates in (("Genetic", list(cache.items())), ("Random", list(zip(random_candidates, random_results))))
        for candidate, score in candidates
    ]
    (output / f"trials-{value}pt.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
    print(f"{value}PT equal-budget random search finished ({len(cache)} candidates)", flush=True)
    return baseline, winner, random_best[0], len(cache)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path("data/processed/modeling"))
    parser.add_argument("--comparison", type=Path, default=Path("data/processed/model-family-comparison"))
    parser.add_argument("--output", type=Path, default=Path("data/processed/genetic-search"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    train, validation = load_development(args.data)
    validation = validation.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    settings, _ = load_model_settings(args.comparison)
    config = settings["Histogram gradient boosting"]
    parameters = {**config["parameters"], "max_leaf_nodes": 12}
    combined, scores, selections = {}, [], {}
    with threadpool_limits(limits=1):
        for value, rows in validation.groupby("PTS_TYPE"):
            training, scoring = build_specialist_data(train, validation, value)
            shots = pd.concat([training, scoring], ignore_index=True)
            bank, base, summary = feature_bank(shots, config)
            folds = []
            for start, end in (("2014-11-16", "2014-12-01"), ("2014-12-01", "2015-01-01")):
                earlier = shots.GAME_DATE.lt(start)
                later = shots.GAME_DATE.ge(start) & shots.GAME_DATE.lt(end)
                imputer = SimpleImputer(strategy="median", keep_empty_features=True)
                folds.append((imputer.fit_transform(bank.loc[earlier]), shots.loc[earlier, TARGET].to_numpy(),
                              imputer.transform(bank.loc[later]), shots.loc[later, TARGET].to_numpy()))
            baseline, genetic, random, budget = search(folds, parameters, list(bank), base, summary, value, args.output)
            selections[value] = {
                "unique_fitness_evaluations_per_search": budget,
                "Genetic": describe(genetic, list(bank)), "Random": describe(random, list(bank)),
            }
            before = shots.GAME_DATE.lt("2015-01-01")
            imputer = SimpleImputer(strategy="median", keep_empty_features=True)
            train_x, scoring_x = imputer.fit_transform(bank.loc[before]), imputer.transform(bank.loc[~before])
            predictions = {}
            for label, candidate in (("Baseline last-10 Histogram", baseline), ("Genetic", genetic), ("Random", random)):
                model = HistGradientBoostingClassifier(**parameters).fit(transform(candidate, train_x), training[TARGET])
                probabilities = model.predict_proba(transform(candidate, scoring_x))[:, 1]
                predictions[label] = probabilities
                combined.setdefault(label, np.empty(len(validation)))[rows.index] = probabilities
            metrics = diagnostic_scores(rows[TARGET], predictions).set_index("baseline")
            metrics = metrics.join(game_bootstrap(rows, predictions, "Baseline last-10 Histogram"))
            metrics["log_loss_delta"] = metrics["log_loss"] - metrics.at["Baseline last-10 Histogram", "log_loss"]
            scores.append(metrics.reset_index().assign(shot_type=value))
            pd.concat(scores, ignore_index=True).to_csv(args.output / "january-scores.csv", index=False)
            print(metrics[["log_loss", "log_loss_delta"]].to_string(), flush=True)
    (args.output / "selected-features.json").write_text(json.dumps({
        "population": 40, "generations": 15, "elite_count": 2, "tournament_size": 4,
        "max_formula_depth": 3, "max_formulas": 3, "parameters": parameters,
        "fitness_folds": [["2014-11-16", "2014-12-01"], ["2014-12-01", "2015-01-01"]],
        "complexity_penalty": {"per_formula_node": 0.00001, "per_selected_column": 0.000001},
        "selected": selections,
    }, indent=2), encoding="utf-8")
    pd.concat([validation[[*SHOT_KEY, "GAME_DATE", "PTS_TYPE", TARGET]], pd.DataFrame(combined)], axis=1).to_csv(
        args.output / "january-predictions.csv", index=False,
    )


if __name__ == "__main__":
    main()
