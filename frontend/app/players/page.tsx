import type { Metadata } from "next";
import { getCatalog, getDataset } from "../../lib/dataset";
import { finderSearch, playerFinder, type FinderScope } from "../../lib/player-finder";
import { emptyShotFilters } from "../../lib/shots";
import { PlayerFinder } from "../../screens/player-finder";
import "../finder.css";

export const metadata: Metadata = { title: "Player Finder" };

export default function Page() {
  const { source, shots, scoredStart } = getDataset();
  const { teams, players, defaultTeam, filterOptions, start, end, retrospective } = getCatalog();
  const scope: FinderScope = { team: defaultTeam, window: "full", pool: "outside" };
  const query = finderSearch(scope, emptyShotFilters, "top");
  const data = playerFinder(shots, scope, emptyShotFilters, "top", scoredStart);
  return <PlayerFinder names={Object.fromEntries(players.map(player => [player.name, player.displayName]))} catalog={{ source, teams, defaultTeam, filterOptions, start, end, scoredStart, retrospective }} initial={{ query, data }} />;
}
