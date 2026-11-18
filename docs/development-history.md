# Development history

The project started with a basketball question. How much does the context of a particular shot tell us about its make probability beyond what we already know about the shooter? The clearest progress came from adding useful context to compact tree models. More complex architectures yielded smaller or inconsistent gains.

## 1. Establish the data and evaluation

The archive has 128,069 shots from 904 games in part of the 2014–15 season. Its key advantage is shot-level closest-defender distance. Three notebooks established row identity, investigated unusual tracking values, and explored how basket distance, defender distance, and player history interact. The model uses completed game dates for historical features. October–December was used to fit candidates, January to compare them, and February 1–March 4 for the final evaluation. [Data source audit](data-sources.md) · [Dataset splits and cleaning](modeling-dataset.md)

A separate audit tested reconstructing missing shot clocks from event sequences. Its rules produced estimates for 558 of 4,626 missing development readings. On the 580 masked controls they could estimate, the mean absolute error was 1.44 seconds. When estimates were used only during training, January loss moved by about +0.00031 for Histogram Gradient Boosting and +0.00014 for XGBoost, with almost no change for logistic regression. The final model uses measured clocks with a late-period fallback. This policy also avoids depending on the outcome-assisted matching used by the retrospective audit. [Clock reconstruction](shot-clock-reconstruction.md) · [Model-selection comparison](../src/select_model.py)

## 2. Establish baselines and compare tracking models

January log loss is the primary development metric. Smaller is better. A prediction incurs more loss when it assigns a low probability to the outcome that occurs.

| January baseline | Log loss |
| --- | ---: |
| Rolling league average | 0.68804 |
| Smoothed shooter history | 0.68403 |
| Shooter history and shot context | 0.66104 |

In the early context comparison, loss was 0.66646 with neither defender distance nor shot clock, 0.66104 with defender distance, 0.66486 with shot clock, and 0.65997 with both. Later comparisons added defender history from earlier-date make residuals. [Baseline runner](../src/fit_baselines.py) · [Feature comparison](../src/compare_features.py)

| Pooled January model | Log loss |
| --- | ---: |
| CatBoost | 0.64657 |
| Histogram Gradient Boosting | 0.64676 |
| XGBoost | 0.64701 |
| TabM | 0.64871 |
| Hierarchical Bayesian logistic | 0.65257 |
| Equal-weight vote of three trees | 0.64621 |

The Bayesian model estimated partially pooled shooter and closest-defender effects with distance splines. Its player effects stayed fixed in January, while the engineered histories updated on completed dates. Its convergence checks warranted caution for the separate three-point fit. [Model-family comparison](../src/compare_model_families.py) · [Bayesian implementation](../src/bayesian_shot_model.py)

## 3. Specialize by shot value and test model complexity

Early routing experiments used same-value shooter histories with pooled defender history. Later experiments separated the models and rebuilt all league, shooter, and defender histories by shot value. This let twos and threes learn different relationships among distance, defensive pressure, and shooting history. [Routing experiments](../src/compare_shot_type_routes.py) · [Fully separate comparison](../src/compare_fully_separate_shot_types.py)

- Reducing Histogram Gradient Boosting from 24 to 12 leaves improved its standalone January loss for both shot values. Smaller CatBoost models performed worse, and the effect for smaller XGBoost trees was mixed. [Capacity comparison](../src/compare_tree_pruning.py) · [Blend comparison](../src/compare_histogram_blends.py)
- Feature gates for TabM produced small, seed-dependent changes. A gated model learns how much weight to give geometry, ball handling, and player history for each prediction. GRUs, which process earlier attempts as a sequence, trailed the leading trees as standalone models. The simple averages from the last ten same-value attempts proved more useful. [Feature gates](../src/compare_tabm_gate.py) · [GRU comparison](../src/compare_gru_history.py)
- In the final tracking-only comparison, the equal-weight vote of CatBoost and 12-leaf Histogram, both with last-ten-shot summaries, scored **0.64579** overall, **0.64960** for twos, and **0.63520** for threes. It became the tracking baseline and the fallback for shots without enriched context. [Retraining comparison](../src/retrain_main_models.py)
- Genetic feature search used two earlier-date validation windows before January and compared against an equally sized random search. The 2PT genetic winner improved its matched loss from 0.65029 to 0.64990, with an interval crossing zero. The 3PT winner worsened from 0.63585 to 0.63620. [Feature search](../src/search_genetic_features.py)
- Contrastive training tested InfoNCE and triplet auxiliary losses alongside binary cross-entropy. The stronger InfoNCE setting modestly improved the matched neural model, while adding it to the tree vote worsened both shot types. Most triplet runs selected checkpoints from their binary-cross-entropy warmup. [Contrastive comparison](../src/compare_contrastive_models.py)

## 4. Diagnose the errors and improve the inputs

The full-January tracking vote projected 46.25% makes, compared with 44.92% observed. A chronological bias correction improved log loss by only 0.00023, with uncertainty spanning zero. On 5,515 ordinary threes from 22 to under 26 ft with at least eight seconds on the model clock, AUC was 0.548. That slice exposed a bigger limitation than average calibration. The model had little power to rank comparable threes.

The play-by-play cache supplied court coordinates and scorer labels such as dunk, layup, and pull-up. A comparison on 23,014 linked January twos improved Histogram loss from 0.64641 with tracking to 0.62765 with coordinates and broad family. Linking by shot order in eligible ambiguous sequences later increased January coverage from 31,608 to 32,734 shots. Make or miss was used afterward to check the links. [Linking implementation](../src/play_by_play_context.py) · [Shot-family comparison](../src/compare_shot_family_models.py)

| January variant on the improved join | 2PT loss, 24,060 shots | 3PT loss, 8,674 shots |
| --- | ---: | ---: |
| Tracking inputs | 0.64965 | 0.63824 |
| Coordinates | 0.63379 | 0.63665 |
| Coordinates and detailed shot family | 0.61558 | 0.63305 |
| Separate models per family with a shared fallback | 0.62021 | 0.63745 |

A detailed family label in each shot-value model performed better than splitting the training sample again. Generic jump shots still accounted for 8,132 of the 8,674 linked threes. A quick-release proxy based on touch time and dribbles failed to improve three-point loss. Same-family shooter history gave twos a small, uncertain gain and slightly worsened threes, so it was retained for twos.

## 5. Add game context and freeze the final model

The last January comparison measured each feature group against the existing enriched model on the same 32,734 linked shots. [Play-by-play comparison](../src/compare_play_by_play_context.py)

| Added feature group | 2PT log loss | 3PT log loss |
| --- | ---: | ---: |
| Existing enriched model | 0.61500 | 0.63305 |
| Second chance and transition | 0.61486 | 0.63285 |
| Court zones and finer shot details | 0.60139 | 0.63260 |
| Score before release | 0.61505 | 0.63242 |
| Opponent and time on court | 0.61454 | 0.63296 |
| All four groups | 0.60069 | 0.63235 |

The four groups together improved overall loss from **0.61978 to 0.60908**. Court zones and finer shot details accounted for most of the two-point gain. The three-point change remained uncertain. Five-point calibration error rose from 1.52 to 1.79 percentage points, with the interval for the change crossing zero.

The selected policy keeps separate 2PT and 3PT enriched Histogram models and uses the tracking vote for unmatched shots. After freezing that policy, the models were refitted on October–January and evaluated on the reserved games. The final runner reproduced the January predictions before scoring the holdout. January was used repeatedly to guide choices, so the February–March results carry the main evidence of generalization. [Model design](model-design.md) · [Final evaluation](final-evaluation.md)

## Experiment settings and comparison limits

- Most tree and neural comparisons reused the earlier selected history weights. Histogram, CatBoost, TabM, and GRU used shooter and defender weights of 150 and 50 attempts. XGBoost used 15 and 150, and selected logistic used 500 and 5,000. [Tree settings and model selection](../src/select_model.py)
- The main neural retraining used three seeds, up to 50 epochs, early-stopping patience of 10, and gradient clipping at norm 2.0. Compare the mean loss over independent seeds with other mean losses. An ensemble instead averages probabilities before computing loss. [Retraining implementation](../src/retrain_main_models.py)
- The Bayesian comparison used four Pólya–Gamma Gibbs chains with 750 warmup and 1,000 retained draws per chain. Maximum split R-hat was about 1.013 for twos and 1.026 for threes, so the three-point posterior diagnostics were less convincing. [Bayesian implementation](../src/bayesian_shot_model.py)
- The genetic and random searches each evaluated 572 candidates per shot value. Genetic search used a population of 40 over 15 generations, with penalties for feature count and expression size. Its missing-value policy differed from earlier recent-summary runs, so the matched baseline is the relevant comparison. [Feature-search implementation](../src/search_genetic_features.py)
- The contrastive comparison used the same two-layer encoder across five objectives, two shot values, and three seeds. InfoNCE used masked views of the same shot. Triplet loss used same-outcome positives and semi-hard opposite-outcome negatives after a five-epoch warmup with binary cross-entropy. [Contrastive implementation](../src/compare_contrastive_models.py)
