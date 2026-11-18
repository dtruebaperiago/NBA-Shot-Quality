# Modeling dataset

Run from the repository root with Python and pandas.

```shell
python src/build_modeling_dataset.py
```

The default build reads `data/raw/shot_logs.csv` and `data/processed/shot-clock-review/missing-shot-clocks.csv`. If the report is absent, regenerate it with `python src/reconstruct_shot_clock.py data/raw/shot_logs.csv`. The reconstruction script reads cached play-by-play and supports `--fetch` for missing games. The dataset builder also supports `--period-clock-only` to explicitly skip reconstruction and `--reconstruction-report` to select a local report.

The Git-ignored `data/processed/modeling/` directory contains the three CSVs and `manifest.json`. The manifest records the input paths, boundaries, context columns, and cleaning counts. Read `GAME_ID` as a string to preserve its 10 characters. Each shot appears once under `GAME_ID`, `player_id`, and `SHOT_NUMBER`. Dates come from `MATCHUP`. Each game belongs to one split.

| File | Game dates, inclusive | Attempts | Games |
| --- | --- | ---: | ---: |
| `train.csv` | 2014-10-28 through 2014-12-31 | 68,735 | 479 |
| `validation.csv` | 2015-01-01 through 2015-01-31 | 33,262 | 231 |
| `holdout.csv` | 2015-02-01 through 2015-03-04 | 26,072 | 194 |

Use `FGM` as the target and select predictors explicitly from the manifest. `SHOT_RESULT`, `PTS`, `W`, and `FINAL_MARGIN` are absent from the output. Keys, names, and provenance fields support joins and audits. Fit on October–December and select model settings on January. Open the holdout for scoring after those settings are fixed.

The training and validation CSVs include `SHOOTER_PRIOR_ATTEMPTS`, `SHOOTER_PRIOR_MAKES`, and `LEAGUE_PRIOR_FG_RATE`. Counts pool twos and threes from strictly earlier dates. The league rate uses all earlier archive shots, with 45.4% from the 2013–14 NBA regular season on opening day. January history incorporates completed January dates. [2013–14 league FG%, Table 1](https://doi.org/10.3390/ijerph20031924)

For shrinkage strength `k > 0`, `smoothed_shooter_rate` computes `(prior makes + k × league rate) / (prior attempts + k)`. Zero prior attempts give the league rate. At final evaluation, build history across development and holdout with the same earlier-date rule.

Run `python src/fit_baselines.py` with SciPy, scikit-learn, and Matplotlib installed. It selects `k` by January log loss, fits the context model on October–December, and writes the score table and calibration plot to `data/processed/baselines/`.

Run `python src/compare_features.py` to compare defender distance and shot clock alone and together. The retrospective comparison replaces the clock with `SHOT_CLOCK_CLEAN` and runs with and without the same defender-history feature. Results and slice counts go to `data/processed/feature-comparisons/`.

For defender history, an expanding model predicts each date using earlier shots and includes shooter history and defender distance. The first date has no fitted model and contributes no residuals. The feature sums expected minus actual makes for the recorded closest defender on earlier dates and divides by the number of those scored attempts plus 50. The 50-attempt weight shrinks small samples toward zero. The comparison adds this one feature to the better January context model that includes defender distance and uses an outcome-independent clock policy. The nearest defender at release is an observed association and the archive has no defensive assignments or possessions without shots.

Run `python src/select_model.py` with XGBoost installed to compare model families. It screens model settings with a common clock policy and history weights, then selects shooter and defender weights from a 5 × 5 grid for each training clock policy by January log loss. The matched clock comparison keeps the family, model settings, and both weights fixed. Every January prediction uses the recorded clock with the late-period fallback. The script writes the complete trial table, matched comparison, and calibration plot to `data/processed/model-selection/`.

Run `python src/tune_tree_models.py` for the January search around the two leading tree models. Both train and predict with the recorded clock and late-period fallback. The search compares tree settings first, then tests nearby history weights with each family's best settings. Results go to `data/processed/tree-tuning/`.

Run `python src/compare_shot_type_models.py` after tuning to compare each pooled tree model with separate models for twos and threes. It reuses the tuned settings and history weights and reports January scores overall and by shot value.

Run `python src/compare_model_families.py` after tree tuning with XGBoost, CatBoost, PyTorch, TabM, and `polyagamma` installed. CatBoost and TabM use the pooled histogram model's history weights and select settings on January. The Bayesian model replaces those histories with partially pooled shooter effects by shot value and closest-defender effects learned on October–December. It uses separate distance splines for twos and threes and averages make probabilities over four Pólya–Gamma Gibbs chains. Its player effects are frozen during January. Scores, calibration, and chain diagnostics go to `data/processed/model-family-comparison/`.

The January comparison also saves shot-keyed probabilities and diagnostic scores. Accuracy and balanced accuracy use a 0.5 threshold. Calibration error averages the absolute gap between predicted and observed make rates over ten equal-width probability bins, weighted by attempt count. Model rankings still use log loss.

## Recorded values and fills

- **Basket distance.** Four recorded zeros become 2 ft in `SHOT_DIST_CLEAN`. The original `SHOT_DIST` and the correction source remain available. The values for Ömer Aşık, Wilson Chandler, and Mario Chalmers are shared layup-distance estimates. The value for Luc Richard Mbah a Moute is the distance listed in cached NBA play-by-play event 400 for game `0021400671`. [EDA 01](../notebooks/01_understand_shot_logs.ipynb)
- **Defender distance and touch time.** `CLOSE_DEF_DIST` retains every recorded value, including 835 zeros and 48 values above 25 ft in development. `TOUCH_TIME_CLEAN` is missing for 258 negative development readings. `TOUCH_TIME` retains the archived values. [EDA 02](../notebooks/02_tracking_value_anomalies.ipynb)
- **Shot clock.** `SHOT_CLOCK` retains the archive readings, including zero. `SHOT_CLOCK_CLEAN` uses valid 0–24 s possession estimates for originally blank development clocks, then fills remaining blanks when the period has at most 24 s left. `CLOCK_SOURCE` records the origin. There are 97,371 recorded clocks, 558 estimates, 2,829 period proxies, and 1,239 unresolved development clocks. The estimates take precedence on 18 eligible late attempts. [EDA 02](../notebooks/02_tracking_value_anomalies.ipynb)
- **Clock comparison.** `SHOT_CLOCK_WITH_PERIOD_FALLBACK` combines recorded clocks with 2,847 late period proxies in development and leaves 1,779 development blanks. This candidate uses the same rule in all splits and can be compared with a model that has only period time. A proxy can overstate time available when an active shot clock expires before the period ends. Use the manifest's baseline context columns for the first comparison. Keep `SHOT_CLOCK_CLEAN` and `CLOCK_SOURCE` for retrospective audit because the reconstruction matches on the current shot outcome. Confirm equivalent release-time data before adopting reconstruction as a feature. [Reconstruction audit](shot-clock-reconstruction.md)
