import type { Shot } from "./shots";

export const probabilityBands = ["Under 20%", "20–<40%", "40–<60%", "60–<80%", "80% and up"];

export function shotBand(probability: number) {
  return Math.min(probabilityBands.length - 1, Math.floor(probability * probabilityBands.length));
}

export type ModelWindow = "full" | "holdout";
export type ModelScope = { team: string; game: string; value: string; window: ModelWindow };

export type ProbabilityRange = readonly [number, number];

export function parseProbabilityRange(lower: string, upper: string): ProbabilityRange | undefined {
  if (!lower.trim() || !upper.trim()) return undefined;
  const min = Number(lower);
  const max = Number(upper);
  if (Number.isFinite(min) && Number.isFinite(max) && min >= 0 && max <= 100 && min <= max) return [min / 100, max / 100];
}

export function matchesProbabilityRange(probability: number | null, [min, max]: ProbabilityRange) {
  return probability !== null && probability >= min && probability <= max;
}

export function modelSearch(scope: ModelScope, range?: { lower: string; upper: string }) {
  return new URLSearchParams({ ...scope, ...range, scope: "model" }).toString();
}

type ScoredTotals = { attempts: number; makes: number; expectedMakes: number; points: number; expectedPoints: number };
type PlayerTotals = ScoredTotals & { name: string; teams: string[]; bands: ScoredTotals[] };

function totals(): ScoredTotals {
  return { attempts: 0, makes: 0, expectedMakes: 0, points: 0, expectedPoints: 0 };
}

function addAttempt(group: ScoredTotals, shot: Shot, probability: number) {
  group.attempts++;
  group.makes += Number(shot.made);
  group.expectedMakes += probability;
  group.points += shot.made ? shot.value : 0;
  group.expectedPoints += shot.value * probability;
}

export function studyShots(shots: Shot[], { team, game, value, window }: ModelScope, holdoutStart: string, range?: ProbabilityRange) {
  const pool = totals();
  const groups = new Map<string, PlayerTotals>();
  for (const shot of shots) {
    if (shot.probability === null || (range && !matchesProbabilityRange(shot.probability, range)) || (window === "holdout" && shot.date < holdoutStart) || (team && shot.team !== team) || (game && shot.game !== game) || (value && String(shot.value) !== value)) continue;
    let player = groups.get(shot.player);
    if (!player) {
      player = { name: shot.player, teams: [], bands: probabilityBands.map(totals), ...totals() };
      groups.set(shot.player, player);
    }
    if (!player.teams.includes(shot.team)) player.teams.push(shot.team);
    addAttempt(player, shot, shot.probability);
    addAttempt(player.bands[shotBand(shot.probability)], shot, shot.probability);
    addAttempt(pool, shot, shot.probability);
  }
  return { pool, players: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

export type ModelStudy = ReturnType<typeof studyShots>;
export type ModelMetric = "fg" | "pps";

export function modelRates({ attempts, makes, expectedMakes, points, expectedPoints }: ScoredTotals, metric: ModelMetric) {
  if (!attempts) return { actual: null, expected: null, gap: null };
  const actual = (metric === "fg" ? makes : points) / attempts;
  const expected = (metric === "fg" ? expectedMakes : expectedPoints) / attempts;
  return { actual, expected, gap: actual - expected };
}
