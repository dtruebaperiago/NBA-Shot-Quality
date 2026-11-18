# NBA Shot Quality TODO

## Complete

- [x] [EDA 01](notebooks/01_understand_shot_logs.ipynb). Verify one row per shot and correct four reviewed basket distances to 2 ft. Retain recorded zero and extreme defender distances.
- [x] [EDA 02](notebooks/02_tracking_value_anomalies.ipynb). Treat negative touch times as missing. Use valid play-by-play estimates first and period-clock values for other late blanks. Keep unresolved clocks missing.
- [x] [EDA 03](notebooks/03_shot_context_relationships.ipynb). Explore shot context, player differences, and changes over time. Compare Lillard's threes by defender distance and inspect one-hot encoding and PCA.

## Next up

1. [x] **Build the modeling dataset.** The [build script](src/build_modeling_dataset.py) applies the cleaning rules and writes separate October–December training, January validation, and February-onward holdout files with whole games in one split. The [dataset notes](docs/modeling-dataset.md) document the predictor allowlist and audit results.
2. [x] **Build player history.** Export cumulative shooter attempts, makes, and the league rate from earlier dates. Use the 2013–14 league field-goal rate on opening day and shrink shooter rates toward the earlier league rate.
3. [x] **Fit three baselines.** Run [the baseline script](src/fit_baselines.py) to select shrinkage on January and compare league average, shooter history, and shot context on the same attempts. The script writes January log loss, Brier scores, and a calibration plot.
4. [x] **Measure what each feature adds.** The [January comparison](src/compare_features.py) tests defender distance and shot clock alone and together, plus a retrospective possession-estimate variant. It reports slice scores and counts.
   - [x] **Build and compare defender history.** Use expected minus actual makes on earlier dates, with predictions from expanding-window models. Compare the selected context model with and without this feature on the same January shots.
   - [x] **Compare model families before final evaluation.** The [model selection script](src/select_model.py) tunes both history weights and compares logistic regression, XGBoost, and histogram gradient boosting on January. It tests possession estimates in training while using the same recorded clock plus fallback for all January predictions.
5. [x] **Run the final evaluation.** Refit the frozen model on October–January and score all 26,072 reserved attempts. See the [final evaluation report](docs/final-evaluation.md) for scores, coverage, calibration, and reproduction commands.
