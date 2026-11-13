"use client";
import CampaignSelect from "./CampaignSelect";
import { fmtDayKey } from "@/lib/format";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Phone,
  PhoneIncoming,
  Target,
  Wallet,
  TrendingUp,
  TrendingDown,
  AlertCircle,
  CalendarClock,
  Activity,
  FileSpreadsheet,
  PauseCircle,
  Plus,
  ArrowRight,
} from "lucide-react";
import { Section, Spinner, Badge, Button, EmptyState } from "./ui";
import { useFetch } from "./useData";
import type { TabId } from "./Shell";
import { Seg, CardHead, Panel, Spark, Avatar, MiniBar } from "./DashboardParts";

/* ------------------------------------------------------------------ *
 * Chart palette
 *
 * Validated, not eyeballed:
 *   node scripts/validate_palette.js "#0ca30c,#fab219,#d03b3b" \
 *        --mode dark --surface "rgb(var(--c-panel))"
 *   → colour-blind separation ΔE 11.3, normal vision 27.6, all ≥3:1.
 *
 * The outcome split keeps these three fixed colours on purpose: the app's
 * own tokens are not far enough apart to share one chart. Single-series
 * marks (bars, sparklines) use the theme accent instead.
 * ------------------------------------------------------------------ */
const C_GOOD = "#0ca30c";
const C_WARN = "#fab219";
const C_BAD = "#d03b3b";
const C_NEUTRAL = "#898781";
const C_BRAND = "rgb(var(--c-accent))";
const C_BRAND_SOFT = "rgb(var(--c-accent) / 0.22)";

interface Kpis {
  placed: number; placedPrev: number;
  connected: number; connectedPrev: number;
  connectRate: number; connectRatePrev: number;
  avgTalkSec: number; avgTalkSecPrev: number;
  press1: number; press1Prev: number;
  press1Rate: number; press1RatePrev: number;
  spent: number; spentPrev: number;
  costPerLead: number; costPerLeadPrev: number;
  rate: number; balance: number;
}
interface DashData {
  range: { from: string; to: string; days: number };
  kpis: Kpis;
  outcomes: Record<string, number>;
  series: { day: string; placed: number; connected: number }[];
  running: { id: string; kind: string; label: string; status: string; pausedReason: string | null; done: number; total: number }[];
  activeSheets: number;
  attention: { id: string; severity: "danger" | "warn" | "info"; title: string; detail: string }[];
  upcoming: { id: string; name: string; kind: string; repeat: string; nextRunAt: string | null; recipientCount: number }[];
  campaigns: { id: string; name: string }[];
  runway: { callsLeft: number | null; daysLeft: number | null };
}

/** The per-campaign rows /api/reports already computes (same range, same counters). */
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

type RangeKey = "1" | "7" | "30" | "90";
const RANGES: { key: RangeKey; label: string }[] = [
  { key: "1", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
];

const IST = (5 * 60 + 30) * 60 * 1000;
function istDay(ms: number) {
  return new Date(ms + IST).toISOString().slice(0, 10);
}
function rupee(n: number) {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}
function dur(sec: number) {
  if (!sec) return "0s";
  const m = Math.floor(sec / 60);
  return m ? `${m}m ${sec % 60}s` : `${sec}s`;
}
function whenIst(iso: string) {
  const d = new Date(Date.parse(iso) + IST);
  const h = d.getUTCHours();
  return `${["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getUTCDay()]} ${d.getUTCDate()} ${
    ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]
  }, ${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
}
function rel(cur: number, prev: number): number | null {
  if (!prev) return null;
  return (cur - prev) / prev;
}

/* ----------------------------- KPI card ----------------------------- */
type KpiTone = "accent" | "ok" | "info" | "warn";
const KPI_TILE: Record<KpiTone, string> = {
  accent: "bg-accent/10 text-accent",
  ok: "bg-ok/10 text-ok",
  info: "bg-info/10 text-info",
  warn: "bg-warn/10 text-warn",
};
const KPI_LINE: Record<KpiTone, string> = {
  accent: "rgb(var(--c-accent))",
  ok: "rgb(var(--c-ok))",
  info: "rgb(var(--c-info))",
  warn: "rgb(var(--c-warn))",
};

function Kpi({
  icon,
  tone,
  label,
  value,
  small,
  delta,
  deltaText,
  vs,
  foot,
  spark,
}: {
  icon: React.ReactNode;
  tone: KpiTone;
  label: string;
  value: string;
  small?: string;
  /** Signed change; up is treated as good. null hides the pill. */
  delta?: number | null;
  deltaText?: string;
  vs?: string;
  foot?: React.ReactNode;
  spark?: number[];
}) {
  const show = delta != null && isFinite(delta) && deltaText;
  const up = (delta ?? 0) >= 0;
  return (
    <div className="relative flex flex-col overflow-hidden rounded-xl border border-line bg-panel px-[18px] pt-4 shadow-card">
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <div className={`grid h-7 w-7 place-items-center rounded-lg ${KPI_TILE[tone]}`}>{icon}</div>
        {label}
      </div>
      <div className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.04em] tabular-nums text-ink">
        {value}
        {small && <small className="ml-1.5 text-[13.5px] font-medium tracking-[-0.01em] text-muted">{small}</small>}
      </div>
      <div className="mt-1.5 flex min-h-[20px] flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
        {show ? (
          <>
            <span
              className={`inline-flex h-5 items-center gap-0.5 rounded-md px-1.5 text-xs font-semibold ${
                up ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
              }`}
            >
              {up ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
              {deltaText}
            </span>
            {vs}
          </>
        ) : (
          foot
        )}
      </div>
      <div className="mt-auto">
        <Spark values={spark ?? []} color={KPI_LINE[tone]} />
      </div>
    </div>
  );
}

/* ----------------------------- Donut ----------------------------- */
function Donut({
  parts,
  total,
  center,
  centerSub,
}: {
  parts: { label: string; value: number; color: string }[];
  total: number;
  center: string;
  centerSub: string;
}) {
  let off = 25;
  return (
    <div className="flex flex-col items-center gap-[22px] px-5 pb-5 pt-1.5 sm:flex-row">
      <svg viewBox="0 0 42 42" className="h-[150px] w-[150px] shrink-0" role="img" aria-label={`${center} ${centerSub}`}>
        <circle cx="21" cy="21" r="15.9" fill="none" stroke="rgb(var(--c-line2))" strokeWidth="5" />
        {parts.map((p) => {
          const pc = total ? (p.value / total) * 100 : 0;
          const el = (
            <circle
              key={p.label}
              cx="21"
              cy="21"
              r="15.9"
              fill="none"
              stroke={p.color}
              strokeWidth="5"
              strokeDasharray={`${Math.max(pc - (parts.length > 1 ? 1 : 0), 0)} ${100 - pc + (parts.length > 1 ? 1 : 0)}`}
              strokeDashoffset={off}
            />
          );
          off -= pc;
          return el;
        })}
        <text x="21" y="21" textAnchor="middle" fontSize="6.5" fontWeight="600" fill="rgb(var(--c-ink))">{center}</text>
        <text x="21" y="26.5" textAnchor="middle" fontSize="3" fill="rgb(var(--c-muted))">{centerSub}</text>
      </svg>
      <div className="grid w-full flex-1 gap-2.5">
        {parts.map((p) => (
          <div key={p.label} className="flex items-center gap-2 text-[13px] text-ink2">
            <i className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: p.color }} />
            {p.label}
            <b className="ml-auto font-semibold tabular-nums text-ink">{p.value.toLocaleString()}</b>
            <span className="w-[46px] text-right text-[12.5px] tabular-nums text-muted">
              {total ? `${Math.round((p.value / total) * 100)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Where each "needs attention" item can be fixed. */
function attentionTarget(id: string): { tab: TabId; label: string; icon: React.ReactNode } | null {
  if (id.startsWith("sheet:")) return { tab: "gsheets", label: "Fix", icon: <FileSpreadsheet size={16} /> };
  if (id.startsWith("schedule:")) return { tab: "scheduled", label: "View", icon: <CalendarClock size={16} /> };
  if (id.startsWith("job:")) return { tab: "bulk", label: "View job", icon: <PauseCircle size={16} /> };
  if (id === "wallet") return { tab: "billing", label: "Top up", icon: <Wallet size={16} /> };
  return null;
}

/* ----------------------------- Screen ----------------------------- */
export default function DashboardTab({ onGo }: { onGo?: (tab: TabId) => void }) {
  const [days, setDays] = useState<RangeKey>("30");
  const [campaign, setCampaign] = useState("");

  const to = istDay(Date.now());
  const from = istDay(Date.now() - (Number(days) - 1) * 86_400_000);
  const qs = new URLSearchParams({ from, to });
  if (campaign) qs.set("campaign", campaign);

  const { data, loading, err } = useFetch<DashData>(`/api/dashboard?${qs}`, [days, campaign]);
  // Per-campaign split for "Top campaigns". Same counters as Call reports; a
  // client without the Call reports permission gets a 403 here and the card
  // simply isn't shown.
  const { data: rep, err: repErr } = useFetch<{ campaignTable: CampaignRow[] }>(`/api/reports?${qs}`, [days, campaign]);
  const topCampaigns = (rep?.campaignTable ?? []).slice(0, 5);

  const o = data?.outcomes;
  const totalCalls = data?.kpis.placed ?? 0;
  const parts = useMemo(() => {
    if (!o || !totalCalls) return [];
    return [
      { label: "Connected", value: o.press1 + o.connected, color: C_GOOD },
      { label: "No answer", value: o.noAnswer, color: C_NEUTRAL },
      { label: "Busy", value: o.busy, color: C_WARN },
      { label: "Failed", value: o.rejected + o.error, color: C_BAD },
    ].filter((b) => b.value > 0);
  }, [o, totalCalls]);

  const chartData = useMemo(
    () => (data?.series ?? []).map((d) => ({ ...d, notAnswered: Math.max(0, d.placed - d.connected) })),
    [data?.series],
  );

  const vs = days === "1" ? "vs yesterday" : `vs previous ${days} days`;

  if (err) {
    return (
      <Section>
        <Panel>
          <div className="py-8 text-center text-sm text-danger">Couldn’t load the dashboard.</div>
        </Panel>
      </Section>
    );
  }

  const k = data?.kpis;
  const placedDelta = k ? rel(k.placed, k.placedPrev) : null;
  const connectPts = k && k.placedPrev ? (k.connectRate - k.connectRatePrev) * 100 : null;
  // A change on a handful of press-1s is noise (4 → 5 reads as +25%).
  const press1Pts = k && k.press1 >= 30 && k.connectedPrev ? (k.press1Rate - k.press1RatePrev) * 100 : null;
  const live = (data?.running ?? []).some((j) => j.status === "running");

  return (
    <Section>
      {/* range + campaign filter + the one primary action */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Seg label="Date range" options={RANGES} value={days} onChange={setDays} />
        <div className="w-full sm:w-56">
          <CampaignSelect campaigns={data?.campaigns ?? []} value={campaign} onChange={setCampaign} emptyLabel="All campaigns" />
        </div>
        {onGo && (
          <Button className="sm:ml-auto" leftIcon={<Plus size={15} />} onClick={() => onGo("bulk")}>
            New bulk call
          </Button>
        )}
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-20 text-muted"><Spinner size={20} /></div>
      ) : !data || !k ? null : (
        <>
          {/* four headline numbers */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              icon={<Phone size={15} />} tone="accent" label="Calls placed"
              value={k.placed.toLocaleString()}
              delta={placedDelta}
              deltaText={placedDelta != null ? `${Math.abs(placedDelta * 100).toFixed(1)}%` : undefined}
              vs={vs}
              foot={`${data.range.days} day${data.range.days === 1 ? "" : "s"} to ${fmtDayKey(data.range.to)}`}
              spark={data.series.map((d) => d.placed)}
            />
            <Kpi
              icon={<PhoneIncoming size={15} />} tone="ok" label="Answered"
              value={k.connected.toLocaleString()} small={pct(k.connectRate)}
              delta={connectPts}
              deltaText={connectPts != null ? `${Math.abs(connectPts).toFixed(1)} pts` : undefined}
              vs={vs}
              foot={`Avg talk time ${dur(k.avgTalkSec)}`}
              spark={data.series.map((d) => d.connected)}
            />
            <Kpi
              icon={<Target size={15} />} tone="info" label="Pressed 1"
              value={k.press1.toLocaleString()} small={k.connected ? pct(k.press1Rate) : undefined}
              delta={press1Pts}
              deltaText={press1Pts != null ? `${Math.abs(press1Pts).toFixed(1)} pts` : undefined}
              vs={vs}
              foot="Share of answered calls"
            />
            <Kpi
              icon={<Wallet size={15} />} tone="warn" label="Spent"
              value={rupee(k.spent)}
              foot={k.press1
                ? `${rupee(k.costPerLead)} per press-1`
                : `${rupee(k.rate)} per connected call`}
              // Spend is connected calls × the per-call rate, so the daily
              // series is exact, not an estimate.
              spark={data.series.map((d) => d.connected * k.rate)}
            />
          </div>

          {/* chart + running / attention */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
            <Panel>
              <CardHead
                title="Calls per day"
                sub={`${data.range.days === 1 ? "Today" : `Last ${data.range.days} days`} · hover a bar`}
                right={
                  <div className="flex gap-4 text-[12.5px] text-muted">
                    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-[2px]" style={{ background: C_BRAND }} />Answered</span>
                    <span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-[2px]" style={{ background: C_BRAND_SOFT }} />Not answered</span>
                  </div>
                }
              />
              <div className="h-[250px] w-full px-3 pb-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -14 }} barCategoryGap="22%">
                    <CartesianGrid stroke="rgb(var(--c-line))" strokeDasharray="3 4" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(d: string) => fmtDayKey(d)} tick={{ fill: "rgb(var(--c-muted))", fontSize: 11 }}
                           axisLine={{ stroke: "rgb(var(--c-line2))" }} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fill: "rgb(var(--c-muted))", fontSize: 11 }} axisLine={false} tickLine={false} width={52} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: "rgb(var(--c-ink) / 0.05)" }}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload as { placed: number; connected: number; notAnswered: number };
                        return (
                          <div className="rounded-[10px] border border-line bg-panel px-3 py-2 text-xs text-ink2 shadow-pop">
                            <div className="mb-1 font-semibold text-ink">{fmtDayKey(String(label))}</div>
                            <div className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-[2px]" style={{ background: C_BRAND }} />{row.connected.toLocaleString()} answered</div>
                            <div className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-[2px]" style={{ background: C_BRAND_SOFT }} />{row.notAnswered.toLocaleString()} not answered</div>
                            <div className="mt-1 text-muted">{row.placed ? pct(row.connected / row.placed) : "—"} answer rate</div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="connected" name="Answered" stackId="a" fill={C_BRAND} radius={[0, 0, 4, 4]} />
                    <Bar dataKey="notAnswered" name="Not answered" stackId="a" fill={C_BRAND_SOFT} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <div className="flex min-w-0 flex-col gap-4">
              <Panel>
                <CardHead
                  title="Running now"
                  sub={`${data.activeSheets} sheet${data.activeSheets === 1 ? "" : "s"} polling`}
                  right={live ? <Badge tone="accent" dot>Live</Badge> : undefined}
                />
                <div className="px-5 pb-[18px]">
                  {!data.running.length ? (
                    <div className="text-sm text-muted">Nothing dialling right now.</div>
                  ) : (
                    <div className="space-y-4">
                      {data.running.map((j) => {
                        const share = j.total ? j.done / j.total : 0;
                        return (
                          <div key={j.id}>
                            <div className="flex items-baseline justify-between gap-3">
                              <b className="truncate text-[13.5px] font-semibold text-ink">{j.label}</b>
                              <span className="shrink-0 text-[13px] tabular-nums text-muted">
                                <b className="font-semibold text-ink">{Math.round(share * 100)}%</b> · {j.done.toLocaleString()} of {j.total.toLocaleString()}
                              </span>
                            </div>
                            <div className="my-2.5 h-2 overflow-hidden rounded-full bg-line2">
                              <i
                                className={`block h-full rounded-full ${j.status === "running" ? "bg-accent" : "bg-warn"}`}
                                style={{ width: `${share * 100}%` }}
                              />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-muted">
                              <span>{j.kind === "whatsapp" ? "WhatsApp batch" : "Bulk call"}</span>
                              {j.status === "paused" && (
                                <span className="text-warn">
                                  {j.pausedReason === "low_balance" ? "Paused, wallet low" : "Paused by you"}
                                </span>
                              )}
                              {onGo && (
                                <button
                                  onClick={() => onGo(j.kind === "whatsapp" ? "whatsapp" : "bulk")}
                                  className="ml-auto inline-flex items-center gap-1 text-accent hover:underline"
                                >
                                  View job <ArrowRight size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Panel>

              <Panel>
                <CardHead
                  title="Needs attention"
                  right={data.attention.length ? <Badge tone="warn">{data.attention.length}</Badge> : <Badge tone="ok">All clear</Badge>}
                />
                {!data.attention.length ? (
                  <div className="px-5 pb-[18px] text-sm text-muted">Nothing is waiting on you.</div>
                ) : (
                  data.attention.map((a) => {
                    const t = attentionTarget(a.id);
                    return (
                      <div key={a.id} className="flex items-start gap-3 border-t border-line px-5 py-3.5">
                        <div
                          className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] ${
                            a.severity === "danger" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn"
                          }`}
                        >
                          {t?.icon ?? <AlertCircle size={16} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <b className="block text-[13.5px] font-semibold tracking-[-0.01em] text-ink">{a.title}</b>
                          <span className="text-[12.5px] text-muted">{a.detail}</span>
                        </div>
                        {t && onGo && (
                          <Button variant="ghost" size="sm" onClick={() => onGo(t.tab)}>{t.label}</Button>
                        )}
                      </div>
                    );
                  })
                )}
              </Panel>

              {data.upcoming.length > 0 && (
                <Panel>
                  <CardHead
                    title="Up next"
                    sub={`${data.upcoming.length} scheduled`}
                    right={onGo && (
                      <button onClick={() => onGo("scheduled")} className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
                        All scheduled <ArrowRight size={12} />
                      </button>
                    )}
                  />
                  {data.upcoming.map((s) => (
                    <div key={s.id} className="flex items-start gap-3 border-t border-line px-5 py-3">
                      <CalendarClock size={15} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold text-ink">{s.name}</div>
                        <div className="text-[12.5px] text-muted">
                          {s.kind === "call" ? "Bulk call" : "WhatsApp"} · {s.recipientCount.toLocaleString()} recipient{s.recipientCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      {s.nextRunAt && <span className="shrink-0 text-[12.5px] text-muted">{whenIst(s.nextRunAt)}</span>}
                    </div>
                  ))}
                </Panel>
              )}
            </div>
          </div>

          {/* top campaigns + outcomes */}
          <div className={`grid grid-cols-1 gap-4 ${repErr ? "" : "lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]"}`}>
            {!repErr && (
              <Panel>
                <CardHead
                  title={days === "1" ? "Top campaigns today" : "Top campaigns"}
                  sub="By calls placed"
                  right={onGo && (
                    <button onClick={() => onGo("reports")} className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
                      Call reports <ArrowRight size={12} />
                    </button>
                  )}
                />
                {!rep ? (
                  <div className="flex justify-center py-10 text-muted"><Spinner size={16} /></div>
                ) : !topCampaigns.length ? (
                  <div className="px-5 pb-5 text-sm text-muted">No campaign made calls in this range.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[13.5px]">
                      <thead>
                        <tr>
                          <th className="whitespace-nowrap border-y border-line bg-elev px-5 py-2.5 text-left text-xs font-medium text-muted">Campaign</th>
                          <th className="whitespace-nowrap border-y border-line bg-elev px-5 py-2.5 text-right text-xs font-medium text-muted">Calls</th>
                          <th className="hidden whitespace-nowrap border-y border-line bg-elev px-5 py-2.5 text-right text-xs font-medium text-muted sm:table-cell">Answered</th>
                          <th className="whitespace-nowrap border-y border-line bg-elev px-5 py-2.5 text-right text-xs font-medium text-muted">Answer rate</th>
                          <th className="hidden whitespace-nowrap border-y border-line bg-elev px-5 py-2.5 text-right text-xs font-medium text-muted sm:table-cell">Spent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topCampaigns.map((r) => {
                          const share = r.total ? r.lifted / r.total : 0;
                          return (
                            <tr key={r.campaignId} className="border-b border-line transition-colors last:border-b-0 hover:bg-elev">
                              <td className="px-5 py-3">
                                <div className="flex items-center gap-3">
                                  <Avatar name={r.name} />
                                  <div className="min-w-0">
                                    <div className="truncate font-semibold tracking-[-0.01em] text-ink">{r.name}</div>
                                    <div className="text-[12.5px] text-muted">
                                      {r.press1.toLocaleString()} pressed 1
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-5 py-3 text-right tabular-nums">{r.total.toLocaleString()}</td>
                              <td className="hidden px-5 py-3 text-right tabular-nums sm:table-cell">{r.lifted.toLocaleString()}</td>
                              <td className="px-5 py-3"><MiniBar share={share} label={pct(share)} /></td>
                              <td className="hidden px-5 py-3 text-right tabular-nums sm:table-cell">{rupee(r.lifted * k.rate)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            )}

            <Panel>
              <CardHead
                title="Call outcomes"
                sub={`${data.range.days === 1 ? "Today" : `Last ${data.range.days} days`} · ${totalCalls.toLocaleString()} call${totalCalls === 1 ? "" : "s"}`}
              />
              {!totalCalls ? (
                <EmptyState icon={<Activity size={20} />} title="No calls in this range" description="Pick a wider range, or place a call." />
              ) : (
                <>
                  <Donut parts={parts} total={totalCalls} center={`${Math.round(k.connectRate * 100)}%`} centerSub="connected" />
                  {/* Press-1 sits below a rule because it is a share of CONNECTED
                      calls — folding it into the ring would stop it summing to 100%. */}
                  <div className="space-y-1 border-t border-line px-5 py-3.5 text-[12.5px] text-muted">
                    <div className="flex items-center gap-2 text-[13px] text-ink2">
                      <i className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: C_BRAND }} />
                      Pressed 1
                      <b className="ml-auto font-semibold tabular-nums text-ink">{k.press1.toLocaleString()}</b>
                      <span className="w-[46px] text-right tabular-nums text-muted">{pct(k.press1Rate)}</span>
                    </div>
                    <div>Share of connected calls, not of all calls.</div>
                    <div>Failed = the phone network refused the call (number switched off, invalid or barred). These calls are not charged.</div>
                  </div>
                </>
              )}
            </Panel>
          </div>

          <div className="text-[12.5px] text-muted">
            Wallet {rupee(k.balance)}
            {data.runway.callsLeft != null && <> · covers about {data.runway.callsLeft.toLocaleString()} more connected calls</>}
            {" · "}
            {data.range.days} day{data.range.days === 1 ? "" : "s"} to {data.range.to}
          </div>
        </>
      )}
    </Section>
  );
}
