# NBA Shot Quality implementation checklist

Use the [implementation plan](plan.md) for architecture, release gates, and the shared verification commands. Task numbers show the default delivery order and the dependency links show work that can proceed independently. Verification commands for application tasks refer to scripts introduced in Tasks 03, 04, and 07.

## Task 01 — Record release dependencies and establish the Python baseline

- [ ] Task 01 complete

Record providers, historical release permissions, and starter-tag sourcing in a readiness ledger. Establish the research test baseline in isolated Python 3.11.

**Acceptance criteria**

- [ ] The ledger tracks separate decisions, status, and owners for invited archive access, external evidence access, and the starter source and reviewer.
- [ ] Record the hosting and verified-email provider choices, or an owner and pending decision for each. Synthetic local development can proceed while those decisions are pending.
- [ ] The existing Python test command runs with the pinned requirements, and any remaining failures are recorded with their cause.

**Verification**

- [ ] Run the PowerShell setup and verification steps in the reproduction guide. Review the ledger against the spec’s release dependencies.

**Dependencies** None.

**Files likely touched** `tasks/pilot-readiness.md`, a local Python environment.

**Estimated scope** Small.

## Task 02 — Export a reconciled historical shot snapshot

- [ ] Task 02 complete

Add an offline Python export that reuses the modeling snapshots and existing play-by-play matcher, preserves source flags, and writes versioned import inputs.

**Acceptance criteria**

- [ ] Join by normalized game ID, player ID, and shot number. Reject duplicate keys and unexpected or invalid model scores. Preserve unresolved context as missing.
- [ ] Resolve game-time shooter team and opponent from matchup and cached events. Keep clock provenance, court coordinates, shot family, and model route.
- [ ] Reconcile 128,069 observed attempts and 26,072 scored attempts, including 25,960 scored attempts with coordinates and 941 scored attempts missing a recorded clock.

**Verification**

- [ ] Run the exporter’s Python unit tests and a local full-archive export. Compare the manifest and aggregate totals to the source artifacts.

**Dependencies** None.

**Files likely touched** `src/export_frontend_snapshot.py`, `tests/test_frontend_snapshot.py`, ignored `data/processed/` output.

**Estimated scope** Medium.

## Task 03 — Bootstrap the frontend and its checks

- [ ] Task 03 complete

Create the React and TypeScript web shell under `frontend/` and establish repeatable local and CI-equivalent commands.

**Acceptance criteria**

- [ ] A clean install starts a shell with routes or navigation placeholders for the three coaching views. Pin dependencies and the supported Node version.
- [ ] Typecheck, lint, unit tests, and production build have documented npm scripts. Environment files and generated output are ignored.

**Verification**

- [ ] From the repo root run `npm --prefix frontend ci` followed by the four scripts listed in the plan. Open the local shell.

**Dependencies** None.

**Files likely touched** `frontend/package.json`, npm lockfile, `frontend/app/` shell, frontend tooling configuration, ignore rules.

**Estimated scope** Medium.

### Checkpoint A — Archive and application baseline

- [ ] Review the readiness ledger. Verify the local export against the archive and run the web checks.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 04 — Load an immutable dataset version

- [ ] Task 04 complete

Add the first PostgreSQL migration and transactional loader for datasets, games, players, and shots. Expose dataset version and counts in the local shell.

**Acceptance criteria**

- [ ] The loader handles synthetic fixtures and the exported historical snapshot. Validation failures leave the active version intact.
- [ ] Inputs are idempotent by version and source identity. An older version remains queryable after activation of a newer one.
- [ ] The local screen shows the active dataset label, date range, and observed and scored counts.

**Verification**

- [ ] Run `test:integration` against an isolated PostgreSQL database. Load the fixture twice, fail a load, then activate a new version and inspect both.

**Dependencies** [02](#task-02--export-a-reconciled-historical-shot-snapshot), [03](#task-03--bootstrap-the-frontend-and-its-checks)

**Files likely touched** `frontend/db/` migration and loader, local dataset status component, import test.

**Estimated scope** Medium.

## Task 05 — Query and list a shot cohort

- [ ] Task 05 complete

Deliver one end-to-end evidence query for eligible shots, metrics, coordinate coverage, and a paginated list.

**Acceptance criteria**

- [ ] The server validates supported date, subject, and shot filters and returns stable pagination and chart coverage for the same cohort.
- [ ] Observed and expected metrics use their own counts. Any displayed delta uses the scored subset on both sides. Missing, empty, and small samples follow the spec.
- [ ] A local view selects a player and date range and displays metrics and evidence from that query.

**Verification**

- [ ] Run unit and database integration tests for mixed twos and threes, date windows, sparse and empty cohorts, and stable paging. Compare one real cohort to a direct source calculation.

**Dependencies** [04](#task-04--load-an-immutable-dataset-version)

**Files likely touched** `frontend` cohort service and route, local evidence panel, metric and query tests.

**Estimated scope** Medium.

## Task 06 — Inspect an individual shot

- [ ] Task 06 complete

Open a reusable shot detail card from the accessible list without losing cohort state.

**Acceptance criteria**

- [ ] The card shows game, teams, player, period, clock, outcome, and available context with clock and model provenance.
- [ ] Opening and closing work with keyboard controls. Unknown fields remain visibly unknown and the evidence list retains selection state.

**Verification**

- [ ] Run the detail component test. Inspect a linked shot, a fallback shot, and a missing-clock example locally.

**Dependencies** [05](#task-05--query-and-list-a-shot-cohort)

**Files likely touched** `frontend` shot detail route and card, focused test.

**Estimated scope** Small.

### Checkpoint B — Local evidence

- [ ] Use an imported dataset to open a real cohort and a shot. Verify counts and detail provenance before extending the UI.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 07 — Plot eligible attempts on the court

- [ ] Task 07 complete

Add a half-court view driven by the evidence cohort and synchronized with the shot list.

**Acceptance criteria**

- [ ] Only attempts with coordinates are plotted. The plotted count and total eligible count are visible together.
- [ ] Selecting a point or list row opens the same detail and highlights the selection in both surfaces. The chart avoids thousands of focusable controls.
- [ ] The court and comparison affordances are legible on desktop and landscape tablet, with the list available by keyboard.

**Verification**

- [ ] Start the browser test script and verify a known plotted shot plus an unplottable attempt. Check a desktop and a landscape tablet viewport.

**Dependencies** [05](#task-05--query-and-list-a-shot-cohort), [06](#task-06--inspect-an-individual-shot)

**Files likely touched** `frontend` court, evidence selection state, browser test.

**Estimated scope** Medium.

## Task 08 — Compare two looks for one player

- [ ] Task 08 complete

Turn the local evidence view into the first complete Shot Lab workflow with one or two looks and independent shot filters per side.

**Acceptance criteria**

- [ ] Single-look mode uses one set of filters. Two looks share a player and date range while allowing independent shot value, zone, family, defender distance, and recorded clock filters.
- [ ] Both cohort definitions and aggregate counts remain visible in two-look mode. Staff can show either cohort or both in the evidence views, with shared attempts represented once.
- [ ] Changing one side preserves the other side and keeps empty or partially covered results understandable.

**Verification**

- [ ] Run a browser test with single, overlapping, and empty examples. Cross-check cohorts against the query service and verify that a shot list selection opens its court location.

**Dependencies** [07](#task-07--plot-eligible-attempts-on-the-court)

**Files likely touched** `frontend` Lab route, comparison state and filters, browser test.

**Estimated scope** Medium.

## Task 09 — Add matched player and benchmark comparisons

- [ ] Task 09 complete

Extend the Shot Lab with player-to-player and player-to-team or league modes.

**Acceptance criteria**

- [ ] Player-to-player and benchmark comparisons share dates and support shared or independent shot filters. The team benchmark uses game-time team membership, excluding the subject. Zone and shot type options follow the shot value in each filter group.
- [ ] The league benchmark excludes the subject and labels its archive scope. All modes use the same metric, court, and evidence behavior.

**Verification**

- [ ] Run integration and browser checks for all three alternatives, including different shot values for each player, a player changing teams, and a benchmark with no remaining shots.

**Dependencies** [08](#task-08--compare-two-looks-for-one-player)

**Files likely touched** `frontend` Lab mode controls and cohort subjects, focused integration and browser tests.

**Estimated scope** Medium.

### Checkpoint C — Player Shot Lab

- [ ] Demonstrate all comparison modes on desktop and landscape tablet and run the browser checks.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 10 — Sign in with a verified email identity

- [ ] Task 10 complete

Integrate the selected identity provider and establish a server-side verified email session shared by future staff and recipient routes.

**Acceptance criteria**

- [ ] A verified account can establish and end a session. The server derives identity from the provider and rejects absent or unverified identities.
- [ ] Local integration tests can use controlled verified and unverified sessions through a test harness that the hosted app cannot access.

**Verification**

- [ ] Exercise login and logout on a provider test tenant. Run integration checks for invalid sessions and verify protected-route responses.

**Dependencies** [01](#task-01--record-release-dependencies-and-establish-the-python-baseline), [03](#task-03--bootstrap-the-frontend-and-its-checks). Select the identity provider before starting this task.

**Files likely touched** `frontend` identity adapter, sign-in route and callback, session test.

**Estimated scope** Medium.

## Task 11 — Enter an invited staff workspace

- [ ] Task 11 complete

Create workspace membership and invitation controls, then gate workspace routes and their evidence endpoints.

**Acceptance criteria**

- [ ] An admin can manage invitations. A verified invitee can enter the workspace. Users outside the workspace cannot access its views or evidence by direct request.
- [ ] Membership authorization is checked on the server. Local historical testing uses a development route that is unavailable in the hosted build.

**Verification**

- [ ] Use admin, member, and non-member accounts in browser and direct request tests. Test a valid session against a second workspace.

**Dependencies** [05](#task-05--query-and-list-a-shot-cohort), [10](#task-10--sign-in-with-a-verified-email-identity)

**Files likely touched** `frontend` membership migration, workspace guard, invite controls, integration test.

**Estimated scope** Medium.

## Task 12 — Suggest evidence for a pregame brief

- [ ] Task 12 complete

Add a pregame workflow that selects a historical game and opponent and opens the shots supporting deterministic tendencies.

**Acceptance criteria**

- [ ] Every result uses only dates strictly before the target game, including evidence counts and links.
- [ ] Suggestions cover supported zones, shot families, and defender-distance bands for high-volume shooters. Ordering is deterministic and small samples remain visible.
- [ ] The earliest archive game shows a clear empty state. Suggestions open the exact evidence cohort.

**Verification**

- [ ] Run integration and browser checks with same-day and later shots, a February 1 target, a modeled later target, and the first archive date.

**Dependencies** [06](#task-06--inspect-an-individual-shot), [11](#task-11--enter-an-invited-staff-workspace)

**Files likely touched** `frontend` pregame view, suggestion service, focused fixture and tests.

**Estimated scope** Medium.

### Checkpoint D — Invited pregame workflow

- [ ] Open a pregame suggestion as an invited user, check its cutoff, and repeat the request from a non-member session.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 13 — Summarize a retrospective opponent window

- [ ] Task 13 complete

Extend the same scouting flow to a retrospective opponent and inclusive dates.

**Acceptance criteria**

- [ ] Both mode and effective evidence dates are explicit. Retrospective results include both boundary dates and use the same suggestion and cohort rules.
- [ ] Switching mode presents valid inputs for that mode. Invalid ranges produce a recoverable validation state.

**Verification**

- [ ] Test both boundaries and mode switching in the browser. Compare results against a fixture with shots on every boundary.

**Dependencies** [12](#task-12--suggest-evidence-for-a-pregame-brief)

**Files likely touched** `frontend` scouting mode and date controls, focused browser test.

**Estimated scope** Small.

## Task 14 — Edit a private Scout Brief draft

- [ ] Task 14 complete

Let a staff member save selected findings, coaching wording, and their order as a private revision.

**Acceptance criteria**

- [ ] Only the author can read or edit the draft. It retains mode, dataset version, filters, and references to the supporting evidence.
- [ ] Saving returns a revision. A stale or failed save preserves the user's local edits and offers a route to recover.

**Verification**

- [ ] Run draft integration tests for ownership and stale revisions. Enter notes, reorder findings, simulate a save failure, and reload.

**Dependencies** [13](#task-13--summarize-a-retrospective-opponent-window)

**Files likely touched** `frontend` brief draft migration, draft service and editor, focused test.

**Estimated scope** Medium.

## Task 15 — Publish a Scout Brief version

- [ ] Task 15 complete

Publish a draft to workspace members as one immutable brief version with a fixed evidence set.

**Acceptance criteria**

- [ ] A publication stores the brief text, metrics, date mode, dataset version, and exact authorized shot membership in one transaction.
- [ ] Members can read the published view. The author can create a private revision and publish a new version while earlier versions remain readable.
- [ ] Evidence opens the published shots. Subsequent edits and dataset activation leave the existing publication intact.

**Verification**

- [ ] Publish from one account and view from another. Use a fixture revision and dataset change to verify the original evidence stays identical.

**Dependencies** [14](#task-14--edit-a-private-scout-brief-draft)

**Files likely touched** `frontend` publication migration, publish service, published view, integration test.

**Estimated scope** Medium.

### Checkpoint E — Internal Scout Brief

- [ ] Draft a brief in each mode, publish one, and verify privately revising it preserves the original version.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 16 — Compare tagged actions

- [ ] Task 16 complete

Deliver an Action Board using two named action selections and synthetic active labels.

**Acceptance criteria**

- [ ] The board uses a controlled action list. Its denominator is tagged field-goal attempts and it shows volume, shooter and court distribution, and points per attempt.
- [ ] Each comparison links to its underlying shot evidence and identifies verified seed versus staff-published provenance. An action without eligible shots has a clear empty state.

**Verification**

- [ ] Use synthetic labels to compare two actions with mixed shot values and partial model coverage. Verify all displayed attempts and metric counts.

**Dependencies** [06](#task-06--inspect-an-individual-shot), [11](#task-11--enter-an-invited-staff-workspace)

**Files likely touched** `frontend` action and tag migration, action cohort query, Board view, focused test.

**Estimated scope** Medium.

## Task 17 — Draft an action tag for a shot

- [ ] Task 17 complete

Let a staff member find a recorded attempt by game, date, shooter, or clock and save an action draft.

**Acceptance criteria**

- [ ] A staff member can locate the target using game and clock context and select an action from the controlled list.
- [ ] The draft is private, revisioned, and visible only to its owner. Saving it leaves the shared comparison unchanged.

**Verification**

- [ ] Use two accounts to check search, draft ownership, and the Board before publication. Test a stale draft save.

**Dependencies** [16](#task-16--compare-tagged-actions)

**Files likely touched** `frontend` tag draft migration, search and draft controls, integration test.

**Estimated scope** Medium.

## Task 18 — Publish an initial action tag

- [ ] Task 18 complete

Publish an authored draft when there is no active label. Treat an identical shared label as a no-op.

**Acceptance criteria**

- [ ] The active label and its attribution are persisted atomically. The published label appears in the shared Board across devices.
- [ ] A repeated submission creates no duplicate active label. An existing different label is returned as a reviewable conflict.

**Verification**

- [ ] Run database tests for initial publication, a repeated submission, and two competing first publications. Read the result from a second session.

**Dependencies** [17](#task-17--draft-an-action-tag-for-a-shot)

**Files likely touched** `frontend` tag publication service and route, publish tests.

**Estimated scope** Small.

### Checkpoint F — Action comparison and publication

- [ ] Compare two fixture actions and publish one new label from a private draft. Verify the shared Board from another account.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 19 — Replace a conflicting action tag

- [ ] Task 19 complete

Add the confirmed replacement path with a revision check and preserve the author’s draft when it must be reviewed again.

**Acceptance criteria**

- [ ] The author sees current and proposed labels and explicitly confirms replacement of the displayed revision.
- [ ] A concurrent change invalidates the confirmation. The draft survives and the author sees the updated label for another review.
- [ ] The Board shows one active label per shot. Published changes retain attribution and history.

**Verification**

- [ ] Run an integration race test with two sessions and a browser test for conflict, retry, final label, and history.

**Dependencies** [18](#task-18--publish-an-initial-action-tag)

**Files likely touched** `frontend` replacement service and conflict UI, concurrency and browser tests.

**Estimated scope** Medium.

## Task 20 — Grant access to a published brief version

- [ ] Task 20 complete

Let a brief author create and revoke named-recipient grants for a specific published version.

**Acceptance criteria**

- [ ] Only the author creates a grant. The author or workspace admin can revoke it. Grants bind to one published version and recipient email.
- [ ] The workspace share controls provide a link for the named recipient and show revocation status to authorized staff.
- [ ] Publishing a new version leaves the earlier grant attached to the earlier version.

**Verification**

- [ ] Run grant API tests for role checks, revocation, and version binding. Create and revoke a grant with test identities.

**Dependencies** [10](#task-10--sign-in-with-a-verified-email-identity), [15](#task-15--publish-a-scout-brief-version)

**Files likely touched** `frontend` external grant migration, grant service, share controls, integration test.

**Estimated scope** Medium.

## Task 21 — Open an external brief as a verified recipient

- [ ] Task 21 complete

Deliver a read-only recipient route with verified email access and a mobile-readable brief.

**Acceptance criteria**

- [ ] The named verified email can open the shared version without membership. Forwarded links, mismatched identities, and revoked grants reveal no brief content.
- [ ] The recipient cannot access workspace routes or other brief versions. Protected responses are excluded from shared caching and indexing.
- [ ] The published brief is usable in a single-column phone layout and identifies mode, evidence dates, and sample coverage.

**Verification**

- [ ] Test recipient, wrong email, anonymous, and revoked access with direct requests and browser sessions. Verify the phone view and response headers.

**Dependencies** [20](#task-20--grant-access-to-a-published-brief-version)

**Files likely touched** `frontend` recipient authorization and view, shared brief styles, access and browser tests.

**Estimated scope** Medium.

### Checkpoint G — Conflict handling and recipient access

- [ ] Resolve a concurrent tag update and check recipient, wrong-email, and revoked link behavior.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 22 — Filter the evidence in a shared brief

- [ ] Task 22 complete

Let verified external viewers sort and filter the shots included in the published findings and open their shot cards.

**Acceptance criteria**

- [ ] The server intersects supported filters with the published shot membership for the selected finding. Pagination, counts, and details obey the same scope.
- [ ] The viewer can filter, sort, and inspect in a phone and keyboard workflow. The published finding and metrics stay intact when the evidence results are narrowed.
- [ ] Requests for a shot outside the grant’s evidence set or for evidence belonging to another version are denied.

**Verification**

- [ ] Run direct-request integration and browser tests with an authorized shot, unrelated shot, narrowed result, and revoked session.

**Dependencies** [06](#task-06--inspect-an-individual-shot), [21](#task-21--open-an-external-brief-as-a-verified-recipient)

**Files likely touched** `frontend` recipient evidence service and list, shared detail integration, focused tests.

**Estimated scope** Medium.

## Task 23 — Curate the verified starter tags

- [ ] Task 23 complete

Once the source is available, run the separate labeling pass with the named reviewer and produce a versioned starter manifest.

**Acceptance criteria**

- [ ] Define at least two action types alongside concrete inclusion examples. Map candidates to exact archive shot keys using game, period, clock, and shooter.
- [ ] The reviewer verifies source references and resolves or excludes ambiguous matches. Each action has at least one verified tagged attempt.
- [ ] The private manifest records the archive version, verification reference, reviewer, and action ID for each imported label.

**Verification**

- [ ] Review each starter example against its evidence and reconcile all manifest shot keys to the export. Record unresolved examples outside the import.

**Dependencies** [01](#task-01--record-release-dependencies-and-establish-the-python-baseline), [02](#task-02--export-a-reconciled-historical-shot-snapshot)

**Files likely touched** Private starter-tag manifest and `tasks/pilot-readiness.md`.

**Estimated scope** Small.

## Task 24 — Load curated labels with provenance

- [ ] Task 24 complete

Implement a validated starter-tag import that works on fixtures and can load the reviewed manifest when available.

**Acceptance criteria**

- [ ] The loader verifies shot and action IDs, archived dataset version, and verification metadata. An invalid manifest leaves active labels unchanged.
- [ ] The import is repeatable and preserves a staff-published correction on reimport. The Board identifies verified seed labels and describes the sample as curated.

**Verification**

- [ ] Run integration tests for valid, invalid, repeated, and post-correction loads. Repeat with the reviewed manifest after Task 23.

**Dependencies** [04](#task-04--load-an-immutable-dataset-version), [16](#task-16--compare-tagged-actions)

**Files likely touched** `frontend` starter-tag loader, Board provenance text, import test.

**Estimated scope** Small.

### Checkpoint H — Scoped evidence and starter labels

- [ ] Verify phone evidence filtering and exact shot boundaries. Review starter-tag intake status and verify the loader on fixtures, plus the real manifest when available.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 25 — Stage the shared demo with synthetic data

- [ ] Task 25 complete

Deploy the app with isolated PostgreSQL and managed identity configuration, using synthetic fixtures and the selected providers.

**Acceptance criteria**

- [ ] Provision a staging database and approved test accounts. Confirm the app bundle and staging data contain synthetic fixtures only.
- [ ] The deployment records active dataset version, import counts and errors, and app error rates. Logs exclude shot rows, private draft content, email, and grant credentials.
- [ ] Document a repeatable deploy, a previous-version rollback, and how to disable archive access by audience.

**Verification**

- [ ] Run the production build and synthetic deployment smoke checks. Inspect emitted logs and rehearse rollback in staging.

**Dependencies** [11](#task-11--enter-an-invited-staff-workspace), [22](#task-22--filter-the-evidence-in-a-shared-brief), [24](#task-24--load-curated-labels-with-provenance)

**Files likely touched** `frontend` deployment configuration and telemetry, staging runbook, synthetic smoke script.

**Estimated scope** Medium.

## Task 26 — Verify the hosted workflows across accounts and devices

- [ ] Task 26 complete

Run the release browser suite and manual product review against the hosted synthetic demo.

**Acceptance criteria**

- [ ] Cover all Lab modes, both Scout Brief modes, both tag publication paths, seed provenance, and external evidence narrowing and revocation.
- [ ] Use two staff accounts and a different verified recipient. Check private drafts, workspace isolation, stale writes, direct evidence URLs, and publication version boundaries.
- [ ] Check desktop and landscape tablet staff workflows, phone recipient reading, keyboard operation, and recoverable empty or error states.

**Verification**

- [ ] Deploy the release candidate to synthetic staging, run `test:e2e`, and record the browser, viewport, and account matrix. Fix failures in the owning feature task before promotion.

**Dependencies** [09](#task-09--add-matched-player-and-benchmark-comparisons), [15](#task-15--publish-a-scout-brief-version), [19](#task-19--replace-a-conflicting-action-tag), [22](#task-22--filter-the-evidence-in-a-shared-brief), [24](#task-24--load-curated-labels-with-provenance), [25](#task-25--stage-the-shared-demo-with-synthetic-data)

**Files likely touched** `frontend` hosted E2E suite and readiness verification notes.

**Estimated scope** Medium.

### Checkpoint I — Synthetic release rehearsal

- [ ] Review the hosted account and device matrix, telemetry, and rollback result before historical activation.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.

## Task 27 — Activate the invited historical workspace

- [ ] Task 27 complete

With release review and the necessary invited-audience clearance, load the verified historical snapshot and starter sample for the staff pilot.

**Acceptance criteria**

- [ ] Record the invited-audience clearance and activate the historical workspace. Keep historical external access gated for Task 29.
- [ ] Reconcile the active data and starter labels after import. Confirm known examples, expected metrics and coverage, and a tagged comparison.
- [ ] Verify rollback to the synthetic or previous dataset and the relevant audience-access disable procedure.

**Verification**

- [ ] Perform a controlled pilot smoke check and a rollback drill. Verify that the workspace accepts invited staff and that recipient routes disclose no historical content.

**Dependencies** [01](#task-01--record-release-dependencies-and-establish-the-python-baseline), [23](#task-23--curate-the-verified-starter-tags), [24](#task-24--load-curated-labels-with-provenance), [26](#task-26--verify-the-hosted-workflows-across-accounts-and-devices)

**Files likely touched** Pilot import records, deployment settings, `tasks/pilot-readiness.md`.

**Estimated scope** Small.

## Task 28 — Run the independent coaching pilot

- [ ] Task 28 complete

Run the agreed first review with a scouting assistant and a player development coach. Record what each person did and what evidence they used.

**Acceptance criteria**

- [ ] The scout independently publishes a pregame finding and explains a game-prep decision using its evidence.
- [ ] The development coach independently compares two looks and identifies one to work on, grounded in the supporting attempts.
- [ ] Staff compare two verified actions and confirm a shared correction from a second device. Record any blocker with its owning task.

**Verification**

- [ ] Observe both sessions using the acceptance steps in the spec, then record results and the separate Action Board check in the pilot notes.

**Dependencies** [27](#task-27--activate-the-invited-historical-workspace)

**Files likely touched** `tasks/pilot-readiness.md` and pilot review notes.

**Estimated scope** Small.

## Task 29 — Activate cleared historical recipient access

- [ ] Task 29 complete

Enable named-recipient access to published historical evidence once that audience has separate clearance. Keep this release task pending while permission is unresolved.

**Acceptance criteria**

- [ ] Record clearance for the exact audience and evidence scope before activation. Enable only the cleared historical recipient access.
- [ ] Confirm that a named verified recipient can inspect and narrow the published results. A different identity, unrelated shot, and revoked grant each remain inaccessible.
- [ ] Confirm staff can withdraw historical recipient access independently of the invited workspace.

**Verification**

- [ ] Test the approved recipient flow with an authorized test recipient, then revoke the grant and exercise the recipient access disable procedure.

**Dependencies** [27](#task-27--activate-the-invited-historical-workspace). Requires separate clearance for external evidence sharing.

**Files likely touched** Pilot release settings and `tasks/pilot-readiness.md`.

**Estimated scope** Small.

### Checkpoint J — Historical pilot

- [ ] Review workspace activation, reconciliation, and the independent coaching outcomes with the project owner. Record external historical activation separately or keep Task 29 pending with its clearance status.
- [ ] Run the applicable test, lint, type, and build checks. Review the working slice before starting the next dependent phase.
