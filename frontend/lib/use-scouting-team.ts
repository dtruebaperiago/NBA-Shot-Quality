"use client";

import type { Team } from "./shots";
import { usePreviewState } from "./use-preview-state";

export function useScoutingTeam({ source, defaultTeam, teams }: { source: string; defaultTeam: string; teams: Record<string, Team> }) {
  const [storedTeam, update] = usePreviewState(`sq-scouting-team-${source}`, defaultTeam);
  const team = Object.hasOwn(teams, storedTeam) ? storedTeam : defaultTeam;
  return [team, (next: string) => update(() => next)] as const;
}
