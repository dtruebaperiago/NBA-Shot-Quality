import type { ArchiveGame } from "./archive-query";
import { smallSampleThreshold, summarize, type Shot } from "./shots.ts";

export function matchupOpponent(game: ArchiveGame | undefined, ownTeam: string) {
  return game?.teams.includes(ownTeam) ? game.teams.find(team => team !== ownTeam) : undefined;
}

export function scoutEvidence(shots: Shot[], opponent: string, from: string, through: string, before?: string) {
  return shots.filter(shot => shot.team === opponent && (before ? shot.date < before : shot.date >= from && shot.date <= through));
}

type TeamHistory = Record<string, { date: string; team: string }[]>;

export function trackedTeamHistory(games: ArchiveGame[], rosters: Record<string, Record<string, string[]>>) {
  const history: TeamHistory = {};
  for (const game of games.toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))) {
    for (const [team, players] of Object.entries(rosters[game.id] ?? {})) {
      for (const player of players) {
        const stints = history[player] ??= [];
        if (stints.at(-1)?.team !== team) stints.push({ date: game.date, team });
      }
    }
  }
  return history;
}

export function pregameShooters(shots: Shot[], history: TeamHistory, before: string) {
  return shots.filter(shot => {
    const last = history[shot.player]?.findLast(stint => stint.date < before);
    return !last || last.team === shot.team;
  });
}

export type Tendency = {
  id: string;
  kind: string;
  title: string;
  attempts: number;
  shots: Shot[];
  actual: number | null;
  expected: number | null;
  scored: number;
  matchedActual: number | null;
  gap: number | null;
};

export function scoutTendencies(shots: Shot[]) {
  const players = new Map<string, Shot[]>();
  for (const shot of shots) {
    const attempts = players.get(shot.player);
    if (attempts) attempts.push(shot);
    else players.set(shot.player, [shot]);
  }

  const results: Tendency[] = [];
  for (const [player, attempts] of players) {
    const groups = new Map<string, { kind: string; title: string; shots: Shot[] }>();
    for (const shot of attempts) {
      const spacing = shot.defender === null ? null : shot.defender >= 4 ? "4+ ft of space" : "Under 4 ft of space";
      const contexts = [["Court zone", shot.zone], ["Shot type", shot.family], ["Defender distance", spacing]];
      for (const [kind, label] of contexts) {
        if (!kind || !label || label === "Unknown") continue;
        const title = `${player} · ${shot.value}PT · ${label}`;
        const id = `${kind} · ${title}`;
        const bucket = groups.get(id);
        if (bucket) bucket.shots.push(shot);
        else groups.set(id, { kind, title, shots: [shot] });
      }
    }

    for (const [id, group] of groups) {
      const metrics = summarize(group.shots);
      const matchedActual = metrics.scored === metrics.attempts ? metrics.fg : summarize(group.shots.filter(shot => shot.probability !== null)).fg;
      const gap = matchedActual !== null && metrics.expectedFg !== null ? matchedActual - metrics.expectedFg : null;
      results.push({ ...group, id, attempts: attempts.length, actual: metrics.fg, expected: metrics.expectedFg, scored: metrics.scored, matchedActual, gap });
    }
  }

  return results.sort(byVolume);
}

function byVolume(a: Tendency, b: Tendency) {
  return b.shots.length - a.shots.length || a.id.localeCompare(b.id);
}

const rateOrders = {
  expected: ["expected", -1],
  actual: ["actual", -1],
  "low-expected": ["expected", 1],
  "low-actual": ["actual", 1],
  above: ["gap", -1],
  below: ["gap", 1],
} as const;

export type ScoutOrder = "balanced" | "volume" | keyof typeof rateOrders;
type RankedTendency = Tendency & { priority?: string };

export function rankTendencies(tendencies: Tendency[], order: ScoutOrder, allowModel = true): RankedTendency[] {
  if (order === "volume") return tendencies;
  if (!allowModel && order !== "balanced" && order !== "actual" && order !== "low-actual") order = "actual";
  function rank(order: keyof typeof rateOrders) {
    const [field, direction] = rateOrders[order];
    const qualifies = (tendency: Tendency) => (field === "actual" ? tendency.shots.length : tendency.scored) >= smallSampleThreshold;
    return tendencies.filter(qualifies).sort((a, b) => direction * ((a[field] ?? 0) - (b[field] ?? 0)) || byVolume(a, b));
  }

  if (order !== "balanced") {
    const ranked = rank(order);
    const rankedIds = new Set(ranked.map(tendency => tendency.id));
    return [...ranked, ...tendencies.filter(tendency => !rankedIds.has(tendency.id))];
  }

  const priorities = new Map<string, RankedTendency>();
  function addFirst(candidates: Tendency[], priority: string) {
    const next = candidates.find(tendency => !priorities.has(tendency.id));
    if (next) priorities.set(next.id, { ...next, priority });
  }
  addFirst(tendencies, "High volume");
  if (allowModel) {
    addFirst(rank("expected"), "High expected FG%");
    addFirst(rank("above").filter(tendency => (tendency.gap ?? 0) >= .005), "Above expected");
  }
  addFirst(rank("actual"), "High actual FG%");
  return [...priorities.values(), ...tendencies.filter(tendency => !priorities.has(tendency.id))];
}
