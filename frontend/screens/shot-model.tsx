"use client";

import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";
import { AnimatedNumber } from "../components/animated-number";
import { Badge, Button, EmptyState, PageHeader, PanelHeader, Segment, SelectField } from "../components/ui";
import { gameLabel } from "../lib/archive-query";
import type { ArchiveCatalog } from "../lib/dataset";
import { equalityLine, modelAxis } from "../lib/model-plot";
import { modelRates, modelSearch, probabilityBands, type ModelMetric, type ModelScope, type ModelStudy } from "../lib/model-study";
import { count, decimal, displayDate, isSmallSample, percentage } from "../lib/shots";
import { useArchiveQuery } from "../lib/use-archive-query";

type Catalog = Pick<ArchiveCatalog, "source" | "teams" | "games" | "attempts" | "scored" | "retrospective" | "earliestScore" | "scoredStart" | "scoredEnd">;
type Player = ModelStudy["players"][number];
const metrics = [{ value: "fg", label: "Field goal %" }, { value: "pps", label: "Points per shot" }] as const;
const scales = [{ value: "spread", label: "Spread" }, { value: "linear", label: "Linear" }] as const;
type Scale = (typeof scales)[number]["value"];
const perPage = 8;

function labLink({ team, game, value, window }: ModelScope, player: string, band?: number) {
  const params = new URLSearchParams({ model: "1", player, team, game, value, window });
  if (band !== undefined) params.set("band", String(band));
  return `/?${params}`;
}

function Rate({ value, metric }: { value: number | null; metric: ModelMetric }) {
  return <AnimatedNumber value={value} format={metric === "fg" ? "percentage" : "decimal"} />;
}

function Gap({ value, metric }: { value: number | null; metric: ModelMetric }) {
  const shown = value === null ? null : value * (metric === "fg" ? 100 : 1);
  const rounded = shown === null ? null : Number(shown.toFixed(metric === "fg" ? 1 : 2));
  return <span className="model-gap" data-direction={rounded ? (rounded > 0 ? "above" : "below") : undefined}>
    <AnimatedNumber value={value} format={metric === "fg" ? "percentage-point" : "signed-decimal"} />
  </span>;
}

function PlayerPlot({ players, active, metric, scale, onSelect }: { players: Player[]; active: Player; metric: ModelMetric; scale: Scale; onSelect: (name: string) => void }) {
  const reduce = useReducedMotion();
  const points = players.flatMap(player => {
    const { actual, expected } = modelRates(player, metric);
    return actual === null || expected === null ? [] : [{ player, actual, expected }];
  });
  const fg = metric === "fg";
  const xAxis = modelAxis(points.map(point => point.expected), metric, scale === "spread");
  const yAxis = modelAxis(points.map(point => point.actual), metric, scale === "spread");
  const tick = (value: number) => fg ? `${Math.round(value * 100)}%` : decimal(value);
  const format = fg ? percentage : decimal;

  return <figure className="model-figure" aria-label={`${fg ? "Field goal rate" : "Points per shot"} scatter plot`}>
    <div className="model-y-label">Actual {fg ? "FG%" : "PPS"}</div>
    <div className="model-plot">
      {xAxis.ticks.map(value => <div className="model-grid-x" key={value} style={{ left: `${xAxis.position(value)}%` }}><span>{tick(value)}</span></div>)}
      {yAxis.ticks.map(value => <div className="model-grid-y" key={value} style={{ bottom: `${yAxis.position(value)}%` }}><span>{tick(value)}</span></div>)}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="model-parity" aria-hidden="true"><polyline points={equalityLine(xAxis, yAxis)} fill="none" vectorEffect="non-scaling-stroke" /></svg>
      {points.map(({ player, actual, expected }) => {
        const selected = player.name === active.name;
        return <motion.button key={player.name} type="button" className="model-point" data-selected={selected} tabIndex={-1} aria-pressed={selected}
          aria-label={`${player.name}, ${format(actual)} actual, ${format(expected)} expected, ${count(player.attempts)} shots`} title={player.name}
          initial={false} animate={{ left: `${xAxis.position(expected)}%`, bottom: `${yAxis.position(actual)}%` }} transition={{ duration: reduce ? 0 : .25 }}
          style={{ "--dot-size": `${Math.min(10, 3.5 + Math.sqrt(player.attempts) * .23)}px` } as CSSProperties} onClick={() => onSelect(player.name)}>
          {selected && <span className="model-point-label" data-left={xAxis.position(expected) > 57} aria-hidden="true">{player.name}</span>}
        </motion.button>;
      })}
    </div>
    <div className="model-x-label">Expected {fg ? "FG%" : "PPS"}</div>
    <figcaption><span><i className="model-legend-line" /> Equal to expected</span><span><i className="model-legend-dot" /> Larger dot = more attempts</span>{scale === "spread" && <span>Axis spacing expands the main cluster.</span>}</figcaption>
  </figure>;
}

export function ShotModel({ catalog, entry, initial }: { catalog: Catalog; entry: { scope: ModelScope; player: string; minimum: string }; initial: { query: string; data: ModelStudy } }) {
  const [scope, setScope] = useState(entry.scope);
  const [metric, setMetric] = useState<ModelMetric>("fg");
  const [scale, setScale] = useState<Scale>("spread");
  const [minimum, setMinimum] = useState(entry.minimum);
  const [selected, setSelected] = useState(entry.player);
  const [order, setOrder] = useState("attempts");
  const [page, setPage] = useState(0);
  const reduce = useReducedMotion();
  const archive = useArchiveQuery(modelSearch(scope), initial);
  const games = catalog.games.filter(game => (scope.window === "full" || game.date >= catalog.scoredStart) && (!scope.team || game.teams.includes(scope.team)));
  const eligible = useMemo(() => archive.data?.players.filter(player => player.attempts >= Number(minimum)) ?? [], [archive.data, minimum]);
  const ranked = useMemo(() => [...eligible].sort((a, b) => {
    if (order === "attempts") return b.attempts - a.attempts || a.name.localeCompare(b.name);
    const field = order === "expected" ? "expected" : "gap";
    const delta = (modelRates(b, metric)[field] ?? 0) - (modelRates(a, metric)[field] ?? 0);
    return (order === "below" ? -delta : delta) || b.attempts - a.attempts || a.name.localeCompare(b.name);
  }), [eligible, metric, order]);
  const focus = eligible.find(player => player.name === selected) ?? ranked[0];
  const playerRate = focus && modelRates(focus, metric);
  const poolRate = archive.data && modelRates(archive.data.pool, metric);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(ranked.length / perPage) - 1));
  const start = currentPage * perPage;
  const game = games.find(game => game.id === scope.game);
  const fullArchive = scope.window === "full" && catalog.retrospective > 0;
  const unit = metric === "fg" ? "FG%" : "PPS";

  function updateScope(next: ModelScope) {
    setScope(next);
    setPage(0);
  }

  return <>
    <PageHeader title="Shot Quality Model" description="Compare the looks players take with how efficiently they finish them.">
      <div className="heading-meta model-window"><CalendarDays size={16} aria-hidden="true" />{catalog.source === "archive" ? fullArchive ? "Full archive" : "Holdout" : "Scored sample"} · {displayDate(fullArchive ? catalog.earliestScore : catalog.scoredStart, fullArchive)} – {displayDate(catalog.scoredEnd, true)}</div>
    </PageHeader>

    <section className="panel controls-panel" aria-label="Model comparison filters">
      <div className="controls-row model-controls" data-archive={catalog.retrospective > 0}>
        <div className="field"><span>Metric</span><Segment label="Model metric" options={metrics} value={metric} onChange={value => { setMetric(value); setPage(0); }} /></div>
        {catalog.retrospective > 0 && <SelectField label="Scoring window" value={scope.window} onChange={event => {
          const window = event.target.value === "holdout" ? "holdout" : "full";
          const dropGame = window === "holdout" && game && game.date < catalog.scoredStart;
          if (dropGame) setMinimum("20");
          updateScope({ ...scope, window, game: dropGame ? "" : scope.game });
        }}><option value="full">Full archive</option><option value="holdout">Holdout only</option></SelectField>}
        <SelectField label="Team" value={scope.team} onChange={event => {
          const team = event.target.value;
          const nextGame = !team || game?.teams.includes(team) ? scope.game : "";
          if (scope.game && !nextGame) setMinimum("20");
          updateScope({ ...scope, team, game: nextGame });
        }}><option value="">All teams</option>{Object.entries(catalog.teams).map(([code, team]) => <option key={code} value={code}>{team.name}</option>)}</SelectField>
        <SelectField label="Game" value={scope.game} onChange={event => {
          const game = event.target.value;
          if (game && !scope.game) setMinimum("1");
          if (!game && scope.game) setMinimum("20");
          updateScope({ ...scope, game });
        }}><option value="">All scored games</option>{games.map(game => <option key={game.id} value={game.id}>{displayDate(game.date)} · {gameLabel(game)}</option>)}</SelectField>
        <SelectField label="Shot value" value={scope.value} onChange={event => updateScope({ ...scope, value: event.target.value })}><option value="">2PT + 3PT</option><option value="2">2PT</option><option value="3">3PT</option></SelectField>
        <SelectField label="Minimum shots" value={minimum} onChange={event => { setMinimum(event.target.value); setPage(0); }}><option value="1">1+</option><option value="10">10+</option><option value="20">20+</option><option value="50">50+</option><option value="100">100+</option></SelectField>
      </div>
      {fullArchive && <p className="model-window-note">Estimates before {displayDate(catalog.scoredStart, true)} are retrospective and use games the model was fitted on. Use Holdout only to compare on unseen games.</p>}
    </section>

    {archive.pending ? <p className="archive-status" role="status">Loading model comparisons…</p> : archive.error ? <p className="archive-status" role="alert">Couldn’t load model comparisons. <Button variant="ghost" onClick={archive.retry}>Retry</Button></p> : focus && playerRate && poolRate ? <>
      <div className="model-analysis">
        <section className="panel model-chart" aria-label="Actual versus expected">
          <PanelHeader title={`Actual vs. expected ${unit}`} description={<><AnimatedNumber value={eligible.length} /> players · <AnimatedNumber value={archive.data?.pool.attempts ?? 0} /> scored attempts in scope</>}><Segment label="Plot scale" options={scales} value={scale} onChange={setScale} /></PanelHeader>
          <PlayerPlot players={eligible} active={focus} metric={metric} scale={scale} onSelect={setSelected} />
        </section>

        <section className="panel model-profile" aria-label="Selected player's model profile">
          <PanelHeader title="Player profile" />
          <div className="model-profile-body">
            <SelectField label="Highlight player" value={focus.name} onChange={event => setSelected(event.target.value)}>{eligible.map(player => <option key={player.name}>{player.name}</option>)}</SelectField>
            <div className="model-profile-name"><div><h3>{focus.name}</h3><p>{focus.teams.join(" · ")} · <AnimatedNumber value={focus.attempts} /> shots</p></div>{isSmallSample(focus.attempts) && <Badge tone="warning">Small sample</Badge>}</div>
            <dl className="model-profile-rates">
              <div><dt>Expected {unit}</dt><dd><Rate value={playerRate.expected} metric={metric} /></dd></div>
              <div><dt>Actual {unit}</dt><dd><Rate value={playerRate.actual} metric={metric} /></dd></div>
              <div><dt>Actual − expected</dt><dd><Gap value={playerRate.gap} metric={metric} /></dd></div>
            </dl>
            <p className="model-pool">Across this scope, the model expected <strong><Rate value={poolRate.expected} metric={metric} /></strong> and the results were <strong><Rate value={poolRate.actual} metric={metric} /></strong>.</p>
            <Link className="button" href={labLink(scope, focus.name)} prefetch={false}>View scored shots <ArrowUpRight size={15} aria-hidden="true" /></Link>
          </div>
        </section>
      </div>

      <section className="panel model-mix" aria-label="Shot selection by make probability">
        <PanelHeader title={`${focus.name}’s shot mix`} description="See how often this player takes each level of look and what happens on those attempts." />
        <div className="table-scroll"><table className="model-table">
          <thead><tr><th scope="col">Make probability</th><th scope="col">Share of attempts</th><th scope="col">Shots</th><th scope="col">Expected {unit}</th><th scope="col">Actual {unit}</th><th scope="col"><span className="sr-only">Shot evidence</span></th></tr></thead>
          <tbody>{focus.bands.map((band, index) => {
            const share = band.attempts / focus.attempts;
            const rate = modelRates(band, metric);
            return <tr key={probabilityBands[index]}>
              <th scope="row">{probabilityBands[index]}</th>
              <td><div className="model-mix-share"><span className="model-mix-track" aria-hidden="true"><motion.i initial={false} animate={{ scaleX: share }} transition={{ duration: reduce ? 0 : .24 }} /></span><Rate value={share} metric="fg" /></div></td>
              <td><AnimatedNumber value={band.attempts} /></td><td><Rate value={rate.expected} metric={metric} /></td><td><Rate value={rate.actual} metric={metric} /></td>
              <td>{band.attempts > 0 && <Link className="model-table-link" href={labLink(scope, focus.name, index)} aria-label={`View shots with ${probabilityBands[index]} make probability`} prefetch={false}>View shots <ArrowUpRight size={13} aria-hidden="true" /></Link>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      </section>

      <section className="panel model-ranking" aria-label="Compare players">
        <PanelHeader title="Compare players"><SelectField label="Sort by" value={order} onChange={event => { setOrder(event.target.value); setPage(0); }}>
          <option value="attempts">Most shots</option><option value="expected">Highest expected</option><option value="above">Most above expected</option><option value="below">Most below expected</option>
        </SelectField></PanelHeader>
        <div className="table-scroll"><table className="model-table">
          <thead><tr><th scope="col">Player</th><th scope="col">Shots</th><th scope="col">Expected {unit}</th><th scope="col">Actual {unit}</th><th scope="col">Difference</th></tr></thead>
          <tbody>{ranked.slice(start, start + perPage).map(player => {
            const rate = modelRates(player, metric);
            return <tr key={player.name} data-selected={player.name === focus.name}>
              <th scope="row"><button type="button" className="model-rank-player" aria-pressed={player.name === focus.name} onClick={() => setSelected(player.name)}>{player.name}<small>{player.teams.join(" · ")}{isSmallSample(player.attempts) ? " · Small sample" : ""}</small></button></th>
              <td><AnimatedNumber value={player.attempts} /></td><td><Rate value={rate.expected} metric={metric} /></td><td><Rate value={rate.actual} metric={metric} /></td><td><Gap value={rate.gap} metric={metric} /></td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="list-footer"><span>{start + 1}–{Math.min(start + perPage, ranked.length)} of {count(ranked.length)} players</span><div><Button variant="icon" aria-label="Previous players" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16} /></Button><Button variant="icon" aria-label="Next players" disabled={start + perPage >= ranked.length} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16} /></Button></div></div>
      </section>
    </> : <section className="panel"><EmptyState title="No players in this sample">Lower the minimum attempts, choose all shot values, or broaden the game filter.</EmptyState></section>}

    <p className="metric-note">Actual and expected use the same scored shots. The model uses shot context and shooter history. Expected FG% averages make probabilities, and expected PPS weights them by the shot’s point value. The gap can reflect finishing, variation, and model error.</p>
    {catalog.source === "archive" && <p className="metric-note model-coverage"><AnimatedNumber value={catalog.scored} /> of <AnimatedNumber value={catalog.attempts} /> archived attempts have model estimates, including <AnimatedNumber value={catalog.scored - catalog.retrospective} /> holdout predictions.</p>}
  </>;
}
