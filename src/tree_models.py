"""Shared tree fitting and categorical input conversion."""

from catboost import CatBoostClassifier
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss
from sklearn.pipeline import make_pipeline

from build_modeling_dataset import TARGET
from fit_baselines import context_preprocessor
from play_by_play_context import BROAD, CONTEXT_CATEGORICAL, FAMILY, PROXY


CATBOOST_DEFAULTS = dict(one_hot_max_size=16, loss_function="Logloss", thread_count=3,
                        random_seed=42, verbose=False, allow_writing_files=False)
HISTOGRAM = "Histogram gradient boosting"


def catboost_inputs(features):
    categorical = [column for column in ("PTS_TYPE", "PERIOD", "LOCATION") if column in features]
    return features.astype(dict.fromkeys(categorical, str)), categorical


def fit_catboost(
    train_x, train_y, validation_x, validation_y, *,
    depths=(4, 6, 8), iterations=700, learning_rate=0.05, early_stopping_rounds=40,
):
    training, categorical = catboost_inputs(train_x)
    scoring, _ = catboost_inputs(validation_x)
    candidates = []
    for depth in depths:
        model = CatBoostClassifier(
            depth=depth, iterations=iterations, learning_rate=learning_rate, **CATBOOST_DEFAULTS,
        )
        model.fit(
            training, train_y, cat_features=categorical, eval_set=(scoring, validation_y),
            early_stopping_rounds=early_stopping_rounds, use_best_model=early_stopping_rounds is not None,
        )
        probabilities = model.predict_proba(scoring)[:, 1]
        candidates.append((log_loss(validation_y, probabilities), depth, model.tree_count_, probabilities))
    loss, depth, rounds, probabilities = min(candidates, key=lambda candidate: candidate[0])
    return probabilities, {
        "depth": depth, "rounds": int(rounds), "learning_rate": learning_rate, "validation_log_loss": loss,
    }


def fit_histogram(train, columns, settings):
    categorical = (FAMILY, BROAD, PROXY, *CONTEXT_CATEGORICAL)
    model = make_pipeline(
        context_preprocessor(columns, extra_categorical=categorical),
        HistGradientBoostingClassifier(**settings),
    )
    model.fit(train[columns], train[TARGET])
    return model


def fit_probabilities(train, validation, columns, settings):
    return fit_histogram(train, columns, settings).predict_proba(validation[columns])[:, 1]
