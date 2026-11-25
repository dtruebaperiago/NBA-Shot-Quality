"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { Court } from "./court";
import { ShotDetails, ShotList } from "./evidence";
import { ShotFilterFields } from "./shot-filter-fields";
import { Button, EmptyState, PanelHeader } from "./ui";
import type { CourtView } from "../lib/court-scene";
import { profileShots, type ProfileShotScope } from "../lib/player-profile";
import { count, emptyShotFilters, shotFilterOptions, type Shot, type ShotFilters } from "../lib/shots";

const noShots: Shot[] = [];
const fullScope = { team: "", game: "", from: "" };

export function PlayerPortrait({ player, nbaId }: { player: string; nbaId?: string }) {
  const [failed, setFailed] = useState(false);
  const initials = player.split(/\s+/).slice(0, 2).map(part => part[0]).join("");
  return <div className="player-portrait">
    {nbaId && !failed
      ? <Image loading="eager" src={"https://cdn.nba.com/headshots/nba/latest/260x190/" + nbaId + ".png"} width={260} height={190} alt={"Portrait of " + player} onError={() => setFailed(true)} />
      : <span aria-hidden="true">{initials}</span>}
  </div>;
}

export function PlayerShotLab({ player, shots, entry }: { player: string; shots: Shot[]; entry: { filters: ShotFilters; scope: ProfileShotScope; label: string } }) {
  const [filters, setFilters] = useState(entry.filters);
  const [scope, setScope] = useState(entry.scope);
  const [label, setLabel] = useState(entry.label);
  const [selectedId, setSelectedId] = useState("");
  const [view, setView] = useState<CourtView>("spatial");
  const scopedShots = useMemo(() => profileShots(shots, emptyShotFilters, scope), [shots, scope]);
  const options = useMemo(() => shotFilterOptions(scopedShots), [scopedShots]);
  const matching = useMemo(() => profileShots(scopedShots, filters, fullScope), [scopedShots, filters]);
  const selected = matching.find(shot => shot.id === selectedId);
  const select = (shot: Shot) => setSelectedId(shot.id);
  const hasFilters = Object.values(filters).some(Boolean);

  return <section className="panel player-lab" id="player-shots" aria-label="Player shot explorer">
    <PanelHeader title="Explore this player’s shots" description={count(matching.length) + " matching attempts · " + (label || "Full tracked archive")} />
    <div className="player-lab-controls">
      <ShotFilterFields filters={filters} options={options} onChange={next => { setFilters(next); setSelectedId(""); }} />
      {(label || hasFilters) && <Button variant="ghost" onClick={() => { setScope(fullScope); setLabel(""); setFilters(emptyShotFilters); setSelectedId(""); }}>Reset to all tracked shots</Button>}
    </div>
    {matching.length ? <>
      <Court first={matching} second={noShots} selected={selected?.id} player={player} view={view} onViewChange={setView} onSelect={select} />
      <div className="player-lab-evidence">
        <ShotList key={matching[0].id + ":" + matching.length + ":" + JSON.stringify(filters)} shots={matching} selected={selected?.id} onSelect={select} />
        {selected && <aside aria-label="Selected shot"><ShotDetails shot={selected} linkPlayer={false} /></aside>}
      </div>
    </> : <EmptyState title="No matching attempts">Clear the filters or reset to the full tracked archive.</EmptyState>}
  </section>;
}
