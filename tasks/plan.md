# NBA Shot Quality coaching frontend implementation plan

Build a historical coaching workspace around one versioned shot dataset. Deliver a working Player Shot Lab first, then the internal Scout Brief and Action Comparison Board, then external brief access and the historical pilot. The [frontend specification](../docs/coaching-frontend-spec.md) defines product behavior. The [task checklist](todo.md) holds the ordered work, direct dependencies, acceptance criteria, and verification steps.

## Architecture decisions

- Build one React and TypeScript application with server-side routes under `frontend/`. Use Next.js App Router and npm as the scaffold defaults. Store application data in PostgreSQL. Use managed email verification for workspace staff and external recipients. Choose hosting and identity providers during Task 01, based on a supported deployment runtime, PostgreSQL connectivity, verified email claims, and separate staging and pilot environments.
- Reuse the Python modeling artifacts and play-by-play matcher to produce a versioned offline snapshot. Use the three cleaned splits for observed outcomes and the saved final holdout export for model probabilities. Normalize the 10-character game ID and join by game, player, and shot number. Stage and reconcile each import before activation. The frontend uses saved probabilities with no runtime model loading or upstream data fetches. [Reproduction guide](../docs/reproduction.md)
- Put date resolution, filtering, metric aggregation, and evidence scope on the server. Return observed and scored attempt counts independently. For mixed date ranges, show expected metrics over the scored subset and use that same subset for any displayed observed-versus-expected difference. Apply the spec's initial threshold of fewer than 20 contributing attempts and retain small-sample results. Keep shot detail and accessibility behavior consistent across all three views.
- Store drafts with an owner and a save revision. Publishing a brief freezes its dataset version, filter definitions, metrics, and shot membership. A recipient grant applies to one published version and verified email. External filtering and sorting operate within the frozen membership set. Publish one active action label per workspace and shot through a transaction, retaining tag history and protecting explicit replacements with a revision check.
- Keep local historical artifacts outside Git and deployment bundles. Use synthetic data for hosted verification while historical permissions are pending. Record archival permission separately for invited staff and named recipients. Activate only the release surface with documented clearance for its audience. [Data-source audit](../docs/data-sources.md)

## Delivery order

| Checkpoint | Tasks | Demonstrable outcome |
| --- | --- | --- |
| A | 01–03 | Release dependencies are visible, the historical export reconciles, and the web shell passes its checks. |
| B | 04–06 | A locally imported snapshot produces consistent metrics, an evidence list, and individual shot detail. |
| C | 07–09 | Desktop and landscape tablet users can complete all Shot Lab comparisons on historical data. |
| D | 10–12 | Invited staff can sign in and inspect suggestions for a historical pregame target. |
| E | 13–15 | Staff can build and publish a versioned brief from either scouting mode. |
| F | 16–18 | Staff can compare tagged actions, create a private label draft, and publish an initial shared label. |
| G | 19–21 | Staff can resolve conflicting labels and share a published brief with a verified recipient. |
| H | 22–24 | External evidence is filterable within the published set, and the Action Board can load verified starter tags when available. |
| I | 25–26 | The hosted synthetic demo passes cross-account, privacy, and device checks. |
| J | 27–29 | The independent staff review records decisions made from historical evidence. Historical external sharing is enabled only after its separate clearance. |

### Dependencies and parallel work

- Start provider selection, permission checks, and sourcing for starter tags in Task 01. Record their status and owners. Local scaffolding and archive reconciliation can proceed while those decisions are pending. Managed sign-in and hosting require provider selection. Tasks 27–28 cover the invited historical release and staff pilot. Task 29 covers the separate historical recipient release and can wait for clearance independently of the staff review.
- Once the evidence contract is verified through Task 06, Shot Lab UI work and identity setup can proceed independently. After Task 11, the Scout Brief and Action Board can proceed on separate branches. Coordinate migrations and shared metric or identity changes before merging those branches.
- Start the starter-labeling pass after shot identities are known and a source is available. Action Board development and hosted verification can use fixtures in parallel. Recipient access work depends on published brief versions and shared identity, and can proceed independently of action-tag conflict handling.
- Activate dataset versions and apply database migrations in sequence. Keep previous dataset versions available when referenced by published evidence. If import verification fails, leave the previous version active. If a historical surface needs to be withdrawn, disable its access and verify the same URLs return a permission-safe response.

## Verification and release gates

- Every task clears its own checks and leaves the current application slice usable. Task 03 provides `npm run typecheck`, `npm run lint`, `npm run test:unit`, and `npm run build`. Add `npm run test:integration` with the first database slice and `npm run test:e2e` with the first browser workflow. From the repo root use `npm --prefix frontend run <script>`. Checkpoints run the commands available by that point plus the listed focused checks.
- Use an isolated Python 3.11 environment with `requirements-final.txt` for research regressions. In the previous check, the four play-by-play tests passed and the final-evaluation module could not import because CatBoost was absent from the active interpreter. Task 01 rechecks this in the pinned environment. The export consumes saved scores, so rerunning model training is unnecessary for the frontend plan. [Research verification commands](../docs/reproduction.md#3-verify)
- Use controlled fixtures for chronology, mixed shot values, date-window coverage, missing coordinates and clocks, team changes, sparse samples, concurrency, and access. Reconcile the real snapshot against the modeling manifest and frozen evaluation. Confirm the current archive has 128,069 observed attempts, 26,072 scored attempts, 25,960 scored attempts with coordinates, and 941 scored attempts without a recorded shot clock. [Modeling dataset](../docs/modeling-dataset.md) · [Final evaluation](../docs/final-evaluation.md)
- Review the working slice at each checkpoint. Release the historical pilot only after the corresponding permission and source checks, deployment smoke tests, and owner review. The first review requires a scouting assistant and a development coach to complete their workflows independently and point to the evidence behind a decision. Also verify a staff-published tag correction from a second device. Full possession replay and hypothetical scoring remain future concepts.

## Risks and decisions to close

| Risk or decision | How the plan handles it |
| --- | --- |
| Historical sharing permission is unverified | Track separate decisions for invited workspace use and external evidence access. Synthetic staging remains available while either decision is pending. |
| Verified starter tags require an appropriate source | Record the source, reviewer, action definitions, and matching procedure early. Import only resolved examples for at least two verified action types. |
| Model coverage and archive coverage differ | Reconcile counts at import and enforce a separate expected-metric denominator throughout the app. Keep older observed games useful for pregame scouting. |
| Shared edits or grants can expose the wrong revision | Require an explicit version on conflicting tag replacement. Bind recipient access to an immutable brief version and a verified recipient identity. Test direct URLs and revocation. |
| Provider selection is open | Record the hosting and email providers before the shared deployment work. The web scaffold and local synthetic development use the architecture defaults above. |
