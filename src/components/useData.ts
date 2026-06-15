"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
