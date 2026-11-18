# Reproduce the results

Use Python 3.11 and run the commands from the repository root. The frozen holdout evaluation uses the pinned packages in [requirements-final.txt](../requirements-final.txt). The additional dependencies for exploratory models are listed separately below.

## 1. Set up Python and get the source data

The commands use PowerShell. In a macOS or Linux shell, use .venv/bin/python directly in place of the PowerShell invocation with the python variable.

~~~powershell
python -m venv .venv
$python = ".\.venv\Scripts\python.exe"
& $python -m pip install -r requirements-final.txt
~~~

Download and extract the Kaggle archive to data/raw/shot_logs.csv. The source audit includes the file checksum and provenance. Keep the archive and the play-by-play cache local. [Original dataset](https://www.kaggle.com/datasets/dansbecker/nba-shot-logs) · [Source audit](data-sources.md)

## 2. Build and score

~~~powershell
& $python src/audit_shot_logs.py data/raw/shot_logs.csv
& $python -u src/reconstruct_shot_clock.py data/raw/shot_logs.csv --fetch
& $python src/build_modeling_dataset.py
& $python -u src/final_evaluation.py --fetch-holdout
& $python -u src/final_evaluation.py --final
~~~

The clock audit caches development games and writes the reconstruction report used by the dataset builder. The holdout fetch fills the cache for the reserved games. Both fetch commands reuse existing responses. Matching coverage affects the fitted enriched models and the final routing, so use the same source archive and cache for an exact replay. Refit uses October–January only. Full evaluation includes the tracking vote for unmatched shots. [Dataset preparation](modeling-dataset.md) · [Frozen policy](final-evaluation.md#frozen-policy)

The runner places the report files in data/processed/final-evaluation/ and the model bundle in models/final-shot-quality.joblib. Completed runs are protected from overwrite. To reproduce a completed run, pass fresh paths with --output and --models. An interrupted publication produced by the runner can be retried at its original paths.

| Generated file | Contents |
| --- | --- |
| holdout-scores.csv | Loss, ranking, calibration, accuracy, and paired comparison intervals. |
| holdout-predictions.csv | One row per reserved shot with its result, probabilities, and link status. |
| holdout-calibration.csv and holdout-calibration.png | Five-point calibration bins and curves for twos and threes. |
| holdout-slices.csv | Counts and scores by shot family and closest-defender distance. |
| settings.json and final-shot-quality.joblib | Model settings and feature lists, plus the fitted estimators and preprocessing. |

## 3. Verify

~~~powershell
$env:PYTHONPATH = "src"
& $python -m unittest discover -s tests -v
~~~

The tests cover pre-shot scoring and event order, substitution-based stints, calibration bin boundaries, recent-shot summaries, and retrying an interrupted report. The optional --january-check command replays the probabilities against the saved outputs from retrain_main_models.py and compare_play_by_play_context.py.

## Development experiments

The final evaluation can run directly from the built dataset and play-by-play cache. To regenerate the experimental trajectory, install PyTorch 2.14.0, XGBoost 3.2.0, TabM 0.0.3, polyagamma 2.0.2, and rtdl_num_embeddings 0.0.12 in a research environment alongside the final packages. These are the versions recorded for the original CPU runs. Use a PyTorch build compatible with the host platform.

Script paths below are under src/. Output directories are under data/processed/.

| Stage | Scripts | Inputs and outputs |
| --- | --- | --- |
| Baselines and context | [fit_baselines.py](../src/fit_baselines.py), [compare_features.py](../src/compare_features.py), [select_model.py](../src/select_model.py), [tune_tree_models.py](../src/tune_tree_models.py) | Built dataset with the clock audit. Writes baselines, feature-comparisons, model-selection, and tree-tuning. |
| Pooled families and variants | [compare_model_families.py](../src/compare_model_families.py), [compare_tree_extensions.py](../src/compare_tree_extensions.py), [compare_tabm_gate.py](../src/compare_tabm_gate.py) | Run the family comparison after tree tuning, then the extensions and gate. Writes model-family-comparison. |
| Shot-value routing and capacity | [compare_shot_type_models.py](../src/compare_shot_type_models.py), [compare_shot_type_routes.py](../src/compare_shot_type_routes.py), [compare_fully_separate_shot_types.py](../src/compare_fully_separate_shot_types.py), [compare_tree_pruning.py](../src/compare_tree_pruning.py), [compare_histogram_blends.py](../src/compare_histogram_blends.py), [compare_gru_history.py](../src/compare_gru_history.py) | Run the initial tree split after tree tuning. The routing experiment uses saved pooled and gated outputs. Run the fully separate comparison before pruning and GRU, then run the Histogram blend after pruning. Writes shot-type-comparison. |
| Recent shot history and alternative objectives | [retrain_main_models.py](../src/retrain_main_models.py), [search_genetic_features.py](../src/search_genetic_features.py), [compare_contrastive_models.py](../src/compare_contrastive_models.py) | Retraining and feature search use the saved family and selection settings. Contrastive comparisons also use the retraining predictions. Writes retraining-50-10, genetic-search, and contrastive-comparison. |
| Play-by-play enrichment | [compare_shot_family_models.py](../src/compare_shot_family_models.py), [compare_play_by_play_context.py](../src/compare_play_by_play_context.py) | Both use the retraining settings and official cache. Writes shot-family-comparison and play-by-play-context. |

Each script has a --help command for input and output options. The [development history](development-history.md) explains how the experiments informed the final choices.
