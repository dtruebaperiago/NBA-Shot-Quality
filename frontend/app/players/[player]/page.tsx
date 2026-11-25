import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PlayerPortrait, PlayerShotLab } from "../../../components/player-shot-lab";
import { EmptyState, PageHeader, PanelHeader } from "../../../components/ui";
import { gameLabel, readShotFilters, sortShotEvidence } from "../../../lib/archive-query";
import { getCatalog, getDataset, getPlayerSeason } from "../../../lib/dataset";
import { parseProbabilityRange } from "../../../lib/model-study";
import { archivePlayerId, historicalProfileCutoff, trackedShooting, type SeasonTotals } from "../../../lib/player-profile";
import { count, decimal, displayDate, percentage } from "../../../lib/shots";
import "../profile.css";

type Props = { params: Promise<{ player: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const labels = { all: "All field goals", "2": "Two-pointers", "3": "Three-pointers" };
const boxScoreStats = [
  ["Points", "pts"], ["Rebounds", "trb"], ["Assists", "ast"], ["Minutes", "mp"], ["Steals", "stl"], ["Blocks", "blk"],
  ["Turnovers", "tov"], ["Offensive rebounds", "orb"], ["Defensive rebounds", "drb"], ["Personal fouls", "pf"],
] as const;
const shootingStats = [
  ["Field goals", "fg", "fga"], ["Two-pointers", "fg2", "fg2a"], ["Three-pointers", "fg3", "fg3a"], ["Free throws", "ft", "fta"],
] as const;
const boxScoreSource = "https://github.com/sportsdataverse/sportsdataverse-data/releases/tag/nba_stats_player_boxscores";

function getProfilePlayer(segment: string) {
  const { players } = getCatalog();
  const exact = players.find(item => item.name === segment);
  if (exact) return exact;
  try {
    const name = decodeURIComponent(segment);
    return players.find(item => item.name === name);
  } catch {
    return undefined;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { player } = await params;
  return { title: getProfilePlayer(player)?.displayName ?? "Player sheet" };
}

function SeasonBoxScore({ totals, through }: { totals: SeasonTotals; through: string }) {
  return <section className="panel player-report" aria-label="Regular-season box score">
    <PanelHeader title={"2014–15 box score through " + displayDate(through, true)} description={count(totals.games) + " games · " + count(totals.games_started) + " starts"} />
    <div className="player-report-grid">
      <dl className="player-box-score">
        {boxScoreStats.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{totals.games ? (totals[key] / totals.games).toFixed(1) : "—"} <small>per game</small></dd><dd className="player-stat-total">{count(key === "mp" ? Math.round(totals.mp) : totals[key])} total</dd></div>)}
      </dl>
      <div className="table-scroll"><table className="model-table player-stats-table">
        <thead><tr><th scope="col">Shooting</th><th scope="col">Made</th><th scope="col">Attempts</th><th scope="col">Rate</th></tr></thead>
        <tbody>{shootingStats.map(([label, made, attempts]) => <tr key={made}>
          <th scope="row">{label}</th><td>{count(totals[made])}</td><td>{count(totals[attempts])}</td><td>{percentage(totals[attempts] ? totals[made] / totals[attempts] : null)}</td>
        </tr>)}
        <tr><th scope="row">Effective FG%</th><td>—</td><td>{count(totals.fga)}</td><td>{percentage(totals.fga ? (totals.fg + .5 * totals.fg3) / totals.fga : null)}</td></tr></tbody>
      </table></div>
    </div>
    <p className="player-source">Regular-season game totals from <a href={boxScoreSource}>NBA Stats via SportsDataverse</a>.</p>
  </section>;
}

export default async function Page({ params, searchParams }: Props) {
  const [{ player }, query] = await Promise.all([params, searchParams]);
  const dataset = getDataset();
  const catalog = getCatalog();
  const entry = getProfilePlayer(player);
  if (!entry) notFound();
  const shots = dataset.shots.filter(shot => shot.player === entry.name).sort(sortShotEvidence);
  const season = getPlayerSeason(shots[0]);
  const nbaId = dataset.source === "archive" ? archivePlayerId(shots[0]) : undefined;
  const through = dataset.source === "archive" && historicalProfileCutoff < dataset.end ? historicalProfileCutoff : dataset.end;
  const shooting = trackedShooting(shots.filter(shot => shot.date <= through));
  const [overall, , threes] = shooting;
  const read = (key: string) => typeof query[key] === "string" ? query[key] : "";
  const team = entry.teams.find(code => code === read("team")) ?? "";
  const excludeTeam = Object.hasOwn(catalog.teams, read("excludeTeam")) ? read("excludeTeam") : "";
  const game = catalog.games.find(item => item.id === read("game") && (!team || item.teams.includes(team)));
  const holdout = read("window") === "holdout";
  const range = parseProbabilityRange(read("lower"), read("upper"));
  const shotScope = { team, game: game?.id ?? "", excludeTeam, from: holdout ? dataset.scoredStart : "", range, scoredOnly: read("scored") === "1" };
  const filters = readShotFilters(read);
  const scopeLabel = [
    holdout && "Holdout",
    team && catalog.teams[team].name,
    excludeTeam && "Excludes " + catalog.teams[excludeTeam].name,
    game && (gameLabel(game) + " · " + displayDate(game.date, true)),
    range ? percentage(range[0]) + "–" + percentage(range[1]) + " expected FG" : shotScope.scoredOnly && "Model-scored shots only",
  ].filter(Boolean).join(" · ");
  const name = entry.displayName;

  return <div className="player-page">
    <Link href="/players" className="model-table-link player-back"><ArrowLeft size={16} aria-hidden="true" /> Player Finder</Link>
    <div className="player-masthead">
      <PageHeader title={name} description={[season?.position, entry.teams.map(code => catalog.teams[code].name).join(" / ")].filter(Boolean).join(" · ")} />
      <PlayerPortrait player={name} nbaId={nbaId} />
    </div>

    <section className="panel player-report" aria-label="Tracked shooting">
      <PanelHeader title="Tracked shooting" description={dataset.label + " · Through " + displayDate(through, true)} />
      <dl className="player-metrics">
        <div><dt>Field goal %</dt><dd>{percentage(overall.fg)}</dd><dd className="player-stat-total">{count(overall.makes)} made · {count(overall.attempts)} attempts</dd></div>
        <div><dt>Three-point %</dt><dd>{percentage(threes.fg)}</dd><dd className="player-stat-total">{count(threes.makes)} made · {count(threes.attempts)} attempts</dd></div>
        <div><dt>Expected FG%</dt><dd>{percentage(overall.expectedFg)}</dd><dd className="player-stat-total">{count(overall.scored)} scored attempts</dd></div>
      </dl>
      <div className="table-scroll"><table className="model-table player-stats-table">
        <thead><tr><th scope="col">Shot value</th><th scope="col">Makes</th><th scope="col">Attempts</th><th scope="col">Actual FG%</th><th scope="col">Effective FG%</th><th scope="col">Expected FG%</th><th scope="col">Scored attempts</th><th scope="col">Actual PPS</th><th scope="col">Expected PPS</th></tr></thead>
        <tbody>{shooting.map(line => <tr key={line.value}>
          <th scope="row">{labels[line.value]}</th><td>{count(line.makes)}</td><td>{count(line.attempts)}</td><td>{percentage(line.fg)}</td><td>{percentage(line.effectiveFg)}</td><td>{percentage(line.expectedFg)}</td><td>{count(line.scored)}</td><td>{decimal(line.pps)}</td><td>{decimal(line.expectedPps)}</td>
        </tr>)}</tbody>
      </table></div>
      {dataset.source === "archive" && <p className="player-source">Expected rates before {displayDate(dataset.scoredStart, true)} are retrospective.</p>}
    </section>

    {season?.through === through && season.totals ? <SeasonBoxScore totals={season.totals} through={through} />
      : dataset.source === "archive" && <section className="panel player-report" aria-label="Regular-season box score">
        <PanelHeader title={"2014–15 box score through " + displayDate(through, true)} />
        <EmptyState title="Box score unavailable">Game totals for this player and date range are unavailable in the local snapshot.</EmptyState>
      </section>}
    <PlayerShotLab key={JSON.stringify([player, filters, shotScope])} player={name} shots={shots} entry={{ filters, scope: shotScope, label: scopeLabel }} />
  </div>;
}
