"""Build chronological tracking and play-by-play model features."""

import numpy as np
import pandas as pd

from build_modeling_dataset import (
    CONTEXT_COLUMNS, HISTORY_COLUMNS, SHOT_KEY, TARGET, VALIDATION_START, add_shooter_history,
)
from fit_baselines import choose_shrinkage, context_inputs, fit_context
from play_by_play_context import FAMILY, OPPONENT_PRIOR_COLUMNS, OUTPUT_COLUMNS, SHOT_VALUE


CLOCK = "SHOT_CLOCK_WITH_PERIOD_FALLBACK"
DEFENDER = "CLOSEST_DEFENDER_PLAYER_ID"
DEFENDER_HISTORY = "DEFENDER_PRIOR_MAKES_PREVENTED_PER_SHOT"
DEFENDER_SUPPORT = "DEFENDER_PRIOR_SCORED_ATTEMPTS"
DEFENDER_RESIDUAL_SUM = "DEFENDER_PRIOR_RESIDUAL_SUM"
DEFENDER_SHRINKAGE = 50


def add_defender_history(shots):
    """Build history from expanding-window predictions on completed dates."""
    shots = shots.sort_values(["GAME_DATE", *SHOT_KEY]).reset_index(drop=True)
    expected = pd.Series(np.nan, index=shots.index)
    for _, day in shots.groupby("GAME_DATE", sort=False):
        earlier = shots.iloc[:day.index[0]]
        if earlier[TARGET].nunique() == 2:
            weight = choose_shrinkage(earlier)
            expected.loc[day.index] = fit_context(earlier, day, weight)

    daily = (
        shots.assign(residual=expected - shots[TARGET])
        .groupby([DEFENDER, "GAME_DATE"], sort=True)["residual"]
        .agg(residual_sum="sum", scored_attempts="count")
    )
    earlier = daily.groupby(level=DEFENDER).cumsum() - daily
    earlier[DEFENDER_HISTORY] = earlier["residual_sum"] / (
        earlier["scored_attempts"] + DEFENDER_SHRINKAGE
    )
    history = earlier.rename(columns={
        "scored_attempts": DEFENDER_SUPPORT, "residual_sum": DEFENDER_RESIDUAL_SUM,
    })
    return shots.join(history, on=[DEFENDER, "GAME_DATE"], validate="many_to_one")


OPENING_RATES = {2: 0.488, 3: 0.360}


def build_specialist_data(train, validation, value, *, cutoff=VALIDATION_START):
    training = train.loc[train[SHOT_VALUE].eq(value)]
    scoring = validation.loc[validation[SHOT_VALUE].eq(value)]
    shots = pd.concat([training, scoring], ignore_index=True).drop(columns=HISTORY_COLUMNS)
    shots = add_shooter_history(shots, OPENING_RATES[value])
    shots = add_defender_history(shots)
    before_cutoff = shots["GAME_DATE"].lt(cutoff)
    return shots.loc[before_cutoff], shots.loc[~before_cutoff]


FEATURES = [*CONTEXT_COLUMNS, CLOCK, DEFENDER_HISTORY]


def with_defender_weight(shots, weight):
    return shots.assign(**{
        DEFENDER_HISTORY: shots[DEFENDER_RESIDUAL_SUM] / (shots[DEFENDER_SUPPORT] + weight),
    })


def model_inputs(train, validation, config, columns):
    return (
        context_inputs(with_defender_weight(shots, config["defender_weight"]), config["shooter_weight"], columns)
        for shots in (train, validation)
    )


HISTORICAL = ["SHOT_DIST_CLEAN", "CLOSE_DEF_DIST", CLOCK, "TOUCH_TIME_CLEAN", "DRIBBLES"]


def sequence_indices(shots, window):
    """For each shot, retain a shooter's latest attempts from strictly earlier dates."""
    indices = np.full((len(shots), window), -1, dtype=int)
    for _, player in shots.groupby("player_id", sort=False):
        prior = []
        for _, day in player.groupby("GAME_DATE", sort=True):
            recent = prior[-window:]
            indices[day.index, :len(recent)] = recent
            prior.extend(day.index)
    return indices


def sequence_data(shots, training_mask, window, *, include_sequence=True):
    indices = sequence_indices(shots, window)
    valid = indices >= 0
    safe = np.maximum(indices, 0)
    values = shots[HISTORICAL]
    median = values.loc[training_mask].median()
    filled = values.fillna(median)
    outcomes = shots[TARGET].to_numpy(dtype=np.float32)
    days = pd.to_datetime(shots["GAME_DATE"]).to_numpy(dtype="datetime64[D]").astype(int)
    age = np.log1p(np.maximum(days[:, None] - days[safe], 0)).astype(np.float32)
    sequence = None
    if include_sequence:
        training = filled.loc[training_mask]
        numeric = ((filled - training.mean()) / training.std().replace(0, 1)).to_numpy(dtype=np.float32)
        sequence = np.concatenate([
            numeric[safe], values.isna().to_numpy(dtype=np.float32)[safe],
            outcomes[safe, None], age[:, :, None],
        ], axis=2)
        sequence[~valid] = 0
    lengths = valid.sum(axis=1)
    count = np.maximum(lengths, 1)
    summary = np.column_stack([
        lengths, (outcomes[safe] * valid).sum(axis=1) / count,
        (filled.to_numpy()[safe] * valid[:, :, None]).sum(axis=1) / count[:, None],
        (age * valid).sum(axis=1) / count,
    ])
    names = ["RECENT_ATTEMPTS", "RECENT_FG_RATE", *[f"RECENT_{name}" for name in HISTORICAL], "RECENT_LOG_DAYS"]
    return sequence, lengths, pd.DataFrame(summary, columns=names)


FEATURES_WITHOUT_TYPE = [column for column in FEATURES if column != "PTS_TYPE"]


FAMILY_HISTORY_WEIGHT = 50


def add_family_history(shots, opening_rate):
    daily = shots.groupby(["player_id", FAMILY, "GAME_DATE"], sort=True)[TARGET].agg(
        attempts="size", makes="sum",
    )
    prior = daily.groupby(level=["player_id", FAMILY]).cumsum() - daily
    league_daily = daily.groupby(level=[FAMILY, "GAME_DATE"], sort=True).sum()
    league_prior = league_daily.groupby(level=FAMILY).cumsum() - league_daily
    league_rate = league_prior["makes"].div(league_prior["attempts"].replace(0, np.nan)).fillna(opening_rate)
    prior = prior.join(league_rate.rename("league_rate"), on=[FAMILY, "GAME_DATE"])
    prior["FAMILY_PRIOR_RATE"] = (
        prior["makes"] + FAMILY_HISTORY_WEIGHT * prior["league_rate"]
    ) / (prior["attempts"] + FAMILY_HISTORY_WEIGHT)
    prior = prior.rename(columns={"attempts": "FAMILY_PRIOR_ATTEMPTS"})
    return shots.join(
        prior[["FAMILY_PRIOR_ATTEMPTS", "FAMILY_PRIOR_RATE"]],
        on=["player_id", FAMILY, "GAME_DATE"], validate="many_to_one",
    )


def prepare_specialist_rows(train, validation, value, config, metadata, *, cutoff=VALIDATION_START):
    training, scoring = build_specialist_data(train, validation, value, cutoff=cutoff)
    combined = pd.concat([training, scoring], ignore_index=True)
    before = np.arange(len(combined)) < len(training)
    _, _, summaries = sequence_data(combined, before, 10, include_sequence=False)
    x_train, x_scoring = model_inputs(training, scoring, config, FEATURES_WITHOUT_TYPE)
    features = pd.concat([pd.concat([x_train, x_scoring], ignore_index=True), summaries], axis=1)
    history_only = [column for column in HISTORY_COLUMNS if column not in features.columns]
    rows = pd.concat([combined[[*OUTPUT_COLUMNS, *history_only]], features], axis=1).merge(
        metadata, how="left", on=SHOT_KEY, validate="one_to_one",
    )
    return rows, features.columns.to_list()


OPPONENT_PRIOR_WEIGHT = 100


def add_opponent_history(shots, opening_rate):
    """Summarize the opponent's shots allowed on earlier dates, within this shot value."""
    keys = ["OPPONENT_TEAM_ID", "COURT_ZONE", "GAME_DATE"]
    known = shots.loc[shots["OPPONENT_TEAM_ID"].ne("Unknown") & shots["COURT_ZONE"].ne("Unknown")]
    daily = known.groupby(keys, sort=True)[TARGET].agg(attempts="size", makes="sum")
    prior = daily.groupby(level=keys[:2]).cumsum() - daily
    zone_daily = daily.groupby(level=keys[1:], sort=True).sum()
    zone_prior = zone_daily.groupby(level="COURT_ZONE").cumsum() - zone_daily
    zone_rate = zone_prior["makes"].div(zone_prior["attempts"].replace(0, np.nan)).fillna(opening_rate)
    prior = prior.join(zone_rate.rename("zone_rate"), on=keys[1:])
    prior[OPPONENT_PRIOR_COLUMNS[0]] = prior["attempts"]
    prior[OPPONENT_PRIOR_COLUMNS[1]] = (
        prior["makes"] + OPPONENT_PRIOR_WEIGHT * prior["zone_rate"]
    ) / (prior["attempts"] + OPPONENT_PRIOR_WEIGHT)
    return shots.join(prior[OPPONENT_PRIOR_COLUMNS], on=keys, validate="many_to_one")
