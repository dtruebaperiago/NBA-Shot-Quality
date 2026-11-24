import { smallSampleThreshold, type Shot } from "./shots.ts";

export type ScoutDates = { from: string; through: string; before: string };
export type ScoutSide = "shooting" | "allowed";
export type ScoutDimension = "zone" | "family" | "space";
export type ScoutMeasure = "actual" | "expected" | "gap";
export type TeamEvidence = ScoutDates & { team: string; side: ScoutSide; dimension: ScoutDimension; bucket: string };
export type ScoutTotals = { attempts: number; makes: number; scored: number; scoredMakes: number; expectedMakes: number };
export type ScoutBucket = { label: string; totals: ScoutTotals };
type Profile = Record<ScoutSide, Record<string, ScoutBucket>>;

export function scoutDimension(value: string): ScoutDimension {
  return value === "family" || value === "space" ? value : "zone";
}

export function teamScoutSearch(dates: ScoutDates, own: string, opponent: string, dimension: ScoutDimension) {
  return new URLSearchParams({ scope: "team-scout", ...dates, own, opponent, dimension }).toString();
}

export function teamEvidenceSearch(query: TeamEvidence) {
  return new URLSearchParams({ scope: "team-scout-shots", ...query }).toString();
}

function inWindow(shot: Shot, dates: ScoutDates) {
  return shot.date >= dates.from && shot.date <= dates.through && (!dates.before || shot.date < dates.before);
}

function splitLabel(shot: Shot, dimension: ScoutDimension) {
  if (dimension === "zone") return shot.zone;
  if (dimension === "family") return shot.family;
  return shot.defender === null ? "Unknown" : shot.defender >= 4 ? "4+ ft of space" : "Under 4 ft of space";
}

const emptyTotals: ScoutTotals = { attempts: 0, makes: 0, scored: 0, scoredMakes: 0, expectedMakes: 0 };

function recordShot(buckets: Record<string, ScoutBucket>, label: string, split: string, shot: Shot) {
  const bucket = buckets[label] ??= { label: split, totals: { ...emptyTotals } };
  const totals = bucket.totals;
  totals.attempts++;
  totals.makes += Number(shot.made);
  if (shot.probability !== null) {
    totals.scored++;
    totals.scoredMakes += Number(shot.made);
    totals.expectedMakes += shot.probability;
  }
}

export function teamScout(shots: Shot[], dates: ScoutDates, own: string, opponent: string, dimension: ScoutDimension) {
  const ownProfile: Profile = { shooting: {}, allowed: {} };
  const opponentProfile: Profile = { shooting: {}, allowed: {} };
  const league: Record<string, ScoutBucket> = {};
  let retrospective = false;

  for (const shot of shots) {
    if (!inWindow(shot, dates)) continue;
    const value = `${shot.value}PT`;
    const context = splitLabel(shot, dimension);
    const detail = `${value} · ${context}`;
    const note = (buckets: Record<string, ScoutBucket>) => {
      recordShot(buckets, value, value, shot);
      if (context && context !== "Unknown") recordShot(buckets, detail, detail, shot);
    };
    note(league);
    if (shot.team === own) note(ownProfile.shooting);
    if (shot.opponent === own) note(ownProfile.allowed);
    if (opponent && shot.team === opponent) note(opponentProfile.shooting);
    if (opponent && shot.opponent === opponent) note(opponentProfile.allowed);
    retrospective ||= Boolean(shot.retrospective);
  }
  return { own: ownProfile, opponent: opponentProfile, league, retrospective };
}

export type TeamScoutReport = ReturnType<typeof teamScout>;

export function teamScoutEvidence(shots: Shot[], query: TeamEvidence) {
  if (!query.team || !query.bucket) return [];
  return shots.filter(shot => {
    if (!inWindow(shot, query) || shot[query.side === "shooting" ? "team" : "opponent"] !== query.team) return false;
    const value = `${shot.value}PT`;
    return query.bucket === value || query.bucket === `${value} · ${splitLabel(shot, query.dimension)}`;
  });
}

export function scoutRates(totals: ScoutTotals = emptyTotals) {
  const { attempts, makes, scored, scoredMakes, expectedMakes } = totals;
  return {
    actual: attempts ? makes / attempts : null,
    expected: scored ? expectedMakes / scored : null,
    gap: scored ? (scoredMakes - expectedMakes) / scored : null,
    extraMakes: scored ? scoredMakes - expectedMakes : null,
    matchedActual: scored ? scoredMakes / scored : null,
  };
}

export function rankingRate(totals: ScoutTotals | undefined, measure: ScoutMeasure) {
  if (!totals || (measure === "actual" ? totals.attempts : totals.scored) < smallSampleThreshold) return null;
  return scoutRates(totals)[measure];
}

export function matchingEdge(attack: ScoutTotals | undefined, allowed: ScoutTotals | undefined, league: ScoutTotals | undefined, measure: ScoutMeasure) {
  const offense = rankingRate(attack, measure);
  const defense = rankingRate(allowed, measure);
  const baseline = measure === "gap" ? 0 : rankingRate(league, measure);
  if (offense === null || defense === null || baseline === null) return null;
  return Math.min(offense - baseline, defense - baseline);
}
