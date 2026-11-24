import type { Metadata } from "next";
import { getCatalog, getDataset } from "../../lib/dataset";
import { modelSearch, studyShots } from "../../lib/model-study";
import { ShotModel } from "../../screens/shot-model";

export const metadata: Metadata = { title: "Shot Quality Model" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const { source, defaultPlayer, teams, games, attempts, scored, retrospective, earliestScore, scoredStart, scoredEnd } = getCatalog();
  const scoredGames = games.filter(game => game.scored);
  const window = query.window === "holdout" ? "holdout" as const : "full" as const;
  const team = typeof query.team === "string" && Object.hasOwn(teams, query.team) ? query.team : "";
  const game = scoredGames.find(game => game.id === query.game && (window === "full" || game.date >= scoredStart) && (!team || game.teams.includes(team)))?.id ?? "";
  const value = query.value === "2" || query.value === "3" ? query.value : "";
  const scope = { team, game, value, window };
  const initial = { query: modelSearch(scope), data: studyShots(getDataset().shots, scope, scoredStart) };
  const selected = initial.data.players.find(player => player.name === query.player);
  const entry = { scope, player: selected?.name ?? defaultPlayer, minimum: game || (selected && selected.attempts < 20) ? "1" : "20" };
  return <ShotModel key={JSON.stringify(entry)} catalog={{ source, teams, games: scoredGames, attempts, scored, retrospective, earliestScore, scoredStart, scoredEnd }} entry={entry} initial={initial} />;
}
