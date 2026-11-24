"use client";

import { ArrowRight, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState } from "react";
import { AnimatedNumber } from "../components/animated-number";
import { ShotDetails, ShotList } from "../components/evidence";
import { ShotFilterFields } from "../components/shot-filter-fields";
import { Badge, Button, Dialog, EmptyState, PageHeader, PanelHeader, Segment, SelectField } from "../components/ui";
import type { ArchiveCatalog } from "../lib/dataset";
import { finderSearch, rankFinderPlayers, type FinderReport, type FinderScope, type FinderSort } from "../lib/player-finder";
import { count, describeShotFilters, displayDate, emptyShotFilters, isSmallSample, type Shot, type ShotFilters } from "../lib/shots";
import { useArchiveQuery } from "../lib/use-archive-query";
import { useScoutingTeam } from "../lib/use-scouting-team";

type Catalog = Pick<ArchiveCatalog, "source" | "teams" | "defaultTeam" | "filterOptions" | "start" | "end" | "scoredStart" | "retrospective">;
type Player = FinderReport["players"][number];
type EvidenceRequest = { title: string; query: string; attempts: number };
const modes = [{ value: "needs", label: "Team needs" }, { value: "search", label: "Player search" }] as const;
const perPage = 10;
const emptyEvidence = { query: "", data: null };

function FinderEvidence({ request, onClose }: { request: EvidenceRequest; onClose: () => void }) {
  const [selected, setSelected] = useState<Shot>();
  const evidence = useArchiveQuery<Shot[] | null>(request.query, emptyEvidence);
  return <Dialog title={request.title} description={`${count(request.attempts)} matching shots`} onClose={onClose}>
    {evidence.error ? <p className="archive-status" role="alert">Couldn’t load these shots. <Button variant="ghost" onClick={evidence.retry}>Retry</Button></p>
      : evidence.data ? <div className="dialog-evidence">{selected && <ShotDetails shot={selected} />}<ShotList shots={evidence.data} selected={selected?.id} onSelect={setSelected} /></div>
      : <p className="archive-status" role="status">Loading shot evidence…</p>}
  </Dialog>;
}

function SearchBenchmark({ label, stats }: { label: string; stats: FinderReport["team"] }) {
  return <article className="finder-benchmark">
    <header><h3>{label}</h3><span><AnimatedNumber value={stats.attempts} /> attempts</span></header>
    <dl className="finder-stat-line">
      <div><dt>Actual FG%</dt><dd><AnimatedNumber value={stats.fg} format="percentage" /></dd></div>
      <div><dt>Expected FG%</dt><dd><AnimatedNumber value={stats.expectedFg} format="percentage" /></dd></div>
      <div><dt>Actual PPS</dt><dd><AnimatedNumber value={stats.pps} format="decimal" /></dd></div>
      <div><dt>Expected PPS</dt><dd><AnimatedNumber value={stats.expectedPps} format="decimal" /></dd></div>
    </dl>
  </article>;
}

export function PlayerFinder({ catalog, initial }: { catalog: Catalog; initial: { query: string; data: FinderReport } }) {
  const [team, setTeam] = useScoutingTeam(catalog);
  const [mode, setMode] = useState<(typeof modes)[number]["value"]>("needs");
  const [window, setWindow] = useState<FinderScope["window"]>("full");
  const [pool, setPool] = useState<FinderScope["pool"]>("outside");
  const [need, setNeed] = useState("top");
  const [filters, setFilters] = useState<ShotFilters>(emptyShotFilters);
  const [name, setName] = useState("");
  const [candidateTeam, setCandidateTeam] = useState("");
  const [minimum, setMinimum] = useState("30");
  const [sort, setSort] = useState<FinderSort>("pps");
  const [page, setPage] = useState(0);
  const [evidence, setEvidence] = useState<EvidenceRequest>();

  const scope: FinderScope = { team, window, pool: mode === "needs" ? "outside" : pool };
  const archive = useArchiveQuery(finderSearch(scope, mode === "needs" ? emptyShotFilters : filters, mode === "needs" ? need : ""), initial);
  const report = archive.data;
  const selectedTeam = catalog.teams[team];
  const candidates = report ? rankFinderPlayers(report.players, sort, Number(minimum), name, candidateTeam === team && scope.pool === "outside" ? "" : candidateTeam) : [];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(candidates.length / perPage) - 1));
  const offset = currentPage * perPage;
  const shotScope = report ? describeShotFilters(report.filters) : "";
  const modelSort = sort === "expectedPps" || sort === "expectedFg" || sort === "gap";

  function inspect(player: Player) {
    if (report) setEvidence({ title: `${player.name} · ${shotScope}`, query: finderSearch(scope, report.filters, "", player.name), attempts: player.attempts });
  }

  return <>
    <PageHeader title="Player Finder" description="Find players with evidence in the looks your team needs.">
      <SelectField label="Your team" className="scout-own-team" value={team} onChange={event => { setTeam(event.target.value); setNeed("top"); setPage(0); }}>
        {Object.entries(catalog.teams).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}
      </SelectField>
    </PageHeader>

    <nav className="scout-view-nav" aria-label="Player finder views"><Segment label="Finder view" options={modes} value={mode} onChange={next => { setMode(next); setPage(0); }} /></nav>
    <section className="panel controls-panel" aria-label="Player search controls">
      <div className="controls-row finder-controls">
        <label className="field finder-name"><span>Player name</span><span className="finder-input"><Search size={15} aria-hidden="true" /><input type="search" placeholder="Search players" value={name} onChange={event => { setName(event.target.value); setPage(0); }} /></span></label>
        <SelectField label="Scoring window" value={window} onChange={event => { setWindow(event.target.value as FinderScope["window"]); setNeed("top"); setPage(0); }}><option value="full">Full archive</option><option value="holdout">Holdout only</option></SelectField>
        <SelectField label="Player team" value={candidateTeam === team && scope.pool === "outside" ? "" : candidateTeam} onChange={event => { setCandidateTeam(event.target.value); setPage(0); }}><option value="">Any team</option>{Object.entries(catalog.teams).filter(([id]) => scope.pool === "all" || id !== team).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}</SelectField>
        <SelectField label={modelSort ? "Minimum scored shots" : "Minimum attempts"} value={minimum} onChange={event => { setMinimum(event.target.value); setPage(0); }}><option value="1">1+</option><option value="10">10+</option><option value="20">20+</option><option value="30">30+</option><option value="50">50+</option><option value="100">100+</option></SelectField>
        <SelectField label="Rank by" value={sort} onChange={event => { setSort(event.target.value as FinderSort); setPage(0); }}><option value="pps">Actual PPS</option><option value="expectedPps">Expected PPS</option><option value="fg">Actual FG%</option><option value="expectedFg">Expected FG%</option><option value="gap">Above expected FG%</option><option value="attempts">Most attempts</option></SelectField>
      </div>
      {mode === "search" && <div className="advanced-filters finder-look-controls">
        <SelectField label="Player pool" value={pool} onChange={event => { setPool(event.target.value as FinderScope["pool"]); setPage(0); }}><option value="outside">Outside your team</option><option value="all">All players</option></SelectField>
        <fieldset className="advanced-group"><legend>Shot filters</legend><ShotFilterFields filters={filters} options={catalog.filterOptions} onChange={next => { setFilters(next); setPage(0); }} /></fieldset>
        <Button variant="ghost" onClick={() => { setFilters(emptyShotFilters); setPage(0); }}>Clear shot filters</Button>
      </div>}
    </section>

    {archive.pending && <p className="archive-status" role="status">Loading player evidence…</p>}
    {archive.error && <p className="archive-status" role="alert">Couldn’t load player evidence. <Button variant="ghost" onClick={archive.retry}>Retry</Button></p>}
    {report && <>
      {mode === "needs" && <section className="panel finder-needs" aria-label="Team shooting needs">
        <PanelHeader title={`${selectedTeam.name} shooting needs`} description="Looks where actual FG% or share of attempts trails the archive average by at least 2 percentage points." />
        {report.needs.length ? <div className="finder-needs-grid">{report.needs.map(item => <button key={item.id} className="finder-need" type="button" aria-pressed={report.activeNeed === item.id} onClick={() => { setNeed(item.id); setPage(0); }}>
          <span className="mini-label">{item.reason}</span><strong>{item.title}</strong>
          <span>{item.reason === "Lower shot share" ? "Shot share" : "Actual FG%"} <b><AnimatedNumber value={item.reason === "Lower shot share" ? item.share : item.rates.actual} format="percentage" /></b> vs. <AnimatedNumber value={item.reason === "Lower shot share" ? item.archiveShare : item.baseline.actual} format="percentage" /> archive</span>
          <span>Expected FG% <b><AnimatedNumber value={item.rates.expected} format="percentage" /></b> vs. <AnimatedNumber value={item.baseline.expected} format="percentage" /> archive</span>
        </button>)}</div> : <div className="finder-no-needs">No shooting gaps met the thresholds in this window.</div>}
        {report.activeNeed && <div className="finder-refine"><Button variant="ghost" onClick={() => { setFilters(report.filters); setMode("search"); setPage(0); }}>Refine this look in Player search <ArrowRight size={15} aria-hidden="true" /></Button></div>}
      </section>}

      <section className="panel finder-results" aria-label="Player results">
        <PanelHeader title={mode === "needs" ? "Outside candidates" : "Matching players"} description={<>{shotScope} · <AnimatedNumber value={candidates.length} /> players · {displayDate(window === "holdout" ? catalog.scoredStart : catalog.start, true)} – {displayDate(catalog.end, true)}</>} />
        <div className="finder-benchmarks"><SearchBenchmark label={selectedTeam.name} stats={report.team} /><SearchBenchmark label="Archive average" stats={report.archive} /></div>
        {candidates.length ? <>
          <div className="table-scroll"><table className="model-table finder-table">
            <thead><tr><th scope="col">Player</th><th scope="col">Attempts</th><th scope="col">Actual FG%</th><th scope="col">Expected FG%</th><th scope="col">FG% gap</th><th scope="col">Actual PPS</th><th scope="col">Expected PPS</th><th scope="col">PPS vs. your team</th></tr></thead>
            <tbody>{candidates.slice(offset, offset + perPage).map(player => <tr key={player.name}>
              <th scope="row"><button className="model-rank-player finder-player" type="button" onClick={() => inspect(player)}><span>{player.name} <ArrowRight size={13} aria-hidden="true" /></span><small>{player.team}{player.scored !== player.attempts && <> · <AnimatedNumber value={player.scored} /> scored</>}</small></button></th>
              <td><AnimatedNumber value={player.attempts} />{isSmallSample(modelSort ? player.scored : player.attempts) && <div><Badge tone="warning">Small sample</Badge></div>}</td><td><AnimatedNumber value={player.fg} format="percentage" /></td><td><AnimatedNumber value={player.expectedFg} format="percentage" /></td><td><AnimatedNumber value={player.gap} format="percentage-point" /></td>
              <td><AnimatedNumber value={player.pps} format="decimal" /></td><td><AnimatedNumber value={player.expectedPps} format="decimal" /></td><td><AnimatedNumber value={player.pps !== null && report.team.pps !== null ? player.pps - report.team.pps : null} format="signed-decimal" /></td>
            </tr>)}</tbody>
          </table></div>
          <div className="list-footer"><span>{offset + 1}–{Math.min(offset + perPage, candidates.length)} of {count(candidates.length)} players</span><div><Button variant="icon" aria-label="Previous players" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button><Button variant="icon" aria-label="Next players" disabled={offset + perPage >= candidates.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div></div>
        </> : <EmptyState title="No players meet these filters">Try a lower shot minimum, a wider window, or fewer filters.</EmptyState>}
      </section>
      <p className="finder-note">Select a player to inspect their shots. Player teams reflect their latest tracked appearances. PPS means points per shot. The FG% gap compares actual and expected on the same scored attempts. Historical rates describe each player’s recorded role and shot context.{window === "full" && catalog.retrospective > 0 && ` Full archive includes estimates from games the model trained on before ${displayDate(catalog.scoredStart, true)}.`}</p>
    </>}
    {evidence && <FinderEvidence key={evidence.query} request={evidence} onClose={() => setEvidence(undefined)} />}
  </>;
}
