# Data source audit

**Status as of 2026-11-09** — The 2014–15 shot log contains the required defender-distance field. Publication rights are unverified.

## 2014–15 NBA shot logs

Dan Becker's public Kaggle upload attributes the data to the NBA REST API. The download contains `shot_logs.csv`. Its SHA-256 is `e9c7fcd71e6f81ade108841449fe1bccda072ed98fae2b5dc86a3b9f29fe5c7c`. [Original listing](https://www.kaggle.com/datasets/dansbecker/nba-shot-logs) · [Kaggle metadata](https://www.kaggle.com/api/v1/datasets/view/dansbecker/nba-shot-logs)

| Check | Observed in the CSV |
| --- | --- |
| Coverage | 128,069 attempts by 281 shooters across 904 games from October 28, 2014 to March 4, 2015 |
| Shot identity | `GAME_ID`, `player_id`, and `SHOT_NUMBER` are unique in combination |
| Make or miss | `SHOT_RESULT` contains 57,905 makes and 70,164 misses |
| Closest defender | `CLOSE_DEF_DIST` has no missing values. Review the 1,056 zero distances and 64 distances above 25 feet before modeling. |
| Curry sample | 968 attempts across 58 games, including 456 threes. Of those threes, 15 have a defender closer than 2 feet and 156 have a defender at least 6 feet away. |

The CSV records shot distance but has no court coordinates or shot-chart event ID. `FGM` agrees with `SHOT_RESULT` on every row, and `PTS` equals `FGM × PTS_TYPE`. Keep all three outcome fields and postgame fields such as `FINAL_MARGIN` and `W` out of model inputs.

### Quality flags

The file includes 312 negative `TOUCH_TIME` values and 5,567 blank `SHOT_CLOCK` values. Of the blank clocks, 2,013 occur with more than 24 seconds left in the period, so a period-end clock rule would explain only part of the missingness. The audit counts these values and unusual defender distances without changing the source file.

### Chronological evaluation sample

The audit uses February 1, 2015 as an illustrative holdout boundary. Dates come from `MATCHUP`. Every holdout shooter appears in the earlier sample.

| Sample | Attempts | Games | Shooters | Curry threes | Curry threes under 2 ft | Curry threes at least 6 ft |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before February 1 | 101,997 | 710 | 281 | 342 | 9 | 112 |
| February 1 onward | 26,072 | 194 | 270 | 114 | 6 | 44 |

The sample supports testing a model that shares information across shooters and uses only earlier games for player history. Six tightly contested Curry threes provide little evidence for evaluating that slice on its own. Report sample sizes when breaking out results by shooter and contest level.

### Cross-check against NBA shot charts

Curry's attempt totals, makes, and sequence of periods, shot values, and outcomes matched the NBA shot charts for October 29, 2014 at Sacramento (7 of 17) and March 4, 2015 against Milwaukee (6 of 16). The archived game clock showed 0–4 more seconds remaining than the shot-chart clock across those 33 attempts. A future coordinate join needs an independently checked shot match, since exact clock equality matched only one of the sampled attempts. The official charts used in the cross-check have no defender distance. [Sacramento box score](https://www.nba.com/game/gsw-vs-sac-0021400014/box-score) · [Milwaukee box score](https://www.nba.com/bucks/game/0021400907-bucks-vs-warriors-oakland-ca-03-04-2015)

### Reproduce the audit

From the repository root, point the standard-library script at the local CSV. The player ID and holdout date are configurable.

```shell
python src/audit_shot_logs.py data/raw/shot_logs.csv --holdout-start 2015-02-01 --player-id 201939
```

## Publication terms

Kaggle's API reports the original upload's license as `Unknown`. A second upload labeled `Apache 2.0` contains the same table after parsing the CSV. Its metadata provides no evidence that the uploader could grant rights to the upstream data. The NBA's current terms require attribution and restrict uses of statistics provided through its services. The historical archive's terms for publishing derived findings remain unverified. [Original metadata](https://www.kaggle.com/api/v1/datasets/view/dansbecker/nba-shot-logs) · [Mirror metadata](https://www.kaggle.com/api/v1/datasets/view/faseehimran/nba-shot-logs-by-faseeh) · [NBA Terms of Use, section 9](https://www.nba.com/termsofuse)

## Other sources checked

- **2015–16 SportVU tracking archive.** Player coordinates could support a distance calculation after identifying the release frame and matching it to the shot result. The data card traces the inputs to SportVU and Basketball Reference. Publication terms for those inputs remain unverified. [SportVU data card](https://huggingface.co/datasets/dcayton/nba_tracking_data_15_16)
- **2022–23 and 2023–24 NBA Stats pulls.** The archived shot-chart records contain locations and outcomes. The archived defender splits aggregate attempts by player, season, and distance bucket, so they cannot assign a defender distance to each shot. The local shot-chart caches also stopped at 102,400 attempts per season. [NBA closest-defender dashboard](https://www.nba.com/stats/players/shots-closest-defender)
