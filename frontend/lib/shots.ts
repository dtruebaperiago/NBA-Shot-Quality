export type Shot = {
  id: string;
  game: string;
  date: string;
  player: string;
  team: string;
  opponent: string;
  period: number;
  gameClock: number;
  shotClock: number | null;
  defender: number | null;
  basketDistance?: number | null;
  value: 2 | 3;
  made: boolean;
  probability: number | null;
  retrospective?: boolean;
  contextConflict?: boolean;
  trackingOnly?: boolean;
  x: number | null;
  y: number | null;
  zone: string;
  family: string;
};

export type ShotValueFilter = "" | "2" | "3";
export type ShotFilters = { value: ShotValueFilter; zone: string; family: string; distance: string; defender: string; clock: string };
export type ShotFilterOptions = Record<ShotValueFilter, { zones: string[]; families: string[] }>;
export const emptyShotFilters: ShotFilters = { value: "", zone: "", family: "", distance: "", defender: "", clock: "" };
export const defenderOptions = [{ value: "open", label: "4+ ft" }, { value: "close", label: "Under 4 ft" }] as const;

export const basketDistanceBands = [
  { id: "2-close", value: 2, min: 0, max: 8, label: "Under 8 ft" },
  { id: "2-middle", value: 2, min: 8, max: 16, label: "8 to under 16 ft" },
  { id: "2-long", value: 2, min: 16, max: Infinity, label: "16 ft and up" },
  { id: "3-near", value: 3, min: 0, max: 30, label: "Under 30 ft" },
  { id: "3-deep", value: 3, min: 30, max: Infinity, label: "30 ft and up" },
] as const;

export function shotDistance(shot: Pick<Shot, "x" | "y" | "basketDistance">) {
  const { x, y, basketDistance } = shot;
  const fromCourt = x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y);
  const distance = fromCourt ? Math.hypot(x, y) / 10 : basketDistance ?? null;
  return { distance, fromCourt };
}

export function matchesBasketDistance(shot: Shot, filter: string) {
  if (!filter) return true;
  const band = basketDistanceBands.find(option => option.id === filter);
  if (!band || band.value !== shot.value) return false;
  const { distance } = shotDistance(shot);
  return distance !== null && distance >= band.min && distance < band.max;
}

export function matchesShotFilters(shot: Shot, filters: ShotFilters) {
  if (filters.value && String(shot.value) !== filters.value) return false;
  if (filters.zone && shot.zone !== filters.zone) return false;
  if (filters.family && shot.family !== filters.family) return false;
  if (!matchesBasketDistance(shot, filters.distance)) return false;
  if (filters.defender && (shot.defender === null || (filters.defender === "open" ? shot.defender < 4 : shot.defender >= 4))) return false;
  return !filters.clock || (shot.shotClock !== null && (filters.clock === "early" ? shot.shotClock >= 15 : shot.shotClock < 7));
}

export function describeShotFilters(filters: ShotFilters) {
  const band = basketDistanceBands.find(option => option.id === filters.distance);
  const value = filters.value || band?.value;
  return [value && `${value}PT`, filters.zone, filters.family, band && `${band.label} from basket`, defenderOptions.find(option => option.value === filters.defender)?.label,
    filters.clock && (filters.clock === "early" ? "15+ s on clock" : "Under 7 s on clock")].filter(Boolean).join(" · ") || "All shot situations";
}

export function shotFilterOptions(shots: Shot[]): ShotFilterOptions {
  function optionsForValue(value?: Shot["value"]) {
    const zones = new Set<string>();
    const families = new Set<string>();
    for (const shot of shots) {
      if (value !== undefined && shot.value !== value) continue;
      if (shot.zone && shot.zone !== "Unknown") zones.add(shot.zone);
      if (shot.family && shot.family !== "Unknown") families.add(shot.family);
    }
    return { zones: [...zones].sort(), families: [...families].sort() };
  }

  return { "": optionsForValue(), "2": optionsForValue(2), "3": optionsForValue(3) };
}

export function withShotValue(filters: ShotFilters, value: ShotValueFilter, options: ShotFilterOptions): ShotFilters {
  const { zones, families } = options[value];
  return {
    ...filters,
    value,
    zone: zones.includes(filters.zone) ? filters.zone : "",
    family: families.includes(filters.family) ? filters.family : "",
    distance: !value || basketDistanceBands.some(band => band.id === filters.distance && String(band.value) === value) ? filters.distance : "",
  };
}

export type Team = { name: string; color: string; city: string; mark: string };
export type Dataset = {
  source: "archive" | "sample";
  label: string;
  start: string;
  end: string;
  scoredStart: string;
  defaultPlayer: string;
  teams: Record<string, Team>;
  shots: Shot[];
};

const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const datedYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const displayDate = (date: string, year = false) => (year ? datedYear : shortDate).format(new Date(`${date}T00:00:00Z`));

export const percentage = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
export const decimal = (value: number | null) => value === null ? "—" : value.toFixed(2);
export const count = (value: number) => value.toLocaleString("en-US");
export const gameClock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
export const smallSampleThreshold = 20;
export const isSmallSample = (attempts: number) => attempts > 0 && attempts < smallSampleThreshold;

export function summarize(shots: Shot[]) {
  let makes = 0;
  let points = 0;
  let scored = 0;
  let expectedMakes = 0;
  let expectedPoints = 0;

  for (const shot of shots) {
    makes += Number(shot.made);
    points += shot.made ? shot.value : 0;
    if (shot.probability !== null) {
      scored++;
      expectedMakes += shot.probability;
      expectedPoints += shot.probability * shot.value;
    }
  }

  const attempts = shots.length;
  return {
    attempts,
    scored,
    fg: attempts ? makes / attempts : null,
    pps: attempts ? points / attempts : null,
    expectedFg: scored ? expectedMakes / scored : null,
    expectedPps: scored ? expectedPoints / scored : null,
  };
}

export const courtBounds = { left: -250, right: 250, top: -52.5, bottom: 360 } as const;

export function courtPosition({ x, y }: Pick<Shot, "x" | "y">) {
  const { left, right, top, bottom } = courtBounds;
  if (x === null || y === null || !Number.isFinite(x) || !Number.isFinite(y) || x < left || x > right) return null;
  const plottedY = Math.max(top, Math.min(bottom, y));
  return { x, y: plottedY, atDepthLimit: plottedY !== y };
}
