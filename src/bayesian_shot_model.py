"""Cross-classified Bayesian logistic regression for shooter and defender effects."""

from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd
from polyagamma import random_polyagamma
from scipy.linalg import cho_factor, cho_solve, solve_triangular
from scipy.special import expit, ndtri
from scipy.stats import rankdata
from sklearn.preprocessing import OneHotEncoder, SplineTransformer, StandardScaler

from build_modeling_dataset import TARGET
from shot_history import CLOCK, DEFENDER


def context_design(train, validation):
    """Learn spline knots, medians and scales from training shots."""
    distances = ["SHOT_DIST_CLEAN", "CLOSE_DEF_DIST"]
    continuous = ["DRIBBLES", "TOUCH_TIME_CLEAN", "PERIOD_SECONDS", CLOCK]
    categories = ["PERIOD", "LOCATION"]
    knots = SplineTransformer(n_knots=5, degree=3, include_bias=False)
    knots.fit(np.log1p(train[distances]))
    medians = train[continuous].median()
    scaler = StandardScaler().fit(train[continuous].fillna(medians))
    encoder = OneHotEncoder(drop="first", handle_unknown="ignore", sparse_output=False).fit(train[categories])

    def transform(shots):
        two = shots["PTS_TYPE"].eq(2).to_numpy(dtype=float)[:, None]
        three = 1 - two
        basis = knots.transform(np.log1p(shots[distances]))
        numeric = scaler.transform(shots[continuous].fillna(medians))
        missing = shots[["TOUCH_TIME_CLEAN", CLOCK]].isna().to_numpy(dtype=float)
        return np.column_stack([two, three, two * basis, three * basis, numeric, missing, encoder.transform(shots[categories])])

    return transform(train), transform(validation)


def group_indices(train, validation):
    """Allocate prior-only effects for identities first seen in January."""
    shots = pd.concat([train, validation], ignore_index=True)
    shooter, levels = pd.factorize(pd.MultiIndex.from_frame(shots[["player_id", "PTS_TYPE"]]))
    shooter_is_three = np.array([shot_type == 3 for _, shot_type in levels])
    defender, defenders = pd.factorize(shots[DEFENDER])
    if np.any(defender < 0):
        raise ValueError("The Bayesian model requires recorded closest-defender IDs")
    return shooter, shooter_is_three, defender, len(defenders)


def sample_chain(design, validation_design, target, groups, warmup, draws, seed):
    rng = np.random.default_rng(seed)
    shooter_all, shooter_is_three, defender_all, defender_count = groups
    shooter, shooter_test = np.split(shooter_all, [len(target)])
    defender, defender_test = np.split(defender_all, [len(target)])
    shooter_partitions = [~shooter_is_three, shooter_is_three]
    coefficient = rng.normal(0, 0.2, design.shape[1])
    shooter_effect = rng.normal(0, 0.2, len(shooter_is_three))
    defender_effect = rng.normal(0, 0.2, defender_count)
    variances = np.full(3, 0.1)
    prior_precision = np.full(design.shape[1], 1 / 2.5**2)
    centered_target = target - 0.5
    target_score = design.T @ centered_target
    predictive_sum = np.zeros(len(validation_design))
    trace = []

    for step in range(warmup + draws):
        eta = design @ coefficient + shooter_effect[shooter] + defender_effect[defender]
        omega = random_polyagamma(z=eta, method="devroye", random_state=rng)
        weighted = design * np.sqrt(omega[:, None])
        precision = weighted.T @ weighted
        precision.flat[:: precision.shape[0] + 1] += prior_precision
        factor = cho_factor(precision, lower=True)
        score = target_score - design.T @ (omega * (shooter_effect[shooter] + defender_effect[defender]))
        coefficient = cho_solve(factor, score) + solve_triangular(
            factor[0], rng.normal(size=len(coefficient)), lower=True, trans="T",
        )

        fixed = design @ coefficient
        for indices, effects, other, prior in (
            (shooter, shooter_effect, defender_effect[defender], 1 / variances[shooter_is_three.astype(int)]),
            (defender, defender_effect, None, 1 / variances[2]),
        ):
            offset = shooter_effect[shooter] if other is None else other
            precision = np.bincount(indices, weights=omega, minlength=len(effects)) + prior
            score = np.bincount(
                indices, weights=centered_target - omega * (fixed + offset), minlength=len(effects),
            )
            effects[:] = score / precision + rng.normal(size=len(effects)) / np.sqrt(precision)

        # Shift each group and its intercept together. This leaves the likelihood
        # unchanged and samples the otherwise slowly mixing location from its priors.
        for group, mask in enumerate(shooter_partitions):
            precision = mask.sum() / variances[group] + prior_precision[group]
            mean = (coefficient[group] * prior_precision[group] - shooter_effect[mask].sum() / variances[group]) / precision
            shift = rng.normal(mean, 1 / np.sqrt(precision))
            shooter_effect[mask] += shift
            coefficient[group] -= shift
        precision = defender_count / variances[2] + prior_precision[:2].sum()
        mean = (coefficient[:2] @ prior_precision[:2] - defender_effect.sum() / variances[2]) / precision
        shift = rng.normal(mean, 1 / np.sqrt(precision))
        defender_effect += shift
        coefficient[:2] -= shift

        for group, effects in enumerate([*(shooter_effect[mask] for mask in shooter_partitions), defender_effect]):
            # Variance prior is inverse-gamma(shape=2, scale=0.1).
            variances[group] = (0.1 + 0.5 * effects @ effects) / rng.gamma(2 + len(effects) / 2)

        if step >= warmup:
            predictive_sum += expit(
                validation_design @ coefficient + shooter_effect[shooter_test] + defender_effect[defender_test]
            )
            trace.append(np.r_[coefficient, np.sqrt(variances), shooter_effect, defender_effect])

    return predictive_sum / draws, np.array(trace)


def split_rhat(chains):
    """Compute rank-normalized and folded split R-hat for each parameter."""
    half = chains.shape[1] // 2
    split = np.concatenate([chains[:, :half], chains[:, -half:]])

    def rank_rhat(values):
        flat = values.reshape(-1, values.shape[-1])
        ranks = rankdata(flat, axis=0)
        normalized = ndtri((ranks - 0.375) / (len(flat) + 0.25)).reshape(values.shape)
        within = normalized.var(axis=1, ddof=1).mean(axis=0)
        between = normalized.mean(axis=1).var(axis=0, ddof=1)
        return np.sqrt((half - 1) / half + between / within)

    folded = np.abs(split - np.median(split, axis=(0, 1)))
    return np.maximum(rank_rhat(split), rank_rhat(folded))


def fit_bayesian_shot_model(train, validation, warmup, draws):
    design, validation_design = context_design(train, validation)
    target = train[TARGET].to_numpy()
    groups = group_indices(train, validation)
    chains, predictions = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for prediction, trace in pool.map(
            lambda seed: sample_chain(design, validation_design, target, groups, warmup, draws, seed),
            (42, 43, 44, 45),
        ):
            chains.append(trace)
            predictions.append(prediction)
            print(f"Bayesian chain {len(chains)}/4 complete", flush=True)
    chains = np.array(chains)
    rhat = split_rhat(chains)
    scale_slice = slice(design.shape[1], design.shape[1] + 3)
    diagnostics = {
        "chains": len(chains),
        "warmup_per_chain": warmup,
        "draws_per_chain": draws,
        "max_rhat": float(rhat.max()),
        "parameters_above_1_01_rhat": int((rhat > 1.01).sum()),
        "hierarchy_sd_posterior_mean": dict(zip(
            ("shooter_2pt", "shooter_3pt", "closest_defender"),
            chains[:, :, scale_slice].mean(axis=(0, 1)).tolist(),
        )),
    }
    return np.mean(predictions, axis=0), diagnostics
