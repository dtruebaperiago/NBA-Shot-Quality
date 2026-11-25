import { labSearch, selectLabShots, type LabEntry } from "../lib/archive-query";
import { getCatalog, getDataset } from "../lib/dataset";
import { probabilityBands } from "../lib/model-study";
import { ShotLab } from "../screens/shot-lab";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const catalog = getCatalog();
  const selected = catalog.players.find(player => player.name === params.player);
  const team = typeof params.team === "string" && Object.hasOwn(catalog.teams, params.team) && selected?.teams.includes(params.team) ? params.team : "";
  const game = catalog.games.find(game => game.id === params.game && (!team || game.teams.includes(team)));
  const entry: LabEntry = {
    player: selected?.name ?? catalog.defaultPlayer,
    team,
    game: game?.id ?? "",
    value: params.value === "2" || params.value === "3" ? params.value : "",
    band: probabilityBands.findIndex((_, index) => String(index) === params.band) >= 0 ? String(params.band) : "",
    model: params.model === "1",
    dateRange: params.window === "full" || (game && game.date < catalog.scoredStart) || selected?.holdout === false ? "all" : "scored",
  };
  const scope = { player: entry.player, team, game: entry.game, start: entry.dateRange === "all" ? catalog.start : catalog.scoredStart, end: catalog.end, comparison: "", benchmark: "" };
  const query = labSearch(scope);
  const openFresh = Boolean(selected || team || game || entry.value || entry.band || entry.model || params.window === "full" || params.window === "holdout");
  return <ShotLab key={JSON.stringify([openFresh, entry])} openFresh={openFresh} dataset={catalog} entry={entry} initial={{ query, data: selectLabShots(getDataset().shots, scope) }} />;
}
