"use client";

import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { modelRates, modelSearch, parseProbabilityRange, type ModelScope, type ModelStudy } from "../lib/model-study";
import { playerProfileLink } from "../lib/player-profile";
import { count, percentage } from "../lib/shots";
import { useArchiveQuery } from "../lib/use-archive-query";
import { useWorkspaceState } from "../lib/use-workspace-state";
import { Button, EmptyState, PanelHeader, SelectField } from "./ui";

const empty = { query: "", data: null };
const perPage = 10;

export function ModelRangeRanking({ scope, names }: { scope: ModelScope; names: Record<string, string> }) {
  const [{ lower, upper, order, minimum, page }, setTab] = useWorkspaceState("model-range", {
    lower: "0",
    upper: "20",
    order: "makes" as "makes" | "attempts" | "fg",
    minimum: "1",
    page: 0,
  });
  const range = parseProbabilityRange(lower, upper);
  const archive = useArchiveQuery<ModelStudy | null>(range ? modelSearch(scope, { lower, upper }) : "", empty);
  const rows = (archive.data?.players ?? []).filter(player => player.attempts >= Number(minimum)).sort((a, b) => {
    const difference = order === "fg" ? b.makes / b.attempts - a.makes / a.attempts : b[order] - a[order];
    return difference || b.makes - a.makes || b.attempts - a.attempts || a.name.localeCompare(b.name);
  });
  const leader = rows[0];
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / perPage) - 1));
  const start = currentPage * perPage;
  const profile = (name: string) => playerProfileLink(name, { ...scope, lower, upper });

  return <section className="panel model-ranking range-ranking" aria-label="Expected FG range rankings">
    <PanelHeader title="Expected FG range rankings" description="Rank players by how many shots they made or took at a chosen make probability. Both range endpoints are included." />
    <div className="range-controls">
      <label className="field"><span>Minimum expected FG%</span><input type="number" min="0" max="100" step="any" value={lower} onChange={event => { setTab("lower", event.target.value); setTab("page", 0); }} /></label>
      <label className="field"><span>Maximum expected FG%</span><input type="number" min="0" max="100" step="any" value={upper} onChange={event => { setTab("upper", event.target.value); setTab("page", 0); }} /></label>
      <SelectField label="Minimum attempts in range" value={minimum} onChange={event => { setTab("minimum", event.target.value); setTab("page", 0); }}>
        <option value="1">1+</option><option value="5">5+</option><option value="10">10+</option><option value="20">20+</option><option value="50">50+</option>
      </SelectField>
      <SelectField label="Rank by" value={order} onChange={event => {
        const next = event.target.value;
        if (next === "makes" || next === "attempts" || next === "fg") setTab("order", next);
        setTab("page", 0);
      }}><option value="makes">Most made field goals</option><option value="attempts">Most attempts</option><option value="fg">Highest actual FG%</option></SelectField>
    </div>

    {!range ? <EmptyState title="Enter an expected FG% range">Use values from 0 to 100, with the minimum at or below the maximum.</EmptyState>
      : archive.pending ? <p className="archive-status" role="status">Loading players in this range…</p>
      : archive.error ? <p className="archive-status" role="alert">Couldn’t load range rankings. <Button variant="ghost" onClick={archive.retry}>Retry</Button></p>
      : leader ? <>
        <div className="range-leader">
          <div><p className="mini-label">Leads this ranking</p><Link className="range-leader-name" href={profile(leader.name)} prefetch={false}>{names[leader.name] ?? leader.name} <ArrowUpRight size={18} aria-hidden="true" /></Link></div>
          <div className="range-leader-metric"><strong>{order === "fg" ? percentage(leader.makes / leader.attempts) : count(leader[order])}</strong><span>{order === "makes" ? "made field goals" : order === "attempts" ? "attempts" : "actual FG%"}</span></div>
        </div>
        <div className="table-scroll"><table className="model-table">
          <thead><tr><th scope="col">Player</th><th scope="col">Makes</th><th scope="col">Attempts</th><th scope="col">Actual FG%</th><th scope="col">Expected FG%</th></tr></thead>
          <tbody>{rows.slice(start, start + perPage).map(player => {
            const rates = modelRates(player, "fg");
            return <tr key={player.name}>
              <th scope="row"><Link className="model-table-link" href={profile(player.name)} prefetch={false}>{names[player.name] ?? player.name} <ArrowUpRight size={13} aria-hidden="true" /></Link></th>
              <td>{count(player.makes)}</td><td>{count(player.attempts)}</td><td>{percentage(rates.actual)}</td><td>{percentage(rates.expected)}</td>
            </tr>;
          })}</tbody>
        </table></div>
        <div className="list-footer"><span>{start + 1}–{Math.min(start + perPage, rows.length)} of {count(rows.length)}</span>
          <div><Button variant="icon" aria-label="Previous ranked players" disabled={!currentPage} onClick={() => setTab("page", currentPage - 1)}><ChevronLeft size={16} /></Button><Button variant="icon" aria-label="Next ranked players" disabled={start + perPage >= rows.length} onClick={() => setTab("page", currentPage + 1)}><ChevronRight size={16} /></Button></div>
        </div>
      </> : <EmptyState title="No players match this range">Widen the range, lower the attempt minimum, or broaden the filters above.</EmptyState>}
  </section>;
}
