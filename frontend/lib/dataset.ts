import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { sampleDataset } from "./sample";
import { shotFilterOptions, type Dataset } from "./shots";
import type { ArchiveGame } from "./archive-query";

let cached: Dataset | undefined;
let version: string;
let catalog: ReturnType<typeof buildCatalog> | undefined;

export function getDataset(): Dataset {
  if (cached) return cached;

  if (process.env.NODE_ENV === "development") {
    try {
      const raw = readFileSync(join(/* turbopackIgnore: true */ process.cwd(), ".local", "archive.json"));
      cached = JSON.parse(raw.toString("utf8")) as Dataset;
      version = createHash("sha256").update(raw).digest("hex");
      return cached;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    }
  }

  cached = sampleDataset();
  version = createHash("sha256").update(JSON.stringify(cached)).digest("hex");
  return cached;
}

export function getDatasetVersion() {
  getDataset();
  return version;
}

function buildCatalog({ shots, ...metadata }: Dataset) {
  const { defaultPlayer } = metadata;
  const players = new Map<string, { name: string; teams: Set<string>; attempts: number; holdout: boolean }>();
  const games = new Map<string, ArchiveGame>();
  const gameRosters = new Map<string, Record<string, Set<string>>>();
  for (const shot of shots) {
    const scored = shot.probability !== null;
    const player = players.get(shot.player) ?? { name: shot.player, teams: new Set<string>(), attempts: 0, holdout: false };
    player.teams.add(shot.team);
    player.attempts++;
    player.holdout ||= scored && shot.date >= metadata.scoredStart;
    players.set(shot.player, player);
    const game = games.get(shot.game) ?? { id: shot.game, date: shot.date, teams: [shot.team, shot.opponent].sort(), scored: false };
    game.scored ||= scored;
    games.set(shot.game, game);
    const roster = gameRosters.get(shot.game) ?? {};
    (roster[shot.team] ??= new Set()).add(shot.player);
    gameRosters.set(shot.game, roster);
  }
  return {
    ...metadata,
    defaultTeam: shots.find(shot => shot.player === defaultPlayer)?.team ?? Object.keys(metadata.teams)[0],
    comparisonPlayer: [...players.values()].filter(player => player.name !== defaultPlayer).sort((a, b) => b.attempts - a.attempts)[0]?.name ?? "",
    players: [...players.values()].map(player => ({ name: player.name, teams: [...player.teams].sort(), holdout: player.holdout })).sort((a, b) => a.name.localeCompare(b.name)),
    games: [...games.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)),
    gameRosters: Object.fromEntries([...gameRosters].map(([id, rosters]) => [id, Object.fromEntries(Object.entries(rosters).map(([team, names]) => [team, [...names]]))])),
    filterOptions: shotFilterOptions(shots),
    attempts: shots.length,
    scored: shots.filter(shot => shot.probability !== null).length,
    retrospective: shots.filter(shot => shot.retrospective).length,
    earliestScore: shots.findLast(shot => shot.probability !== null)?.date ?? metadata.scoredStart,
    scoredEnd: shots.find(shot => shot.probability !== null)?.date ?? metadata.end,
  };
}

export type ArchiveCatalog = ReturnType<typeof buildCatalog>;

export function getCatalog() {
  return catalog ??= buildCatalog(getDataset());
}
