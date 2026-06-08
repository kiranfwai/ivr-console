"use client";

import { useState } from "react";
import {
  PhoneCall, PhoneIncoming, PhoneOff, Clock, Download, RefreshCw, TrendingUp, BarChart3,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, BarChart, Bar, Legend,
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
  hangupCauseCounts: Record<string, number>;
  recent: (CallRecord & { outcome: string | null })[];
  plivoRecent: any[];
}

// Report day buckets are IST (Asia/Kolkata) — match the server. Compute the
// calendar day by shifting the instant by +5:30 and reading the UTC date.
const IST_SHIFT_MS = (5 * 60 + 30) * 60 * 1000;
function istDateKey(ms: number): string {
  return new Date(ms + IST_SHIFT_MS).toISOString().slice(0, 10);
}
function istTimeOfDay(iso: string): string {
  return new Date(Date.parse(iso) + IST_SHIFT_MS).toISOString().slice(11, 19);
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
                onChange={(e) => setFrom(e.target.value)}
                className="bg-bg/60 border border-line rounded-lg px-2.5 py-2 text-sm outline-none hover:border-line2 focus:border-brand/60"
              />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted mb-1.5">To</div>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
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

      {loading && !data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
      )}

      {data && data.totals.total === 0 && (
        <Card>
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No calls in this range"
            description="Place a call from the Dial tab, then come back."
          />
        </Card>
      )}

      {data && data.totals.total > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI label="Calls" value={data.totals.total} icon={<PhoneCall size={18} />} tone="accent" />
            <KPI label="Lifted" value={data.totals.lifted} sub={`${data.totals.liftRate}% lift rate`} icon={<PhoneIncoming size={18} />} tone="ok" />
            <KPI label="Press 1" value={data.totals.press1} sub={`${data.totals.press1Rate}%`} icon={<TrendingUp size={18} />} tone="ok" />
            <KPI label="Not lifted" value={data.totals.notLifted} sub="busy + no-answer" icon={<PhoneOff size={18} />} tone="warn" />
            <KPI label="Avg duration" value={`${data.totals.avgDurationSec}s`} icon={<Clock size={18} />} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card title="Outcome breakdown" description="Click a slice to focus.">
              <OutcomePie outcomes={data.outcomes} total={data.totals.total} />
            </Card>
            <Card title="Volume by hour">
              <HourlyChart byHour={data.byHour} />
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <Card title="By campaign">
              <CampaignBars rows={data.byCampaign} />
            </Card>
            <Card title="Hangup causes (Plivo)" description="From Plivo's call history.">
              <KVList rows={data.hangupCauseCounts} />
            </Card>
          </div>

          <Card title="Recent calls" description={`Showing ${data.recent.length} of ${data.totals.total}`}>
            <RecentTable rows={data.recent} />
          </Card>
        </>
      )}
    </Section>
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

function OutcomePie({ outcomes, total }: { outcomes: Report["outcomes"]; total: number }) {
  const data = [
    { name: "press1", value: outcomes.press1 },
    { name: "connected", value: outcomes.connected },
    { name: "busy", value: outcomes.busy },
    { name: "no-answer", value: outcomes.noAnswer },
    { name: "rejected", value: outcomes.rejected },
    { name: "error", value: outcomes.error },
  ].filter((d) => d.value > 0);

  if (!data.length) return <div className="text-sm text-muted">No data yet.</div>;

  return (
    <div className="flex items-center gap-6">
      <div className="w-40 h-40 relative shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" innerRadius={48} outerRadius={72} strokeWidth={0} paddingAngle={2}>
              {data.map((entry, i) => (
                <Cell key={i} fill={OUTCOME_COLOR[entry.name]} />
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
      <div className="space-y-1.5 flex-1 min-w-0">
        {data.map((d) => (
          <div key={d.name} className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: OUTCOME_COLOR[d.name] }} />
              <span className="text-ink2 truncate">{OUTCOME_LABEL[d.name]}</span>
            </div>
            <span className="font-mono tabular-nums text-ink shrink-0">{d.value}</span>
          </div>
        ))}
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

function RecentTable({ rows }: { rows: (CallRecord & { outcome: string | null })[] }) {
  if (!rows.length) return <div className="text-sm text-muted">No calls yet.</div>;
  return (
    <div className="overflow-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
            <th className="font-medium py-2 px-1">Time</th>
            <th className="font-medium px-1">To</th>
            <th className="font-medium px-1">Campaign</th>
            <th className="font-medium px-1">Outcome</th>
            <th className="font-medium px-1">Digit</th>
            <th className="font-medium px-1 text-right">Dur</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
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
  );
}

const tooltipStyle = {
  background: "#0f1218",
  border: "1px solid #2a3142",
  borderRadius: 8,
  fontSize: 12,
  color: "#e8ecf3",
};
