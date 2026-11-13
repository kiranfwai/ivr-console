"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar } from "lucide-react";
import { api } from "../useData";
import { istToday, istDaysAgo } from "./money";
import { Seg } from "../AdminTabKit";

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

const PRESETS: { id: string; label: string; from: () => string }[] = [
  { id: "today", label: "Today", from: () => istToday() },
  { id: "7", label: "7 days", from: () => istDaysAgo(6) },
  { id: "30", label: "30 days", from: () => istDaysAgo(29) },
  { id: "90", label: "90 days", from: () => istDaysAgo(89) },
  // "All" reaches back ~2 years — within readRange's 800-day cap — so historical
  // (pre-clients) data surfaces without a migration.
  { id: "all", label: "All", from: () => istDaysAgo(729) },
];

const DATE_CLS =
  "h-[30px] rounded-lg border border-line bg-panel px-2 text-[12.5px] text-ink shadow-xs outline-none hover:border-line2 focus:border-accent focus:shadow-glow";

/** Preset segmented control + From/To dates. Controlled by the parent view. */
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
  const active = PRESETS.find((p) => from === p.from() && to === today)?.id ?? "";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Seg
        value={active}
        size="sm"
        options={PRESETS.map((p) => ({ id: p.id, label: p.label }))}
        onChange={(id) => {
          const p = PRESETS.find((x) => x.id === id);
          if (p) onChange(p.from(), today);
        }}
      />
      <div className="flex items-center gap-1.5">
        <Calendar size={14} className="text-muted" aria-hidden="true" />
        <input
          type="date"
          value={from}
          max={to}
          onChange={(e) => onChange(e.target.value, to)}
          className={DATE_CLS}
          aria-label="From date"
        />
        <span className="text-xs text-muted">–</span>
        <input
          type="date"
          value={to}
          min={from}
          max={today}
          onChange={(e) => onChange(from, e.target.value)}
          className={DATE_CLS}
          aria-label="To date"
        />
      </div>
    </div>
  );
}
