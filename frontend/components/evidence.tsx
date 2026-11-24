"use client";

import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, ListFilter } from "lucide-react";
import { useState } from "react";
import { shotPageSize } from "../lib/archive-query";
import { count, displayDate, gameClock, isSmallSample, shotDistance, smallSampleThreshold, summarize, type Shot } from "../lib/shots";
import { AnimatedNumber } from "./animated-number";
import { Badge, Button, Dialog, EmptyState } from "./ui";

export type CohortSide = "a" | "b";

export function CohortMetrics({ side, title, context, shots, totals = summarize(shots) }: { side?: CohortSide; title: string; context: string; shots: Shot[]; totals?: ReturnType<typeof summarize> }) {
  const small = isSmallSample(totals.attempts);
  const scoredSmall = isSmallSample(totals.scored);

  return <section className="cohort-panel" aria-label={title} data-side={side ?? "a"}>
    <header className="cohort-header">
      {side && <span className="cohort-marker" aria-hidden="true">{side.toUpperCase()}</span>}
      <div className="cohort-heading"><h2>{title}</h2><p>{context}</p></div>
      {small && <Badge tone="warning" title={`Fewer than ${smallSampleThreshold} recorded attempts match the filters.`}>Small sample</Badge>}
      <span className="cohort-attempts"><strong><AnimatedNumber value={totals.attempts} /></strong> <span>shots</span></span>
    </header>
    <dl className="metric-grid">
      <div><dt>Actual PPS</dt><dd><AnimatedNumber format="decimal" value={totals.pps} /></dd></div>
      <div><dt>Expected PPS</dt><dd><AnimatedNumber format="decimal" value={totals.expectedPps} /></dd></div>
      <div><dt>Actual FG%</dt><dd><AnimatedNumber format="percentage" value={totals.fg} /></dd></div>
      <div><dt>Expected FG%</dt><dd><AnimatedNumber format="percentage" value={totals.expectedFg} /></dd></div>
    </dl>
    <div className="cohort-foot"><span>{totals.scored ? <>Expected metrics use <AnimatedNumber value={totals.scored} />{totals.scored < totals.attempts && <> of <AnimatedNumber value={totals.attempts} /></>} shots</> : "Expected metrics unavailable"}</span>{scoredSmall && !small && <Badge tone="warning" title={`Fewer than ${smallSampleThreshold} attempts have a model estimate. Actual metrics still use every matching attempt.`}>Few model-scored shots</Badge>}</div>
  </section>;
}

export function ShotDetails({ shot }: { shot: Shot }) {
  const { distance, fromCourt } = shotDistance(shot);

  return <div className="shot-details">
    <div className="shot-summary"><div><strong>{shot.player}</strong><span>{shot.team} vs {shot.opponent} · {displayDate(shot.date, true)}</span></div><Badge tone={shot.made ? "positive" : "neutral"}>{shot.made ? "Made" : "Missed"} {shot.value}PT</Badge></div>
    <div className="shot-probability">
      <span>Expected make</span>
      <strong><AnimatedNumber format="percentage" value={shot.probability} /></strong>
    </div>
    <dl className="shot-facts">
      {shot.probability !== null && <div><dt>Expected points</dt><dd><AnimatedNumber format="decimal" value={shot.probability * shot.value} /></dd></div>}
      <div><dt>Shot type</dt><dd>{shot.family}</dd></div>
      <div><dt>Court zone</dt><dd>{shot.zone}</dd></div>
      <div><dt>Basket distance</dt><dd title={fromCourt ? "From original court coordinates" : undefined}><AnimatedNumber format="distance" value={distance} prefix={fromCourt ? "≈ " : ""} empty="Unrecorded" /></dd></div>
      <div><dt>Game clock</dt><dd>{shot.period > 4 ? `OT${shot.period - 4}` : `Q${shot.period}`} · <AnimatedNumber format="clock" value={shot.gameClock} /></dd></div>
      <div><dt>Shot clock</dt><dd><AnimatedNumber format="seconds" value={shot.shotClock} empty="Unrecorded" /></dd></div>
      <div><dt>Nearest defender</dt><dd><AnimatedNumber format="distance" value={shot.defender} empty="Unknown" /></dd></div>
      {shot.trackingOnly && <div><dt>Model</dt><dd>Tracking only</dd></div>}
      {shot.retrospective && <div><dt>Estimate type</dt><dd>Retrospective (in-sample)</dd></div>}
      {shot.contextConflict && <div><dt>Play-by-play</dt><dd>Outcome conflict · location and type unverified</dd></div>}
    </dl>
  </div>;
}

export function ShotList({ shots, selected, onSelect, paging }: { shots: Shot[]; selected?: string; onSelect: (shot: Shot) => void; paging?: { index: number; total: number; onChange: (page: number) => void } }) {
  const [page, setPage] = useState(0);
  const total = paging?.total ?? shots.length;
  const pageCount = Math.ceil(total / shotPageSize);
  const currentPage = paging?.index ?? Math.min(page, Math.max(0, pageCount - 1));
  const start = currentPage * shotPageSize;
  const rows = paging ? shots : shots.slice(start, start + shotPageSize);
  const changePage = paging?.onChange ?? setPage;

  if (!shots.length) return <EmptyState title="No matching shots">Try widening the date range or clearing a filter.</EmptyState>;

  return <div className="shot-list">
    <div className="table-scroll"><table>
      <thead><tr><th scope="col">Player / game</th><th scope="col">Shot</th><th scope="col">Result</th><th scope="col">Expected</th></tr></thead>
      <tbody>{rows.map(shot => <tr key={shot.id} data-selected={selected === shot.id}>
        <td><button type="button" className="shot-row-button" onClick={() => onSelect(shot)} aria-pressed={selected === shot.id}>
          <strong>{shot.player}</strong><small>{displayDate(shot.date)} · {shot.team} vs {shot.opponent}</small>
          <span className="sr-only">, {gameClock(shot.gameClock)}, {shot.made ? "made" : "missed"} {shot.value}-pointer</span>
        </button></td>
        <td>{shot.family}</td><td><span className={`result-label ${shot.made ? "is-made" : ""}`}>{shot.made ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{shot.made ? "Made" : "Missed"}</span></td>
        <td className="mono"><AnimatedNumber format="percentage" value={shot.probability} /></td>
      </tr>)}</tbody>
    </table></div>
    <div className="list-footer"><span><AnimatedNumber value={start + 1} />–<AnimatedNumber value={Math.min(start + shotPageSize, total)} /> of <AnimatedNumber value={total} /> shots</span><div>
      <Button variant="icon" aria-label="Previous shots" disabled={!currentPage} onClick={() => changePage(currentPage - 1)}><ChevronLeft size={16} /></Button>
      <Button variant="icon" aria-label="Next shots" disabled={currentPage + 1 >= pageCount} onClick={() => changePage(currentPage + 1)}><ChevronRight size={16} /></Button>
    </div></div>
  </div>;
}

export function EvidenceDialog({ title, shots, onClose }: { title: string; shots: Shot[]; onClose: () => void }) {
  const [selected, setSelected] = useState<Shot>();
  return <Dialog title={title} description={`${count(shots.length)} supporting shots`} onClose={onClose}>
    <div className="dialog-evidence">
      {selected && <ShotDetails shot={selected} />}
      <ShotList shots={shots} selected={selected?.id} onSelect={setSelected} />
    </div>
  </Dialog>;
}

export function EvidenceLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <Button variant="ghost" className="evidence-link" onClick={onClick}><ListFilter size={15} aria-hidden="true" />{children}</Button>;
}
