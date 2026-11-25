"use client";

import { createContext, useContext, useEffect, useState, type SetStateAction } from "react";
import { usePreviewState } from "./use-preview-state";

export const WorkspaceArchive = createContext("");

export function useWorkspaceState<T extends object>(screen: string, defaults: T, openFresh = false) {
  const archive = useContext(WorkspaceArchive);
  const [initial] = useState(defaults);
  const [saved, save] = usePreviewState<T | null>("sq-workspace-v1-" + archive + "-" + screen, null, undefined, "session");
  const [entryState, setEntryState] = useState(initial);

  // An explicit link opens its requested scope, which becomes the workspace tab's latest state.
  useEffect(() => {
    if (openFresh) save(() => initial);
  }, [initial, openFresh, save]);

  function setField<K extends keyof T>(field: K, action: SetStateAction<T[K]>) {
    let next = initial;
    save(previous => {
      const current = previous ?? initial;
      const value = typeof action === "function" ? (action as (previous: T[K]) => T[K])(current[field]) : action;
      next = { ...current, [field]: value };
      return next;
    });
    if (openFresh) setEntryState(next);
  }

  return [openFresh ? entryState : saved ?? initial, setField] as const;
}
