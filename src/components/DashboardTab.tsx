"use client";
import { fmtDayKey } from "@/lib/format";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import {
  Phone,
  Check,
  Clock,
  Target,
  Wallet,
  TrendingUp,
  AlertCircle,
  CalendarClock,
  Activity,
  ArrowRight,
} from "lucide-react";
import { Section, Card, Select, Spinner, Badge, EmptyState } from "./ui";
import { useFetch } from "./useData";
import type { TabId } from "./Shell";

/* ------------------------------------------------------------------ *
 * Chart palette
 *
 * Validated, not eyeballed:
 *   node scripts/validate_palette.js "#0ca30c,#fab219,#d03b3b" \
 *        --mode dark --surface "#0f1218"
 *   → colour-blind separation ΔE 11.3, normal vision 27.6, all ≥3:1.
 *
 * The app's own tokens FAILED this check — brand teal (#5eead4) and sky
 * (#7dd3fc) are only ΔE 10.1 apart and cannot share a chart. So the charts
 * deliberately do NOT match the site palette; re-tinting them to fit the
 * brand would trade a real accessibility property for a cosmetic one.
 * ------------------------------------------------------------------ */
const C_GOOD = "#0ca30c";
const C_WARN = "#fab219";
const C_BAD = "#d03b3b";
const C_NEUTRAL = "#898781";
const C_BRAND = "#5eead4";

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

const RANGES = [
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

/** A stat tile: icon, the number, and how it moved against the previous window. */
function Stat({
  icon,
  tint,
  value,
  label,
  delta,
  deltaGood,
  note,
}: {
  icon: React.ReactNode;
  tint: string;
  value: string;
  label: string;
  delta?: number | null;
  /** true = up is good (calls, connect rate); false = down is good (cost). */
  deltaGood?: boolean;
  note?: string;
}) {
  const show = delta != null && isFinite(delta) && Math.abs(delta) >= 0.001;
  const up = (delta ?? 0) > 0;
  const good = deltaGood === false ? !up : up;
  return (
    <div className="flex items-center gap-3.5 rounded-xl border border-line2 bg-gradient-to-b from-[rgba(22,26,35,0.9)] to-[rgba(14,17,23,0.95)] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: `${tint}22`, color: tint }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[23px] font-extrabold leading-tight tracking-[-0.04em] tabular-nums">{value}</div>
        <div className="text-xs text-muted">{label}</div>
        {show ? (
          <div className={`mt-0.5 text-[11.5px] ${good ? "text-brand" : "text-warn"}`}>
            {up ? "↑" : "↓"} {Math.abs(delta! * 100).toFixed(1)}% vs previous
          </div>
        ) : note ? (
          <div className="mt-0.5 text-[11.5px] text-muted">{note}</div>
        ) : null}
      </div>
    </div>
  );
}

/** Ranked bar — a share of some whole, with the count and the percentage inline. */
function Bar({ label, value, share, color, muted }: { label: string; value: number; share: number; color: string; muted?: boolean }) {
  return (
    <div className="grid grid-cols-[92px_1fr_92px] items-center gap-3 py-2">
      <div className={`flex items-center gap-2 text-[12.5px] ${muted ? "text-muted" : "text-ink2"}`}>
        <span className="h-[9px] w-[9px] shrink-0 rounded-[3px]" style={{ background: color }} />
        {label}
      </div>
      <div className="h-[11px] overflow-hidden rounded-md bg-white/[0.055] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
        <div className="h-full rounded-md" style={{ width: `${Math.min(100, share * 100)}%`, background: color }} />
      </div>
      <div className="text-right text-[12.5px] tabular-nums">
        {value.toLocaleString()}
        <span className="ml-1.5 text-[11.5px] text-muted">{pct(share)}</span>
      </div>
    </div>
  );
}

function rel(cur: number, prev: number): number | null {
  if (!prev) return null;
  return (cur - prev) / prev;
}

export default function DashboardTab({ onGo }: { onGo?: (tab: TabId) => void }) {
  const [days, setDays] = useState("30");
  const [campaign, setCampaign] = useState("");

  const to = istDay(Date.now());
  const from = istDay(Date.now() - (Number(days) - 1) * 86_400_000);
  const qs = new URLSearchParams({ from, to });
  if (campaign) qs.set("campaign", campaign);

  const { data, loading, err } = useFetch<DashData>(`/api/dashboard?${qs}`, [days, campaign]);

  const o = data?.outcomes;
  const totalCalls = data?.kpis.placed ?? 0;
  const bars = useMemo(() => {
    if (!o || !totalCalls) return [];
    return [
      { label: "Connected", value: o.press1 + o.connected, color: C_GOOD },
      { label: "No answer", value: o.noAnswer, color: C_NEUTRAL },
      { label: "Busy", value: o.busy, color: C_WARN },
      { label: "Failed", value: o.rejected + o.error, color: C_BAD },
    ]
      .filter((b) => b.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [o, totalCalls]);

  if (err) {
    return (
      <Section>
        <Card>
          <div className="py-8 text-center text-sm text-danger">Couldn’t load the dashboard.</div>
        </Card>
      </Section>
    );
  }

  return (
    <Section>
      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-xl border border-line2 bg-white/[0.03]">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setDays(r.key)}
              className={`px-3.5 py-2 text-xs font-semibold transition-colors ${
                days === r.key
                  ? "bg-brand/12 text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.22)]"
                  : "text-ink2 hover:text-ink"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="w-56">
          <Select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
            <option value="">All campaigns</option>
            {(data?.campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-20 text-muted"><Spinner size={20} /></div>
      ) : !data ? null : (
        <>
          {/* six headline numbers */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Stat icon={<Phone size={18} />} tint={C_BRAND} value={data.kpis.placed.toLocaleString()}
                  label="Calls placed" delta={rel(data.kpis.placed, data.kpis.placedPrev)} deltaGood />
            <Stat icon={<Check size={18} />} tint={C_GOOD} value={pct(data.kpis.connectRate)}
                  label="Connected" delta={rel(data.kpis.connectRate, data.kpis.connectRatePrev)} deltaGood
                  note={`${data.kpis.connected.toLocaleString()} calls`} />
            <Stat icon={<Clock size={18} />} tint="#7dd3fc" value={dur(data.kpis.avgTalkSec)}
                  label="Avg talk time" note="connected calls only" />
            <Stat icon={<Target size={18} />} tint={C_WARN} value={pct(data.kpis.press1Rate)}
                  label="Pressed 1"
                  // A % change on a handful of press-1s is noise (4 → 5 reads as +25%).
                  delta={data.kpis.press1 >= 30 ? rel(data.kpis.press1Rate, data.kpis.press1RatePrev) : null} deltaGood
                  note={`${data.kpis.press1.toLocaleString()} leads`} />
            <Stat icon={<Wallet size={18} />} tint="#e87ba4" value={rupee(data.kpis.spent)}
                  label="Spent" note={`${rupee(data.kpis.rate)} per connected call`} />
            <Stat icon={<TrendingUp size={18} />} tint="#9085e9"
                  value={data.kpis.press1 ? rupee(data.kpis.costPerLead) : "—"}
                  label="Cost per press-1"
                  delta={data.kpis.press1 >= 30 ? rel(data.kpis.costPerLead, data.kpis.costPerLeadPrev) : null} deltaGood={false}
                  note={data.kpis.press1
                    ? `${rupee(data.kpis.spent)} ÷ ${data.kpis.press1.toLocaleString()} press-1${data.kpis.press1 === 1 ? "" : "s"}`
                    : "no press-1 leads yet"} />
          </div>

          {/* chart + outcomes */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.35fr_1fr]">
            <Card title="Calls per day" description="connected shown against total">
              <div className="h-[240px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.series} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="rgba(255,255,255,0.055)" vertical={false} />
                    <XAxis dataKey="day" tickFormatter={(d: string) => fmtDayKey(d)} tick={{ fill: "#7a8597", fontSize: 10 }}
                           axisLine={{ stroke: "rgba(255,255,255,0.14)" }} tickLine={false} minTickGap={24} />
                    <YAxis tick={{ fill: "#7a8597", fontSize: 10 }} axisLine={false} tickLine={false} width={52} />
                    <Tooltip
                      contentStyle={{
                        background: "rgba(18,21,29,0.98)", border: "1px solid #2a3142",
                        borderRadius: 11, fontSize: 12,
                      }}
                      labelStyle={{ color: "#7a8597" }}
                    />
                    {/* Two 2px strokes with no fill under either, so neither series hides the other. */}
                    <Line type="monotone" dataKey="placed" name="Calls placed" stroke={C_BRAND} strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="connected" name="Connected" stroke={C_GOOD} strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 flex gap-4 text-[11.5px] text-ink2">
                <span className="inline-flex items-center gap-1.5">
                  <i className="h-[9px] w-[9px] rounded-[3px]" style={{ background: C_BRAND }} /> Calls placed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <i className="h-[9px] w-[9px] rounded-[3px]" style={{ background: C_GOOD }} /> Connected
                </span>
              </div>
            </Card>

            <Card title="Outcomes" description="every call that reached the carrier">
              {!totalCalls ? (
                <EmptyState icon={<Activity size={20} />} title="No calls in this range" description="Pick a wider range, or place a call." />
              ) : (
                <>
                  {bars.map((b) => (
                    <Bar key={b.label} label={b.label} value={b.value} share={b.value / totalCalls} color={b.color} />
                  ))}
                  {/* Press-1 sits below a rule because it is a share of CONNECTED
                      calls — folding it in with the four above would stop them
                      summing to 100%. */}
                  <div className="mt-3 border-t border-line pt-3">
                    <Bar label="Pressed 1" value={data.kpis.press1} share={data.kpis.press1Rate} color={C_BRAND} />
                    <div className="mt-1 text-[11px] text-muted">Share of connected calls, not of all calls.</div>
                    <div className="mt-1 text-[11px] text-muted">
                      Failed = the phone network refused the call (number switched off, invalid or barred). These calls are not charged.
                    </div>
                  </div>
                </>
              )}
            </Card>
          </div>

          {/* what a reporting dashboard doesn't need, but a console does */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Card title="Running now" description={`${data.activeSheets} sheet${data.activeSheets === 1 ? "" : "s"} polling`}>
              {!data.running.length ? (
                <div className="py-4 text-sm text-muted">Nothing dialling right now.</div>
              ) : (
                <div className="space-y-2.5">
                  {data.running.map((j) => (
                    <div key={j.id} className="flex items-start gap-2.5">
                      <span className={`mt-1.5 h-[7px] w-[7px] shrink-0 rounded-full ${j.status === "running" ? "bg-ok animate-pulse2" : "bg-warn"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{j.label}</div>
                        <div className="text-[11.5px] text-muted">
                          {j.done.toLocaleString()} of {j.total.toLocaleString()}
                          {j.status === "paused" && (j.pausedReason === "low_balance" ? " · paused, wallet low" : " · paused by you")}
                        </div>
                      </div>
                      <span className="shrink-0 text-[11.5px] tabular-nums text-muted">
                        {j.total ? Math.round((j.done / j.total) * 100) : 0}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="Needs attention"
              description={data.attention.length ? `${data.attention.length} item${data.attention.length === 1 ? "" : "s"}` : "all clear"}
            >
              {!data.attention.length ? (
                <div className="py-4 text-sm text-muted">Nothing is waiting on you.</div>
              ) : (
                <div className="space-y-2.5">
                  {data.attention.map((a) => (
                    <div key={a.id} className="flex items-start gap-2.5">
                      <AlertCircle size={14} className={`mt-0.5 shrink-0 ${a.severity === "danger" ? "text-danger" : "text-warn"}`} />
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold">{a.title}</div>
                        <div className="text-[11.5px] text-muted">{a.detail}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card
              title="Fires next"
              description={data.upcoming.length ? `${data.upcoming.length} scheduled` : "nothing armed"}
              action={
                onGo && (
                  <button onClick={() => onGo("scheduled")} className="inline-flex items-center gap-1 text-xs text-brand hover:text-[#a9f2e8]">
                    All <ArrowRight size={12} />
                  </button>
                )
              }
            >
              {!data.upcoming.length ? (
                <div className="py-4 text-sm text-muted">Nothing scheduled.</div>
              ) : (
                <div className="space-y-2.5">
                  {data.upcoming.map((s) => (
                    <div key={s.id} className="flex items-start gap-2.5">
                      <CalendarClock size={14} className="mt-0.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold">{s.name}</div>
                        <div className="text-[11.5px] text-muted">
                          {s.kind === "call" ? "Bulk call" : "WhatsApp"} · {s.repeat} ·{" "}
                          {s.recipientCount.toLocaleString()} recipient{s.recipientCount === 1 ? "" : "s"}
                        </div>
                      </div>
                      {s.nextRunAt && (
                        <span className="shrink-0 text-[11.5px] text-muted">{whenIst(s.nextRunAt)}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="text-[11.5px] text-muted">
            Wallet {rupee(data.kpis.balance)}
            {data.runway.callsLeft != null && <> · covers about {data.runway.callsLeft.toLocaleString()} more connected calls</>}
            {" · "}
            {data.range.days} day{data.range.days === 1 ? "" : "s"} to {data.range.to}
          </div>
        </>
      )}
    </Section>
  );
}
