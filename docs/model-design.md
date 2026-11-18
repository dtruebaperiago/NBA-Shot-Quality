# Model design

The prediction is a probability between zero and one for the field-goal result, FGM. The archive supplies the shooter, defender distance, shot distance, and ball-handling context. NBA PlayByPlayV3 adds geometry, scorer annotations, and the events leading up to a linked shot.

~~~mermaid
flowchart LR
    A["Tracking shot log"] --> B["Clean shots and split by game date"]
    P["NBA PlayByPlayV3"] --> J["Link events by game, shooter, period, value, and clock"]
    B --> J
    B --> H["Histories through the previous completed date"]
    H --> R["Route by 2PT or 3PT"]
    J --> R
    R -->|Linked shot| E["Enriched Histogram Gradient Boosting"]
    R -->|Unmatched shot| T["Equal-weight tracking vote"]
    E --> M["Make probability"]
    T --> M
~~~

## Tracking features

Both prediction paths start with the same 19 tracking inputs. Twos and threes have separate models and separate histories. Shot value selects the model. Shooter and closest-defender IDs support history calculations.

| Feature group | Inputs |
| --- | --- |
| Current attempt | Cleaned basket distance, recorded closest-defender distance, cleaned touch time, dribbles, period, seconds left in the period, home or away, and the recorded shot clock with a late-period fallback. |
| Shooter history | Earlier same-value attempts and a make rate shrunk toward the earlier same-value league rate with a weight of 150 attempts. |
| Defender history | Earlier expected makes minus actual makes when that player was recorded as closest defender, divided by scored attempts plus 50. Expected makes come from expanding-window context fits using earlier dates. |
| Last ten attempts | Number of earlier same-value attempts available, make rate, average basket distance, average closest-defender distance, average shot clock, average touch time, average dribbles, and average log-days since those shots. |

The two-point and three-point opening percentages are 48.8% and 36.0%, from the 2013–14 NBA regular season. Later league rates use earlier archive attempts. A shooter with little history is pulled toward the league rate. Defender history describes an association with observed shots, since the archive identifies the nearest defender rather than assigning responsibility for the play. [History implementation](../src/shot_history.py) · [Opening priors, Table 1](https://doi.org/10.3390/ijerph20031924)

## Match the official events

The matcher uses game, shooter, period, shot value, and game clock within six seconds. It accepts a unique pair, or an ordered group with equal numbers of candidate shots and events where all pairings fit the clock window. Outcome agreement is checked after linkage. This differs from the separate missing-clock audit, where make or miss is part of retrospective linkage. [Event matching](../src/play_by_play_context.py) · [Shot-clock audit](shot-clock-reconstruction.md)

## Enrichment for linked shots

| Feature group | Inputs and source |
| --- | --- |
| Shot coordinates and family | Basket-centered X/Y from xLegacy and yLegacy, plus a grouped shot label from the scorer's subtype, such as dunk, layup, pull-up, or generic jump shot. |
| Court zone and shot detail | Rim, paint, outside-paint, corner-three, and above-the-break categories. Subtype flags cover driving, reverse, alley-oop, putback, running, bank, fadeaway, and turnaround. |
| Second chance and transition | Prior offensive or defensive rebound, paired live-ball steal, seconds since that event, and whether the shooter grabbed the rebound. Ambiguous sequences stay unknown. |
| Score context | The shooter's team margin before the shot and a late-close-game flag for a margin within five points in the final five minutes of regulation or in overtime. |
| Opponent and stint | Opponent team, opponent attempts allowed and shrunk make rate by court zone on earlier dates, and seconds on court in the current period. Stint source records a logged substitution, inferred period start, or unknown. The opponent history prior has a weight of 100 attempts. |
| Same-family shooter history | For twos only, earlier same-family attempt count and make rate shrunk toward the league's same-family rate with a weight of 50 attempts. |

The event state is captured before the current shot updates the score or possession. Historical player and opponent features advance only after a full date. Court zones are approximations. Scorer annotations and archived coordinates reflect what the historical feed records, which is relevant when interpreting the results as retrospective evaluation. [Context extraction](../src/play_by_play_context.py) · [Smoothed histories](../src/shot_history.py)

## Fit, route, and score

- **Linked shots.** Fit one Histogram Gradient Boosting model per shot value on linked development attempts. Each uses 150 iterations, a 12-leaf limit, a 0.05 learning rate, and seed 42.
- **Tracking fallback.** Fit tracking-only Histogram and CatBoost models per shot value on the full development sample. The tracking probability is the mean of the two make probabilities. CatBoost uses depth 4, 463 iterations, a 0.05 learning rate, and seed 42.
- **Preprocessing.** Histogram uses training medians for missing numeric values, scales numeric features, and one-hot encodes categories. CatBoost receives period and home or away as categorical fields.
- **Final replay.** Train through January 31 and keep the fitted models and preprocessing fixed during February–March. Each new day starts with histories from earlier dates. Every reserved attempt receives a prediction through the appropriate route.

The final evaluator saves the preprocessing and six fitted estimators, reloads the bundle, and verifies that it reproduces the scored probabilities. [Tree fitting](../src/tree_models.py) · [Final runner](../src/final_evaluation.py) · [Holdout results](final-evaluation.md)
