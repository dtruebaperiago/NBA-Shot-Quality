# Shot Quality frontend

From the repository root, install dependencies and open the local preview.

```powershell
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run dev
```

Open [the local workspace](http://127.0.0.1:3000). Use Node 22.18 or later. Use the historical files in `frontend/.local/` for all four tabs. Scout Brief drafts, brief previews, and the shared scouting team selection are stored in the current browser.

To prepare the 2014–15 archive for the app, follow the [reproduction guide](../docs/reproduction.md), then export the archive and import player metadata before starting the app.

```powershell
python -B frontend/scripts/export-local-preview.py
python -B frontend/scripts/import-player-seasons.py
npm.cmd --prefix frontend run dev
```

The export includes the full tracked archive of 128,069 attempts by 281 players across all 30 teams and 904 games from October 28, 2014 through March 4, 2015. Team rosters reflect the players and teams recorded in the archive. The exporter uses the saved final model to score 101,997 earlier attempts retrospectively, checks that the same scoring path reproduces the 26,072 saved holdout predictions, and preserves the published holdout probabilities. The model view offers both Full archive and Holdout only. The earlier games were used when fitting the model. Use the holdout to assess performance on unseen games. Development and production load the same historical snapshot. Git ignores the local archive files. Restart the local development server after refreshing them.

Player Finder flags shooting situations where the selected team trails the archive by two percentage points or more in actual FG% or shot share. Select a need to rank outside players on the same shot context, or use Player search to build a custom query. Candidate and benchmark rows show attempts, actual and expected efficiency, and the actual PPS difference from the team. The FG% gap uses matched scored shots. The latest tracked team determines whether a player is external, and outside searches exclude shots they took for your team.

Pregame player suggestions use each player's latest tracked team before the target date. Targets during the model fitting period use observed rates and volume to rank findings. Published shot evidence is tied to the exact archive version. Brief text remains readable when its original evidence version is unavailable.

Shot Lab can benchmark against the selected player’s position group or a chosen group. Click a grouped court bin or choose it in the Benchmark bin menu to step through its shots with the Shot details arrows. Guards are PG and SG, wings/forwards are SF and PF, and centers are C. The benchmark excludes the selected player and uses tracked attempts within the current filters. The Shot Quality Model’s Expected FG range view ranks scored attempts within both entered endpoints. Sort by makes, attempts, or actual FG%.

Player sheets show tracked shooting and 2014–15 regular-season box-score totals through March 3, 2015, inclusive. The shot explorer uses the archive and the selected filters. The local import matches positions by name and team and joins dated NBA game logs to game box scores by NBA player and game IDs. It writes to the ignored `frontend/.local/` folder. The import accepts saved source files via `--html`, `--game-logs`, and `--box-scores`. Restart the development server after refreshing the local files. Historical sheets use NBA headshots when available. [Positions](https://www.basketball-reference.com/leagues/NBA_2015_totals.html) · [NBA game logs](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_game_logs) · [NBA box scores](https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_boxscores)

The workspace tabs remember filters and selections for the current browser session. Links to a specific Model or Shot Lab scope open that analysis. In shot details, select the shooter’s name to open their player sheet.

## Deploy to Vercel

1. Import the GitHub repository. Set the framework to Next.js and the root directory to `frontend`.
2. Connect a private Vercel Blob store to the project’s Production environment. Upload `archive.json` and `player-seasons.json` from `frontend/.local/` to the root of that store using their exact names.
3. Deploy from the production branch. The `npm run build` command downloads both files if they are absent and bundles them with the Next.js server. Open the project’s production URL to verify the 2014–15 archive and Player Finder.

## Design foundations

- **Surfaces.** Warm paper, ruled comparison sheets, evergreen navigation, and a dark measured court. `app/foundations.css` defines light and dark semantic colors, 4 px spacing steps, panel radii, and keyboard focus.
- **Type.** Barlow Condensed for headings, DM Sans for controls and prose, and IBM Plex Mono for scores and counts. Fonts are served with the app.
- **Evidence.** Circles mark makes and crosses mark misses. Look A uses green and red. Look B uses blue and amber. Shared attempts use both colors. Select a shot to replay its illustrative path in the rotatable 3D court or switch to the top-down chart. Large benchmarks use court bins and load individual shots one page at a time. Attempts beyond the chart depth start at its boundary. Basket distance uses original coordinates when available, with the tracking distance as a fallback.
- **Motion.** Data values count to new results across the workspace, the shared tab underline tracks selection, and Scout Brief findings animate when their order changes. Reduced-motion mode shows static trajectories and updates numbers immediately.

| Component | Use |
| --- | --- |
| `Button`, `SelectField`, `Segment` | Use one primary action per surface, native selects for named choices, and segments for short sets of mutually exclusive options. Use descriptive names for icon-only controls. |
| `PageHeader`, `PanelHeader`, `Badge`, `EmptyState` | Use headers for hierarchy and badges for meaningful states. Empty states describe a specific recovery action. |
| `CohortMetrics`, `ShotList`, `ShotDetails` | Keep observed and scored counts visible. Put the same evidence detail behind court marks, scouting findings, and player searches. |
| `Court`, `Dialog`, `EvidenceDialog` | Use the court for spatial comparison and the list for keyboard inspection. Native dialogs support Escape and return focus to the invoking control. |

Run `npm.cmd --prefix frontend run typecheck`, `lint`, `test:unit`, and `build` before submitting frontend changes.
