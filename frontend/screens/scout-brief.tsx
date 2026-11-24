"use client";

import { ArrowDown, ArrowUp, ArrowUpRight, Check, Plus, Trash2 } from "lucide-react";
import { motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { AnimatedNumber } from "../components/animated-number";
import { EvidenceDialog, EvidenceLink } from "../components/evidence";
import { TeamScoutReview, TeamScoutShotDialog, type ScoutDraftFinding, type ScoutEvidenceLink } from "../components/team-scout-review";
import { Badge, Button, Dialog, EmptyState, PageHeader, PanelHeader, Segment, SelectField } from "../components/ui";
import { gameLabel, teamSearch, type ArchiveGame } from "../lib/archive-query";
import type { ArchiveCatalog } from "../lib/dataset";
import { matchupOpponent, pregameShooters, rankTendencies, scoutEvidence, scoutTendencies, type trackedTeamHistory, type ScoutOrder, type Tendency } from "../lib/scout-tendencies";
import { displayDate, isSmallSample, smallSampleThreshold, type Shot } from "../lib/shots";
import { useArchiveQuery } from "../lib/use-archive-query";
import { usePreviewState } from "../lib/use-preview-state";
import { useScoutingTeam } from "../lib/use-scouting-team";

const modes = [{ value: "pregame", label: "Pregame" }, { value: "retrospective", label: "Team overview" }] as const;
const views = [{ value: "opponent", label: "Opponent tendencies" }, { value: "team", label: "Your team" }, { value: "matchup", label: "Matchup" }] as const;
const opponentViews = [{ value: "shooting", label: "Shooting tendencies" }, { value: "team-shooting", label: "Team shooting" }, { value: "allowed", label: "Shots allowed" }] as const;
type Mode = (typeof modes)[number]["value"];
type View = (typeof views)[number]["value"];
type ScoutCatalog = Pick<ArchiveCatalog, "defaultTeam" | "source" | "teams" | "games" | "start" | "end" | "scoredStart">;
type Finding = { id: string; title: string; note: string; shotIds: string[]; evidence?: ScoutEvidenceLink[]; version?: string };
type Brief = { findings: Finding[]; published?: { findings: Finding[]; version: number } };
const noShots: Shot[] = [];

export function ScoutBrief({ dataset, archiveVersion, teamHistory, entry, initial }: { dataset: ScoutCatalog; archiveVersion: string; teamHistory: ReturnType<typeof trackedTeamHistory>; entry: { opponent: string; game: string }; initial: { query: string; data: Shot[] } }) {
  const [ownTeam, setOwnTeam] = useScoutingTeam(dataset);
  const [chosenOpponent, setTeam] = useState(entry.opponent);
  const [mode, setMode] = useState<Mode>("pregame");
  const [view, setView] = useState<View>("opponent");
  const [opponentView, setOpponentView] = useState<(typeof opponentViews)[number]["value"]>("shooting");
  const [target, setTarget] = useState(entry.game);
  const [from, setFrom] = useState(dataset.start);
  const [through, setThrough] = useState(dataset.end);
  const [ownFrom, setOwnFrom] = useState(dataset.start);
  const [ownThrough, setOwnThrough] = useState(dataset.end);
  const [evidence, setEvidence] = useState<{ title: string; shots: Shot[] }>();
  const [teamEvidence, setTeamEvidence] = useState<ScoutEvidenceLink>();
  const [publishedOpen, setPublishedOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [order, setOrder] = useState<ScoutOrder>("balanced");

  const games = dataset.games.filter(game => game.teams.includes(ownTeam));
  const game = games.find(entry => entry.id === target) ?? games[0];
  const isPregame = mode === "pregame";
  const latestOpponent = matchupOpponent(game, ownTeam) ?? Object.keys(dataset.teams).find(code => code !== ownTeam) ?? "";
  const team = isPregame || chosenOpponent === ownTeam ? latestOpponent : chosenOpponent;
  const teamInfo = dataset.teams[team];
  const archive = useArchiveQuery(teamSearch(team, archiveVersion), initial);
  const teamShots = archive.data ?? noShots;
  const opponents = new Set(games.map(game => matchupOpponent(game, ownTeam)));
  const valid = isPregame ? Boolean(game && matchupOpponent(game, ownTeam) === team) : Boolean(from && through && from <= through && from >= dataset.start && through <= dataset.end);
  const range = !valid ? "Choose a valid evidence range" : isPregame && game ? `${displayDate(dataset.start, true)} to before ${displayDate(game.date, true)}` : `${displayDate(from, true)} – ${displayDate(through, true)}`;
  const scope = valid ? scoutEvidence(teamShots, team, from, through, isPregame ? game?.date : undefined) : noShots;
  const review = view === "matchup" ? "matchup" : opponentView === "allowed" ? "opponent-defense" : opponentView === "team-shooting" ? "opponent-shooting" : undefined;
  const earlyPregame = Boolean(isPregame && game && game.date < dataset.scoredStart);
  const activeOrder = earlyPregame && order !== "balanced" && order !== "volume" && order !== "actual" && order !== "low-actual" ? "actual" : order;
  const suggestions = view === "opponent" && !review ? rankTendencies(scoutTendencies(isPregame && game ? pregameShooters(scope, teamHistory, game.date) : scope), activeOrder, !earlyPregame) : [];
  const context = `${dataset.source}-${team}-${mode}-${isPregame ? game?.id : `${from}-${through}`}`;
  const legacyKey = (isPregame && valid) || ownTeam === dataset.defaultTeam ? `sq-brief-v1-${context}` : undefined;
  const [draft, update, saveFailed] = usePreviewState<Brief>(`sq-brief-v2-${ownTeam}-${context}`, { findings: [] }, legacyKey);
  const added = new Set(draft.findings.filter(finding => finding.version === archiveVersion).map(finding => finding.id));
  const shown = showAll ? suggestions : suggestions.slice(0, 4);
  const retrospective = scope.some(shot => shot.retrospective);
  const modeLabel = isPregame ? "Pregame" : "Team overview";
  const dates = isPregame ? { from: dataset.start, through: dataset.end, before: game?.date ?? "" } : { from, through, before: "" };
  const ownDates = { from: ownFrom, through: ownThrough, before: "" };
  const ownValid = Boolean(ownFrom && ownThrough && ownFrom <= ownThrough && ownFrom >= dataset.start && ownThrough <= dataset.end);

  function selectGame(next: ArchiveGame) {
    const opponent = matchupOpponent(next, ownTeam);
    if (!opponent) return;
    setTarget(next.id);
    setTeam(opponent);
    setShowAll(false);
  }

  function changeOwnTeam(next: string) {
    setOwnTeam(next);
    const match = [game, ...dataset.games].find(game => matchupOpponent(game, next));
    const opponent = matchupOpponent(match, next) ?? Object.keys(dataset.teams).find(team => team !== next);
    setTarget(match?.id ?? "");
    if (opponent && (isPregame || team === next)) setTeam(opponent);
    setShowAll(false);
  }

  function captureFinding(finding: Omit<Finding, "version" | "note">) {
    update(current => {
      const existing = current.findings.find(item => item.id === finding.id);
      if (existing?.version === archiveVersion) return current;
      const next = { ...finding, title: existing?.title ?? finding.title, note: existing?.note ?? "", version: archiveVersion };
      return { ...current, findings: existing ? current.findings.map(item => item.id === finding.id ? next : item) : [...current.findings, next] };
    });
  }

  function add(candidate: Tendency) {
    captureFinding({ id: candidate.id, title: candidate.title, shotIds: candidate.shots.map(shot => shot.id) });
  }

  function addReviewFinding(finding: ScoutDraftFinding) {
    captureFinding({ ...finding, shotIds: [] });
  }

  function openTeamEvidence(link: ScoutEvidenceLink) {
    setPublishedOpen(false);
    setTeamEvidence(link);
  }

  function move(id: string, direction: -1 | 1) {
    update(current => {
      const findings = [...current.findings];
      const index = findings.findIndex(finding => finding.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= findings.length) return current;
      [findings[index], findings[destination]] = [findings[destination], findings[index]];
      return { ...current, findings };
    });
  }

  function openFinding(finding: Finding) {
    const ids = new Set(finding.shotIds);
    setPublishedOpen(false);
    setEvidence({ title: finding.title, shots: teamShots.filter(shot => ids.has(shot.id)) });
  }

  return <>
    <PageHeader title="Opponent Scout Brief" description="Build a brief from the shots behind each tendency.">
      <SelectField label="Your team" className="scout-own-team" value={ownTeam} onChange={event => changeOwnTeam(event.target.value)}>{Object.entries(dataset.teams).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}</SelectField>
    </PageHeader>
    <nav className="scout-view-nav" aria-label="Scout brief views"><Segment label="Scouting view" options={views} value={view} onChange={setView} /></nav>
    {view === "team" ? <>
      <section className="panel controls-panel" aria-label="Your team review dates">
        <div className="date-fields scout-own-dates">
          <label className="field"><span>From</span><input type="date" min={dataset.start} max={dataset.end} value={ownFrom} onChange={event => setOwnFrom(event.target.value)} /></label>
          <label className="field"><span>Through</span><input type="date" min={dataset.start} max={dataset.end} value={ownThrough} onChange={event => setOwnThrough(event.target.value)} /></label>
        </div>
      </section>
      {ownValid ? <TeamScoutReview key="team" view="team" own={ownTeam} opponent="" dates={ownDates} range={`${displayDate(ownFrom, true)} – ${displayDate(ownThrough, true)}`} scoredStart={dataset.scoredStart} archiveVersion={archiveVersion} added={new Set()} onAdd={addReviewFinding} onEvidence={openTeamEvidence} /> : <EmptyState title="Choose valid review dates">Pick a start and end within the archive.</EmptyState>}
    </> : <section className="panel controls-panel" aria-label="Scouting scope">
      <div className="controls-row scout-controls">
        <SelectField label="Opponent" value={team} onChange={event => {
          const opponent = event.target.value;
          const match = isPregame ? games.find(game => matchupOpponent(game, ownTeam) === opponent) : undefined;
          if (match) selectGame(match);
          else { setTeam(opponent); setShowAll(false); }
        }}>{Object.entries(dataset.teams).filter(([id]) => id !== ownTeam && (!isPregame || opponents.has(id))).map(([id, entry]) => <option key={id} value={id}>{entry.name}</option>)}</SelectField>
        <div className="field"><span>Brief mode</span><Segment label="Brief mode" options={modes} value={mode} onChange={next => {
          if (next === mode) return;
          setMode(next);
          setShowAll(false);
          if (next === "pregame") {
            const match = game && matchupOpponent(game, ownTeam) === team ? game : games.find(game => matchupOpponent(game, ownTeam) === team) ?? games[0];
            if (match) selectGame(match);
          } else setTeam(team);
        }} /></div>
        {isPregame ? <SelectField label="Target game" value={game?.id ?? ""} onChange={event => {
          const match = games.find(game => game.id === event.target.value);
          if (match) selectGame(match);
        }}>
          {games.map(match => <option key={match.id} value={match.id}>{displayDate(match.date, true)} · {gameLabel(match)}</option>)}
        </SelectField> : <div className="date-fields">
          <label className="field"><span>From</span><input type="date" min={dataset.start} max={dataset.end} value={from} onChange={event => setFrom(event.target.value)} /></label>
          <label className="field"><span>Through</span><input type="date" min={dataset.start} max={dataset.end} value={through} onChange={event => setThrough(event.target.value)} /></label>
        </div>}
      </div>
    </section>}

    {view === "opponent" && <div className="scout-view-nav"><Segment label="Opponent scouting perspective" options={opponentViews} value={opponentView} onChange={setOpponentView} /></div>}
    {view !== "team" && <div className="scout-grid">
      {review ? valid ? <TeamScoutReview key={review} view={review} own={ownTeam} opponent={team} dates={dates} range={range} scoredStart={dataset.scoredStart} archiveVersion={archiveVersion} added={added} onAdd={addReviewFinding} onEvidence={openTeamEvidence} /> : <EmptyState title="Choose a valid scouting window">Pick a target game or valid archive dates.</EmptyState> : <section aria-label="Suggested tendencies" className="panel suggestions-panel" aria-busy={archive.pending}>
        <PanelHeader title="Suggested tendencies" description={archive.data ? <><AnimatedNumber value={scope.length} /> {team} attempts · {range}</> : range}>
          <SelectField label="Rank by" className="scout-ranking" value={activeOrder} onChange={event => { setOrder(event.target.value as ScoutOrder); setShowAll(false); }}>
            <option value="balanced">Scouting priorities</option><option value="volume">Most shots</option><option value="expected" disabled={earlyPregame}>Highest expected FG%</option><option value="actual">Highest actual FG%</option><option value="low-expected" disabled={earlyPregame}>Lowest expected FG%</option><option value="low-actual">Lowest actual FG%</option><option value="above" disabled={earlyPregame}>FG% gap · highest first</option><option value="below" disabled={earlyPregame}>FG% gap · lowest first</option>
          </SelectField>
        </PanelHeader>
        {shown.length > 0 && <p className="scout-method">Each tendency groups an opponent’s shots by player, point value, and shot context. Rate rankings prioritize groups with {smallSampleThreshold}+ contributing shots.{retrospective && ` The archived model was fitted on games before ${displayDate(dataset.scoredStart, true)}.`}{earlyPregame && " Expected rates are retrospective for this target. Rankings use actual results and volume."}</p>}
        {archive.pending ? <p className="archive-status" role="status">Loading opponent shots…</p> : archive.error ? <p className="archive-status" role="alert">Couldn’t load opponent shots. <Button variant="ghost" onClick={archive.retry}>Retry</Button></p> : shown.length ? <div className="suggestion-list">{shown.map(candidate => {
          const isAdded = added.has(candidate.id);
          return <motion.article key={candidate.id} className="suggestion" layout="position" initial={{ opacity: .72 }} animate={{ opacity: 1 }} transition={{ duration: .18 }}>
            <div className="suggestion-meta"><span className="mini-label">{candidate.kind}</span>{candidate.priority && <Badge tone="positive">{candidate.priority}</Badge>}{isSmallSample(candidate.shots.length) && <Badge tone="warning">Small sample</Badge>}{candidate.shots.length >= smallSampleThreshold && isSmallSample(candidate.scored) && <Badge tone="warning">Few model-scored shots</Badge>}</div>
            <div className="suggestion-main"><div><h3>{candidate.title}</h3><p><AnimatedNumber value={candidate.shots.length} /> of <AnimatedNumber value={candidate.attempts} /> recorded attempts for this player.</p></div></div>
            <dl className="suggestion-rates">
              <div><dt>Actual FG%</dt><dd><AnimatedNumber format="percentage" value={candidate.actual} /></dd></div>
              <div><dt>Expected FG%</dt><dd><AnimatedNumber format="percentage" value={candidate.expected} /></dd></div>
              <div><dt>Actual − expected</dt><dd><AnimatedNumber format="percentage-point" value={candidate.gap} /></dd></div>
            </dl>
            {candidate.scored > 0 && candidate.scored < candidate.shots.length && <p className="suggestion-coverage">Expected FG% and the gap use <AnimatedNumber value={candidate.scored} /> scored shots, with <AnimatedNumber format="percentage" value={candidate.matchedActual} /> actual FG% on those shots.</p>}
            <div className="suggestion-actions"><EvidenceLink onClick={() => setEvidence(candidate)}>View shots</EvidenceLink><Button variant="ghost" disabled={isAdded} onClick={() => add(candidate)}><span className="finding-icon" data-added={isAdded} aria-hidden="true"><Plus size={15} /><Check size={15} /></span>{isAdded ? "Added" : "Add finding"}</Button></div>
          </motion.article>;
        })}</div> : <EmptyState title="No tendencies in this window">{valid ? "Choose a later target game or widen the dates in Team overview." : "Choose a target game or set valid dates within the archive."}</EmptyState>}
        {suggestions.length > 4 && <div className="panel-bottom"><Button variant="ghost" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer tendencies" : <>Show all <AnimatedNumber value={suggestions.length} /> tendencies</>}{showAll ? <ArrowUp size={15} /> : <ArrowDown size={15} />}</Button></div>}
      </section>}

      <section className="panel brief-panel" aria-label="Brief draft">
        <div className="brief-masthead"><span className="brief-team" style={{ "--team-color": teamInfo.color } as CSSProperties}>{teamInfo.mark}</span><div><span className="mini-label">{modeLabel} · For {ownTeam}</span><h2>{teamInfo.name}</h2>{isPregame && game && <p className="brief-match">{gameLabel(game)} · {displayDate(game.date, true)}</p>}</div></div>
        <div className="brief-body">
          <header className="brief-header"><h3>Brief draft</h3><Badge tone={draft.findings.length ? "positive" : "neutral"}>Local draft</Badge></header>
          {saveFailed && <p role="alert" className="brief-empty">Your changes are unsaved. Browser storage is unavailable. Keep this tab open and retry before closing it. <Button variant="ghost" onClick={() => update(current => current)}>Retry save</Button></p>}
          {draft.findings.length ? <ol className="finding-list">{draft.findings.map((finding, index) => <motion.li key={finding.id} layout="position" initial={{ opacity: .58 }} animate={{ opacity: 1 }} transition={{ duration: .22 }}>
            <div className="finding-tools"><small>{finding.evidence && finding.evidence.length > 1 ? <><AnimatedNumber value={finding.evidence.length} /> shot samples</> : <><AnimatedNumber value={finding.evidence?.[0]?.count ?? finding.shotIds.length} /> supporting shots</>}</small><div><Button variant="icon" aria-label={`Move finding ${index + 1} up`} disabled={index === 0} onClick={() => move(finding.id, -1)}><ArrowUp size={15} /></Button><Button variant="icon" aria-label={`Move finding ${index + 1} down`} disabled={index + 1 === draft.findings.length} onClick={() => move(finding.id, 1)}><ArrowDown size={15} /></Button><Button variant="icon" aria-label={`Remove finding ${index + 1}`} onClick={() => update(current => ({ ...current, findings: current.findings.filter(item => item.id !== finding.id) }))}><Trash2 size={15} /></Button></div></div>
            <label className="field"><span>Finding</span><input value={finding.title} onChange={event => { const title = event.target.value; update(current => ({ ...current, findings: current.findings.map(item => item.id === finding.id ? { ...item, title } : item) })); }} /></label>
            <label className="field"><span>Coaching note</span><textarea placeholder="What should the team take away?" value={finding.note} onChange={event => { const note = event.target.value; update(current => ({ ...current, findings: current.findings.map(item => item.id === finding.id ? { ...item, note } : item) })); }} rows={2} /></label>
          </motion.li>)}</ol> : <p className="brief-empty">Add a tendency and write the takeaway you want the team to discuss.</p>}
        </div>
        <div className="brief-footer">
          {draft.published && <Button variant="ghost" onClick={() => setPublishedOpen(true)}><span>View version <AnimatedNumber value={draft.published.version} /></span><ArrowUpRight size={16} /></Button>}
          <Button variant="primary" disabled={!draft.findings.length || draft.findings.some(finding => !finding.title.trim())} onClick={() => {
            if (update(current => ({ ...current, published: { findings: current.findings, version: (current.published?.version ?? 0) + 1 } }), true)) setPublishedOpen(true);
          }}>Publish preview</Button>
        </div>
      </section>
    </div>}
    {publishedOpen && draft.published && <Dialog title={`${teamInfo.name} scout brief`} description={`${modeLabel} for ${ownTeam} · ${range} · Local version ${draft.published.version}`} onClose={() => setPublishedOpen(false)}>
      <div className="published-findings">{draft.published.findings.map(finding => <article key={finding.id}><h3>{finding.title}</h3>{finding.note.trim() && <p>{finding.note}</p>}{finding.version !== archiveVersion ? <p>The original archive version is unavailable for this finding. Add it again to capture current evidence.</p> : finding.evidence ? finding.evidence.map(link => <EvidenceLink key={link.title} onClick={() => openTeamEvidence(link)}><span>{link.query.team} · {link.query.side === "shooting" ? "Shooting" : "Shots allowed"} · <AnimatedNumber value={link.count} /> shots</span></EvidenceLink>) : archive.data && <EvidenceLink onClick={() => openFinding(finding)}><span><AnimatedNumber value={finding.shotIds.length} /> supporting shots</span></EvidenceLink>}</article>)}</div>
    </Dialog>}
    {evidence && <EvidenceDialog title={evidence.title} shots={evidence.shots} onClose={() => setEvidence(undefined)} />}
    {teamEvidence && <TeamScoutShotDialog key={teamEvidence.title} link={teamEvidence} version={archiveVersion} onClose={() => setTeamEvidence(undefined)} />}
  </>;
}
