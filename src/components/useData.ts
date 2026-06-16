"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * State that survives tab switches (component unmount) and full page reloads by
 * mirroring into localStorage. Used for anything the operator typed/uploaded:
 * the contact CSV, the selected campaign, concurrency, and the active job id —
 * so none of it is lost when the dashboard tab is changed or the page refreshes.
 *
 * SSR-safe: we render the default on the server + first client paint, then
 * rehydrate from storage in an effect. This avoids React hydration mismatches
 * while still restoring the stored value before any state-dependent API call
 * (the polling effects key off the rehydrated value once it lands).
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>, boolean] {
  const [state, setState] = useState<T>(initial);
  const hydratedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setState(JSON.parse(raw) as T);
    } catch {
      /* corrupt/blocked storage — fall back to the in-memory default */
    }
    hydratedRef.current = true;
    setHydrated(true);
    // Only re-run if the key itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    // Don't let the default value clobber stored data before rehydration.
    if (!hydratedRef.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage full / disabled — non-fatal, state still works in memory */
    }
  }, [key, state]);

  return [state, setState, hydrated];
}

export interface ApiError extends Error {
  status: number;
  isClient: boolean; // 4xx — usually bad input; vs 5xx/network — server/transport
}

function makeError(status: number, message: string): ApiError {
  const e = new Error(message) as ApiError;
  e.status = status;
  e.isClient = status >= 400 && status < 500;
  return e;
}

export function useFetch<T>(url: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Abort the in-flight request when url/deps change or on unmount, so a slow
  // response can't overwrite newer state or update an unmounted component.
  const ctlRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    if (!url) return;
    ctlRef.current?.abort();
    const ctl = new AbortController();
    ctlRef.current = ctl;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(url, { signal: ctl.signal });
      if (!r.ok) throw makeError(r.status, `HTTP ${r.status}`);
      const json = await r.json();
      if (!ctl.signal.aborted) setData(json);
    } catch (e: any) {
      if (e?.name === "AbortError") return; // superseded; ignore
      if (!ctl.signal.aborted) setErr(String(e?.message || e));
    } finally {
      if (!ctl.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    reload();
    return () => ctlRef.current?.abort();
  }, [reload]);

  return { data, loading, err, reload, setData };
}

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    });
  } catch (e: any) {
    // Network/transport failure — treat as a retryable server-side problem.
    throw makeError(0, "Network error — check your connection");
  }
  const txt = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(txt);
  } catch {}
  if (!r.ok) throw makeError(r.status, json?.error || `HTTP ${r.status}`);
  return json as T;
}

/**
 * api() with auto-retry on *transient* failures only (BUG 5): network drop and
 * 429 / 502 / 503 / 504. These mean the request didn't complete (or the server
 * asked us to back off), so retrying is safe — and the bulk endpoint is
 * idempotency-keyed, so even a 504 after the job actually saved won't duplicate.
 * 4xx/500 are NOT retried (client error / ambiguous), they throw immediately.
 */
export async function apiRetry<T = any>(
  url: string,
  init?: RequestInit,
  opts: { retries?: number; baseMs?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 600;
  let lastErr: any;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await api<T>(url, init);
    } catch (e: any) {
      lastErr = e;
      const status: number = e?.status ?? 0;
      const transient = status === 0 || status === 429 || status === 502 || status === 503 || status === 504;
      if (!transient || attempt === retries) throw e;
      const delay = Math.min(baseMs * 2 ** attempt, 8000) + Math.random() * 250;
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw lastErr;
}
