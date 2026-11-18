# Shot-clock reconstruction audit

This audit investigates blank `SHOT_CLOCK` values in the 2014–15 shot log before February 1. Across 702 official NBA game responses, the play-by-play action records contained the period clock and event sequence. None contained a shot-clock field. The raw shot log remains the source for measured values. [Example NBA play-by-play](https://www.nba.com/game/lal-vs-sas-0021400339/play-by-play)

## Run locally

```powershell
python src/reconstruct_shot_clock.py data/raw/shot_logs.csv --fetch
```

The script caches official responses by game in `data/raw/nba-play-by-play-v3/`. Omit `--fetch` to rerun from the cache. Reports go to the Git-ignored `data/processed/shot-clock-review/` folder. They include the original value, NBA event ID, preceding events, classification and reason, any estimate, masked controls, and a small review queue.

## Matching and reconstruction

Match by game, shooter, period, shot value, result, and period clocks within six seconds. Require a unique match in both directions. The result helps identify the archived attempt and is used only for retrospective record linkage. Both timestamps in the estimate come from the official feed.

- **Estimated.** The shot immediately follows a defensive rebound paired with an opponent's miss, a steal paired with the opposing turnover, or an opponent's made field goal strictly inside the stopped-clock window. Estimate the remaining clock as 24 seconds minus elapsed game time. The time the NBA logs a shot can differ from the time it was released. [NBA timing rules](https://official.nba.com/rule-no-5-scoring-and-timing/) · [2015–16 NBA rulebook, Rules 5 and 7](https://ak-static-int.nba.com/wp-content/uploads/sites/3/2015/12/2015-16-NBA-Rule-Book.pdf)
- **Likely off.** A qualifying change of possession happened with 24 seconds or less left in the period. The numeric clock stays blank.
- **Unresolved.** The event match is uncertain, the cached game is unavailable, or the preceding sequence falls outside the automated rules. Fouls, inbound timing, offensive rebounds and rim contact can complicate reconstruction.

The clock-off rule is documented in the adjacent-season rulebook. The 2018 change from a 24-second reset to a 14-second reset after offensive rebounds illustrates why historical rules matter when expanding coverage. [2015–16 NBA rulebook, Rule 7](https://ak-static-int.nba.com/wp-content/uploads/sites/3/2015/12/2015-16-NBA-Rule-Book.pdf) · [NBA 2018 rule changes](https://www.nba.com/news/nba-board-governors-approves-rule-changes)

## Masked validation

The script randomly selects up to 2,000 January attempts with a recorded shot clock in games that also have a blank. Matching and reconstruction use the same rules as for the missing rows, and the recorded values are compared only after estimating. The error metrics apply to the subset the rules could estimate. February and later games are excluded.

## Results

All 702 games were available. The matcher linked 4,530 of 4,626 blanks to unique NBA events. Of the 96 unmatched attempts, 71 had an ambiguous match and 25 had no candidate.

| Classification | Attempts |
| --- | ---: |
| Estimated | 558 |
| Likely off | 1,150 |
| Unresolved | 2,918 |

The rules estimated 580 of the 2,000 masked January controls. Mean absolute error was 1.44 seconds, median absolute error was 1.20 seconds, and the 90th percentile absolute error was 2.60 seconds. Estimates averaged 1.18 seconds below the recorded values. No control with a recorded clock was classified as likely off. That check shows how the rule behaved on recorded clocks. It cannot confirm the clock display on blank attempts.

| Rule | Blank estimates | Control estimates | Control mean absolute error |
| --- | ---: | ---: | ---: |
| Defensive rebound | 429 | 428 | 1.33 s |
| Opponent make within the stopped-clock window | 30 | 28 | 1.70 s |
| Paired live-ball steal | 99 | 124 | 1.76 s |

## Manual review

Three reviewers checked eight matched, unresolved attempts from the first partial run. They identified the paired-steal and stopped-clock patterns. The final rules reproduce the Jordan Hill estimate of 14.0 seconds and the Kobe Bryant estimate of 11.8 seconds. Ginobili's attempt following a basket logged at exactly 1:00 stays unresolved at the timing boundary. [Lakers at Spurs, December 12](https://www.nba.com/game/lal-vs-sas-0021400339/play-by-play)

The other Bryant attempt would have about 7 seconds left if the preceding offensive rebound reset the clock. Sacre's putback could have been taken with the clock off or near expiration depending on rim contact. Both stay unresolved. The reviewers also flagged possible clock-off sequences for Monta Ellis, C.J. Watson, and Channing Frye involving a team rebound with an intervening block event, a defensive foul, and a final made free throw respectively. Those three were kept outside the automated rules. [Lakers at Spurs](https://www.nba.com/game/lal-vs-sas-0021400339/play-by-play) · [Kings at Lakers](https://www.nba.com/game/sac-vs-lal-0021400315/play-by-play) · [NBA rim-contact explanation](https://official.nba.com/trigger/24-second-shot-clock-reset/)

Keep the original blank values in the modeling baseline. The estimates and likely-off labels are stored separately for a future January validation comparison.
