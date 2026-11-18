# Modeling dataset

The dataset builder turns the raw shot log into chronological training, validation, and holdout tables. See the [source audit](data-sources.md) for provenance and the [reproduction guide](reproduction.md#2-build-and-score) for setup commands.

The Git-ignored `data/processed/modeling/` directory contains the three CSVs and `manifest.json`. The manifest records the input paths, boundaries, context columns, and cleaning counts. Read `GAME_ID` as a string to preserve its 10 characters. Each shot appears once under `GAME_ID`, `player_id`, and `SHOT_NUMBER`. Dates come from `MATCHUP`. Each game belongs to one split.

| File | Game dates, inclusive | Attempts | Games |
| --- | --- | ---: | ---: |
| `train.csv` | 2014-10-28 through 2014-12-31 | 68,735 | 479 |
| `validation.csv` | 2015-01-01 through 2015-01-31 | 33,262 | 231 |
| `holdout.csv` | 2015-02-01 through 2015-03-04 | 26,072 | 194 |

The target is `FGM`, the make-or-miss label. The manifest lists the baseline context predictors. `SHOT_RESULT`, `PTS`, `W`, and `FINAL_MARGIN` are absent from the output. Keys, names, and provenance fields support joins and audits. Development models fit on October–December and use January to compare settings. The final models refit on October–January and score the reserved games in date order.

The training and validation CSVs include `SHOOTER_PRIOR_ATTEMPTS`, `SHOOTER_PRIOR_MAKES`, and `LEAGUE_PRIOR_FG_RATE`. Counts pool twos and threes from strictly earlier dates. The league rate uses all earlier archive shots, with 45.4% from the 2013–14 NBA regular season on opening day. January history incorporates completed January dates. [2013–14 league FG%, Table 1](https://doi.org/10.3390/ijerph20031924)

For shrinkage strength `k > 0`, `smoothed_shooter_rate` computes `(prior makes + k × league rate) / (prior attempts + k)`. Zero prior attempts give the league rate. At final evaluation, build history across development and holdout with the same earlier-date rule.

The final runner rebuilds player and defender histories independently for twos and threes. The [model design](model-design.md) describes these histories, the official event join, and the features that enter each model. The [development history](development-history.md) records the January comparisons.

## Recorded values and fills

- **Basket distance.** Four recorded zeros become 2 ft in `SHOT_DIST_CLEAN`. The original `SHOT_DIST` and the correction source remain available. The values for Ömer Aşık, Wilson Chandler, and Mario Chalmers are shared layup-distance estimates. The value for Luc Richard Mbah a Moute is the distance listed in cached NBA play-by-play event 400 for game `0021400671`. [EDA 01](../notebooks/01_understand_shot_logs.ipynb)
- **Defender distance and touch time.** `CLOSE_DEF_DIST` retains every recorded value, including 835 zeros and 48 values above 25 ft in development. `TOUCH_TIME_CLEAN` is missing for 258 negative development readings. `TOUCH_TIME` retains the archived values. [EDA 02](../notebooks/02_tracking_value_anomalies.ipynb)
- **Shot clock.** `SHOT_CLOCK` retains the archive readings, including zero. `SHOT_CLOCK_CLEAN` uses valid 0–24 s possession estimates for originally blank development clocks, then fills remaining blanks when the period has at most 24 s left. `CLOCK_SOURCE` records the origin. There are 97,371 recorded clocks, 558 estimates, 2,829 period proxies, and 1,239 unresolved development clocks. The estimates take precedence on 18 eligible late attempts. [EDA 02](../notebooks/02_tracking_value_anomalies.ipynb)
- **Frozen shot-clock feature.** `SHOT_CLOCK_WITH_PERIOD_FALLBACK` preserves recorded clocks and fills late blanks from period time when 24 seconds or less remain. In development it uses 2,847 period proxies and leaves 1,779 blanks. A proxy can overstate the time available if an active shot clock would expire first. `SHOT_CLOCK_CLEAN` and `CLOCK_SOURCE` are retained for audit and earlier comparisons. [Reconstruction audit](shot-clock-reconstruction.md)

## Build options

The default builder reads data/raw/shot_logs.csv and data/processed/shot-clock-review/missing-shot-clocks.csv. Use --reconstruction-report to provide an alternate report. Use --period-clock-only to build without retrospective estimates. The final predictor uses the same recorded-plus-period clock in either build. The separate play-by-play cache still supplies geometry, shot families, and event context. [Dataset builder](../src/build_modeling_dataset.py) · [Reproduction guide](reproduction.md)
