"use client";

import { useEffect, useState } from "react";

export function useArchiveQuery<T>(query: string, initial: { query: string; data: T }) {
  const [result, setResult] = useState<{ query: string; data?: T; errorStatus?: number }>(initial);
  const [retry, setRetry] = useState(0);
  const initialQuery = initial.query;

  useEffect(() => {
    if (!query || query === initialQuery) return;
    const controller = new AbortController();
    fetch(`/api/archive?${query}`, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw response.status;
        return response.json() as Promise<T>;
      })
      .then(data => { if (!controller.signal.aborted) setResult({ query, data }); })
      .catch(error => { if (!controller.signal.aborted) setResult({ query, errorStatus: typeof error === "number" ? error : 0 }); });
    return () => controller.abort();
  }, [query, initialQuery, retry]);

  const active = query === initialQuery ? initial : result.query === query ? result : undefined;
  const errorStatus = active && "errorStatus" in active ? active.errorStatus : undefined;
  return {
    data: active?.data,
    pending: Boolean(query && !active),
    error: errorStatus !== undefined,
    errorStatus,
    retry: () => { setResult(initial); setRetry(value => value + 1); },
  };
}
