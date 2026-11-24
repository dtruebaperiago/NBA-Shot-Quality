import type { Metadata } from "next";
import { teamSearch } from "../../lib/archive-query";
import { getCatalog, getDataset, getDatasetVersion } from "../../lib/dataset";
import { matchupOpponent, trackedTeamHistory } from "../../lib/scout-tendencies";
import { ScoutBrief } from "../../screens/scout-brief";

export const metadata: Metadata = { title: "Opponent Scout Brief" };

export default function Page() {
  const catalog = getCatalog();
  const { defaultTeam, source, teams, games, gameRosters, start, end, scoredStart } = catalog;
  const game = games.find(game => game.teams.includes(defaultTeam));
  const opponent = matchupOpponent(game, defaultTeam) ?? Object.keys(teams).find(team => team !== defaultTeam) ?? "";
  const archiveVersion = getDatasetVersion();
  return <ScoutBrief dataset={{ defaultTeam, source, teams, games, start, end, scoredStart }} archiveVersion={archiveVersion} teamHistory={trackedTeamHistory(games, gameRosters)} entry={{ opponent, game: game?.id ?? "" }} initial={{ query: teamSearch(opponent, archiveVersion), data: getDataset().shots.filter(shot => shot.team === opponent) }} />;
}
