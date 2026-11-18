# NBA Shot Quality

Estimate the probability that a specific NBA player makes a field-goal attempt, given the shot context and the player's earlier shooting history. The project tests how much recorded defender distance, court location, and possession context add to that prediction.

The final model achieved **0.60789 log loss** on **26,072 held-out shots** from the 2014–15 NBA season. The tracking-only model scored **0.64293** on the same shots, a **5.45% reduction** in log loss. Two-pointers accounted for most of the gain. The three-point difference was small, with a game-bootstrap interval that crossed zero. [Final evaluation](docs/final-evaluation.md)

## Start here

| Read | What it covers |
| --- | --- |
| [Development history](docs/development-history.md) | How the project moved from an archive audit and simple baselines to the final model. Includes experiments that had little effect. |
| [Model design](docs/model-design.md) | The inputs, chronological histories, play-by-play join, and prediction paths for linked and unmatched shots. |
| [Data and preparation](docs/modeling-dataset.md) | What a row represents, how raw measurements were cleaned, and how games were split. |
| [Final evaluation](docs/final-evaluation.md) | Holdout results, calibration, sample sizes, and limitations. |
| [Reproduce the results](docs/reproduction.md) | Set up Python, reconstruct the data, run the frozen evaluation, and locate the earlier experiments. |

## Project layout

| Path | Contents |
| --- | --- |
| [notebooks/](notebooks/) | Exploratory analysis of the raw shot log, tracking anomalies, and shot context. |
| [src/](src/) | Data preparation, model comparisons, feature engineering, and the final evaluator. |
| [tests/](tests/) | Tests for event ordering, calibration bands, history summaries, and interrupted report writes. |
| [docs/](docs/) | Research history, data audits, methodology, and results. |

The project is a historical, shot-level probability evaluation. It uses 2014–15 tracking snapshots and archived scorer annotations. Live use would require equivalent inputs at release. Raw data, cached play-by-play, and fitted artifacts stay local. The [MIT license](LICENSE) covers project code. The [source audit](docs/data-sources.md) records the separate data terms.
