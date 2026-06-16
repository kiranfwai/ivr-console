"use client";

import { Fragment, useMemo, useState } from "react";
import {
  PhoneCall, PhoneIncoming, PhoneOff, Clock, Download, RefreshCw, TrendingUp, BarChart3,
  ArrowUp, ArrowDown, X, ChevronRight, ChevronDown,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar,
} from "recharts";
import { Button, Card, KPI, Badge, Select, EmptyState, Section, Skeleton } from "./ui";
import { useFetch } from "./useData";
import type { CallRecord, Campaign } from "@/lib/models";

interface Report {
  totals: {
    total: number;
    answered: number;
    press1: number;
    failed: number;
    answerRate: number;
    press1Rate: number;
    avgDurationSec: number;
    totalsHorizonHint: number;
    lifted: number;
    notLifted: number;
    liftRate: number;
  };
  outcomes: {
    press1: number;
    connected: number;
    busy: number;
    noAnswer: number;
    rejected: number;
    error: number;
    pending: number;
  };
  byHour: Record<string, number>;
  byCampaign: Record<string, number>;
  campaignTable: CampaignRow[];
  range: { from: string; to: string };
  hangupCauseCounts: Record<string, number>;
  recent: (CallRecord & { outcome: string | null })[];
  plivoRecent: any[];
}

interface CampaignRow {
  campaignId: string;
  name: string;
  total: number;
  lifted: number;
  press1: number;
  busy: number;
  failed: number;
  liftRate: number;
}

interface DrillRow {
  to: string;
  outcome: string;
  durationSec: number | null;
  triggeredAt: string;
  digit: string;
  hangupCause: string | null;
}

type RecentRow = CallRecord & { outcome: string | null };

// Report day buckets are IST (Asia/Kolkata) — match the server. Compute the
// calendar day by shifting the instant by +5:30 and reading the UTC date.
const IST_SHIFT_MS = (5 * 60 + 30) * 60 * 1000;
function istDateKey(ms: number): string {
  return new Date(ms + IST_SHIFT_MS).toISOString().slice(0, 10);
}
function istTimeOfDay(iso: string): string {
  return new Date(Date.parse(iso) + IST_SHIFT_MS).toISOString().slice(11, 19);
}
// Compact IST "MM-DD HH:MM" for drill-down rows (keeps the date for multi-day ranges).
function istStamp(iso: string): string {
  const d = new Date(Date.parse(iso) + IST_SHIFT_MS).toISOString();
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`;
}
function todayKey(): string {
  return istDateKey(Date.now());
}
function offsetDay(n: number): string {
  return istDateKey(Date.now() + n * 24 * 60 * 60 * 1000);
}

const OUTCOME_LABEL: Record<string, string> = {
  press1: "Lifted + pressed 1",
  connected: "Lifted, no press",
  busy: "Busy",
  "no-answer": "Not lifted",
  rejected: "Rejected/invalid",
  error: "Carrier error",
  pending: "In progress",
};
const OUTCOME_TONE: Record<string, "ok" | "warn" | "danger" | "muted" | "accent" | "info"> = {
  press1: "ok",
  connected: "info",
  busy: "warn",
  "no-answer": "warn",
  rejected: "danger",
  error: "danger",
  pending: "muted",
};
const OUTCOME_COLOR: Record<string, string> = {
  press1: "#22c55e",
  connected: "#6366f1",
  busy: "#f59e0b",
  "no-answer": "#fbbf24",
  rejected: "#ef4444",
  error: "#dc2626",
  pending: "#7a8597",
};

export default function ReportsTab() {
  const [from, setFrom] = useState<string>(todayKey());
  const [to, setTo] = useState<string>(todayKey());
  const [campaign, setCampaign] = useState<string>("");
  const { data: cdata } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const campaigns = cdata?.campaigns ?? [];

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (campaign) qs.set("campaign", campaign);
  const { data, loading, reload } = useFetch<Report>(`/api/reports?${qs.toString()}`, [from, to, campaign]);

  function setPreset(start: string, end: string) {
    setFrom(start);
    setTo(end);
  }
  // Keep from <= to on manual edits so a range never inverts (which silently
  // returns zero rows). The query key (url) is from/to, so any change re-fetches.
  function changeFrom(v: string) {
    setFrom(v);
    if (to && v > to) setTo(v);
  }
  function changeTo(v: string) {
    setTo(v);
    if (from && v < from) setFrom(v);
  }
  function downloadCsv() {
    const csvQs = new URLSearchParams();
    if (from) csvQs.set("from", from);
    if (to) csvQs.set("to", to);
    if (campaign) csvQs.set("campaign", campaign);
    window.open(`/api/reports/csv?${csvQs.toString()}`, "_blank");
  }
  function downloadXlsx() {
    const xQs = new URLSearchParams();
    if (from) xQs.set("from", from);
    if (to) xQs.set("to", to);
    if (campaign) xQs.set("campaign", campaign);
    window.open(`/api/reports/xlsx?${xQs.toString()}`, "_blank");
  }

  const isToday = from === todayKey() && to === todayKey();
  const isYesterday = from === offsetDay(-1) && to === offsetDay(-1);
  const is7d = from === offsetDay(-6) && to === todayKey();
  const is30d = from === offsetDay(-29) && to === todayKey();

  // Trend hint for the Calls KPI: compare the most recent populated hour vs the
  // one before it (both come straight from real byHour data, no fabrication).
  const callsTrend = useMemo<"up" | "down" | "flat" | undefined>(() => {
    if (!data) return undefined;
    const vals = Object.entries(data.byHour)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, v]) => v);
    if (vals.length < 2) return undefined;
    const last = vals[vals.length - 1];
    const prev = vals[vals.length - 2];
    if (last > prev) return "up";
    if (last < prev) return "down";
    return "flat";
  }, [data]);

  const isRangeFiltered = !isToday || campaign !== "";

  return (
    <Section>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted mb-1.5">Range</div>
            <div className="inline-flex p-1 bg-elev/60 border border-line rounded-lg">
              <RangeBtn active={isToday} onClick={() => setPreset(todayKey(), todayKey())} label="Today" />
              <RangeBtn active={isYesterday} onClick={() => setPreset(offsetDay(-1), offsetDay(-1))} label="Yesterday" />
              <RangeBtn active={is7d} onClick={() => setPreset(offsetDay(-6), todayKey())} label="7 days" />
              <RangeBtn active={is30d} onClick={() => setPreset(offsetDay(-29), todayKey())} label="30 days" />
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted mb-1.5">From</div>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => changeFrom(e.target.value)}
                className="bg-bg/60 border border-line rounded-lg px-2.5 py-2 text-sm outline-none hover:border-line2 focus:border-brand/60"
              />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted mb-1.5">To</div>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => changeTo(e.target.value)}
                className="bg-bg/60 border border-line rounded-lg px-2.5 py-2 text-sm outline-none hover:border-line2 focus:border-brand/60"
              />
            </div>
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs uppercase tracking-wider text-muted mb-1.5">Campaign</div>
            <Select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={reload} loading={loading} leftIcon={!loading && <RefreshCw size={14} />}>
              Refresh
            </Button>
            <Button variant="ghost" onClick={downloadCsv} disabled={!data?.totals.total} leftIcon={<Download size={14} />}>
              CSV
            </Button>
            <Button onClick={downloadXlsx} disabled={!data?.totals.total} leftIcon={<Download size={14} />}>
              Excel
            </Button>
          </div>
        </div>
      </Card>

      {loading && !data && <ReportSkeleton />}

      {data && data.totals.total === 0 && (
        <Card>
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No calls in this range"
            description={
              isRangeFiltered
                ? "No calls matched these filters. Try widening the date range or selecting all campaigns."
                : "Place a call from the Dial tab, then come back."
            }
          />
        </Card>
      )}

      {data && data.totals.total > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI label="Calls" value={data.totals.total} icon={<PhoneCall size={18} />} tone="accent" trend={callsTrend} sub={callsTrend ? "vs. last hour" : undefined} />
            <KPI label="Lifted" value={data.totals.lifted} sub={`${data.totals.liftRate}% lift rate`} icon={<PhoneIncoming size={18} />} tone="ok" />
            <KPI label="Press 1" value={data.totals.press1} sub={`${data.totals.press1Rate}%`} icon={<TrendingUp size={18} />} tone="ok" />
            <KPI label="Not lifted" value={data.totals.notLifted} sub="busy + no-answer" icon={<PhoneOff size={18} />} tone="warn" />
            <KPI label="Avg duration" value={`${data.totals.avgDurationSec}s`} icon={<Clock size={18} />} />
          </div>

          <ReportBody data={data} from={from} to={to} />
        </>
      )}
    </Section>
  );
}

function ReportBody({ data, from, to }: { data: Report; from: string; to: string }) {
  // Client-side outcome filter shared by the pie and the recent-calls table.
  const [outcomeFilter, setOutcomeFilter] = useState<string | null>(null);

  function toggleOutcome(name: string) {
    setOutcomeFilter((cur) => (cur === name ? null : name));
  }

  const filteredRecent = useMemo(() => {
    if (!outcomeFilter) return data.recent;
    return data.recent.filter((r) => (r.outcome || "pending") === outcomeFilter);
  }, [data.recent, outcomeFilter]);

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="Outcome breakdown" description="Click a slice or legend row to filter recent calls.">
          <OutcomePie
            outcomes={data.outcomes}
            total={data.totals.total}
            active={outcomeFilter}
            onSelect={toggleOutcome}
          />
        </Card>
        <Card title="Volume by hour">
          <HourlyChart byHour={data.byHour} />
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card title="By campaign">
          <CampaignBars rows={data.byCampaign} />
        </Card>
        <Card title="Hangup causes (Plivo)" description="From Plivo's call history, most frequent first.">
          <KVList rows={data.hangupCauseCounts} />
        </Card>
      </div>

      <Card
        title="Campaign breakdown"
        description="Click a row to drill into individual numbers, outcomes, duration and time."
      >
        <CampaignTable rows={data.campaignTable ?? []} from={from} to={to} />
      </Card>

      <Card
        title="Recent calls"
        description={
          outcomeFilter
            ? `${filteredRecent.length} ${OUTCOME_LABEL[outcomeFilter] || outcomeFilter} of ${data.recent.length} loaded`
            : `Showing ${data.recent.length} of ${data.totals.total}`
        }
        action={
          outcomeFilter && (
            <button
              onClick={() => setOutcomeFilter(null)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs bg-elev/60 border border-line text-ink2 hover:text-ink hover:border-line2 transition-colors"
            >
              <X size={12} />
              Clear filter
            </button>
          )
        }
      >
        <RecentTable rows={filteredRecent} filtered={!!outcomeFilter} />
      </Card>
    </>
  );
}

function ReportSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Skeleton className="h-56 rounded-2xl" />
        <Skeleton className="h-56 rounded-2xl" />
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </>
  );
}

function RangeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1.5 rounded-md text-xs transition-all ${
        active ? "bg-brand/15 text-brand" : "text-ink2 hover:text-ink"
      }`}
    >
      {label}
    </button>
  );
}

function OutcomePie({
  outcomes,
  total,
  active,
  onSelect,
}: {
  outcomes: Report["outcomes"];
  total: number;
  active: string | null;
  onSelect: (name: string) => void;
}) {
  const data = [
    { name: "press1", value: outcomes.press1 },
    { name: "connected", value: outcomes.connected },
    { name: "busy", value: outcomes.busy },
    { name: "no-answer", value: outcomes.noAnswer },
    { name: "rejected", value: outcomes.rejected },
    { name: "error", value: outcomes.error },
  ].filter((d) => d.value > 0);

  if (!data.length) return <div className="text-sm text-muted">No data yet.</div>;

  const hasActive = active != null;

  return (
    <div className="flex items-center gap-6">
      <div className="w-40 h-40 relative shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              innerRadius={48}
              outerRadius={72}
              strokeWidth={0}
              paddingAngle={2}
              onClick={(e: any) => e?.name && onSelect(e.name)}
            >
              {data.map((entry, i) => (
                <Cell
                  key={i}
                  fill={OUTCOME_COLOR[entry.name]}
                  className="cursor-pointer outline-none transition-opacity"
                  fillOpacity={hasActive && active !== entry.name ? 0.28 : 1}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(v: any, n: any) => [v, OUTCOME_LABEL[n] || n]}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <div className="text-2xl font-semibold tabular-nums">{total}</div>
          <div className="text-[10px] uppercase tracking-wider text-muted">calls</div>
        </div>
      </div>
      <div className="space-y-1 flex-1 min-w-0">
        {data.map((d) => {
          const isActive = active === d.name;
          const dimmed = hasActive && !isActive;
          return (
            <button
              key={d.name}
              onClick={() => onSelect(d.name)}
              className={`w-full flex items-center justify-between gap-2 text-sm px-1.5 py-1 rounded-md transition-colors hover:bg-elev/60 ${
                isActive ? "bg-elev/80 ring-1 ring-line2" : ""
              } ${dimmed ? "opacity-50" : ""}`}
              title={isActive ? "Click to clear filter" : "Click to filter recent calls"}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OUTCOME_COLOR[d.name] }} />
                <span className="text-ink2 truncate">{OUTCOME_LABEL[d.name]}</span>
              </div>
              <span className="font-mono tabular-nums text-ink shrink-0">{d.value}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HourlyChart({ byHour }: { byHour: Record<string, number> }) {
  const entries = Object.entries(byHour).sort();
  if (!entries.length) return <div className="text-sm text-muted">No data.</div>;
  const data = entries.map(([k, v]) => ({ hour: k.slice(11), calls: v, raw: k }));

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="brandFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5eead4" stopOpacity={0.45} />
              <stop offset="100%" stopColor="#5eead4" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1f2531" vertical={false} />
          <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "#7a8597" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "#7a8597" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "#2a3142" }} />
          <Area type="monotone" dataKey="calls" stroke="#5eead4" strokeWidth={2} fill="url(#brandFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function CampaignBars({ rows }: { rows: Record<string, number> }) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]).slice(0, 6);
  if (!entries.length) return <div className="text-sm text-muted">No data.</div>;
  const data = entries.map(([name, calls]) => ({ name, calls }));

  return (
    <div className="h-40">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
          <XAxis type="number" tick={{ fontSize: 10, fill: "#7a8597" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: "#b8c0cf" }} axisLine={false} tickLine={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "#161a23" }} />
          <Bar dataKey="calls" fill="#5eead4" radius={[4, 4, 4, 4]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function KVList({ rows }: { rows: Record<string, number> }) {
  // Hangup causes sorted by frequency (desc).
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <div className="text-sm text-muted">No data.</div>;
  const max = Math.max(...entries.map(([, v]) => v));
  return (
    <div className="space-y-1.5 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="truncate text-ink2">{k}</span>
              <span className="font-mono tabular-nums text-muted">{v}</span>
            </div>
            <div className="h-1 bg-line rounded-full overflow-hidden">
              <div className="h-full bg-brand/50" style={{ width: `${(v / max) * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

type SortKey = "time" | "to" | "campaign" | "outcome" | "digit" | "duration";
type SortDir = "asc" | "desc";

const PAGE_SIZE = 25;

function RecentTable({ rows, filtered }: { rows: RecentRow[]; filtered: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visible, setVisible] = useState<number>(PAGE_SIZE);

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Sensible defaults: text asc, numeric/time desc.
      setSortDir(key === "to" || key === "campaign" || key === "outcome" ? "asc" : "desc");
    }
    setVisible(PAGE_SIZE);
  }

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: RecentRow): string | number => {
      switch (sortKey) {
        case "time": return Date.parse(r.triggeredAt) || 0;
        case "to": return r.to || "";
        case "campaign": return (r.campaignName || "").toLowerCase();
        case "outcome": return OUTCOME_LABEL[r.outcome || "pending"] || r.outcome || "pending";
        case "digit": return r.digit || "";
        case "duration": return r.durationSec ?? -1;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sortKey, sortDir]);

  if (!rows.length) {
    return (
      <div className="text-sm text-muted py-4 text-center">
        {filtered ? "No loaded calls match this outcome." : "No calls yet."}
      </div>
    );
  }

  const shown = sorted.slice(0, visible);
  const remaining = sorted.length - shown.length;

  return (
    <div>
      <div className="overflow-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
              <Th label="Time" col="time" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="px-1" />
              <Th label="To" col="to" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="px-1" />
              <Th label="Campaign" col="campaign" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="px-1" />
              <Th label="Outcome" col="outcome" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="px-1" />
              <Th label="Digit" col="digit" sortKey={sortKey} sortDir={sortDir} onSort={onSort} className="px-1" />
              <Th label="Dur" col="duration" sortKey={sortKey} sortDir={sortDir} onSort={onSort} align="right" className="px-1" />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const o = r.outcome || "pending";
              return (
                <tr key={r.callUuid} className="border-t border-line hover:bg-elev/40 transition-colors">
                  <td className="py-2 px-1 font-mono text-xs text-muted">{istTimeOfDay(r.triggeredAt)}</td>
                  <td className="px-1 font-mono text-xs">{r.to}</td>
                  <td className="px-1 truncate max-w-[160px]">{r.campaignName}</td>
                  <td className="px-1">
                    <Badge tone={OUTCOME_TONE[o] || "muted"}>{OUTCOME_LABEL[o] || o}</Badge>
                  </td>
                  <td className="px-1 font-mono text-xs">{r.digit || "—"}</td>
                  <td className="px-1 text-right font-mono text-xs tabular-nums">{r.durationSec ? `${r.durationSec}s` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {remaining > 0 && (
        <div className="flex justify-center pt-3">
          <Button variant="ghost" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Load {Math.min(PAGE_SIZE, remaining)} more · {remaining} remaining
          </Button>
        </div>
      )}
    </div>
  );
}

function Th({
  label,
  col,
  sortKey,
  sortDir,
  onSort,
  align = "left",
  className = "",
}: {
  label: string;
  col: SortKey;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sortKey === col;
  return (
    <th className={`font-medium py-2 ${align === "right" ? "text-right" : "text-left"} ${className}`}>
      <button
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-ink ${
          active ? "text-ink" : "text-muted"
        } ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        {active && (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );
}

// ---- Campaign breakdown table + phone-level drill-down (FEATURE 3) ----------

function CampaignTable({ rows, from, to }: { rows: CampaignRow[]; from: string; to: string }) {
  const [openCid, setOpenCid] = useState<string | null>(null);
  if (!rows.length) {
    return <div className="text-sm text-muted py-4 text-center">No campaign activity in this range.</div>;
  }
  const dateLabel = from === to ? from : `${from} → ${to}`;
  return (
    <div className="overflow-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
            <th className="font-medium py-2 px-1">Campaign</th>
            <th className="font-medium px-1">Date</th>
            <th className="font-medium px-1 text-right">Total</th>
            <th className="font-medium px-1 text-right">Lifted</th>
            <th className="font-medium px-1 text-right">Press 1</th>
            <th className="font-medium px-1 text-right">Busy</th>
            <th className="font-medium px-1 text-right">Failed</th>
            <th className="font-medium px-1 text-right">Lift Rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const open = openCid === r.campaignId;
            return (
              <Fragment key={r.campaignId}>
                <tr
                  onClick={() => setOpenCid(open ? null : r.campaignId)}
                  className={`border-t border-line cursor-pointer transition-colors ${open ? "bg-elev/50" : "hover:bg-elev/40"}`}
                >
                  <td className="py-2 px-1">
                    <span className="inline-flex items-center gap-1.5">
                      {open ? <ChevronDown size={12} className="text-muted" /> : <ChevronRight size={12} className="text-muted" />}
                      <span className="truncate max-w-[160px]">{r.name}</span>
                    </span>
                    <span className="block font-mono text-[10px] text-muted truncate max-w-[200px] pl-[18px]">{r.campaignId}</span>
                  </td>
                  <td className="px-1 text-muted text-xs whitespace-nowrap">{dateLabel}</td>
                  <td className="px-1 text-right font-mono tabular-nums">{r.total.toLocaleString()}</td>
                  <td className="px-1 text-right font-mono tabular-nums text-ok">{r.lifted.toLocaleString()}</td>
                  <td className="px-1 text-right font-mono tabular-nums">{r.press1.toLocaleString()}</td>
                  <td className="px-1 text-right font-mono tabular-nums text-warn">{r.busy.toLocaleString()}</td>
                  <td className="px-1 text-right font-mono tabular-nums text-danger">{r.failed.toLocaleString()}</td>
                  <td className="px-1 text-right">
                    <Badge tone={r.liftRate >= 20 ? "ok" : r.liftRate >= 10 ? "warn" : "muted"}>{r.liftRate}%</Badge>
                  </td>
                </tr>
                {open && (
                  <tr className="border-t border-line/40">
                    <td colSpan={8} className="px-1 py-2">
                      <DrillDown campaignId={r.campaignId} from={from} to={to} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const DRILL_STATUSES = [
  { value: "", label: "All statuses" },
  { value: "connected", label: "Connected" },
  { value: "failed", label: "Failed" },
  { value: "no-answer", label: "No Answer" },
  { value: "busy", label: "Busy" },
];

function DrillDown({ campaignId, from, to }: { campaignId: string; from: string; to: string }) {
  const [status, setStatus] = useState<string>("");
  const qs = new URLSearchParams({ campaign: campaignId, from, to });
  if (status) qs.set("status", status);
  const { data, loading } = useFetch<{ rows: DrillRow[]; total: number; capped: boolean }>(
    `/api/reports/calls?${qs.toString()}`,
    [campaignId, from, to, status],
  );
  const rows = data?.rows ?? [];

  return (
    <div className="bg-bg/50 border border-line rounded-lg p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-xs text-muted">
          {loading
            ? "Loading numbers…"
            : `${rows.length.toLocaleString()} number${rows.length === 1 ? "" : "s"}${data?.capped ? " (showing first 1,000)" : ""}`}
        </span>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="bg-bg/60 border border-line rounded-md px-2 py-1 text-xs outline-none hover:border-line2 focus:border-brand/60"
        >
          {DRILL_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>
      {loading && <Skeleton className="h-24 rounded-lg" />}
      {!loading && !rows.length && <div className="text-xs text-muted py-3 text-center">No matching calls.</div>}
      {!loading && rows.length > 0 && (
        <div className="max-h-72 overflow-auto rounded-md border border-line">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg">
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="font-medium py-1.5 px-2">Phone</th>
                <th className="font-medium px-2">Status</th>
                <th className="font-medium px-2 text-right">Duration</th>
                <th className="font-medium px-2 text-right">Time (IST)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.to}-${i}`} className="border-t border-line/60 hover:bg-elev/40">
                  <td className="py-1.5 px-2 font-mono">{r.to}</td>
                  <td className="px-2">
                    <Badge tone={OUTCOME_TONE[r.outcome] || "muted"}>{OUTCOME_LABEL[r.outcome] || r.outcome}</Badge>
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">{r.durationSec ? `${r.durationSec}s` : "—"}</td>
                  <td className="px-2 text-right font-mono text-muted whitespace-nowrap">{istStamp(r.triggeredAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const tooltipStyle = {
  background: "#0f1218",
  border: "1px solid #2a3142",
  borderRadius: 8,
  fontSize: 12,
  color: "#e8ecf3",
};
