# NBA Shot Quality handoff

Updated 2026-11-18. Workspace is C:/GitHub/NBA-Shot-Quality.

## Current position

Predict a named player's probability of making an NBA shot using earlier shooting history and context at release. Closest-defender distance is central. Damian Lillard is the original player-specific example.

Dataset construction, chronological histories, feature comparisons, model-family comparisons, specialization, tree pruning, neural training, genetic feature search, and contrastive experiments are complete locally. After diagnosing January probability errors and improving the inputs, the user approved the frozen final evaluation. TODO items 1–5 are complete.

The full-January tracking-only reference is an equal-weight soft vote of CatBoost and 12-leaf Histogram Gradient Boosting, both with last-10 same-type shooter summaries. January log loss is 0.645789 overall, 0.649598 for twos, and 0.635205 for threes. The user has yet to lock a final model.

The [final holdout report](docs/final-evaluation.md) covers all 26,072 attempts from February 1 to March 4, 2015. The model scored 0.60789 log loss versus 0.64293 for the tracking-only vote. The two-point gain is clear. The game-bootstrap interval for the three-point difference crosses zero. Play-by-play linked 25,960 attempts, with the remaining 112 using the tracking fallback. Completed holdout dates advance rolling histories. Model fitting, feature selection, and settings use development data.

The January diagnostic found 46.25% predicted versus 44.92% observed makes. An earlier-date intercept correction reduced the bias with an uncertain log-loss improvement of 0.00023 on January 11–31. For 5,515 ordinary threes (22–<26 ft and 8+ seconds on the model clock), AUC was 0.548 and log-loss gain versus same-type shooter history was 0.00221.

The play-by-play cache contains court coordinates and coarse shot families. A one-to-one match used game, shooter, period, shot value, and a six-second clock window. On the same 23,014 matched January twos, fixed 12-leaf Histogram scored 0.64641 with existing inputs, 0.63180 with coordinates, and 0.62765 with coordinates and shot family. The same test on 8,594 threes changed 0.63692 to 0.63621, with the interval crossing zero. Match coverage is selective. The 1,447 unmatched twos had 53.36% predicted versus 33.59% observed makes, with most of the gap among ambiguous rapid sequences. Post-shot follow-ups are diagnostic evidence only. A previous-attempt timing feature yielded an uncertain 0.00007 gain across all January twos. Establish release-time feature availability and audit coverage before adopting the enriched inputs.

[Shot family follow-up](src/compare_shot_family_models.py) resolves some ambiguous sequences by attempt order, raising January linkage to 32,734 of 33,262 shots. All 1,126 newly linked January outcomes agreed with the archive on a post-match check. The experiment exports development shot labels, subtype counts, coverage, and January predictions and scores under data/processed/shot-family-comparison/.

With fixed Histogram settings on the same linked January shots, coordinates plus detailed family scored 0.61558 for twos and 0.63305 for threes. Broad labels scored 0.62849 and 0.63665. Routing to independently trained shot-family models worsened both results to 0.62021 and 0.63745. Same-family shooter history gave an uncertain gain for twos and worsened threes slightly. Generic jump shots account for 8,132 of 8,674 linked threes. The 396 tagged pull-up threes include 195 quick no-dribble readings. A full-January three-point experiment found no improvement from the dribbles and touch-time proxy.

[Play-by-play context comparison](src/compare_play_by_play_context.py) added four feature groups to the same 32,734 linked January attempts and reproduced the previous enriched probabilities exactly. All four groups improved overall log loss from 0.61978 to 0.60908. Twos improved from 0.61500 to 0.60069. Court zones and finer shot details alone achieved 0.60139, accounting for most of the gain. Threes moved from 0.63305 to 0.63235, with a paired game-bootstrap interval that crossed zero. Predictions, scores, and the keyed development feature table live in data/processed/play-by-play-context/.

Pre-shot state uses event order. Rebound and steal origin is known for 12,595 linked January attempts, with unclassified sequences kept as unknown. Score snapshots follow earlier scoring events and ignore non-scoring placeholders. Opponent zone histories use completed dates. Stint time counts seconds within the current period since a logged entry or an inferred period start. The feature marks the source explicitly and leaves 598 January stints unknown. Court zones approximate the NBA markings, and the finer details retain the historical scorer annotations from the shot subtype.

## Read first and user preferences

Read this file and [TODO.md](TODO.md), then the relevant scripts and their saved outputs. [README.md](README.md), [dataset notes](docs/modeling-dataset.md), and the audit notes provide background. The original request to review repository contents and all notebook code and saved outputs was completed earlier. Notebook proposals can differ from later decisions.

- Log loss is the primary objective. Also explain accuracy, Brier, AUC, and calibration accessibly.
- The user explicitly requested fully independent two-point and three-point training with pertinent shot-type histories. Current specialists separate league, shooter, and defender histories.
- History uses strictly earlier dates. January histories update after each completed date while fitted parameters stay fixed.
- Small samples use shrinkage. Opening league priors come from 2013–14.
- Possession estimates were requested as a retrospective comparison and as training-only data. Both comparisons were completed.
- Neural training now uses cap 50 epochs, early-stopping patience 10, and gradient clipping at norm 2.0. Historical helper defaults retain older schedules for reproducibility, so pass the current settings explicitly.
- Soft voting averages make probabilities with equal weights. Distinguish mean scores across independent seeds from the score of averaged seed predictions.
- Explain choices. Avoid creating redundant reviews or documentation for every experiment. Save concrete outputs and update existing context.
- Requests such as “run it” authorize the described experiment. Follow through to completion and verification.
- The user's earlier music CNN project informed gating and voting ideas. Its files are C:/GitHub/Music-Genre-Classification/README.md and improved_cnn_se_architecture.svg. Several choices changed together in its final run, so its reported improvements cannot isolate attention alone.
- Research into NBA methods informed discussion. The user chose the 2PT/3PT split. Our implementation has no verified equivalence to the NBA's proprietary architecture or benchmark.

TODO and modeling-dataset.md mainly document the early pipeline. Use this handoff for later results, and resolve discrepancies against code and local tables.

## Data, provenance, and availability

Source is data/raw/shot_logs.csv. Key is GAME_ID, player_id, SHOT_NUMBER. Read GAME_ID as a string and normalize to 10 digits. FGM is the binary target. Exclude outcome duplicates SHOT_RESULT and PTS, and postgame fields W and FINAL_MARGIN.

| Split | Inclusive dates | Attempts | Games |
| --- | --- | ---: | ---: |
| Training | 2014-10-28 through 2014-12-31 | 68,735 | 479 |
| January validation | 2015-01-01 through 2015-01-31 | 33,262 | 231 |
| Reserved holdout | 2015-02-01 through 2015-03-04 | 26,072 | 194 |

Training contains 50,589 twos and 18,146 threes. January contains 24,461 twos and 8,801 threes. Keep whole games in one split.

[src/build_modeling_dataset.py](src/build_modeling_dataset.py) writes train.csv, validation.csv, holdout.csv, and manifest.json under data/processed/modeling/. JSON records input paths, split boundaries, columns, priors, and cleaning counts in machine-readable form. Base train/validation CSVs contain pooled histories. Specialist scripts rebuild them by shot type.

Recorded values, estimates, and missing values are distinct.

- SHOT_DIST_CLEAN corrects four reviewed recorded zeros to 2 ft. Three corrections are layup-distance estimates; one is a cached NBA play-by-play distance. Original values and correction provenance remain available. See notebook 01 and docs/modeling-dataset.md.
- CLOSE_DEF_DIST preserves recorded zeros and extremes. Development contains 835 zeros and 48 distances above 25 ft.
- TOUCH_TIME_CLEAN makes negative touch durations missing and retains the shots. There are 258 such development readings.
- SHOT_CLOCK retains recorded readings, including zero.
- SHOT_CLOCK_WITH_PERIOD_FALLBACK uses recorded clock, then period seconds for blanks only when at most 24 seconds remain. Period proxies can overstate actual shot-clock time.
- SHOT_CLOCK_CLEAN additionally includes retrospective possession estimates. Event matching used the current outcome, so its availability differs from prediction at release.
- Development SHOT_CLOCK_CLEAN provenance is 97,371 recorded clocks, 558 estimates, 2,829 period proxies, and 1,239 unresolved blanks. Estimates override 18 eligible period proxies.
- The recorded-plus-period policy has 2,847 period proxies and 1,779 unresolved development blanks.
- All recent main-model experiments use SHOT_CLOCK_WITH_PERIOD_FALLBACK in both training and January. CLOCK_SOURCE supports auditing.

The reconstruction report is data/processed/shot-clock-review/missing-shot-clocks.csv. Regenerate from cached play-by-play with python src/reconstruct_shot_clock.py data/raw/shot_logs.csv. It supports --fetch for uncached games. The dataset builder supports --period-clock-only and --reconstruction-report.

The archive has shot snapshots, without continuous trajectories, defensive assignments, or possessions with no shot. Closest-defender effects are conditional associations. Raw data stays local. Publication rights remain unverified in docs/data-sources.md.

## Histories and inputs

Opening priors are pooled FG 0.454, 2PT 0.488, and 3PT 0.360. These are 2013–14 regular-season rates from Table 1 of https://doi.org/10.3390/ijerph20031924. Rates update as earlier archive attempts become available.

Shooter smoothing is (prior makes + k × earlier league rate) / (prior attempts + k). Attempts remain a measure of evidence strength. All counts and rates use completed dates.

Defender history is earlier expected-minus-actual makes divided by earlier scored attempts plus a shrinkage weight. Expected makes come from expanding-window context models fitted on dates before each historical shot. The first date has no fitted residual. Positive values mean fewer makes than expected.

An early specialist comparison separated shooter history but kept pooled defender residuals. This was corrected in [src/compare_fully_separate_shot_types.py](src/compare_fully_separate_shot_types.py). build_specialist_data filters by shot value before rebuilding league, shooter, and defender histories. Later pruning, recent-summary, GRU, retraining, genetic, and contrastive scripts use this helper.

FEATURES in src/select_model.py supplies cleaned shot distance, defender distance, touch time, dribbles, period, period seconds, shot value, home/away, recorded-plus-period clock, and defender history. context_inputs adds shooter attempts and smoothed rate. Specialists remove constant shot value.

Recent summaries describe earlier same-type shooter attempts, make rate, mean shot/defender distance, clock, touch time, dribbles, and recency. Windows 5/10/20 were explored. GRU sequences also include earlier outcomes and elapsed days.

Current experiments mostly reuse earlier January-selected shrinkage weights. Histogram, CatBoost, TabM, and GRU inputs use shooter/defender weights 150/50. XGBoost uses 15/150. Selected logistic uses 500/5000. These have not been exhaustively retuned separately for every specialist or new feature set.

## Completed experiments

All loss values below are measured on January unless labeled as internal fitness. Small differences often have uncertainty intervals crossing zero.

### Initial baselines, features, and clocks

- Pooled rolling league average scored 0.688042. Pooled smoothed shooter-only history scored 0.684027, with January-selected k = 49.583158.
- Controlled comparisons tested defender distance, clock, both, defender history, and retrospective reconstructed clocks.
- Matched training-only possession estimates changed log loss by approximately +0.000306 for Histogram, +0.000141 for XGBoost, and -0.000001 for logistic. Positive means worse. Independently tuning each clock policy could alter the ranking slightly. Later comparisons standardized on recorded-plus-period clocks.
- Scripts are fit_baselines.py, compare_features.py, select_model.py, and tune_tree_models.py.
- Outputs are data/processed/baselines/, feature-comparisons/, model-selection/, and tree-tuning/.

### Pooled model families and early blends

| Model | January loss |
| --- | ---: |
| CatBoost | 0.646566 |
| Histogram Gradient Boosting | 0.646762 |
| XGBoost | 0.647008 |
| TabM | 0.648707 |
| Cross-classified Bayesian logistic | 0.652570 |
| Equal-weight three-tree vote | 0.646208 |

[src/compare_model_families.py](src/compare_model_families.py) saves scores, key-aligned probabilities, settings, calibration, and diagnostics under data/processed/model-family-comparison/. Other pooled gate/TabM votes used three seeds. Compare matching seeds, features, and history policies.

Fully separate training was requested after the initial pooled comparisons. Original compare_shot_type_models.py and expanded route comparisons predate the fully separate defender-history correction.

### Fully separate models, pruning, gates, and GRUs

- The initial fully separate best was CatBoost + Histogram + gated TabM for twos, loss 0.649954, and the three-tree vote for threes, loss 0.636782. Combined loss was 0.646468.
- Half-capacity testing changed Histogram maximum leaves 24→12 and XGBoost/CatBoost depth 4→3. These were newly fitted smaller trees. The experiment did not remove branches from saved trees.
- Smaller Histogram improved standalone scores on both types. Smaller CatBoost worsened both. Smaller XGBoost improved threes marginally and worsened twos.
- Replacing only Histogram in blends gave three-point three-tree vote loss 0.636748. The two TabM blends worsened slightly.
- The SE-inspired gate learns per-shot weights for geometry, timing/ball handling, and player history. Effects were small and seed-dependent.
- GRUs used 16 hidden units and 10/20 previous same-type shots, alongside a current-context probability head. Standalone GRUs lost to the leading trees. Some GRU votes improved other neural votes.
- The most useful discovery was adding recent same-type summaries to the 12-leaf Histogram model.

Scripts and tables preserve the experiment lineage. See compare_tree_extensions.py, compare_tabm_gate.py, compare_shot_type_routes.py, compare_fully_separate_shot_types.py, compare_tree_pruning.py, compare_histogram_blends.py, and compare_gru_history.py. Most outputs are under data/processed/shot-type-comparison/. Filenames distinguish the historical policies.

### Full 50-epoch / patience-10 retraining

[src/retrain_main_models.py](src/retrain_main_models.py) retrained main families and recent-summary variants. Neural models used three seeds, a 50-epoch cap, patience 10, clipping norm 2.0. Tree rounds and Bayesian sampling retained selected settings.

| Standalone model | 2PT loss | 3PT loss |
| --- | ---: | ---: |
| Logistic regression | 0.661930 | 0.641643 |
| Bayesian logistic | 0.657848 | 0.638196 |
| CatBoost | 0.651119 | 0.637868 |
| XGBoost | 0.650331 | 0.637090 |
| Histogram, 24 leaves | 0.651032 | 0.639979 |
| Histogram, 12 leaves | 0.650362 | 0.638804 |
| CatBoost + last-10 summaries | 0.650087 | 0.636284 |
| Histogram + last-10 summaries | 0.650189 | 0.635630 |
| TabM | 0.652727 | 0.638394 |
| Gated TabM | 0.652534 | 0.638505 |
| GRU, last 10 | 0.654116 | 0.638444 |
| GRU, last 20 | 0.654099 | 0.638383 |

Neural rows are mean scores across three independent seeds.

The best equal-weight vote averages CatBoost + last-10 summaries and 12-leaf Histogram + last-10 summaries. It scores 0.649598 on twos, 0.635205 on threes, and 0.645789 overall. Overall Brier is 0.227797, accuracy is 62.37%, AUC is 0.64558, and ten-bin calibration error is 1.48 percentage points.

Individual neural runs stopped after 19–39 epochs, with best epochs 9–29. Clipping activated on 0 of 31,830 steps; maximum norm was 0.32. Those gradient figures belong to this retraining experiment.

Artifacts under data/processed/retraining-50-10/ are january-scores.csv, january-predictions.csv, training.csv, and settings.json. Vote recent-summary trees is the leading probability column. The saved settings enumerate the equal-weight ensembles.

### Genetic programming feature search

[src/search_genetic_features.py](src/search_genetic_features.py) searched subsets and formulas around fixed 12-leaf Histogram. Population 40, generations 15, two elites, tournament size four, up to three formulas of depth at most three. Operations are addition, subtraction, multiplication, protected division, and log1p(abs(x)). Fitness adds small column/node complexity penalties to attempt-weighted chronological log loss.

Internal fitness trained before November 16 and validated November 16–30, then trained before December 1 and validated December. Genetic and random search each evaluated 572 distinct candidates per shot type. Across both types and methods, 2,288 candidate records were saved. The evolving selections used pre-January fitness; their fixed history weights came from earlier January experiments.

| January model | 2PT loss | 3PT loss |
| --- | ---: | ---: |
| Matched last-10 Histogram baseline | 0.650293 | 0.635855 |
| Genetic winner | 0.649905 | 0.636196 |
| Random winner | 0.650136 | 0.636635 |

The genetic two-point winner retained 33 raw inputs and three expressions. Its improvement's bootstrap interval crossed zero. The three-point internal fitness gain failed to carry into January. The recent-summary soft vote still leads.

This script computes recent averages from available historical values, then fills missing averages using training-only medians. Earlier summary scripts filled missing historical values first. This explains the slightly different matched baseline.

Outputs under data/processed/genetic-search/ include selected-features.json, trials-2pt.json, trials-3pt.json, generation tables, January scores, and probabilities. Expressions can be inspected directly in the JSON.

### Latest experiment — contrastive objectives

[src/compare_contrastive_models.py](src/compare_contrastive_models.py) ran 30 fits across five objectives, two shot types, and three seeds. Inputs and encoder were matched across objectives, with 50 maximum epochs, patience 10, and clipping norm 2.0.

Encoder widths 128/64 with LayerNorm/ReLU, probability head with dropout 0.1, and projection head to normalized 32-dimensional embeddings. Inputs are context, same-type histories, last-10 summaries, and missing indicators. The probability head predicts from clean inputs.

InfoNCE uses two masked views of the same shot, grouped masking probability 0.1, explicit mask indicators, batch negatives, and temperature 0.2. Related history fields are masked together. Triplet loss uses random same-outcome positives and semi-hard opposite-outcome negatives within training batches. Mining uses normalized squared-distance margin 0.2 after five BCE-only warmup epochs. Auxiliary weights 0.01/0.05 were tested.

| Mean standalone score across seeds | 2PT loss | 3PT loss |
| --- | ---: | ---: |
| BCE only | 0.655844 | 0.639396 |
| BCE + InfoNCE 0.01 | 0.655822 | 0.639500 |
| BCE + InfoNCE 0.05 | 0.655386 | 0.639221 |
| BCE + triplet 0.01 | 0.655844 | 0.639396 |
| BCE + triplet 0.05 | 0.655828 | 0.639396 |

Soft votes average the three neural seeds first, then equally average that prediction with the two recent-summary tree predictions.

| Soft vote | 2PT loss | 3PT loss |
| --- | ---: | ---: |
| Existing recent-summary tree vote | 0.649598 | 0.635205 |
| Trees + BCE | 0.649868 | 0.635383 |
| Trees + InfoNCE 0.05 | 0.649737 | 0.635404 |
| Trees + triplet 0.05 | 0.649806 | 0.635383 |

InfoNCE modestly improved the matched neural encoder. Eleven of twelve triplet runs selected checkpoints within the BCE warmup. Mining was active later but generally failed to improve January. Clipping activated on 0 of 30,339 steps; maximum norm was 1.39.

Artifacts under data/processed/contrastive-comparison/ are january-scores.csv, january-predictions.csv, training.json, and settings.json. All 52 score rows, 30 training records, and votes were verified against saved probabilities.

## Settings, interpretation, and limitations

- Histogram uses 150 iterations, learning rate 0.05, seed 42, early_stopping=False, and 24 or 12 leaves as named.
- XGBoost uses 150 rounds, depth four, learning rate 0.05, histogram construction, seed 42, n_jobs=2.
- CatBoost uses 463 rounds, depth four, learning rate 0.05, seed 42, one_hot_max_size=16. Initial pooled screening used January early stopping across depths 4/6/8. Later specialist comparisons fixed the chosen configuration.
- TabM uses width 128, two blocks, eight members, dropout 0.1, AdamW learning rate 0.002, and batch size 1,024.
- GRU uses 16 hidden units, a 32-unit context head, AdamW learning rate 0.001 and weight decay 0.0001, and batches of 512.
- Bayesian logistic uses shooter/closest-defender partial pooling, distance splines, and four Pólya–Gamma Gibbs chains with 750 warmup plus 1,000 retained draws each. It replaces engineered player histories with fitted effects. Player effects stay fixed in January, unlike rolling histories in other models.
- Fully separate Bayesian maximum R-hat was approximately 1.0126 for twos and 1.0261 for threes. Convergence diagnostics are incomplete for a definitive Bayesian comparison.
- History strengths and many hyperparameters were selected in pooled experiments and reused. Fully separate models have not received exhaustive independent tuning.
- January has been used repeatedly for development. Small gains and game-bootstrap intervals are exploratory. These intervals do not adjust for model-selection multiplicity or every cross-game dependence.
- Accuracy uses threshold 0.5. Calibration error uses ten equal-width probability bins weighted by shot count. A nearly constant league rate can score well on this calibration metric while providing little ranking ability. Log loss and Brier remain important.
- Development scripts mostly save probabilities, metrics, and settings. The final runner additionally persists the six fitted estimators and their preprocessing in models/final-shot-quality.joblib and verifies that reloaded probabilities reproduce the scored predictions.

## Reproduction and local environment

Run PowerShell from C:/GitHub/NBA-Shot-Quality. Python 3.11.9 is available. The [final evaluation](docs/final-evaluation.md) uses requirements-final.txt. The older experiments use extra dependencies installed locally under data/processed/model-selection/dependencies.

Set PYTHONPATH before running experiments.

    $env:PYTHONPATH = (Resolve-Path 'data/processed/model-selection/dependencies').Path
    python -u src/retrain_main_models.py
    python -u src/search_genetic_features.py
    python -u src/compare_contrastive_models.py
    python -u src/compare_shot_family_models.py
    python -u src/compare_play_by_play_context.py

The first command writes data/processed/retraining-50-10/. Genetic search writes data/processed/genetic-search/. Contrastive training reads retraining probabilities as its reference and writes data/processed/contrastive-comparison/. These are substantial CPU runs. Read existing results first when a request only needs analysis.

Verified versions were NumPy 2.2.6, pandas 2.2.3, SciPy 1.15.3, scikit-learn 1.6.1, Matplotlib 3.10.3, PyTorch 2.14.0, XGBoost 3.2.0, CatBoost 1.2.10, TabM 0.0.3, polyagamma 2.0.2, and rtdl_num_embeddings 0.0.12. This machine has an eight-core/16-thread Ryzen CPU. Training used CPU execution.

Additional entry points under src/ preserve older experiments. Match code, settings, seed, history policy, and output directory before comparing scores.

## Final evaluation

The historical evaluation is complete. The [report](docs/final-evaluation.md) records the frozen protocol, reproduction commands, and artifact links. The January replay reproduced both saved prediction columns before the final runner refitted on October–January. The finished report covers retrospective prediction with archived inputs. Publication rights and live input availability remain separate considerations.

## Workspace state

The local Git snapshot includes project source, tests, documentation, and notebooks.

Raw data, processed outputs, and most model artifacts are Git-ignored and may be absent in a fresh checkout. Consult .gitignore before assuming local artifacts travel with Git. This handoff refers to outputs currently present in the workspace.
