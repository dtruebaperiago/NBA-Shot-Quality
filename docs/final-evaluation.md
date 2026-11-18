# Final historical evaluation

## February–March 2015 results

The frozen pipeline scored all 26,072 reserved attempts across 194 games. Play-by-play linked 25,960 attempts (99.57%). The tracking-only fallback supplied the other 112 predictions, comprising 97 twos and 15 threes.

| Model | Log loss ↓ | Brier ↓ | ROC AUC ↑ | Accuracy at 50% ↑ | 5-point ECE ↓ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Final model with fallback | **0.60789** | **0.21100** | **0.70852** | **66.72%** | 1.64 pp |
| Tracking-only vote | 0.64293 | 0.22652 | 0.64836 | 62.45% | 1.72 pp |
| Same-type shooter history | 0.67801 | 0.24255 | 0.57255 | 56.09% | 1.13 pp |
| Same-type league history | 0.67940 | 0.24324 | 0.55395 | 55.47% | 0.76 pp |

| Attempts | Count | Final log loss | Tracking log loss | Final minus tracking, 95% game-bootstrap interval |
| --- | ---: | ---: | ---: | ---: |
| All | 26,072 | 0.60789 | 0.64293 | −0.04016 to −0.02996 |
| 2PT | 19,123 | 0.59939 | 0.64677 | −0.05397 to −0.04075 |
| 3PT | 6,949 | 0.63128 | 0.63236 | −0.00362 to +0.00148 |

The final model lowered log loss by 5.45% overall relative to the tracking vote. Twos account for most of the improvement. The three-point difference is small and its interval crosses zero. The bootstrap resamples whole games with both models evaluated on the same attempts. The league baseline's low ECE accompanies limited discrimination, reflected in its AUC and log loss.

| Closest defender distance | 2PT attempts | 3PT attempts |
| --- | ---: | ---: |
| Under 2 ft | 4,488 | 135 |
| 2 to under 4 ft | 8,309 | 1,246 |
| 4 to under 6 ft | 4,318 | 2,834 |
| 6 ft or more | 2,008 | 2,734 |

| Recorded shot family | 2PT attempts | 3PT attempts |
| --- | ---: | ---: |
| Dunk | 1,217 | 0 |
| Floater | 360 | 2 |
| Generic jump shot | 7,344 | 6,610 |
| Hook | 1,003 | 0 |
| Layup | 5,809 | 0 |
| Other jumper | 952 | 32 |
| Pull-up | 645 | 197 |
| Step-back | 295 | 81 |
| Tip | 513 | 0 |
| Turnaround or fadeaway | 888 | 12 |
| Family unavailable | 97 | 15 |

The final model placed only 19 threes at 60% or higher, so the calibration curve in that range is based on sparse bins. The [reproduction guide](reproduction.md#2-build-and-score) lists where to find the locally generated plot, metrics, calibration counts, and per-shot predictions.

This evaluates retrospective historical prediction through March 4, 2015. The enriched model uses historical scorer descriptions and archived shot coordinates. A live system would need equivalent inputs at release.

## Frozen policy

Fit separate 2PT and 3PT classifiers on October 28, 2014 through January 31, 2015. Score the 26,072 reserved attempts from February 1 through March 4, 2015. January is the development replay.

- Matched attempts use the enriched 12-leaf Histogram Gradient Boosting model with 150 iterations, learning rate 0.05, seed 42, and all four play-by-play feature groups. The 2PT model adds same-family shooter history. Both models use the latest 10 earlier-date attempts of the same shot value.
- Unmatched attempts use the equal-weight tracking-only Histogram and CatBoost vote. CatBoost uses depth 4, 463 iterations, learning rate 0.05, and seed 42. Both constituent models are fitted separately for twos and threes.
- Link play-by-play by game, shooter, period, shot value, and clock within six seconds. Resolve eligible ambiguous groups by order. Historical shot subtype comes from the scorer annotation. Match coverage determines the route.
- The shot-clock predictor uses the recorded clock with the late-period fallback. Context before release uses preceding events in source order. Shooter, defender, family, and opponent histories use strictly earlier dates and update between completed dates. Defender residuals follow the existing expanding-window logistic procedure. The fitted final trees and preprocessing stay fixed while scoring.
- Compare against the tracking vote on every shot, the earlier same-type league rate, and shooter history with its shrinkage selected on January. Report log loss, Brier, accuracy, ROC AUC, five-point Expected Calibration Error, and slice counts.

## Reading the metrics

Log loss is the primary score because each output is a probability. It penalizes placing very low probability on the eventual result. Brier score measures the mean squared difference between predicted probabilities and binary outcomes. ROC AUC measures how well scores rank makes above misses, and accuracy uses a 50% decision threshold.

Expected calibration error (ECE) averages the absolute gaps between mean predicted probability and observed make rate in fixed five-percentage-point bands, weighted by attempt count. Zero is ideal. ECE depends on the buckets and their sample sizes. A model can have low ECE with predictions concentrated near the league average, which is why the report gives log loss, AUC, and the calibration counts alongside it.

## Reproduce

Follow the [reproduction guide](reproduction.md) for commands and artifact locations. The [model design](model-design.md) lists all features and explains how an attempt routes to the enriched or tracking-only model.
