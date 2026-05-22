"use client";

import { useCallback, useEffect, useState } from "react";

export function useFetch<T>(url: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const json = await r.json();
      setData(json);
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { data, loading, err, reload, setData };
}

export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const txt = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(txt);
  } catch {}
  if (!r.ok) throw new Error(json?.error || `HTTP ${r.status}`);
  return json as T;
}
