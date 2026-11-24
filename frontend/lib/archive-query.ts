import { courtPosition, emptyShotFilters, matchesShotFilters, summarize, type Shot, type ShotFilters, type ShotValueFilter } from "./shots.ts";
import { shotBand } from "./model-study.ts";

export type ArchiveGame = { id: string; date: string; teams: string[]; scored: boolean };
export type LabEntry = { player: string; team: string; game: string; value: ShotValueFilter; band: string; model: boolean; dateRange: "all" | "scored" };

export type LabScope = {
  player: string;
  team: string;
  game: string;
  start: string;
  end: string;
  comparison: string;
  benchmark: string;
};

export function labSearch(scope: LabScope) {
  return new URLSearchParams({ ...scope, scope: "lab" }).toString();
}

export function teamSearch(team: string, version: string) {
  return new URLSearchParams({ scope: "team", team, version }).toString();
}

export function selectLabShots(shots: Shot[], scope: LabScope) {
  const { player, team, game, start, end, comparison, benchmark } = scope;
  return shots.filter(shot => {
    if (shot.date < start || shot.date > end || (game && shot.game !== game)) return false;
    if (shot.player === player) return !team || shot.team === team;
    if (comparison) return shot.player === comparison;
    return benchmark === "pool" || shot.team === benchmark;
  });
}

export function gameLabel(game: ArchiveGame) {
  return game.teams.join(" vs ");
}

export const shotPageSize = 8;
const individualPlotLimit = 2_000;

type BenchmarkOptions = {
  first: ShotFilters;
  second: ShotFilters;
  band: string;
  scoredOnly: boolean;
};
export type BenchmarkPage = { index: number; a: boolean; b: boolean };
export type ShotBin = { x: number; y: number; makes: number; misses: number };

export function benchmarkSearch(scope: LabScope, options: BenchmarkOptions, page?: BenchmarkPage) {
  const params = new URLSearchParams({ ...scope, scope: page ? "benchmark-shots" : "benchmark", band: options.band, scored: options.scoredOnly ? "1" : "0" });
  for (const [prefix, filters] of [["a", options.first], ["b", options.second]] as const) {
    for (const [key, value] of Object.entries(filters)) if (value) params.set(`${prefix}.${key}`, value);
  }
  if (page) {
    params.set("page", String(page.index));
    params.set("a", page.a ? "1" : "0");
    params.set("b", page.b ? "1" : "0");
  }
  return params.toString();
}

export function readShotFilters(read: (key: string) => string, prefix = ""): ShotFilters {
  const value = read(`${prefix}value`);
  return { ...emptyShotFilters, value: value === "2" || value === "3" ? value : "", zone: read(`${prefix}zone`), family: read(`${prefix}family`), distance: read(`${prefix}distance`), defender: read(`${prefix}defender`), clock: read(`${prefix}clock`) };
}

export function sortShotEvidence(a: Shot, b: Shot) {
  return b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
}

export function selectBenchmarkShots(shots: Shot[], scope: LabScope, { first, second, band, scoredOnly }: BenchmarkOptions) {
  return selectLabShots(shots, scope).filter(shot => {
    if ((band || scoredOnly) && (shot.probability === null || (band && shotBand(shot.probability) !== Number(band)))) return false;
    return matchesShotFilters(shot, shot.player === scope.player ? first : second);
  });
}

export function benchmarkReport(shots: Shot[], scope: LabScope, options: BenchmarkOptions) {
  const cohorts = selectBenchmarkShots(shots, scope, options);
  const first = cohorts.filter(shot => shot.player === scope.player);
  const second = cohorts.filter(shot => shot.player !== scope.player);
  const aggregate = second.length > individualPlotLimit;
  const bins = new Map<string, ShotBin>();
  let plottedSecond = 0;
  let firstPlottedSecond: Shot | undefined;
  for (const shot of second) {
    const location = courtPosition(shot);
    if (!location) continue;
    plottedSecond++;
    firstPlottedSecond ??= shot;
    if (!aggregate) continue;
    const key = `${Math.round(location.x / 20)},${Math.round(location.y / 20)}`;
    const bin = bins.get(key) ?? { x: 0, y: 0, makes: 0, misses: 0 };
    bin.x += location.x;
    bin.y += location.y;
    if (shot.made) bin.makes++;
    else bin.misses++;
    bins.set(key, bin);
  }
  const density = aggregate ? [...bins.values()].map(bin => {
    const size = bin.makes + bin.misses;
    return { ...bin, x: bin.x / size, y: bin.y / size };
  }) : undefined;
  return { first, second: aggregate ? [] : second, totals: summarize(second), plottedSecond, density, example: firstPlottedSecond ?? second[0] };
}

export type BenchmarkReport = ReturnType<typeof benchmarkReport>;

export function benchmarkEvidence(shots: Shot[], scope: LabScope, options: BenchmarkOptions, page: BenchmarkPage) {
  const matches = selectBenchmarkShots(shots, scope, options).filter(shot => shot.player === scope.player ? page.a : page.b).sort(sortShotEvidence);
  const index = Math.max(0, Math.min(page.index, Math.ceil(matches.length / shotPageSize) - 1));
  return { rows: matches.slice(index * shotPageSize, (index + 1) * shotPageSize), total: matches.length, index };
}

export type BenchmarkEvidence = ReturnType<typeof benchmarkEvidence>;
