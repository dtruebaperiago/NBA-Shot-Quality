import assert from "node:assert/strict";
import test from "node:test";
import { courtCamera, flightPoint, flightTiming, rimHeight } from "./court-scene.ts";
import { benchmarkEvidence, benchmarkReport, selectLabShots, shotPageSize } from "./archive-query.ts";
import { equalityLine, modelAxis } from "./model-plot.ts";
import { modelRates, parseProbabilityRange, shotBand, studyShots } from "./model-study.ts";
import { profileShots, trackedShooting, type PlayerPositions } from "./player-profile.ts";
import { playerFinder, playerFinderShots, rankFinderPlayers, type FinderScope } from "./player-finder.ts";
import { matchupOpponent, pregameShooters, rankTendencies, scoutEvidence, scoutTendencies, trackedTeamHistory } from "./scout-tendencies.ts";
import { matchingEdge, scoutRates, teamScout, teamScoutEvidence, type ScoutTotals } from "./team-scout.ts";
import { courtPosition, emptyShotFilters, matchesBasketDistance, shotFilterOptions, summarize, withShotValue, type Shot, type ShotFilters } from "./shots.ts";

const example: Shot = {
  id: "shot", game: "game", date: "2015-02-01", player: "Player", team: "A", opponent: "B",
  period: 1, gameClock: 600, shotClock: 16, defender: 3.5, value: 2, made: true,
  probability: 0.5, x: 0, y: 8, zone: "Rim", family: "Layup",
};

test("dense benchmark totals, court bins and evidence use the same filtered shots", () => {
  const bench = Array.from({ length: 2_010 }, (_, index) => ({ ...example, id: `bench-${String(index).padStart(4, "0")}`, player: "Peer", team: "B", made: index % 2 === 0 }));
  const shots = [example, ...bench, { ...example, id: "excluded", player: "Peer", value: 3 as const }];
  const scope = { player: example.player, team: "A", game: example.game, start: example.date, end: example.date, comparison: "", benchmark: "pool" };
  const filters = { first: emptyShotFilters, second: { ...emptyShotFilters, value: "2" as const }, band: "", scoredOnly: false };
  const report = benchmarkReport(shots, scope, filters);
  assert.deepEqual(report.second, []);
  assert.equal(report.first.length, 1);
  assert.equal(report.totals.attempts, bench.length);
  assert.equal(report.totals.fg, .5);
  assert.deepEqual(report.density, [{ id: "0,0", x: example.x, y: example.y, makes: 1005, misses: 1005 }]);
  assert.equal(report.plottedSecond, bench.length);
  const page = benchmarkEvidence(shots, scope, filters, { index: 1, a: false, b: true });
  assert.equal(page.total, bench.length);
  assert.deepEqual(page.rows.map(shot => shot.id), bench.slice(shotPageSize, 2 * shotPageSize).map(shot => shot.id));
  assert.equal(benchmarkEvidence(shots, scope, filters, { index: 9_000, a: false, b: true }).rows.length, 2);
});

test("pregame shooters exclude known departures without looking at the target date", () => {
  const games = [
    { id: "early", teams: ["A", "C"], date: "2015-01-29", scored: true },
    { id: "trade", teams: ["B", "C"], date: "2015-02-03", scored: true },
  ];
  const history = trackedTeamHistory(games, { early: { A: [example.player, "Stayed"] }, trade: { B: [example.player] } });
  const stayed = { ...example, player: "Stayed" };
  assert.deepEqual(pregameShooters([example, stayed], history, "2015-02-03"), [example, stayed]);
  assert.deepEqual(pregameShooters([example, stayed], history, "2015-02-04"), [stayed]);
});

test("historical pregame priority ignores expected rates when the model was fitted later", () => {
  const shots = Array.from({ length: 40 }, (_, index) => ({ ...example, id: `shot-${index}`, player: index < 20 ? "Made" : "Missed", made: index < 20, probability: index < 20 ? .2 : .8 }));
  const candidates = scoutTendencies(shots);
  assert.equal(rankTendencies(candidates, "expected")[0].actual, 0);
  assert.equal(rankTendencies(candidates, "expected", false)[0].actual, 1);
  assert.ok(rankTendencies(candidates, "balanced", false).every(item => item.priority !== "High expected FG%" && item.priority !== "Above expected"));
});

test("observed and expected metrics use separate denominators and shot values", () => {
  const result = summarize([
    example,
    { ...example, id: "three", value: 3, made: false, probability: 0.4 },
    { ...example, id: "earlier", date: "2015-01-27", probability: null },
  ]);

  assert.deepEqual(result, { attempts: 3, scored: 2, fg: 2 / 3, pps: 4 / 3, expectedFg: 0.45, expectedPps: 1.1 });
  assert.equal(summarize([]).pps, null);
  assert.equal(summarize([{ ...example, probability: null }]).expectedPps, null);
});

test("model comparisons pair actual and expected outcomes and preserve exact evidence bands", () => {
  const scope = { team: "A", game: "game", value: "", window: "full" as const };
  const shots = [
    { ...example, probability: .2 },
    { ...example, id: "three", value: 3 as const, made: false, probability: .8 },
    { ...example, id: "earlier", probability: null },
    { ...example, id: "road", team: "B", probability: .4 },
    { ...example, id: "later", game: "next", probability: .6 },
  ];
  const study = studyShots(shots, scope, example.date);
  assert.equal(study.pool.attempts, 2);
  assert.deepEqual(modelRates(study.pool, "fg"), { actual: .5, expected: .5, gap: 0 });
  assert.equal(modelRates(study.pool, "pps").actual, 1);
  assert.ok(Math.abs((modelRates(study.pool, "pps").expected ?? 0) - 1.4) < 1e-12);
  assert.deepEqual(study.players[0].bands.map(band => band.attempts), [0, 1, 0, 0, 1]);
  assert.equal(studyShots(shots, { ...scope, value: "3" }, example.date).pool.attempts, 1);
  assert.deepEqual([0, .199, .2, .4, .6, .8, 1].map(shotBand), [0, 0, 1, 2, 3, 4, 4]);
});

test("the full model window includes retrospective scores and the holdout window excludes them", () => {
  const shots = [example, { ...example, id: "early", date: "2014-10-28", probability: .6, retrospective: true }];
  const scope = { team: "", game: "", value: "" };
  assert.equal(studyShots(shots, { ...scope, window: "full" }, example.date).pool.attempts, 2);
  assert.equal(studyShots(shots, { ...scope, window: "holdout" }, example.date).pool.attempts, 1);
});

test("spread axes enlarge the dense region while keeping both extremes and exact equality", () => {
  const expected = [.2, .40, .41, .42, .43, .44, .45, .46, .47, .48, .8];
  const x = modelAxis(expected, "fg", true);
  const linear = modelAxis(expected, "fg", false);
  const y = modelAxis(expected.map(value => value + .025), "fg", true);
  assert.ok(x.position(.48) - x.position(.40) > linear.position(.48) - linear.position(.40));
  assert.ok(x.position(.2) >= 0 && x.position(.8) <= 100);
  const line = equalityLine(x, y).split(" ").map(pair => pair.split(",").map(Number));
  const values = [...new Set([...x.breaks, ...y.breaks])].filter(value => value >= Math.max(x.min, y.min) && value <= Math.min(x.max, y.max)).sort((a, b) => a - b);
  assert.deepEqual(line, values.map(value => [x.position(value), 100 - y.position(value)]));
  assert.ok(Number.isFinite(modelAxis([1, 1], "fg", true).position(1)));
});

test("basket-distance bands use shot value and original court coordinates at the cutoffs", () => {
  const at = (ft: number, value: Shot["value"] = 2): Shot => ({ ...example, x: 0, y: ft * 10, basketDistance: 1, value });
  assert.ok(matchesBasketDistance(at(7.99), "2-close"));
  assert.ok(!matchesBasketDistance(at(8), "2-close"));
  assert.ok(matchesBasketDistance(at(8), "2-middle"));
  assert.ok(matchesBasketDistance(at(16), "2-long"));
  assert.ok(matchesBasketDistance(at(22, 3), "3-near"));
  assert.ok(!matchesBasketDistance(at(22, 3), "2-long"));
  assert.ok(matchesBasketDistance(at(29.99, 3), "3-near"));
  assert.ok(matchesBasketDistance(at(30, 3), "3-deep"));
  assert.ok(matchesBasketDistance(at(48, 3), "3-deep"));
  assert.ok(matchesBasketDistance({ ...example, x: null, y: null, basketDistance: 11 }, "2-middle"));
  assert.ok(!matchesBasketDistance({ ...example, x: null, y: null }, "2-middle"));
});

test("a player's team is scoped at the time of the game when comparing cohorts", () => {
  const scope = { player: "Player", team: "A", game: "game", start: example.date, end: example.date, comparison: "Peer", benchmark: "" };
  const shots = [
    example,
    { ...example, id: "traded", team: "B" },
    { ...example, id: "peer", player: "Peer", team: "B" },
    { ...example, id: "elsewhere", player: "Peer", game: "other" },
  ];
  assert.deepEqual(selectLabShots(shots, scope).map(shot => shot.id), ["shot", "peer"]);
  assert.deepEqual(selectLabShots(shots, { ...scope, comparison: "", benchmark: "B" }).map(shot => shot.id), ["shot", "peer"]);
});

test("pregame scouting resolves the other team and stops before the target date", () => {
  const game = { id: "target", date: "2015-02-06", teams: ["BKN", "NYK"], scored: true };
  const opponent = matchupOpponent(game, "BKN");
  assert.equal(opponent, "NYK");
  assert.equal(matchupOpponent(game, "NYK"), "BKN");
  assert.equal(matchupOpponent(game, "GSW"), undefined);
  const prior = { ...example, id: "prior", team: "NYK", opponent: "BOS", date: "2015-02-05" };
  const own = { ...prior, id: "own", team: "BKN" };
  const targetShot = { ...prior, id: "target", game: game.id, date: game.date };
  const shots = [prior, own, targetShot, { ...prior, date: "2015-02-07" }];
  assert.deepEqual(scoutEvidence(shots, opponent!, "2015-02-04", "2015-02-06", game.date), [prior]);
  assert.deepEqual(scoutEvidence(shots, opponent!, "2015-02-05", "2015-02-06"), [prior, targetShot]);
});

test("scouting separates twos and threes and measures the gap on scored shots only", () => {
  const shots = [
    { ...example, family: "Jump shot", probability: .25 },
    { ...example, family: "Jump shot", probability: null, made: false },
    { ...example, family: "Jump shot", value: 3 as const, zone: "Above the break" },
  ];
  const tendencies = scoutTendencies(shots);
  const twos = tendencies.find(tendency => tendency.title === "Player · 2PT · Jump shot");
  assert.equal(twos?.shots.length, 2);
  assert.deepEqual([twos?.actual, twos?.expected, twos?.scored, twos?.matchedActual, twos?.gap], [.5, .25, 1, 1, .75]);
  assert.equal(tendencies.find(tendency => tendency.title === "Player · 3PT · Jump shot")?.shots.length, 1);
});

test("team scouting uses all opponents and a shared pregame cutoff for both directions", () => {
  const dates = { from: "2015-02-01", through: "2015-03-01", before: "2015-02-06" };
  const shots = [
    { ...example, id: "own", team: "BKN", opponent: "BOS" },
    { ...example, id: "allowed-a", team: "BOS", opponent: "BKN", value: 3 as const, zone: "Corner three", probability: .4 },
    { ...example, id: "allowed-b", team: "CLE", opponent: "BKN", value: 3 as const, zone: "Corner three", probability: null, made: false },
    { ...example, id: "opponent", team: "NYK", opponent: "PHI", value: 3 as const, probability: .6 },
    { ...example, id: "opponent-allowed", team: "BOS", opponent: "NYK" },
    { ...example, id: "target", team: "NYK", opponent: "BKN", date: "2015-02-06" },
  ];
  const report = teamScout(shots, dates, "BKN", "NYK", "zone");
  assert.equal(report.own.shooting["2PT"].totals.attempts, 1);
  assert.equal(report.opponent.shooting["3PT"].totals.attempts, 1);
  assert.equal(report.opponent.allowed["2PT"].totals.attempts, 1);
  const allowed = report.own.allowed["3PT · Corner three"].totals;
  assert.deepEqual(scoutRates(allowed), { actual: .5, expected: .4, gap: .6, extraMakes: .6, matchedActual: 1 });
  const evidence = teamScoutEvidence(shots, { ...dates, team: "BKN", side: "allowed", dimension: "zone", bucket: "3PT · Corner three" });
  assert.deepEqual(evidence.map(shot => shot.id), ["allowed-a", "allowed-b"]);
  assert.equal(evidence.length, allowed.attempts);
});

test("a matchup signal requires both sides above the same reference and enough attempts", () => {
  const totals = (makes: number, expectedMakes: number): ScoutTotals => ({ attempts: 100, scored: 100, makes, scoredMakes: makes, expectedMakes });
  const league = totals(40, 40);
  const attack = totals(55, 45);
  const allowed = totals(50, 49);
  assert.ok((matchingEdge(attack, allowed, league, "expected") ?? 0) > 0);
  assert.ok((matchingEdge(attack, totals(40, 36), league, "expected") ?? 0) < 0);
  assert.ok((matchingEdge(attack, allowed, league, "gap") ?? 0) > 0);
  assert.equal(matchingEdge(attack, { ...allowed, scored: 19 }, league, "gap"), null);
});

test("finder uses the same shot context for a need, candidate comparison and evidence", () => {
  const scope: FinderScope = { team: "A", window: "holdout", pool: "outside" };
  const shots: Shot[] = Array.from({ length: 24 }, (_, index) => [
    { ...example, id: `own-${index}`, team: "A", player: "Home", value: 3 as const, zone: "Corner three", probability: .4, made: false },
    { ...example, id: `peer-${index}`, team: "B", player: "Candidate", value: 3 as const, zone: "Corner three", probability: .5 },
    { ...example, id: `two-${index}`, team: "B", player: "Candidate" },
  ]).flat();
  shots.push({ ...shots[1], id: "early", date: "2015-01-28", made: false });
  const report = playerFinder(shots, scope, emptyShotFilters, "threes", example.date);
  assert.equal(report.activeNeed, "threes");
  assert.equal(report.team.fg, 0);
  assert.equal(report.archive.attempts, 48);
  assert.equal(report.players[0].name, "Candidate");
  assert.equal(report.players[0].pps, 3);
  const evidence = playerFinderShots(shots, scope, report.filters, "Candidate", example.date);
  assert.equal(evidence.length, report.players[0].attempts);
  assert.ok(evidence.every(shot => shot.value === 3 && shot.date >= example.date));
});

test("finder excludes current teammates even if their latest shots are outside the active look", () => {
  const scope: FinderScope = { team: "A", window: "full", pool: "outside" };
  const shots: Shot[] = [
    { ...example, player: "Arrived", team: "B", date: "2015-01-20", value: 3 },
    { ...example, player: "Arrived", team: "A" },
    { ...example, player: "Left", team: "A", date: "2015-01-20", value: 3 },
    { ...example, player: "Left", team: "B", value: 3 },
    { ...example, player: "Left", team: "B", value: 3, probability: null },
  ];
  const report = playerFinder(shots, scope, { ...emptyShotFilters, value: "3" }, "", example.date);
  assert.deepEqual(report.players.map(player => [player.name, player.team, player.attempts, player.scored]), [["Left", "B", 2, 1]]);
  assert.equal(rankFinderPlayers(report.players, "expectedFg", 2, "", "").length, 0);
  assert.equal(rankFinderPlayers(report.players, "fg", 2, "le", "B").length, 1);
  assert.equal(playerFinderShots(shots, scope, report.filters, "Arrived", example.date).length, 0);
});

test("rate rankings keep small groups visible below qualified evidence", () => {
  const shots = [
    ...Array.from({ length: 20 }, (_, i) => ({ ...example, id: String(i), player: "Qualified", family: "Unrecorded layup", probability: .3 })),
    { ...example, player: "Single shot", probability: .99 },
  ];
  const candidates = scoutTendencies(shots).filter(tendency => tendency.kind === "Court zone");
  for (const mode of ["expected", "actual", "low-expected", "low-actual", "above", "below"] as const) {
    assert.deepEqual(rankTendencies(candidates, mode).map(tendency => tendency.shots.length), [20, 1]);
  }
  assert.equal(rankTendencies(candidates, "balanced")[1].priority, undefined);
});

test("the lowest actual and lowest expected rankings can surface different shooters", () => {
  const shots = Array.from({ length: 20 }, (_, index) => [
    { ...example, id: `miss-${index}`, player: "Low actual", made: false, probability: .6 },
    { ...example, id: `make-${index}`, player: "Low expected", made: true, probability: .2 },
  ]).flat();
  const candidates = scoutTendencies(shots).filter(tendency => tendency.kind === "Court zone");
  assert.match(rankTendencies(candidates, "low-actual")[0].title, /^Low actual/);
  assert.match(rankTendencies(candidates, "low-expected")[0].title, /^Low expected/);
});

test("an unplottable attempt can still contribute to the cohort", () => {
  const missing = { ...example, x: null, y: null };
  assert.equal(courtPosition(missing), null);
  assert.equal(courtPosition({ x: 251, y: 45 }), null);
  assert.equal(summarize([missing]).attempts, 1);
});

test("court position caps plot depth without changing the source coordinates", () => {
  const heave = { ...example, x: -82, y: 496, basketDistance: 50 };
  assert.deepEqual(courtPosition(heave), { x: -82, y: 360, atDepthLimit: true });
  assert.equal(heave.y, 496);
  assert.equal(heave.basketDistance, 50);
  assert.deepEqual(courtPosition({ x: 0, y: 360 }), { x: 0, y: 360, atDepthLimit: false });
  assert.deepEqual(courtPosition(example), { x: 0, y: 8, atDepthLimit: false });
});

test("an illustrative make starts at the release location, rises, and reaches the rim", () => {
  const start = { x: -82, y: 360 };
  assert.deepEqual(flightPoint(start, true, 0).slice(0, 2), [-82, 360]);
  assert.deepEqual(flightPoint(start, true, 1), [0, 0, rimHeight]);
  assert.ok(flightPoint(start, true, .5)[2] > rimHeight);
  assert.notEqual(flightPoint(start, false, 1)[0], 0);
});

test("the 3D camera projects height and rotation, while the overhead court keeps original shot coordinates", () => {
  const camera = courtCamera(760, 410, "spatial", .31);
  const ground = camera.project([60, 190, 0]);
  assert.ok(camera.project([60, 190, rimHeight])[1] < ground[1]);
  assert.notDeepEqual(courtCamera(760, 410, "spatial", -.31).project([60, 190, 0]), ground);
  const overhead = courtCamera(760, 410, "overhead", 0);
  assert.deepEqual(overhead.project([-82, 360, 0]), overhead.project([-82, 360, rimHeight]));
});

test("shot replay compresses large batches and finishes small samples quickly", () => {
  const single = flightTiming(1);
  const small = flightTiming(10);
  const typical = flightTiming(221);
  const large = flightTiming(5_030);

  assert.equal(single.gap, 0);
  assert.ok(single.total < .75);
  assert.ok(small.total < 2);
  assert.ok(typical.total >= 5 && typical.total < 10);
  assert.ok(large.total > typical.total && large.total < 10);
  assert.ok(large.flight < small.flight && large.gap < small.gap);
  assert.ok((5_030 - 1) * large.gap + large.flight <= large.total);
});

test("shot value limits the available zones and types to recorded combinations", () => {
  const options = shotFilterOptions([
    example,
    { ...example, zone: "Paint", family: "Tip" },
    { ...example, zone: "Rim", family: "Dunk" },
    { ...example, value: 3, zone: "Corner three", family: "Jump shot" },
    { ...example, value: 3, zone: "Unknown", family: "Unknown" },
  ]);

  assert.deepEqual(options["2"], { zones: ["Paint", "Rim"], families: ["Dunk", "Layup", "Tip"] });
  assert.deepEqual(options["3"], { zones: ["Corner three"], families: ["Jump shot"] });
  assert.deepEqual(options[""], { zones: ["Corner three", "Paint", "Rim"], families: ["Dunk", "Jump shot", "Layup", "Tip"] });
});

test("changing shot value clears incompatible selections and preserves compatible ones", () => {
  const options = shotFilterOptions([
    { ...example, zone: "Paint", family: "Tip" },
    { ...example, zone: "Midrange", family: "Jump shot" },
    { ...example, value: 3, zone: "Corner three", family: "Jump shot" },
  ]);
  const filters: ShotFilters = { value: "2", zone: "Paint", family: "Tip", distance: "2-close", defender: "open", clock: "early" };

  assert.deepEqual(withShotValue(filters, "3", options), { ...filters, value: "3", zone: "", family: "", distance: "" });
  assert.deepEqual(withShotValue({ ...filters, family: "Jump shot" }, "3", options), { ...filters, value: "3", zone: "", family: "Jump shot", distance: "" });
  assert.deepEqual(withShotValue(filters, "", options), { ...filters, value: "" });
});


test("position benchmarks exclude the selected player and unknown roles in totals and evidence", () => {
  const shots = [
    example,
    { ...example, id: "peer", team: "B", player: "Peer" },
    { ...example, id: "center", team: "B", player: "Center" },
    { ...example, id: "unknown", team: "B", player: "Unknown" },
    { ...example, id: "outside-window", game: "other", team: "B", player: "Peer" },
  ];
  const positions: PlayerPositions = { Player: "position:guard", Peer: "position:guard", Center: "position:center" };
  const scope = { player: example.player, team: "A", game: example.game, start: example.date, end: example.date, comparison: "", benchmark: "position:guard" };
  const filters = { first: emptyShotFilters, second: emptyShotFilters, band: "", scoredOnly: false };
  const report = benchmarkReport(shots, scope, filters, positions);
  assert.deepEqual(report.first.map(shot => shot.id), [example.id]);
  assert.deepEqual(report.second.map(shot => shot.id), ["peer"]);
  assert.equal(report.totals.attempts, 1);
  assert.deepEqual(benchmarkEvidence(shots, scope, filters, { index: 0, a: false, b: true }, positions).rows.map(shot => shot.id), ["peer"]);
});

test("benchmark bin evidence pages only the plotted shots that belong to that bin", () => {
  const nearby = Array.from({ length: shotPageSize + 2 }, (_, index) => ({
    ...example, id: "nearby-" + String(index).padStart(2, "0"), player: "Peer", x: 38 + index % 5, y: 3000 + index,
  }));
  const others = Array.from({ length: 2_000 }, (_, index) => ({ ...example, id: "elsewhere-" + index, player: "Peer" }));
  const shots = [example, ...nearby, ...others, { ...example, id: "unplotted", player: "Peer", x: null }];
  const scope = { player: example.player, team: "", game: "", start: example.date, end: example.date, comparison: "", benchmark: "pool" };
  const options = { first: emptyShotFilters, second: emptyShotFilters, band: "", scoredOnly: false };
  const report = benchmarkReport(shots, scope, options);
  const bin = report.density?.find(item => item.id === "2,18");
  assert.ok(bin);
  assert.equal(bin.makes + bin.misses, nearby.length);
  const first = benchmarkEvidence(shots, scope, options, { bin: bin.id, index: 0, a: true, b: true });
  const next = benchmarkEvidence(shots, scope, options, { bin: bin.id, index: 1, a: true, b: true });
  assert.equal(first.total, nearby.length);
  assert.equal(next.total, nearby.length);
  assert.deepEqual([...first.rows, ...next.rows].map(shot => shot.id), nearby.map(shot => shot.id));
  assert.equal(benchmarkEvidence(shots, scope, options, { bin: "missing", index: 0, a: true, b: true }).total, 0);
});

test("expected FG ranges keep exact endpoints and agree with player shot evidence", () => {
  const range = parseProbabilityRange("0", "20");
  assert.deepEqual(range, [0, .2]);
  assert.equal(parseProbabilityRange("20", "0"), undefined);
  assert.equal(parseProbabilityRange("", "20"), undefined);
  assert.equal(parseProbabilityRange("0", "101"), undefined);
  const shots = [
    { ...example, id: "zero", probability: 0 },
    { ...example, id: "limit", probability: .2, made: false },
    { ...example, id: "above", probability: .20001 },
    { ...example, id: "unscored", probability: null },
    { ...example, id: "training", probability: .1, date: "2015-01-31" },
    { ...example, id: "three", probability: .1, value: 3 as const },
    { ...example, id: "other-team", probability: .1, team: "C" },
  ];
  const model = studyShots(shots, { team: "A", game: example.game, value: "2", window: "holdout" }, example.date, range);
  const matches = profileShots(shots, { ...emptyShotFilters, value: "2" }, { team: "A", game: example.game, from: example.date, range });
  assert.deepEqual(matches.map(shot => shot.id), ["zero", "limit"]);
  assert.equal(model.players[0].attempts, matches.length);
  assert.equal(model.players[0].makes, 1);
  assert.deepEqual(modelRates(model.players[0], "fg"), { actual: .5, expected: .1, gap: .4 });
});

test("player shooting separates two-point and three-point rates and shows model coverage", () => {
  const madeThree = { ...example, id: "three", value: 3 as const, probability: null };
  const [overall, twos, threes] = trackedShooting([{ ...example, made: false }, madeThree]);
  assert.equal(overall.fg, .5);
  assert.equal(overall.effectiveFg, .75);
  assert.equal(overall.scored, 1);
  assert.equal(twos.makes, 0);
  assert.equal(threes.fg, 1);
  assert.equal(threes.expectedFg, null);
});
