import type { Metadata } from "next";
import { EmptyState, PageHeader } from "../../components/ui";
import { getCatalog, getDataset } from "../../lib/dataset";
import { finderSearch, playerFinder, type FinderScope } from "../../lib/player-finder";
import { emptyShotFilters } from "../../lib/shots";
import { PlayerFinder } from "../../screens/player-finder";
import "../finder.css";

export const metadata: Metadata = { title: "Player Finder" };

export default function Page() {
  const { source, shots, scoredStart } = getDataset();
  if (source !== "archive") return <>
    <PageHeader title="Player Finder" description="Find players by the shots your team needs." />
    <section className="panel"><EmptyState title="Historical archive required">Open the local archive preview to search real player shots.</EmptyState></section>
  </>;

  const { teams, defaultTeam, filterOptions, start, end, retrospective } = getCatalog();
  const scope: FinderScope = { team: defaultTeam, window: "full", pool: "outside" };
  const query = finderSearch(scope, emptyShotFilters, "top");
  const data = playerFinder(shots, scope, emptyShotFilters, "top", scoredStart);
  return <PlayerFinder catalog={{ source, teams, defaultTeam, filterOptions, start, end, scoredStart, retrospective }} initial={{ query, data }} />;
}
