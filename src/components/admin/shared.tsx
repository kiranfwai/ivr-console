"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { api } from "../useData";
import { istToday, istDaysAgo } from "./money";

/** One client's volumes + cost over the selected range (from /api/admin/analytics). */
export interface AnalyticsRow {
  id: string;
  name: string;
  email: string;
  active: boolean;
  perCallOverride: number | null;
  perMinuteOverride: number | null;
  perConnectedCallOverride: number | null;
  effPerCall: number;
  effPerMinute: number;
  effPerConnectedCall: number;
  balance: number;
  total: number;
  connected: number;
  press1: number;
  busy: number;
  noAnswer: number;
  failed: number;
  connectedSeconds: number;
  minutes: number;
  liftRate: number;
  cost: number;
}

export interface Pricing {
  perCall: number;
  perMinute: number;
  perConnectedCall: number;
  currency: string;
}

export interface AnalyticsResp {
  range: { from: string; to: string };
  currency: string;
  pricing: Pricing;
  rows: AnalyticsRow[];
  legacy: (Omit<AnalyticsRow, "id" | "name" | "email" | "active" | "perCallOverride" | "perMinuteOverride" | "perConnectedCallOverride" | "effPerCall" | "effPerMinute" | "effPerConnectedCall" | "balance" | "liftRate"> & { liftRate: number }) | null;
  totals: { total: number; connected: number; press1: number; minutes: number; cost: number };
}

/** Fetch admin analytics for a day range. Returns data + loading/error + reload. */
export function useAnalytics(from: string, to: string) {
  const [data, setData] = useState<AnalyticsResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api<AnalyticsResp>(`/api/admin/analytics?from=${from}&to=${to}`);
      setData(r);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  return { data, err, loading, reload: load };
}

/** Persist the admin "view as" client and jump to a data tab (reloads the page). */
export function viewAsClient(id: string, tab = "reports") {
  document.cookie = `ivr_admin_client=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
  window.location.href = `/?tab=${tab}`;
}

const PRESETS: { label: string; from: () => string; days: number }[] = [
  { label: "Today", from: () => istToday(), days: 0 },
  { label: "7d", from: () => istDaysAgo(6), days: 6 },
  { label: "30d", from: () => istDaysAgo(29), days: 29 },
  { label: "90d", from: () => istDaysAgo(89), days: 89 },
  // "All" reaches back ~2 years — within readRange's 800-day cap — so historical
  // (pre-clients) data surfaces without a migration.
  { label: "All", from: () => istDaysAgo(729), days: 729 },
];

/** From/To date inputs with quick presets. Controlled by the parent view. */
export function RangeControl({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const today = istToday();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1.5 text-muted">
        <Calendar size={14} />
      </div>
      <input
        type="date"
        value={from}
        max={to}
        onChange={(e) => onChange(e.target.value, to)}
        className="bg-bg/60 border border-line hover:border-line2 focus:border-brand/60 rounded-lg px-2.5 py-1.5 text-xs outline-none"
      />
      <span className="text-muted text-xs">→</span>
      <input
        type="date"
        value={to}
        min={from}
        max={today}
        onChange={(e) => onChange(from, e.target.value)}
        className="bg-bg/60 border border-line hover:border-line2 focus:border-brand/60 rounded-lg px-2.5 py-1.5 text-xs outline-none"
      />
      <div className="flex items-center gap-1 ml-1">
        {PRESETS.map((p) => {
          const active = from === p.from() && to === today;
          return (
            <button
              key={p.label}
              onClick={() => onChange(p.from(), today)}
              className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                active
                  ? "bg-brand/10 text-brand border-brand/25"
                  : "text-ink2 border-line hover:bg-elev/60"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
