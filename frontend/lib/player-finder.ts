import { emptyShotFilters, matchesShotFilters, smallSampleThreshold, summarize, type Shot, type ShotFilters } from "./shots.ts";
import { scoutRates, teamScout } from "./team-scout.ts";

export type FinderScope = { team: string; window: "full" | "holdout"; pool: "outside" | "all" };
export type FinderSort = "pps" | "expectedPps" | "fg" | "expectedFg" | "gap" | "attempts";

const looks = [
  { id: "threes", title: "Three-point shooting", bucket: "3PT", value: "3", zone: "" },
  { id: "corner", title: "Corner threes", bucket: "3PT · Corner three", value: "3", zone: "Corner three" },
  { id: "above-break", title: "Above-the-break threes", bucket: "3PT · Above the break", value: "3", zone: "Above the break" },
  { id: "rim", title: "Finishing at the rim", bucket: "2PT · Rim", value: "2", zone: "Rim" },
  { id: "paint", title: "Paint scoring", bucket: "2PT · Paint", value: "2", zone: "Paint" },
  { id: "midrange", title: "Midrange shooting", bucket: "2PT · Midrange", value: "2", zone: "Midrange" },
] as const;

export function finderSearch(scope: FinderScope, filters: ShotFilters, need = "", player = "") {
  return new URLSearchParams({ scope: player ? "player-finder-shots" : "player-finder", ...scope, ...filters, need, player }).toString();
}

function analyzeNeeds(shots: Shot[], team: string, start: string) {
  const { own, league } = teamScout(shots, { from: start, through: "9999-12-31", before: "" }, team, "", "zone");
  const total = (buckets: typeof league) => (buckets["2PT"]?.totals.attempts ?? 0) + (buckets["3PT"]?.totals.attempts ?? 0);
  const teamTotal = total(own.shooting);
  const archiveTotal = total(league);
  if (teamTotal < smallSampleThreshold) return [];
  return looks.flatMap(look => {
    const current = own.shooting[look.bucket]?.totals;
    const archive = league[look.bucket]?.totals;
    if (!archive || archive.attempts < smallSampleThreshold) return [];
    const rates = scoutRates(current);
    const baseline = scoutRates(archive);
    const share = (current?.attempts ?? 0) / teamTotal;
    const archiveShare = archive.attempts / archiveTotal;
    const efficiencyGap = current && current.attempts >= smallSampleThreshold && rates.actual !== null && baseline.actual !== null ? baseline.actual - rates.actual : 0;
    const usageGap = archiveShare - share;
    const deficit = Math.max(efficiencyGap, usageGap);
    if (deficit < .02) return [];
    return [{ ...look, rates, baseline, share, archiveShare, attempts: current?.attempts ?? 0, deficit, reason: efficiencyGap >= usageGap ? "Lower actual FG%" : "Lower shot share" }];
  }).sort((a, b) => b.deficit - a.deficit || a.id.localeCompare(b.id));
}

function summarizeFinderShots(shots: Shot[]) {
  const stats = summarize(shots);
  const matchedActual = stats.scored === stats.attempts ? stats.fg : summarize(shots.filter(shot => shot.probability !== null)).fg;
  return { ...stats, matchedActual, gap: matchedActual !== null && stats.expectedFg !== null ? matchedActual - stats.expectedFg : null };
}

function latestShot(last: Shot | undefined, shot: Shot) {
  return !last || last.date < shot.date || (last.date === shot.date && last.game < shot.game) ? shot : last;
}

export function playerFinder(shots: Shot[], scope: FinderScope, filters: ShotFilters, need: string, holdoutStart: string) {
  const start = scope.window === "holdout" ? holdoutStart : "";
  const needs = analyzeNeeds(shots, scope.team, start);
  const active = need === "top" ? needs[0] : needs.find(item => item.id === need);
  const appliedFilters = active ? { ...emptyShotFilters, value: active.value, zone: active.zone } : filters;
  const teams = new Map<string, Shot>();
  const groups = new Map<string, Shot[]>();
  const teamShots: Shot[] = [];
  const archiveShots: Shot[] = [];
  for (const shot of shots) {
    teams.set(shot.player, latestShot(teams.get(shot.player), shot));
    if (shot.date < start || !matchesShotFilters(shot, appliedFilters)) continue;
    archiveShots.push(shot);
    if (shot.team === scope.team) {
      teamShots.push(shot);
      if (scope.pool === "outside") continue;
    }
    const group = groups.get(shot.player);
    if (group) group.push(shot);
    else groups.set(shot.player, [shot]);
  }
  const players = [...groups].flatMap(([name, attempts]) => {
    const team = teams.get(name)!.team;
    return scope.pool === "outside" && team === scope.team ? [] : [{ name, team, ...summarizeFinderShots(attempts) }];
  });
  return { needs, activeNeed: active?.id ?? "", filters: appliedFilters, players, team: summarizeFinderShots(teamShots), archive: summarizeFinderShots(archiveShots) };
}

export type FinderReport = ReturnType<typeof playerFinder>;

export function playerFinderShots(shots: Shot[], scope: FinderScope, filters: ShotFilters, name: string, holdoutStart: string) {
  if (!name) return [];
  const playerShots = shots.filter(shot => shot.player === name);
  const latest = playerShots.reduce<Shot | undefined>(latestShot, undefined);
  if (scope.pool === "outside" && latest?.team === scope.team) return [];
  return playerShots.filter(shot => (scope.window !== "holdout" || shot.date >= holdoutStart) && (scope.pool !== "outside" || shot.team !== scope.team) && matchesShotFilters(shot, filters));
}

export function rankFinderPlayers(players: FinderReport["players"], order: FinderSort, minimum: number, name: string, team: string) {
  const query = name.trim().toLowerCase();
  const usesModel = order === "expectedPps" || order === "expectedFg" || order === "gap";
  return players.filter(player => (usesModel ? player.scored : player.attempts) >= minimum && (!team || player.team === team) && player.name.toLowerCase().includes(query))
    .sort((a, b) => (b[order] ?? -Infinity) - (a[order] ?? -Infinity) || b.attempts - a.attempts || a.name.localeCompare(b.name));
}
