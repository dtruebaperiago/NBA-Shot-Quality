import { matchesProbabilityRange, type ProbabilityRange } from "./model-study.ts";
import { matchesShotFilters, summarize, type Shot, type ShotFilters } from "./shots.ts";

export const positionBenchmarks = [
  { value: "position:guard", label: "Guards", positions: "PG and SG" },
  { value: "position:wing", label: "Wings / forwards", positions: "SF and PF" },
  { value: "position:center", label: "Centers", positions: "C" },
] as const;

export type PositionBenchmark = (typeof positionBenchmarks)[number]["value"];
export type PlayerPositions = Record<string, PositionBenchmark>;
export type SeasonTotals = Record<
  "games" | "games_started" | "mp" | "fg" | "fga" | "fg2" | "fg2a" | "fg3" | "fg3a" |
  "ft" | "fta" | "orb" | "drb" | "trb" | "ast" | "stl" | "blk" | "tov" | "pf" | "pts",
  number
>;
export type PlayerSeason = { name: string; position: string; through?: string; totals?: SeasonTotals };
export const historicalProfileCutoff = "2015-03-03";

export function positionBenchmark(position?: string): PositionBenchmark | undefined {
  if (position === "PG" || position === "SG") return "position:guard";
  if (position === "SF" || position === "PF") return "position:wing";
  if (position === "C") return "position:center";
}

export function archivePlayerId({ id }: Pick<Shot, "id">) {
  return /^\d+-(\d+)-\d+$/.exec(id)?.[1];
}

export function playerProfileLink(name: string, filters: Record<string, string> = {}) {
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== ""));
  return "/players/" + encodeURIComponent(name) + (query.size ? "?" + query : "");
}

export function trackedShooting(shots: Shot[]) {
  return (["all", "2", "3"] as const).map(value => {
    const matching = value === "all" ? shots : shots.filter(shot => String(shot.value) === value);
    const makes = matching.filter(shot => shot.made).length;
    const threes = matching.filter(shot => shot.value === 3 && shot.made).length;
    return { value, makes, effectiveFg: matching.length ? (makes + .5 * threes) / matching.length : null, ...summarize(matching) };
  });
}

export type ProfileShotScope = {
  team: string;
  game: string;
  from: string;
  excludeTeam?: string;
  range?: ProbabilityRange;
  scoredOnly?: boolean;
};

export function profileShots(shots: Shot[], filters: ShotFilters, scope: ProfileShotScope) {
  return shots.filter(shot => (!scope.team || shot.team === scope.team) && (!scope.game || shot.game === scope.game) && shot.date >= scope.from
    && (!scope.excludeTeam || shot.team !== scope.excludeTeam) && (!scope.scoredOnly || shot.probability !== null)
    && (!scope.range || matchesProbabilityRange(shot.probability, scope.range))
    && matchesShotFilters(shot, filters));
}
