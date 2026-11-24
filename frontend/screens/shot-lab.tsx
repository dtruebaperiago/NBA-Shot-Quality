"use client";

import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Crosshair, List, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Court } from "../components/court";
import { AnimatedNumber } from "../components/animated-number";
import { CohortMetrics, ShotDetails, ShotList, type CohortSide } from "../components/evidence";
import { ShotFilterFields } from "../components/shot-filter-fields";
import { Button, EmptyState, PageHeader, PanelHeader, Segment, SelectField } from "../components/ui";
import { benchmarkSearch, gameLabel, labSearch, shotPageSize, sortShotEvidence, type BenchmarkEvidence, type BenchmarkReport, type LabEntry } from "../lib/archive-query";
import type { CourtView } from "../lib/court-scene";
import type { ArchiveCatalog } from "../lib/dataset";
import { probabilityBands, shotBand } from "../lib/model-study";
import { courtPosition, displayDate, describeShotFilters as describe, emptyShotFilters as blank, matchesShotFilters as matches, type Shot, type ShotFilterOptions, type ShotFilters } from "../lib/shots";
import { useArchiveQuery } from "../lib/use-archive-query";

type FilterScope = "shared" | "separate";
type ComparisonFilters = { scope: FilterScope; individual: Record<CohortSide, ShotFilters> };
const modeOptions = [{ value: "single", label: "Single look" }, { value: "situations", label: "Two looks" }, { value: "players", label: "Players" }, { value: "benchmark", label: "Benchmark" }] as const;
const playerFilterOptions = [{ value: "shared", label: "Both players" }, { value: "separate", label: "Each player" }] as const;
const benchmarkFilterOptions = [{ value: "shared", label: "Both cohorts" }, { value: "separate", label: "Each cohort" }] as const;
const viewOptions = [{ value: "court", label: "Court", icon: <Crosshair size={15} /> }, { value: "list", label: "Shot list", icon: <List size={15} /> }] as const;
const bothLooks = { a: true, b: true };
const noShots: Shot[] = [];
const emptyQuery = { query: "", data: null };

function CohortFilters({ title, filters, onChange, options }: { title: string; filters: ShotFilters; onChange: (filters: ShotFilters) => void; options: ShotFilterOptions }) {
  return <fieldset className="advanced-group"><legend>{title}</legend><ShotFilterFields filters={filters} onChange={onChange} options={options} /></fieldset>;
}

function LookKey({ side }: { side: CohortSide }) {
  return <span className="look-key" data-side={side} aria-hidden="true"><i /><X size={13} strokeWidth={1.7} absoluteStrokeWidth /></span>;
}

export function ShotLab({ dataset, entry, initial }: { dataset: ArchiveCatalog; entry: LabEntry; initial: { query: string; data: Shot[] } }) {
  const players = dataset.players;
  const [player, setPlayer] = useState(entry.player);
  const [team, setTeam] = useState(entry.team);
  const [game, setGame] = useState(entry.game);
  const [band, setBand] = useState(entry.band);
  const [scoredOnly, setScoredOnly] = useState(entry.model);
  const [secondPlayer, setSecondPlayer] = useState(dataset.comparisonPlayer === entry.player ? dataset.defaultPlayer : dataset.comparisonPlayer);
  const [benchmark, setBenchmark] = useState("pool");
  const [mode, setMode] = useState<(typeof modeOptions)[number]["value"]>(entry.model ? "single" : "situations");
  const [view, setView] = useState<(typeof viewOptions)[number]["value"]>("court");
  const [courtView, setCourtView] = useState<CourtView>("spatial");
  const [dateRange, setDateRange] = useState<string>(entry.dateRange);
  const [customStart, setCustomStart] = useState(dataset.start);
  const [customEnd, setCustomEnd] = useState(dataset.end);
  const [advanced, setAdvanced] = useState(Boolean(entry.value));
  const [selectedId, setSelectedId] = useState<string>();
  const [filtersA, setFiltersA] = useState<ShotFilters>({ ...blank, value: entry.value, defender: entry.model ? "" : "open" });
  const [filtersB, setFiltersB] = useState<ShotFilters>({ ...blank, defender: "close" });
  const [matched, setMatched] = useState<ShotFilters>(blank);
  const [comparisonFilters, setComparisonFilters] = useState<Partial<Record<"players" | "benchmark", ComparisonFilters>>>({});
  const [visible, setVisible] = useState(bothLooks);
  const [listPage, setListPage] = useState({ key: "", index: 0 });
  const [cursor, setCursor] = useState<{ key: string; index: number }>();
  const courtPanel = useRef<HTMLElement>(null);

  const single = mode === "single";
  const situations = single || mode === "situations";
  const comparisonMode = mode === "players" || mode === "benchmark" ? mode : undefined;
  const savedComparison = comparisonMode ? comparisonFilters[comparisonMode] : undefined;
  const filterScope = savedComparison?.scope ?? "shared";
  const individual = savedComparison?.individual ?? { a: matched, b: matched };
  const firstFilters = situations ? filtersA : filterScope === "separate" ? individual.a : matched;
  const secondFilters = mode === "situations" ? filtersB : filterScope === "separate" ? individual.b : matched;
  const gameRosters = dataset.gameRosters[game];
  const matchPlayers = gameRosters && new Set(team ? gameRosters[team] : Object.values(gameRosters).flat());
  const roster = players.filter(entry => (!team || entry.teams.includes(team)) && (!matchPlayers || matchPlayers.has(entry.name)));
  const comparisonPlayers = useMemo(() => players.filter(entry => entry.name !== player && (!gameRosters || Object.values(gameRosters).some(names => names.includes(entry.name)))), [gameRosters, player, players]);
  const compareWith = useMemo(() => comparisonPlayers.find(entry => entry.name === secondPlayer)?.name ?? comparisonPlayers[0]?.name ?? "", [comparisonPlayers, secondPlayer]);

  const start = dateRange === "scored" ? dataset.scoredStart : dateRange === "custom" ? customStart : dataset.start;
  const end = dateRange === "custom" ? customEnd : dataset.end;
  const validRange = Boolean(start && end && start <= end && start >= dataset.start && end <= dataset.end);
  const isBenchmark = mode === "benchmark";
  const scope = { player, team, game, start, end, comparison: mode === "players" ? compareWith : "", benchmark: isBenchmark ? benchmark : "" };
  const benchmarkOptions = { first: firstFilters, second: secondFilters, band, scoredOnly };
  const query = validRange && !isBenchmark ? labSearch(scope) : "";
  const archive = useArchiveQuery(query, initial);
  const benchmarkKey = validRange && isBenchmark ? benchmarkSearch(scope, benchmarkOptions) : "";
  const benchmarkQuery = useArchiveQuery<BenchmarkReport | null>(benchmarkKey, emptyQuery);
  const report = benchmarkQuery.data;
  const pool = useMemo(() => {
    if (!archive.data) return noShots;
    if (!scoredOnly && !band) return archive.data;
    return archive.data.filter(shot => shot.probability !== null && (!band || shotBand(shot.probability) === Number(band)));
  }, [archive.data, band, scoredOnly]);
  const filterOptions = dataset.filterOptions;
  const first = useMemo(() => report?.first ?? pool.filter(shot => shot.player === player && matches(shot, firstFilters)), [firstFilters, player, pool, report]);
  const second = useMemo(() => single || isBenchmark ? noShots : pool.filter(shot => shot.player === (mode === "situations" ? player : compareWith) && matches(shot, secondFilters)),
    [compareWith, isBenchmark, mode, player, pool, secondFilters, single]);
  const visibleFirst = single || visible.a ? first : noShots;
  const visibleSecond = visible.b ? report?.second ?? second : noShots;
  const density = visible.b ? report?.density : undefined;
  const combined = useMemo(() => [...new Map([...visibleFirst, ...visibleSecond].map(shot => [shot.id, shot])).values()].sort(sortShotEvidence), [visibleFirst, visibleSecond]);
  const plotted = combined.filter(courtPosition).length + (density ? report!.plottedSecond : 0);
  const visibleCount = combined.length + (density ? report!.totals.attempts : 0);
  const pagingKey = `${benchmarkKey}&a=${visible.a}&b=${visible.b}`;
  const activeCursor = density && cursor?.key === pagingKey ? cursor.index : undefined;
  const pageIndex = view === "list" ? listPage.key === pagingKey ? listPage.index : 0 : Math.floor((activeCursor ?? 0) / shotPageSize);
  const pageQuery = useArchiveQuery<BenchmarkEvidence | null>(density && (view === "list" || activeCursor !== undefined) ? benchmarkSearch(scope, benchmarkOptions, { index: pageIndex, ...visible }) : "", emptyQuery);
  const evidencePage = pageQuery.data;
  const remoteSelection = activeCursor !== undefined && evidencePage?.index === Math.floor(activeCursor / shotPageSize) ? evidencePage.rows[activeCursor % shotPageSize] : undefined;
  const localSelection = combined.find(shot => shot.id === selectedId) ?? combined.find(shot => shot.value === 3 && shot.made && courtPosition(shot)) ?? combined[0] ?? (density ? report?.example : undefined);
  const selected = activeCursor === undefined ? localSelection : remoteSelection;
  const selectedLocation = selected && courtPosition(selected);
  const index = combined.findIndex(shot => shot.id === selected?.id);
  const plotSecond = useMemo(() => density && selected && selected.player !== player ? [selected] : visibleSecond, [density, player, selected, visibleSecond]);
  const situationTitle = (filters: ShotFilters, label: string) => filters.defender === "open" ? "Open looks" : filters.defender === "close" ? "Contested looks" : label;
  const firstTitle = mode === "situations" ? situationTitle(filtersA, "First look") : player;
  const secondTitle = mode === "situations" ? situationTitle(filtersB, "Second look") : mode === "players" ? compareWith || "Comparison player" : benchmark === "pool" ? "Archive pool" : dataset.teams[benchmark].name;
  const games = dataset.games.filter(match => !team || match.teams.includes(team));
  const activeQuery = isBenchmark ? benchmarkQuery : archive;
  const isLoading = activeQuery.pending || activeQuery.error;
  const modelLink = `/model?${new URLSearchParams({ player, team, game, value: firstFilters.value, window: dateRange === "scored" ? "holdout" : "full" })}`;
  function pick(shot: Shot) {
    setCursor(undefined);
    setSelectedId(shot.id);
  }

  function pickFromList(shot: Shot) {
    pick(shot);
    if (density && evidencePage) setCursor({ key: pagingKey, index: evidencePage.index * shotPageSize + evidencePage.rows.findIndex(row => row.id === shot.id) });
    setView("court");
    courtPanel.current?.focus({ preventScroll: true });
    courtPanel.current?.scrollIntoView({ block: "start" });
  }

  function changeEvidenceView(next: typeof view) {
    if (next === "list" && activeCursor !== undefined) setListPage({ key: pagingKey, index: Math.floor(activeCursor / shotPageSize) });
    setView(next);
  }

  function changeEvidencePage(index: number) {
    setCursor(undefined);
    setListPage({ key: pagingKey, index });
  }

  function moveShot(by: number) {
    if (activeCursor !== undefined) setCursor({ key: pagingKey, index: activeCursor + by });
    else pick(combined[index + by]);
  }

  function toggleLook(side: CohortSide) {
    setVisible(current => current[side] && !current[side === "a" ? "b" : "a"] ? current : { ...current, [side]: !current[side] });
  }

  function updateComparison(next: ComparisonFilters) {
    if (comparisonMode) setComparisonFilters(current => ({ ...current, [comparisonMode]: next }));
  }

  function clearFilters() {
    setBand("");
    setScoredOnly(false);
    if (situations) {
      setFiltersA(blank);
      if (!single) setFiltersB(blank);
    } else if (filterScope === "separate") {
      updateComparison({ scope: "separate", individual: { a: blank, b: blank } });
    } else {
      setMatched(blank);
    }
  }

  function changePlayer(name: string) {
    setPlayer(name);
    if (name === secondPlayer) setSecondPlayer(player);
    if (dateRange === "scored" && players.find(entry => entry.name === name)?.holdout === false) {
      setDateRange("all");
      setScoredOnly(false);
      setBand("");
    }
  }

  function changeTeam(code: string) {
    setTeam(code);
    if (!code) return;
    const gameRoster = gameRosters?.[code];
    if (game && !gameRoster) setGame("");
    const available = players.filter(entry => entry.teams.includes(code) && (!gameRoster || gameRoster.includes(entry.name)));
    if (!available.some(entry => entry.name === player) && available[0]) changePlayer((available.find(entry => entry.holdout) ?? available[0]).name);
  }

  function changeGame(id: string) {
    setGame(id);
    const match = games.find(entry => entry.id === id);
    const rosters = dataset.gameRosters[id];
    const names = rosters && (team ? rosters[team] : Object.values(rosters).flat());
    if (names?.length && !names.includes(player)) changePlayer(names[0]);
    if (match && (match.date < start || match.date > end)) setDateRange("all");
    if (match && !match.scored) {
      setBand("");
      setScoredOnly(false);
    }
  }

  return <>
    <PageHeader title="Player Shot Lab" description="Compare shot selection, results, and model estimates.">
      <Link href={modelLink} className="button model-entry" prefetch={false}>{dateRange === "custom" ? "Explore full-archive model" : "Explore the shot model"} <ArrowUpRight size={15} aria-hidden="true" /></Link>
    </PageHeader>

    <section className="panel controls-panel" aria-label="Shot comparison controls">
      <div className="controls-row lab-controls">
        <SelectField label="Player" className="player-field" value={player} onChange={event => changePlayer(event.target.value)}>{roster.map(({ name }) => <option key={name}>{name}</option>)}</SelectField>
        <div className="field mode-field"><span>Analysis mode</span><Segment label="Analysis mode" options={modeOptions} value={mode} onChange={next => { setMode(next); setVisible(bothLooks); }} /></div>
        <SelectField label="Date range" value={dateRange} onChange={event => setDateRange(event.target.value)}><option value="scored">{dataset.source === "archive" ? "Holdout window" : "Scored window"}</option><option value="all">Full archive</option><option value="custom">Custom range</option></SelectField>
        <Button className="filter-toggle" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced} aria-controls={advanced ? "shot-filters" : undefined}><SlidersHorizontal size={16} /> Filters</Button>
      </div>
      <div className="controls-row secondary-controls archive-controls">
        <SelectField label="Roster team" value={team} onChange={event => changeTeam(event.target.value)}><option value="">All teams</option>{Object.entries(dataset.teams).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}</SelectField>
        <SelectField label="Game" value={game} onChange={event => changeGame(event.target.value)}><option value="">All games</option>{games.map(match => <option key={match.id} value={match.id}>{displayDate(match.date, true)} · {gameLabel(match)}</option>)}</SelectField>
        {mode === "players" && <SelectField label="Comparison player" value={compareWith} onChange={event => setSecondPlayer(event.target.value)}>{comparisonPlayers.map(({ name }) => <option key={name}>{name}</option>)}</SelectField>}
        {mode === "benchmark" && <SelectField label="Benchmark" value={benchmark} onChange={event => setBenchmark(event.target.value)}><option value="pool">All archive teams</option>{Object.entries(dataset.teams).map(([id, team]) => <option key={id} value={id}>{team.name}</option>)}</SelectField>}
        {dateRange === "custom" && <><label className="field"><span>From</span><input type="date" min={dataset.start} max={dataset.end} value={customStart} onChange={event => setCustomStart(event.target.value)} /></label><label className="field"><span>Through</span><input type="date" min={dataset.start} max={dataset.end} value={customEnd} onChange={event => setCustomEnd(event.target.value)} /></label></>}
        <div className="heading-meta"><CalendarDays size={15} aria-hidden="true" /><span>{validRange ? `${displayDate(start)} – ${displayDate(end, true)}` : "Select a valid range"}</span></div>
      </div>
      {(scoredOnly || band) && <div className="model-evidence-scope"><span>{band ? `${probabilityBands[Number(band)]} expected make` : "Model-scored attempts only"}</span><Button variant="ghost" onClick={() => { setBand(""); setScoredOnly(false); }}><X size={14} /> Clear model scope</Button></div>}
      {advanced && <div className="advanced-filters" id="shot-filters">
        {comparisonMode && <div className="field comparison-filter-mode"><span>Apply filters to</span><Segment label={mode === "players" ? "Player filter scope" : "Benchmark filter scope"} options={mode === "players" ? playerFilterOptions : benchmarkFilterOptions} value={filterScope} onChange={scope => {
          if (scope !== filterScope) updateComparison({ scope, individual });
        }} /></div>}
        {situations ? <>
          <CohortFilters title={single ? "Shot filters" : "A · First look"} filters={filtersA} onChange={setFiltersA} options={filterOptions} />
          {!single && <CohortFilters title="B · Second look" filters={filtersB} onChange={setFiltersB} options={filterOptions} />}
        </> : filterScope === "separate" ? <>
          <CohortFilters title={`A · ${player}`} filters={individual.a} onChange={filters => updateComparison({ scope: "separate", individual: { ...individual, a: filters } })} options={filterOptions} />
          <CohortFilters title={`B · ${secondTitle}`} filters={individual.b} onChange={filters => updateComparison({ scope: "separate", individual: { ...individual, b: filters } })} options={filterOptions} />
        </> : <CohortFilters title="Both cohorts" filters={matched} onChange={setMatched} options={filterOptions} />}
        <Button variant="ghost" onClick={clearFilters}>Clear shot filters</Button>
      </div>}
    </section>

    {activeQuery.pending && <p className="archive-status" role="status">Loading matching shots…</p>}
    {activeQuery.error && <p className="archive-status" role="alert">Couldn’t load matching shots. <Button variant="ghost" onClick={activeQuery.retry}>Retry</Button></p>}
    <div aria-busy={isLoading} className={`cohort-grid comparison-sheet lab-comparison${single ? " single-look" : ""}`} hidden={isLoading}>
      <CohortMetrics side={single ? undefined : "a"} title={firstTitle} context={describe(firstFilters)} shots={first} />
      {!single && <CohortMetrics side="b" title={secondTitle} context={isBenchmark ? `${describe(secondFilters)} · Excludes selected player` : describe(secondFilters)} shots={report?.second ?? second} totals={report?.totals} />}
    </div>

    <div className="analysis-grid" aria-busy={isLoading} hidden={isLoading}>
      <section className="panel court-panel" ref={courtPanel} tabIndex={-1} aria-label="Shot locations">
        <PanelHeader title="Shot locations" description={<><AnimatedNumber value={plotted} /> plotted · <AnimatedNumber value={visibleCount} /> unique attempts</>}><Segment label="Evidence display" options={viewOptions} value={view} onChange={changeEvidenceView} /></PanelHeader>
        {density && <p className="metric-note">Benchmark shots are grouped in court bins. Open Shot list to select and replay an individual benchmark shot.</p>}
        {!visibleCount && !isLoading && <EmptyState title="No matching shots">{!single && (!visible.a || !visible.b) ? "Show the other look or broaden the filters." : "Try a different game, widening the date range, or clearing a filter."}</EmptyState>}
        {view === "court" ? <div hidden={!visibleCount}>
          <Court ready={!isLoading && Boolean(visibleCount)} first={visibleFirst} second={plotSecond} density={density} selected={selected?.id} player={player} comparisonPlayer={mode === "players" ? compareWith : undefined} view={courtView} onViewChange={setCourtView} onSelect={pick} />
        </div> : density ? evidencePage ? <ShotList shots={evidencePage.rows} selected={selected?.id} onSelect={pickFromList} paging={{ index: evidencePage.index, total: evidencePage.total, onChange: changeEvidencePage }} /> : pageQuery.error ? <p className="archive-status" role="alert">Couldn’t load shot evidence. <Button variant="ghost" onClick={pageQuery.retry}>Retry</Button></p> : <p className="archive-status" role="status">Loading shot evidence…</p> : combined.length > 0 && <ShotList key={`${player}-${mode}-${dateRange}-${combined[0]?.id}-${combined.length}`} shots={combined} selected={selected?.id} onSelect={pickFromList} />}
        <div className="court-legend">
          {single ? <span className="single-look-key"><LookKey side="a" />{firstTitle}</span> : <div className="look-toggles" role="group" aria-label="Visible looks">
            <Button variant="ghost" aria-pressed={visible.a} disabled={visible.a && !visible.b} onClick={() => toggleLook("a")}><LookKey side="a" />A · {firstTitle}</Button>
            <Button variant="ghost" aria-pressed={visible.b} disabled={visible.b && !visible.a} onClick={() => toggleLook("b")}><LookKey side="b" />B · {secondTitle}</Button>
          </div>}
          <span className="legend-result">{density ? "Benchmark bins · blue makes · amber misses" : "Circle = made · × = missed"}</span>
        </div>
      </section>
      <section className="panel selected-panel" aria-label="Selected shot">
        <PanelHeader title="Shot details">{selected && <div className="detail-nav"><Button variant="icon" aria-label="Previous shot" disabled={(activeCursor ?? index) < 1} onClick={() => moveShot(-1)}><ChevronLeft size={16} /></Button><Button variant="icon" aria-label="Next shot" disabled={activeCursor !== undefined ? activeCursor >= visibleCount - 1 : index >= combined.length - 1} onClick={() => moveShot(1)}><ChevronRight size={16} /></Button></div>}</PanelHeader>
        {selected ? <>
          <ShotDetails shot={selected} />
          {!selectedLocation && <p className="shot-location-note" role="status">{selected.x === null || selected.y === null ? "No recorded court location for this shot." : "This shot’s location cannot be plotted."}</p>}
          {selectedLocation?.atDepthLimit && <p className="shot-location-note" role="status">Marker shown at the chart’s depth limit.</p>}
        </> : activeCursor !== undefined && pageQuery.error ? <p className="archive-status" role="alert">Couldn’t load shot evidence. <Button variant="ghost" onClick={pageQuery.retry}>Retry</Button></p> : activeCursor !== undefined && pageQuery.pending ? <p className="archive-status" role="status">Loading shot evidence…</p> : <EmptyState title="No shot selected">{validRange ? "Change the filters to find a shot." : "Choose a start and end date inside the preview window."}</EmptyState>}
      </section>
    </div>
    <p className="metric-note">PPS means points per shot. Actual metrics use every matching shot. Expected metrics use shots with a model estimate.{start < dataset.scoredStart && dataset.retrospective > 0 && " Estimates from before the holdout are retrospective and use games the model was fitted on."}</p>
  </>;
}
