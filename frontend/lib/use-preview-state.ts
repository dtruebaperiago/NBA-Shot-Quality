"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

const changed = "shot-quality-preview-change";
const memory = new Map<string, string>();
const failed = new Set<string>();

function subscribe(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(changed, notify);
  return () => { window.removeEventListener("storage", notify); window.removeEventListener(changed, notify); };
}

function read(key: string) {
  const fallback = memory.get(key);
  if (fallback !== undefined) return fallback;
  try { return localStorage.getItem(key); } catch { return null; }
}

function parse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export function usePreviewState<T>(key: string, fallback: T, legacyKey?: string) {
  const getSnapshot = useCallback(() => read(key) ?? (legacyKey ? read(legacyKey) : null), [key, legacyKey]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const value = useMemo(() => parse(raw, fallback), [raw, fallback]);
  const saveFailed = useSyncExternalStore(subscribe, () => failed.has(key), () => false);

  function update(edit: (current: T) => T, requireStorage = false) {
    const next = JSON.stringify(edit(parse(getSnapshot(), fallback)));
    try {
      localStorage.setItem(key, next);
      memory.delete(key);
      failed.delete(key);
    } catch {
      if (!requireStorage) memory.set(key, next);
      failed.add(key);
    }
    window.dispatchEvent(new Event(changed));
    return !failed.has(key);
  }

  return [value, update, saveFailed] as const;
}
