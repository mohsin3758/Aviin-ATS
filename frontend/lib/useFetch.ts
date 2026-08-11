'use client';

import { useState, useEffect, useCallback } from 'react';
import { authHeaders, API, clearToken } from './auth';

function handle401() {
  clearToken();
  if (typeof window !== 'undefined') {
    window.location.href = '/login?reason=session_expired';
  }
}

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
    fetch(API + path, { headers: authHeaders() })
      .then(r => {
        if (r.status === 401) { handle401(); return Promise.reject('session_expired'); }
        return r.ok ? r.json() : r.json().then(d => Promise.reject(d.detail || r.status));
      })
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(e => { if (!cancelled && e !== 'session_expired') { setError(String(e)); setLoading(false); } });
    return () => { cancelled = true; };
  }, [path, tick]);

  return { data, loading, error, refetch, mutate: (d: T) => setData(d) };
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(API + path, {
    ...options,
    headers: { ...authHeaders(), 'Content-Type': 'application/json', ...options?.headers },
  });
  if (res.status === 401) {
    handle401();
    throw new Error('Session expired. Please log in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // FastAPI's HTTPException(status, {dict}) shape nests the real message
    // one level deeper (`{"detail": {"detail": "...", "owner": {...}}}`) —
    // a bare `data?.detail` in that case is an object, and `new Error(obj)`
    // silently stringifies to "[object Object]" instead of the real text
    // (a real, pre-existing bug found 2026-08-11 while adding more call
    // sites that use this same enriched-detail shape, e.g. the "Candidate
    // Already Owned" ownership-conflict/lock messages).
    const rawDetail = data?.detail;
    const message = typeof rawDetail === 'string' ? rawDetail
      : (rawDetail && typeof rawDetail === 'object' && typeof rawDetail.detail === 'string') ? rawDetail.detail
      : data?.message || 'Request failed';
    const err: any = new Error(message);
    err.body = data; // full parsed body, for callers that want e.g. detail.owner
    throw err;
  }
  return data;
}
