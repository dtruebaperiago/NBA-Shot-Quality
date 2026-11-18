# NBA Shot Quality

Predict the probability that a specific NBA player makes a shot, given their shooting history and the context of that attempt. Recorded closest-defender distance is essential. An open Curry three and a heavily contested Curry three from the same spot should be distinguishable to the model.

## Data comes first

The first milestone is to verify a free, traceable source with one record per attempt, a shooter ID, a make or miss label, recorded closest-defender distance, and enough dated attempts to evaluate predictions on later games. Any season can qualify. The source terms must support publishing the project and its findings. Raw data stays local.

See the [data source audit](docs/data-sources.md) for what has been verified and what remains open.

To reproduce the 2014–15 audit, download and extract the [Kaggle shot log](https://www.kaggle.com/datasets/dansbecker/nba-shot-logs) to `data/raw/shot_logs.csv`. Run the audit from the repository root with Python.

```shell
python src/audit_shot_logs.py data/raw/shot_logs.csv
```

## Build the modeling dataset

Run the builder from the repository root with pandas installed and the local reconstruction report available.

```shell
python src/build_modeling_dataset.py
```

The build writes October–December training data, January validation data, and a separate February-onward holdout to `data/processed/modeling/`. See the [modeling dataset notes](docs/modeling-dataset.md) for input columns, clock provenance, and how to build from a fresh checkout.

## Final historical evaluation

See the [final evaluation report](docs/final-evaluation.md) for the frozen model policy, February–March results, and reproduction commands.

## Repository layout

| Path | Purpose |
| --- | --- |
| `docs/` | Dataset provenance, coverage, and reuse terms |
| `data/raw/` and `data/processed/` | Local source files and generated tables |
| `notebooks/` | Data exploration and validation |
| `src/` | Data preparation, training, and evaluation |
| `models/` | Local model artifacts |
| `frontend/` | Interface for exploring predictions |

The repository uses the [MIT license](LICENSE) for project code. Dataset terms are documented separately.
