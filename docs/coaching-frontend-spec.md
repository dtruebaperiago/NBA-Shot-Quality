# NBA Shot Quality coaching frontend specification

## Purpose and first release

Create a historical coaching workspace with three views over the same shot evidence. A scouting assistant prepares an opponent brief. A player development coach compares shot situations and identifies a look to work on. Staff compare the field-goal attempts created by tagged actions.

The pilot uses the available 2014–15 archive, which covers October 28, 2014 through March 4, 2015. Invited staff work across devices. A published Scout Brief can also be shared with named recipients who verify their email. Staff workflows target desktop and landscape tablets. Shared briefs and their evidence must also be readable and usable on phones. Full possession replay and hypothetical shot simulation are future concepts.

The first review succeeds when a scouting assistant and a development coach each complete their workflow independently and explain one coaching decision using the supporting shots. The Action Board also has a release check covering selection, comparison, tagging, publication, and conflict handling.

## Product behavior

### Player Shot Lab

- Start with a player and date range. Inspect a single look, compare two situations for the same player, compare two players, or compare a player against a team or league benchmark. Offer filters for shot value, court zone, recorded shot family, closest-defender distance, and recorded shot clock. Keep the active selections and date range visible whenever results are shown.
- All comparison modes share a date range. Two-look mode has independent shot filters. Player-to-player and benchmark modes support either shared or independent filters. Zone and shot type options reflect the selected shot value and clear incompatible selections when it changes. Benchmarks include the selected team’s shots or all available archive shots, excluding the selected player. State the benchmark scope in the UI.
- Show shot volume, observed and model-expected efficiency, and the underlying attempts. The court uses a circle for makes and a cross for misses, with distinct palettes for each look and controls to show either look or both. Offer a rotatable 3D view and a top-down chart. Selecting a shot opens its details, highlights its location, and draws an illustrative path toward the rim. Play all sequences the visible attempts with locations. Reduced-motion mode displays static paths.

### Opponent Scout Brief

- In **Pregame** mode, select your team and a game on its schedule to resolve the opponent. Use only the opponent’s shots from game dates before the selected game, applying the cutoff to suggestions, evidence searches, and counts. In **Team overview**, select an opponent and an inclusive date range without a target game. Display the mode and evidence dates on draft, published, and external views.
- Group opponent attempts by shooter, shot value, and one of court zone, recorded shot type, or defender distance. The default suggestions prioritize shot volume, expected FG%, above-expected finishing, and actual FG%. Staff can change the order and inspect the underlying shots. Give rate-based rankings precedence to groups with at least 20 contributing attempts. Show actual FG% over all shots and expected FG% over scored shots. Compute the gap on the matched scored subset and label the coverage when some shots lack estimates. Identify the archive model’s fitting period. Staff write the tactical interpretation.
- In **Opponent tendencies**, sort player shooting groups by lowest actual FG%, lowest expected FG%, or lowest gap. The **Team shooting** and **Shots allowed** views apply the same shot-value totals and context breakdowns as **Your team** to the selected opponent. Both use the brief’s evidence window and support adding context-level findings with their shot evidence.
- In **Your team**, review shooting and shots allowed across all opponents within a chosen date range. Show actual and expected makes by shot value, then break down weak spots by court zone, recorded shot type, or defender distance. In **Matchup**, pair either team’s shooting with the other team’s shots allowed for the same contexts and dates. For actual or expected FG%, highlight looks where both rates exceed the archive benchmark for that look. For the FG% gap, highlight looks where both sides made or allowed more than expected. Keep both evidence links when a matchup is added to the brief.
- Staff choose suggestions, edit wording, reorder findings, and save a private draft. Publishing creates a versioned snapshot of the brief, its search definitions, and the eligible evidence. Workspace members can open the published brief. Editing a published brief starts a private revision for its author. Publishing that revision creates a new version.
- An author can share a specific published version with named email addresses and revoke access later. Recipients verify their email and can read that version and filter or sort its published shot results. Every recipient request is scoped to that version and its evidence. The author must create a share for a new version to give recipients access to it. A forwarded URL alone grants no access.

### Action Comparison Board

- Compare two named actions from a controlled action list. Show tagged attempts, their distribution by shooter and location, observed points per attempt, and model-expected points per attempt when available. Display the selection and sample size for each action. The unit is a recorded field-goal attempt tagged with the action that created the look. Actions that end in a turnover or a trip to the line without a field-goal attempt are outside this comparison denominator.
- Seed a small verified set through a separate labeling pass after an appropriate source is available. Agree on the definitions for at least two distinct actions, record the game, period, clock, shooter, and verification reference, and map each reviewed example to a specific shot. Import only resolved tags and identify the seed as a curated sample. Record whether the displayed label came from the verified seed or a staff publication.
- Staff find a shot by game, date, shooter, or clock, choose its primary action from the list, and save a private tag draft. Publishing can set or replace the shared label for that shot. When another label is already active, show the current and proposed labels, require explicit replacement confirmation, and recheck the version at write time. If it changed again, preserve the draft and repeat review. Keep the history of published changes and the user who made each one.

## Data and metric rules

- Use the cleaned historical splits for observed attempts and the final holdout prediction export for expected metrics. Reuse the existing play-by-play matcher to obtain coordinates, recorded shot family, and available event context. Join on the normalized 10-character game ID, player ID, and shot number. Resolve game and team identifiers from archive matchup data and cached game events. Use the shooter’s team at the time of the game for team and opponent filters. Keep conflicting or unresolved values explicit.
- Freeze and version the imported data. A local read-only check joined all 26,072 prediction rows to their source shots and found valid probabilities for all of them. In that sample, 25,960 attempts have court coordinates and 941 lack a recorded shot clock. A shot without coordinates stays in aggregate totals and the list when it matches the active filters. Show how many attempts could be plotted. Filter clocks by recorded values and court zones by zones derived from available coordinates. Identify any clock proxy displayed in the detail card.
- Observed FG% is makes divided by all eligible attempts. Observed points per attempt is actual field-goal points divided by those attempts. Expected FG% is the mean make probability across scored attempts. Expected points per attempt is the mean of each scored shot’s make probability multiplied by its shot value. Keep expected metrics unavailable before February 1, 2015 and show scored coverage for any mixed range. If the UI shows an observed-versus-expected difference, compute both figures on the same scored attempts. Apply these rules to all three views and external evidence.
- Show the counts behind each metric. Keep metrics and suggestions visible for small nonempty samples and label them **Small sample**. Use fewer than 20 contributing attempts as the initial display threshold. Apply the threshold to the scored count for expected metrics and to the observed count for observed metrics. A single example can be opened as evidence. An empty result shows its filters and a way to broaden them, with no efficiency value displayed.
- A shot detail card shows the player, teams, game date, period, game clock, result, basket distance, and available shot context. Attempts past the chart’s depth appear at its edge and retain their original distance in the detail card. Label model scores as estimates for the observed shot. If a shot lacked enough linked context to use the enriched model, indicate the tracking-only score when showing per-shot model provenance.

[Modeling dataset](modeling-dataset.md) · [Model design](model-design.md) · [Final evaluation](final-evaluation.md) · [Reproduction guide](reproduction.md)

## Interface and implementation

### Application and data flow

- Use a single React and TypeScript application with server-side routes, PostgreSQL, and managed email authentication. Keep the Python research pipeline as the offline source. A repeatable importer should join saved artifacts, validate keys and counts, and stage a dataset version before activation. The app reads saved probabilities and does not need live model inference or upstream API calls. Bring up shared features with synthetic test fixtures before loading cleared data.
- Store dataset versions, games, teams, players, shots, and a controlled action list. Keep workspace membership, tag drafts and published tag revisions, brief drafts and published brief versions, and external grants in separate tables. Pin published evidence to a dataset version and exact shot IDs. Persist each published finding’s original metrics and filter definition. Filtering evidence in read mode can show filtered counts without editing the published finding.
- Index shots by dataset and common player, team, game, and date filters. Use server-side grouping for counts and metrics, and paginate detailed rows. Feed the court from the same query as the accessible list and avoid rendering thousands of individual controls. Use a stable cursor for the evidence list and a stable order for ties. Keep selection state when switching between the court and the list.

### Service contracts

| Operation | Contract |
| --- | --- |
| Query cohorts | Accept a dataset version, supported subjects and comparison mode, filters, and a date range or pregame target. Return metrics, contributing attempt counts, coordinate coverage, and paginated evidence. |
| Read a shot | Return the available shot context and source flags. Require workspace access or a verified grant covering that shot in the published brief. |
| Create or edit drafts | Require a workspace member and enforce ownership on writes. Return the saved revision so a stale browser cannot overwrite a newer save silently. |
| Publish a tag | Require draft ownership. Publish one active label per workspace and shot in a transaction. Treat publication of the active label as a no-op. If replacing a different label, require the expected current version and confirmation. Return a conflict when the active version changed. |
| Publish a brief | Require draft ownership. Create the published version and its evidence snapshot in a transaction. Use the saved filters and dataset version to resolve the evidence. |
| Share or revoke a brief version | Let the author create grants and the author or workspace administrator revoke them. Store grants by published version and verified recipient identity. Restrict recipient queries to a subset of that grant’s published evidence IDs. |

### Access and interaction

- Workspaces require an invitation and verified identity. Workspace admins manage membership and can revoke grants. Members can publish their own drafts and read shared publications. Enforce workspace and version scope on the server for every request. External recipients use a separate read-only route with no membership requirement. Scope grant lookups to verified email, avoid public indexing and shared caching of brief content, and keep grant credentials and shot data out of application logs.
- Structure the Shot Lab around the court and comparison cards, the Scout Brief around searchable evidence and an editable brief, and the Action Board around side-by-side comparisons. Use one detail card across all three. Keep volume and provenance visible without relying on color. Provide keyboard access to filtering, selection, editing, and evidence inspection. Use a single column for mobile shared briefs and a keyboard-friendly tabular evidence view alongside visual charts.
- Keep drafts recoverable after a save error or a publication conflict. Distinguish an empty result from missing archive context, access failure, and unavailable data. A first-date pregame brief can have no earlier evidence. A revoked or mismatched recipient link should offer a way to return to sign-in or contact the sender without disclosing the brief or recipient list.

## Delivery, risks, and verification

| Risk or trade-off | Response |
| --- | --- |
| The archive has unverified publication terms. Staff access and external evidence sharing expose different audiences. | Confirm permission for each use before enabling that release path with historical data. Use synthetic fixtures for hosted testing until the applicable permission is confirmed. |
| The board depends on verified starter tags that do not yet exist. | Make the source selection and labeling pass a distinct milestone. Check the imported sample against its references, keep provenance visible, and validate tagging mechanics with synthetic fixtures in parallel. |
| Sparse or overlapping cohorts can imply more evidence than is available. | Show counts and coverage beside metrics and suggestions. Allow overlap between intentional comparison filters. Use the same scored subset for any observed-versus-expected difference. |
| Concurrent publications can overwrite a coaching interpretation. | Use version checks and explicit replacement, retain the private draft on conflict, and retain publication history. |
| A recipient could otherwise gain broader access or see a revised brief unexpectedly. | Pin each grant to one immutable version, enforce its exact evidence scope server-side, and test forward, revocation, and versioning paths. |

Implement in three increments. First, prove the offline import, common evidence query, and Shot Lab on local historical data. Second, add workspace membership, private drafts, and internal publication for the Scout Brief and Action Board using synthetic fixtures where needed. Third, verify recipient sharing, complete the labeling pass, and run the invited historical pilot when the data permission and seed evidence are in place. Keep the research artifacts out of app source control and hosted builds. Record the active dataset version, import counts, import failures, and application error rates. Leave recipient email and private draft content out of routine telemetry.

### Acceptance checks

- Reconcile imported coverage and aggregate metrics with the source exports. Check duplicate keys, team changes, unknown coordinates, missing clocks, cross-window metric denominators, low counts, empty results, mixed shot values, and February 1 pregame and retrospective queries. Verify a pregame brief cannot include any same-day or later shots.
- Exercise all Shot Lab comparisons and both brief modes through the interactive UI. Confirm that plot, list, aggregates, and the selected shot agree. Assess desktop and landscape tablet interaction plus mobile external reading, including keyboard use and recoverable error states.
- Use two staff accounts across devices to verify draft privacy, same-label and conflicting tag publications, stale saves, shared updates, and workspace isolation. Check that a seeded action and a staff-published action can be distinguished. Test that an external recipient can narrow published evidence, while a forwarded link, revoked grant, different email, draft, unrelated shot, or unpublished revision remains inaccessible.
- In the review, have the scouting assistant select and publish a pregame finding and explain how the evidence would affect game prep. Have the development coach compare two looks and point to a specific look to work on. Ask each reviewer to show the evidence unaided. Separately verify that staff can compare two verified actions and publish a correction from a second device.

### Decisions still open

- Confirm the historical data permission separately for invited staff and named external recipients. Identify the appropriate source and reviewer for the initial labeling pass.
- Select the hosting and managed email providers before implementation. Treat the React and PostgreSQL stack, the initial filter set, the default small-sample threshold, and the fixed-version share behavior as proposed implementation defaults for review.

[Data source and publication audit](data-sources.md)
