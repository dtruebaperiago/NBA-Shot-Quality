"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { AnimatedNumber } from "./animated-number";
import { EvidenceLink, ShotDetails, ShotList } from "./evidence";
import { Badge, Button, Dialog, EmptyState, PanelHeader, Segment, SelectField } from "./ui";
import { count, displayDate, isSmallSample, percentage, type Shot } from "../lib/shots";
import { matchingEdge, rankingRate, scoutDimension, scoutRates, teamEvidenceSearch, teamScoutSearch, type ScoutDates, type ScoutDimension, type ScoutMeasure, type ScoutSide, type ScoutTotals, type TeamEvidence, type TeamScoutReport } from "../lib/team-scout";
import { useArchiveQuery } from "../lib/use-archive-query";
import { useWorkspaceState } from "../lib/use-workspace-state";

const sides = [{ value: "shooting", label: "Our shooting" }, { value: "allowed", label: "Shots allowed" }] as const;
const directions = [{ value: "own", label: "Our offense" }, { value: "opponent", label: "Opponent offense" }] as const;
const values = ["2PT", "3PT"];
const initialReport = { query: "", data: null };
const initialEvidence = { query: "", data: null };

export type ScoutEvidenceLink = { title: string; count: number; query: TeamEvidence };
export type ScoutDraftFinding = { id: string; title: string; evidence: ScoutEvidenceLink[] };

export function TeamScoutShotDialog({ link, version, onClose }: { link: ScoutEvidenceLink; version: string; onClose: () => void }) {
  const [selected, setSelected] = useState<Shot>();
  const evidence = useArchiveQuery<Shot[] | null>(teamEvidenceSearch(link.query) + `&version=${encodeURIComponent(version)}`, initialEvidence);
  return <Dialog title={link.title} description={`${count(link.count)} supporting shots`} onClose={onClose}>
    {evidence.errorStatus === 409 || (evidence.data && evidence.data.length !== link.count) ? <p className="archive-status" role="alert">The original archive evidence is unavailable for this finding.</p>
      : evidence.error ? <p className="archive-status" role="alert">Couldn’t load these shots. <Button variant="ghost" onClick={evidence.retry}>Retry</Button></p>
      : evidence.data ? <div className="dialog-evidence">{selected && <ShotDetails shot={selected} />}<ShotList shots={evidence.data} selected={selected?.id} onSelect={setSelected} /></div>
      : <p className="archive-status" role="status">Loading shot evidence…</p>}
  </Dialog>;
}

function ShootingRates({ totals }: { totals?: ScoutTotals }) {
  if (!totals) return <span className="scout-norates">No shots</span>;
  const rates = scoutRates(totals);
  return <>
    <dl className="scout-rate-line">
      <div><dt>Actual FG%</dt><dd><AnimatedNumber value={rates.actual} format="percentage" /></dd></div>
      <div><dt>Expected FG%</dt><dd><AnimatedNumber value={rates.expected} format="percentage" /></dd></div>
      <div><dt>Gap</dt><dd><AnimatedNumber value={rates.gap} format="percentage-point" /></dd></div>
    </dl>
    <div className="scout-rate-volume"><span><AnimatedNumber value={totals.attempts} /> attempts</span>{isSmallSample(totals.attempts) && <Badge tone="warning">Small sample</Badge>}
      {totals.scored !== totals.attempts && <span><AnimatedNumber value={totals.scored} /> scored{rates.matchedActual !== null && <> · <AnimatedNumber value={rates.matchedActual} format="percentage" /> actual on scored shots</>}</span>}
    </div>
  </>;
}

function referenceText(totals: ScoutTotals | undefined, measure: ScoutMeasure) {
  if (measure === "gap") return "Gap reference · 0 pp";
  const rate = rankingRate(totals, measure);
  return rate === null ? "Archive comparison unavailable" : `Archive ${measure} FG% · ${percentage(rate)}`;
}

export function TeamScoutReview({ view, own, opponent, dates, range, scoredStart, archiveVersion, added, onAdd, onEvidence }: {
  view: "team" | "matchup" | "opponent-defense" | "opponent-shooting";
  own: string;
  opponent: string;
  dates: ScoutDates;
  range: string;
  scoredStart: string;
  archiveVersion: string;
  added: ReadonlySet<string>;
  onAdd: (finding: ScoutDraftFinding) => void;
  onEvidence: (link: ScoutEvidenceLink) => void;
}) {
  const [{ teamSide, direction, dimension, selectedMeasure }, setTab] = useWorkspaceState("scout-" + view, {
    teamSide: "allowed" as ScoutSide,
    direction: "opponent" as "own" | "opponent",
    dimension: "zone" as ScoutDimension,
    selectedMeasure: (view === "matchup" ? "expected" : "actual") as ScoutMeasure,
  });
  const earlyPregame = Boolean(dates.before && dates.before < scoredStart);
  const measure = earlyPregame ? "actual" : selectedMeasure;
  const matchup = view === "matchup";
  const opponentDefense = view === "opponent-defense";
  const opponentReview = opponentDefense || view === "opponent-shooting";
  const subject = opponentReview ? opponent : own;
  const side = opponentReview ? opponentDefense ? "allowed" : "shooting" : teamSide;
  const archive = useArchiveQuery<TeamScoutReport | null>(teamScoutSearch(dates, subject, matchup ? opponent : "", dimension) + `&version=${encodeURIComponent(archiveVersion)}`, initialReport);
  const data = archive.data;
  const title = matchup ? "Where the matchup lines up" : "Where to review";
  const reviewTitle = opponentReview ? `${opponent} ${opponentDefense ? "defense" : "shooting"}` : `${own} team review`;
  const sideLabel = opponentDefense ? "defense" : "shooting";

  function link(team: string, side: ScoutSide, bucket: string, totals: ScoutTotals): ScoutEvidenceLink {
    return { title: `${team} ${side === "shooting" ? "shooting" : "shots allowed"} · ${bucket}`, count: totals.attempts, query: { ...dates, team, side, dimension, bucket } };
  }

  const controls = <div className="team-scout-controls">
    {matchup ? <Segment label="Matchup direction" value={direction} options={directions} onChange={next => setTab("direction", next)} /> : !opponentReview && <Segment label="Team scout perspective" value={side} options={sides} onChange={next => setTab("teamSide", next)} />}
    <SelectField label="Break down by" value={dimension} onChange={event => setTab("dimension", scoutDimension(event.target.value))}><option value="zone">Court zone</option><option value="family">Shot type</option><option value="space">Defender distance</option></SelectField>
    <SelectField label="Rank by" value={measure} onChange={event => setTab("selectedMeasure", event.target.value as ScoutMeasure)}><option value="actual">Actual FG%</option><option value="expected" disabled={earlyPregame}>Expected FG%</option><option value="gap" disabled={earlyPregame}>Actual − expected</option></SelectField>
  </div>;

  if (!data) return <section className="panel team-scout-panel"><PanelHeader title={matchup ? "Matchup" : reviewTitle} description={range} />{controls}
    {archive.error ? <p className="archive-status" role="alert">Couldn’t load scouting metrics. <Button variant="ghost" onClick={archive.retry}>Retry</Button></p> : <p className="archive-status" role="status">Loading scouting metrics…</p>}
  </section>;

  const ownAttack = direction === "own";
  const attackTeam = ownAttack ? own : opponent;
  const defenseTeam = ownAttack ? opponent : own;
  const shooting = ownAttack ? data.own.shooting : data.opponent.shooting;
  const allowed = ownAttack ? data.opponent.allowed : data.own.allowed;
  const subjectBuckets = data.own[side];
  const relevant = matchup ? [...new Set([...Object.keys(shooting), ...Object.keys(allowed)])] : Object.keys(subjectBuckets);
  const detail = relevant.filter(bucket => !values.includes(bucket));
  const compareScore = (bucket: string) => matchup
    ? matchingEdge(shooting[bucket]?.totals, allowed[bucket]?.totals, data.league[bucket]?.totals, measure)
    : rankingRate(subjectBuckets[bucket]?.totals, measure);
  const countFor = (bucket: string) => matchup ? (shooting[bucket]?.totals.attempts ?? 0) + (allowed[bucket]?.totals.attempts ?? 0) : subjectBuckets[bucket].totals.attempts;
  const descending = matchup || side === "allowed";
  detail.sort((a, b) => {
    const first = compareScore(a);
    const second = compareScore(b);
    if (first === null || second === null) return Number(first === null) - Number(second === null) || countFor(b) - countFor(a) || a.localeCompare(b);
    return (descending ? second - first : first - second) || countFor(b) - countFor(a) || a.localeCompare(b);
  });

  return <section className="panel team-scout-panel" aria-label={matchup ? "Matchup scouting" : opponentReview ? `Opponent ${sideLabel}` : "Your team scouting"}>
    <PanelHeader title={matchup ? `${attackTeam} offense vs. ${defenseTeam} defense` : reviewTitle} description={range} />
    {controls}
    {earlyPregame && <p className="team-scout-method">Expected rates are retrospective for this target. Rankings use actual results.</p>}
    <p className="team-scout-method">{matchup
      ? measure === "gap" ? "Highlights looks where the offense makes more than expected and the defense also allows more makes than expected." : "Highlights looks where the offense and the shots allowed by the defense are both above the archive rate for the same look."
      : side === "allowed" ? `These are shots taken against ${opponentDefense ? opponent : "your team"} by all opponents. A positive gap means those opponents made more shots than expected.` : `These are ${opponentReview ? `${opponent}’s` : "your team’s"} shots against all opponents. A negative gap means fewer makes than expected.`}</p>
    {!relevant.length ? <EmptyState title="No shots in this window">Choose a wider range or a later target game.</EmptyState> : matchup ? <>
      <div className="team-scout-heading"><h3>{title}</h3><p>Both sides use the same dates. Each side draws on all its opponents.</p></div>
      <div className="team-scout-comparisons">{[...values.filter(bucket => relevant.includes(bucket)), ...detail].map(bucket => {
        const left = shooting[bucket]?.totals;
        const right = allowed[bucket]?.totals;
        const edge = compareScore(bucket);
        const evidence = [left && link(attackTeam, "shooting", bucket, left), right && link(defenseTeam, "allowed", bucket, right)].filter(entry => entry !== undefined);
        const id = `matchup-${attackTeam}-${defenseTeam}-${values.includes(bucket) ? "all" : dimension}-${bucket}`;
        return <article key={bucket} className="team-scout-comparison">
          <header><div><h4>{bucket}</h4><p>{referenceText(data.league[bucket]?.totals, measure)}</p></div>{edge !== null && edge > 0 && <Badge tone={ownAttack ? "positive" : "warning"}>{measure === "gap" ? "Both above expected" : "Both above archive FG%"}</Badge>}</header>
          <div className="team-scout-pair">
            <div><h5>{attackTeam} shooting</h5><ShootingRates totals={left} />{left && <EvidenceLink onClick={() => onEvidence(link(attackTeam, "shooting", bucket, left))}>Shooting evidence</EvidenceLink>}</div>
            <div><h5>{defenseTeam} shots allowed</h5><ShootingRates totals={right} />{right && <EvidenceLink onClick={() => onEvidence(link(defenseTeam, "allowed", bucket, right))}>Defense evidence</EvidenceLink>}</div>
          </div>
          {left && right && <div className="team-scout-add"><Button variant="ghost" disabled={added.has(id)} onClick={() => onAdd({ id, title: `${attackTeam} offense vs. ${defenseTeam} defense · ${bucket}`, evidence })}><Plus size={15} aria-hidden="true" />{added.has(id) ? "Added to brief" : "Add matchup to brief"}</Button></div>}
        </article>;
      })}</div>
    </> : <>
      <div className="team-scout-overalls">{values.map(bucket => {
        const totals = subjectBuckets[bucket]?.totals;
        const rates = scoutRates(totals);
        return <article key={bucket} className="team-scout-overall"><header><h3>{bucket} {side === "allowed" ? "allowed" : "shooting"}</h3>{totals && <EvidenceLink onClick={() => onEvidence(link(subject, side, bucket, totals))}>View shots</EvidenceLink>}</header>
          <ShootingRates totals={totals} />
          {totals && rates.extraMakes !== null && <p className="team-scout-makes"><AnimatedNumber value={totals.scoredMakes} /> makes vs. <AnimatedNumber value={totals.expectedMakes} format="decimal" /> expected on <AnimatedNumber value={totals.scored} /> scored attempts <strong>(<AnimatedNumber value={rates.extraMakes} format="signed-decimal" /> makes)</strong></p>}
        </article>;
      })}</div>
      <div className="team-scout-heading"><h3>{title}</h3><p>{side === "allowed" ? "Highest rates or gaps allowed first." : "Lowest shooting rates or most negative gaps first."}</p></div>
      <div className="table-scroll"><table className="team-scout-table"><thead><tr><th scope="col">Shot context</th><th scope="col">Attempts</th><th scope="col">Actual FG%</th><th scope="col">Expected FG%</th><th scope="col">Gap</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{detail.map(bucket => {
          const totals = subjectBuckets[bucket].totals;
          const rates = scoutRates(totals);
          const evidence = link(subject, side, bucket, totals);
          const id = `opponent-${side}-${subject}-${dimension}-${bucket}`;
          return <tr key={bucket}><th scope="row">{bucket}<small>{referenceText(data.league[bucket]?.totals, measure)}</small>{isSmallSample(totals.attempts) && <Badge tone="warning">Small sample</Badge>}{totals.scored !== totals.attempts && <small><AnimatedNumber value={totals.scored} /> scored</small>}</th>
            <td><AnimatedNumber value={totals.attempts} /></td><td><AnimatedNumber value={rates.actual} format="percentage" /></td><td><AnimatedNumber value={rates.expected} format="percentage" /></td><td><AnimatedNumber value={rates.gap} format="percentage-point" /></td>
            <td><EvidenceLink onClick={() => onEvidence(evidence)}>View shots</EvidenceLink>{opponentReview && <Button variant="icon" disabled={added.has(id)} aria-label={`${added.has(id) ? "Added" : "Add"} ${bucket} ${sideLabel} to brief`} title={added.has(id) ? "Added to brief" : "Add to brief"} onClick={() => onAdd({ id, title: evidence.title, evidence: [evidence] })}><Plus size={15} aria-hidden="true" /></Button>}</td></tr>;
        })}</tbody></table></div>
      {!detail.length && <p className="team-scout-method">No recorded contexts for this breakdown.</p>}
    </>}
    <p className="team-scout-method team-scout-foot">FG% gaps compare the same scored attempts. Rate rankings use at least 20 contributing shots for each ranked side.{data.retrospective && ` The archive includes estimates from games the model was fitted on before ${displayDate(scoredStart, true)}.`}</p>
  </section>;
}
