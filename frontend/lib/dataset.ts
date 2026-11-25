import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { archivePlayerId, positionBenchmark, type PlayerPositions, type PlayerSeason, type PositionBenchmark } from "./player-profile";
import { shotFilterOptions, type Dataset, type Shot } from "./shots";
import type { ArchiveGame } from "./archive-query";

let cached: Dataset | undefined;
let version: string;
let catalog: ReturnType<typeof buildCatalog> | undefined;
let seasons: Record<string, PlayerSeason> | undefined;

function readArchiveFile(name: "archive.json" | "player-seasons.json") {
  try {
    return readFileSync(join(/* turbopackIgnore: true */ process.cwd(), ".local", name));
  } catch (error) {
    throw new Error("Could not read the required historical archive file .local/" + name, { cause: error });
  }
}

export function getDataset(): Dataset {
  if (cached) return cached;
  const raw = readArchiveFile("archive.json");
  const dataset = JSON.parse(raw.toString("utf8")) as Dataset;
  if (dataset.source !== "archive" || !Array.isArray(dataset.shots) || !dataset.shots.length) {
    throw new Error("The historical shot archive is empty or invalid.");
  }
  version = createHash("sha256").update(raw).digest("hex");
  cached = dataset;
  return cached;
}

export function getDatasetVersion() {
  getDataset();
  return version;
}

export function getPlayerSeason(shot: Shot) {
  const id = archivePlayerId(shot);
  if (!id) return undefined;
  seasons ??= JSON.parse(readArchiveFile("player-seasons.json").toString("utf8")) as Record<string, PlayerSeason>;
  return Object.hasOwn(seasons, id) ? seasons[id] : undefined;
}

function buildCatalog({ shots, ...metadata }: Dataset) {
  const { defaultPlayer } = metadata;
  const players = new Map<string, { name: string; displayName: string; position?: PositionBenchmark; teams: Set<string>; attempts: number; holdout: boolean }>();
  const games = new Map<string, ArchiveGame>();
  const gameRosters = new Map<string, Record<string, Set<string>>>();
  for (const shot of shots) {
    const scored = shot.probability !== null;
    let player = players.get(shot.player);
    if (!player) {
      const season = getPlayerSeason(shot);
      const position = positionBenchmark(season?.position);
      player = { name: shot.player, displayName: season?.name ?? shot.player, position, teams: new Set<string>(), attempts: 0, holdout: false };
      players.set(shot.player, player);
    }
    player.teams.add(shot.team);
    player.attempts++;
    player.holdout ||= scored && shot.date >= metadata.scoredStart;
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
    players: [...players.values()].map(({ name, displayName, position, teams, holdout }) => ({ name, displayName, position, teams: [...teams].sort(), holdout })).sort((a, b) => a.displayName.localeCompare(b.displayName)),
    playerPositions: Object.fromEntries([...players.values()].flatMap(player => player.position ? [[player.name, player.position]] : [])) as PlayerPositions,
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
