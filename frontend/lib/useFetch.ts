'use client';

import { useState, useEffect, useCallback } from 'react';
import { authHeaders, API } from './auth';

export function useFetch<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refetch = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    fetch(`${API}${path}`, { headers: authHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [path, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  return { data, loading, error, refetch };
}

export async function apiFetch(path: string, options?: RequestInit) {
  const r = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...authHeaders(), 'Content-Type': 'application/json', ...options?.headers },
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
