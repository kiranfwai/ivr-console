"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  PhoneCall, PhoneIncoming, MousePointerClick, Clock, Wallet, Download, RefreshCw, Calendar,
  Megaphone, ChevronDown, ChevronRight, Columns3, Search, X, Info, ArrowUp, ArrowDown,
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import {
  Button, Card, KPI, Badge, EmptyState, Section, Skeleton, DataPanel, DataTable, TH, TD, Label, Select, toast,
} from "./ui";
import { useFetch } from "./useData";
import { Popover, CheckBox, Initials, TRIGGER } from "./ReportsTabUi";
import type { CallRecord } from "@/lib/models";
import { CSV_COLUMNS, callOutcome, causeLabel, mmss, statusLabel } from "@/lib/report-format";

interface Report {
  totals: {
    total: number;
    answered: number;
    press1: number;
    failed: number;
    answerRate: number;
    press1Rate: number;
    avgDurationSec: number;
    lifted: number;
    notLifted: number;
    liftRate: number;
    spent?: number | null;
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
  campaignsInRange?: RangeCampaign[];
  range: { from: string; to: string };
  hangupCauseCounts: Record<string, number>;
  recent: RecentRow[];
}

interface RangeCampaign {
  id: string;
  name: string;
  calls: number;
}

interface CampaignRow {
  campaignId: string;
  name: string;
  total: number;
  answered?: number;
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

type RecentRow = CallRecord & { outcome: string | null; gsheetConnName?: string | null; cost?: number | null };

// Report day buckets are IST (Asia/Kolkata) — match the server.
const IST_SHIFT_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
function istDateKey(ms: number): string {
  return new Date(ms + IST_SHIFT_MS).toISOString().slice(0, 10);
}
function istTimeOfDay(iso: string): string {
  return new Date(Date.parse(iso) + IST_SHIFT_MS).toISOString().slice(11, 16);
}
function istStamp(iso: string): string {
  const d = new Date(Date.parse(iso) + IST_SHIFT_MS).toISOString();
  return `${d.slice(5, 10)} ${d.slice(11, 16)}`;
}
function todayKey(): string {
  return istDateKey(Date.now());
}
function offsetDay(n: number): string {
  return istDateKey(Date.now() + n * DAY_MS);
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function niceDay(day: string, withYear = false): string {
  const [y, m, d] = day.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ""}${withYear ? ` ${y}` : ""}`;
}
function rangeLabel(from: string, to: string): string {
  if (from === to) return niceDay(from, true);
  return from.slice(0, 4) === to.slice(0, 4)
    ? `${niceDay(from)} – ${niceDay(to)} ${to.slice(0, 4)}`
    : `${niceDay(from, true)} – ${niceDay(to, true)}`;
}
const fmt = (n: number) => n.toLocaleString("en-IN");
const rupees = (n: number) =>
  "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : "—");

/** Range presets, worked out on the IST calendar. */
function presets(): { label: string; from: string; to: string }[] {
  const today = todayKey();

  const monthStart = `${today.slice(0, 7)}-01`;
  const lastMonthEnd = istDateKey(Date.parse(`${monthStart}T00:00:00.000+05:30`) - DAY_MS);
  const lastMonthStart = `${lastMonthEnd.slice(0, 7)}-01`;
  return [
    { label: "Today", from: today, to: today },
    { label: "Yesterday", from: offsetDay(-1), to: offsetDay(-1) },
    { label: "Last 7 days", from: offsetDay(-6), to: today },
    { label: "Last 14 days", from: offsetDay(-13), to: today },
    { label: "This month", from: monthStart, to: today },
    { label: `Last month (${MONTHS[Number(lastMonthEnd.slice(5, 7)) - 1]})`, from: lastMonthStart, to: lastMonthEnd },
  ];
}

/** Outcome groups shown as bars (and used to filter the calls table). */
const GROUPS: { key: string; label: string; color: string; match: (o: string) => boolean }[] = [
  { key: "answered", label: "Answered", color: "rgb(var(--c-accent))", match: (o) => o === "press1" || o === "connected" },
  { key: "no-answer", label: "No answer", color: "rgb(var(--c-muted))", match: (o) => o === "no-answer" },
  { key: "busy", label: "Busy", color: "rgb(var(--c-warn))", match: (o) => o === "busy" },
  { key: "failed", label: "Failed", color: "rgb(var(--c-danger))", match: (o) => o === "rejected" || o === "error" || o === "failed" },
  { key: "pending", label: "In progress", color: "rgb(var(--c-line2))", match: (o) => o === "pending" },
];

const STATUS_TONE: Record<string, "ok" | "warn" | "danger" | "muted" | "accent" | "info"> = {
  press1: "ok",
  connected: "ok",
  busy: "warn",
  "no-answer": "muted",
  rejected: "danger",
  error: "danger",
  failed: "danger",
  pending: "info",
};

export default function ReportsTab() {
  // Open on the last 7 days: "Today" is empty most mornings, and an empty first
  // screen reads as "no data" rather than "nothing yet today".
  const [from, setFrom] = useState<string>(() => offsetDay(-6));
  const [to, setTo] = useState<string>(todayKey());
  // null = every campaign that ran in the range; otherwise the picked ids.
  const [selected, setSelected] = useState<string[] | null>(null);

  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (selected && selected.length) qs.set("campaigns", selected.join(","));
  const query = qs.toString();
  const { data, loading, reload } = useFetch<Report>(`/api/reports?${query}`, [query]);

  const ran = useMemo(() => data?.campaignsInRange ?? [], [data]);

  // A new range can drop campaigns that didn't run in it — keep the selection
  // to campaigns that are actually in the list.
  useEffect(() => {
    if (!selected || !data?.campaignsInRange || data.range.from !== from || data.range.to !== to) return;
    const ids = new Set(data.campaignsInRange.map((c) => c.id));
    const kept = selected.filter((id) => ids.has(id));
    if (kept.length !== selected.length) setSelected(kept.length && kept.length < ids.size ? kept : null);
  }, [data, selected, from, to]);

  function applyRange(a: string, b: string) {
    if (a > b) [a, b] = [b, a];
    setFrom(a);
    setTo(b);
  }

  function exportUrl(kind: "csv" | "xlsx") {
    const p = new URLSearchParams();
    p.set("from", from);
    p.set("to", to);
    if (selected && selected.length) p.set("campaigns", selected.join(","));
    return `/api/reports/${kind}?${p.toString()}`;
  }
  function download(kind: "csv" | "xlsx") {
    const a = document.createElement("a");
    a.href = exportUrl(kind);
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    const n = data?.totals.total ?? 0;
    toast(`${kind === "csv" ? "CSV" : "Excel"} download started · ${fmt(n)} call${n === 1 ? "" : "s"}`, "ok");
  }

  const selectedList = selected ? ran.filter((c) => selected.includes(c.id)) : ran;
  const total = data?.totals.total ?? 0;

  return (
    <Section>
      {/* Sticky filter bar */}
      <div className="sticky top-[58px] z-20 -mx-1 -mt-2 bg-bg/90 px-1 py-2.5 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker from={from} to={to} onApply={applyRange} />
          <CampaignPicker
            ran={ran}
            selected={selected}
            rangeText={rangeLabel(from, to)}
            loading={loading && !data}
            onApply={setSelected}
          />
          {selected && selectedList.map((c) => (
            <span
              key={c.id}
              className="inline-flex h-7 max-w-[220px] items-center gap-1.5 rounded-[8px] border border-accent/25 bg-accent/[0.08] pl-2.5 pr-1 text-[12.5px] font-medium text-accent"
            >
              <span className="truncate">{c.name}</span>
              <button
                type="button"
                aria-label={`Remove ${c.name}`}
                onClick={() => {
                  const next = selected.filter((id) => id !== c.id);
                  setSelected(next.length ? next : null);
                }}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-md hover:bg-accent/15"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {selected && (
            <button type="button" onClick={() => setSelected(null)} className="text-[13px] font-medium text-accent hover:underline">
              Clear
            </button>
          )}
          <span className="flex-1" />
          <Button variant="subtle" size="md" onClick={reload} loading={loading} leftIcon={!loading && <RefreshCw size={14} />} aria-label="Refresh">
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <ColumnsPopover />
          <Button variant="ghost" onClick={() => download("xlsx")} disabled={!total} leftIcon={<Download size={14} />}>
            Excel
          </Button>
          <Button onClick={() => download("csv")} disabled={!total} leftIcon={<Download size={14} />}>
            Download CSV · {fmt(total)} call{total === 1 ? "" : "s"}
          </Button>
        </div>
      </div>

      {loading && !data && <ReportSkeleton />}

      {data && total === 0 && (
        <Card>
          <EmptyState
            icon={<Calendar size={20} />}
            title="No calls in this date range"
            description={
              selected
                ? "None of the picked campaigns placed calls in this range. Pick another range or clear the campaign filter."
                : "Pick another range — only campaigns that ran in it are listed. Calls from Dial, Bulk calls and Sheet auto-dial show up here once placed."
            }
          />
        </Card>
      )}

      {data && total > 0 && (
        <ReportBody data={data} from={from} to={to} campaignCount={selected ? selected.length : ran.length} onCsv={() => download("csv")} />
      )}
    </Section>
  );
}

/* ---------------- Date range popover ---------------- */

function RangePicker({ from, to, onApply }: { from: string; to: string; onApply: (a: string, b: string) => void }) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    if (open) {
      setA(from);
      setB(to);
    }
  }, [open, from, to]);
  const today = todayKey();
  const list = presets();

  return (
    <Popover
      open={open}
      onClose={close}
      trigger={
        <button type="button" className={TRIGGER} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Calendar size={15} className="text-muted" />
          <span className="tabular-nums">{rangeLabel(from, to)}</span>
          <ChevronDown size={14} className="text-muted" />
        </button>
      }
    >
      <div className="grid w-[min(520px,calc(100vw-2rem))] grid-cols-1 sm:grid-cols-[160px_1fr]">
        <div className="border-b border-line p-1 sm:border-b-0 sm:border-r">
          {list.map((p) => {
            const on = p.from === from && p.to === to;
            return (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  onApply(p.from, p.to);
                  close();
                }}
                className={`flex w-full items-center rounded-[8px] px-2.5 py-2 text-left text-[13.5px] transition-colors ${
                  on ? "bg-accent/10 font-medium text-accent" : "text-ink2 hover:bg-ink/[0.05] hover:text-ink"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="p-3.5">
          <div className="text-[14px] font-semibold">Custom range</div>
          <div className="mb-3 mt-0.5 text-xs text-muted">Days are India time (IST).</div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label>From</Label>
              <input
                type="date"
                value={a}
                max={today}
                onChange={(e) => setA(e.target.value)}
                className="w-full rounded-[9px] border border-line bg-panel px-2.5 py-2 text-sm text-ink shadow-xs outline-none hover:border-line2 focus:border-accent focus:shadow-glow"
              />
            </div>
            <div>
              <Label>To</Label>
              <input
                type="date"
                value={b}
                max={today}
                onChange={(e) => setB(e.target.value)}
                className="w-full rounded-[9px] border border-line bg-panel px-2.5 py-2 text-sm text-ink shadow-xs outline-none hover:border-line2 focus:border-accent focus:shadow-glow"
              />
            </div>
          </div>
          <div className="mt-3.5 flex justify-end gap-2">
            <Button variant="subtle" size="sm" onClick={close}>Cancel</Button>
            <Button
              size="sm"
              disabled={!a || !b}
              onClick={() => {
                onApply(a, b);
                close();
              }}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </Popover>
  );
}

/* ---------------- Campaign multi-select popover ---------------- */

function CampaignPicker({
  ran,
  selected,
  rangeText,
  loading,
  onApply,
}: {
  ran: RangeCampaign[];
  selected: string[] | null;
  rangeText: string;
  loading: boolean;
  onApply: (ids: string[] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  useEffect(() => {
    if (open) {
      setDraft(new Set(selected ?? ran.map((c) => c.id)));
      setQ("");
    }
    // Only when the popover opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commit = useCallback(
    (d: Set<string>) => {
      if (!d.size) return; // nothing picked: keep what was there
      onApply(d.size >= ran.length && ran.every((c) => d.has(c.id)) ? null : ran.filter((c) => d.has(c.id)).map((c) => c.id));
    },
    [onApply, ran],
  );
  const close = useCallback(() => {
    setOpen(false);
    commit(draft);
  }, [commit, draft]);

  const allSel = !selected;
  const one = selected && selected.length === 1 ? ran.find((c) => c.id === selected[0]) : null;
  const shown = q ? ran.filter((c) => c.name.toLowerCase().includes(q.toLowerCase())) : ran;

  return (
    <Popover
      open={open}
      onClose={close}
      trigger={
        <button type="button" className={TRIGGER} onClick={() => (open ? close() : setOpen(true))} aria-expanded={open}>
          <Megaphone size={15} className="text-muted" />
          <span className="max-w-[200px] truncate">
            {loading ? "Campaigns" : allSel ? (
              <>All campaigns <span className="text-[12.5px] font-normal text-muted">({ran.length})</span></>
            ) : one ? one.name : `${selected!.length} campaigns`}
          </span>
          <ChevronDown size={14} className="text-muted" />
        </button>
      }
    >
      <div className="w-[min(340px,calc(100vw-2rem))]">
        <div className="-mx-1.5 -mt-1.5 mb-1.5 flex items-center gap-2 border-b border-line px-3">
          <Search size={15} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search campaigns"
            className="flex-1 bg-transparent py-2.5 text-[13.5px] text-ink outline-none placeholder:text-muted"
          />
        </div>
        <div className="mx-2 mb-1.5 text-xs text-muted">
          {ran.length} campaign{ran.length === 1 ? "" : "s"} ran in {rangeText}
        </div>
        <div className="max-h-[300px] overflow-auto">
          {shown.map((c) => {
            const on = draft.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  const next = new Set(draft);
                  if (on) next.delete(c.id);
                  else next.add(c.id);
                  setDraft(next);
                }}
                className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13.5px] hover:bg-ink/[0.05]"
              >
                <CheckBox on={on} />
                <Initials name={c.name} size={28} />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="shrink-0 text-[12.5px] tabular-nums text-muted">{fmt(c.calls)} calls</span>
              </button>
            );
          })}
          {!shown.length && (
            <div className="px-3 py-6 text-center text-[13px] text-muted">
              {ran.length ? "No campaign matches that search." : "No campaigns ran in this range."}
            </div>
          )}
        </div>
        <div className="-mx-1.5 -mb-1.5 mt-1.5 flex items-center gap-3 border-t border-line bg-elev/60 px-3 py-2.5">
          <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setDraft(new Set(ran.map((c) => c.id)))}>
            Select all
          </button>
          <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setDraft(new Set())}>
            Clear
          </button>
          <span className="flex-1 text-right text-xs text-muted">{draft.size ? `${draft.size} selected` : "Pick at least one"}</span>
          <Button size="sm" disabled={!draft.size} onClick={close}>
            Done
          </Button>
        </div>
      </div>
    </Popover>
  );
}

function ColumnsPopover() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <Popover
      open={open}
      onClose={close}
      align="right"
      trigger={
        <Button variant="ghost" onClick={() => setOpen((v) => !v)} leftIcon={<Columns3 size={14} />} aria-expanded={open}>
          Columns
        </Button>
      }
    >
      <div className="w-[min(380px,calc(100vw-2rem))] px-2.5 py-2">
        <div className="text-[14px] font-semibold">CSV columns</div>
        <div className="mt-0.5 text-xs text-muted">One row per call, ready for Excel or Google Sheets.</div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {CSV_COLUMNS.map((c) => (
            <span key={c} className="rounded-md border border-line bg-elev px-2 py-0.5 text-xs text-ink2">
              {c}
            </span>
          ))}
        </div>
      </div>
    </Popover>
  );
}

/* ---------------- Body ---------------- */

function ReportBody({
  data,
  from,
  to,
  campaignCount,
  onCsv,
}: {
  data: Report;
  from: string;
  to: string;
  campaignCount: number;
  onCsv: () => void;
}) {
  // Outcome-group filter shared by the outcome bars and the calls table.
  const [group, setGroup] = useState<string | null>(null);
  const t = data.totals;
  const o = data.outcomes;
  const spent = typeof t.spent === "number" ? t.spent : null;

  const groupCounts: Record<string, number> = {
    answered: o.press1 + o.connected,
    "no-answer": o.noAnswer,
    busy: o.busy,
    failed: o.rejected + o.error,
    pending: o.pending,
  };

  const rows = useMemo(() => {
    const withOutcome = data.recent.map((r) => ({ ...r, _o: callOutcome(r) }));
    if (!group) return withOutcome;
    const g = GROUPS.find((x) => x.key === group);
    return g ? withOutcome.filter((r) => g.match(r._o)) : withOutcome;
  }, [data.recent, group]);

  return (
    <>
      <div className={`grid grid-cols-2 gap-3 ${spent != null ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <KPI label="Calls" value={fmt(t.total)} sub={`${campaignCount} campaign${campaignCount === 1 ? "" : "s"}`} icon={<PhoneCall size={18} />} tone="accent" />
        <KPI label="Answered" value={fmt(t.answered)} sub={`${pct(t.answered, t.total)} answer rate`} icon={<PhoneIncoming size={18} />} tone="ok" />
        <KPI label="Pressed 1" value={fmt(t.press1)} sub={t.answered ? `${pct(t.press1, t.answered)} of answered` : "—"} icon={<MousePointerClick size={18} />} tone="info" />
        <KPI label="Avg talk time" value={t.answered ? `${t.avgDurationSec}s` : "—"} sub="answered calls" icon={<Clock size={18} />} />
        {spent != null && (
          <KPI
            label="Spent"
            value={rupees(spent)}
            sub={t.press1 ? `${rupees(spent / t.press1)} per press-1` : "connected calls only"}
            icon={<Wallet size={18} />}
            tone="warn"
          />
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <DataPanel title="By campaign" meta={`${rangeLabel(from, to)} · click a row for its numbers`}>
          <CampaignTable rows={data.campaignTable ?? []} from={from} to={to} />
        </DataPanel>
        <Card title="Outcomes" description={`${fmt(t.total)} calls · click one to filter the calls below`}>
          <div className="space-y-0.5">
            {GROUPS.filter((g) => g.key !== "pending" || groupCounts.pending > 0).map((g) => {
              const v = groupCounts[g.key] || 0;
              const on = group === g.key;
              return (
                <button
                  key={g.key}
                  type="button"
                  onClick={() => setGroup(on ? null : g.key)}
                  className={`grid w-full grid-cols-[100px_1fr_84px] items-center gap-3 rounded-[8px] px-1.5 py-2 text-left text-[13px] transition-colors hover:bg-ink/[0.04] ${
                    on ? "bg-accent/[0.07]" : group ? "opacity-60" : ""
                  }`}
                >
                  <span className="truncate text-ink2">{g.label}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-line">
                    <span className="block h-full rounded-full" style={{ width: `${t.total ? (v / t.total) * 100 : 0}%`, background: g.color }} />
                  </span>
                  <span className="text-right tabular-nums text-ink2">
                    {fmt(v)} · {t.total ? Math.round((v / t.total) * 100) : 0}%
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex gap-2.5 rounded-[10px] border border-accent/20 bg-accent/[0.06] px-3 py-2.5 text-[13px] text-ink2">
            <Info size={15} className="mt-0.5 shrink-0 text-accent" />
            <span>The CSV has one row per call with {CSV_COLUMNS.length} columns — the same detail you get from a Wavelength call log.</span>
          </div>
        </Card>
      </div>

      <DataPanel
        title="Calls"
        meta={
          group
            ? `${rows.length} ${GROUPS.find((g) => g.key === group)?.label.toLowerCase()} of the latest ${data.recent.length} · download the CSV for all of them`
            : `Latest ${data.recent.length} of ${fmt(t.total)} · download the CSV for all of them`
        }
        action={
          <>
            {group && (
              <Button variant="subtle" size="sm" leftIcon={<X size={12} />} onClick={() => setGroup(null)}>
                Clear filter
              </Button>
            )}
            <Button variant="ghost" size="sm" leftIcon={<Download size={13} />} onClick={onCsv}>
              CSV
            </Button>
          </>
        }
      >
        <RecentTable rows={rows} filtered={!!group} />
      </DataPanel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Calls by hour" description="When calls in this range were placed (IST).">
          <HourlyChart byHour={data.byHour} />
        </Card>
        <Card title="Why calls ended" description="As reported by the phone network for the latest calls, most frequent first.">
          <KVList rows={data.hangupCauseCounts} />
        </Card>
      </div>
    </>
  );
}

function ReportSkeleton() {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </>
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
            <linearGradient id="reportsFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--c-accent))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="rgb(var(--c-accent))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgb(var(--c-line))" vertical={false} />
          <XAxis dataKey="hour" tick={{ fontSize: 10, fill: "rgb(var(--c-muted))" }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 10, fill: "rgb(var(--c-muted))" }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "rgb(var(--c-line))" }} />
          <Area type="monotone" dataKey="calls" stroke="rgb(var(--c-accent))" strokeWidth={2} fill="url(#reportsFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function KVList({ rows }: { rows: Record<string, number> }) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <div className="text-sm text-muted">No data.</div>;
  const max = Math.max(...entries.map(([, v]) => v));
  return (
    <div className="space-y-2 text-sm">
      {entries.map(([k, v]) => (
        <div key={k}>
          <div className="mb-1 flex items-center justify-between text-[13px]">
            <span className="truncate text-ink2" title={k}>{causeLabel(k)}</span>
            <span className="tabular-nums text-muted">{fmt(v)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-accent/60" style={{ width: `${(v / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- Calls table ---------------- */

type SortKey = "time" | "lead" | "campaign" | "status" | "duration" | "cost";
type SortDir = "asc" | "desc";
const PAGE_SIZE = 25;

function RecentTable({ rows, filtered }: { rows: (RecentRow & { _o: string })[]; filtered: boolean }) {
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [visible, setVisible] = useState<number>(PAGE_SIZE);

  function onSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "lead" || key === "campaign" || key === "status" ? "asc" : "desc");
    }
    setVisible(PAGE_SIZE);
  }

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const val = (r: RecentRow & { _o: string }): string | number => {
      switch (sortKey) {
        case "time": return Date.parse(r.triggeredAt) || 0;
        case "lead": return (r.name || r.to || "").toLowerCase();
        case "campaign": return (r.campaignName || "").toLowerCase();
        case "status": return statusLabel(r._o);
        case "duration": return r.durationSec ?? -1;
        case "cost": return r.cost ?? -1;
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
      <div className="border-t border-line px-5 py-8 text-center text-sm text-muted">
        {filtered ? "None of the latest calls has this outcome." : "No calls yet."}
      </div>
    );
  }

  const shown = sorted.slice(0, visible);
  const remaining = sorted.length - shown.length;
  const th = (label: string, col: SortKey, cls = "", right = false) => (
    <th className={`${TH} ${right ? "text-right" : ""} ${cls}`}>
      <button
        type="button"
        onClick={() => onSort(col)}
        className={`inline-flex items-center gap-1 transition-colors hover:text-ink ${sortKey === col ? "text-ink" : ""} ${right ? "flex-row-reverse" : ""}`}
      >
        {label}
        {sortKey === col && (sortDir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </button>
    </th>
  );

  return (
    <div>
      <DataTable>
        <thead>
          <tr>
            {th("When", "time")}
            {th("Lead", "lead")}
            {th("Campaign", "campaign", "hidden md:table-cell")}
            {th("Status", "status")}
            {th("Duration", "duration", "", true)}
            <th className={`${TH} hidden md:table-cell`}>Pressed 1</th>
            <th className={`${TH} hidden md:table-cell`}>WhatsApp</th>
            {th("Cost", "cost", "hidden md:table-cell", true)}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => {
            const d = new Date(Date.parse(r.triggeredAt) + IST_SHIFT_MS).toISOString().slice(0, 10);
            return (
              <tr key={r.callUuid} className="transition-colors hover:bg-ink/[0.025]">
                <td className={`${TD} whitespace-nowrap`}>
                  <div>{niceDay(d)}</div>
                  <div className="text-xs tabular-nums text-muted">{istTimeOfDay(r.triggeredAt)}</div>
                </td>
                <td className={TD}>
                  <div className="max-w-[180px] truncate font-medium">{r.name || r.to}</div>
                  <div className="text-xs tabular-nums text-muted">
                    {r.name ? r.to : ""}
                    {r.gsheetConnName ? `${r.name ? " · " : ""}Sheet: ${r.gsheetConnName}` : ""}
                  </div>
                </td>
                <td className={`${TD} hidden max-w-[200px] truncate md:table-cell`}>{r.campaignName}</td>
                <td className={TD}>
                  <Badge tone={STATUS_TONE[r._o] || "muted"}>{statusLabel(r._o)}</Badge>
                </td>
                <td className={`${TD} text-right tabular-nums`}>{r.durationSec ? mmss(r.durationSec) : "—"}</td>
                <td className={`${TD} hidden md:table-cell`}>
                  {r.digit === "1" ? <Badge tone="ok">Yes</Badge> : <span className="text-muted">No</span>}
                </td>
                <td className={`${TD} hidden md:table-cell`}>
                  {r.whatsappSentAt ? <Badge tone="info">Sent</Badge> : <span className="text-muted">—</span>}
                </td>
                <td className={`${TD} hidden text-right tabular-nums md:table-cell`}>
                  {typeof r.cost === "number" ? rupees(r.cost) : <span className="text-muted">—</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </DataTable>
      {remaining > 0 && (
        <div className="flex justify-center py-3">
          <Button variant="ghost" size="sm" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
            Show {Math.min(PAGE_SIZE, remaining)} more · {remaining} remaining
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------- By-campaign table + phone-level drill-down ---------------- */

function CampaignTable({ rows, from, to }: { rows: CampaignRow[]; from: string; to: string }) {
  const [openCid, setOpenCid] = useState<string | null>(null);
  if (!rows.length) {
    return <div className="border-t border-line px-5 py-8 text-center text-sm text-muted">No campaign activity in this range.</div>;
  }
  return (
    <DataTable>
      <thead>
        <tr>
          <th className={TH}>Campaign</th>
          <th className={`${TH} text-right`}>Calls</th>
          <th className={`${TH} hidden text-right sm:table-cell`}>Answered</th>
          <th className={`${TH} text-right`}>Answer rate</th>
          <th className={`${TH} hidden text-right sm:table-cell`}>Pressed 1</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const open = openCid === r.campaignId;
          const answered = r.answered ?? r.lifted;
          const rate = r.total ? (answered / r.total) * 100 : 0;
          const canDrill = r.campaignId !== "none";
          return (
            <Fragment key={r.campaignId}>
              <tr
                onClick={() => canDrill && setOpenCid(open ? null : r.campaignId)}
                className={`transition-colors ${canDrill ? "cursor-pointer" : ""} ${open ? "bg-elev" : "hover:bg-ink/[0.025]"}`}
              >
                <td className={TD}>
                  <div className="flex items-center gap-2.5">
                    {canDrill ? (
                      open ? <ChevronDown size={13} className="shrink-0 text-muted" /> : <ChevronRight size={13} className="shrink-0 text-muted" />
                    ) : <span className="w-[13px]" />}
                    <Initials name={r.name} size={28} />
                    <span className="max-w-[220px] truncate font-medium">{r.name}</span>
                  </div>
                </td>
                <td className={`${TD} text-right tabular-nums`}>{fmt(r.total)}</td>
                <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{fmt(answered)}</td>
                <td className={TD}>
                  <div className="flex items-center justify-end gap-2.5">
                    <span className="hidden h-[5px] w-[70px] overflow-hidden rounded-full bg-line sm:block">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${rate}%` }} />
                    </span>
                    <span className="w-12 text-right tabular-nums">{rate.toFixed(1)}%</span>
                  </div>
                </td>
                <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{fmt(r.press1)}</td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={5} className="border-b border-line/70 bg-elev/50 px-5 py-3">
                    <DrillDown campaignId={r.campaignId} from={from} to={to} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </DataTable>
  );
}

const DRILL_STATUSES = [
  { value: "", label: "All statuses" },
  { value: "connected", label: "Connected" },
  { value: "failed", label: "Failed" },
  { value: "no-answer", label: "No answer" },
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
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">
          {loading
            ? "Loading numbers…"
            : `${rows.length.toLocaleString()} number${rows.length === 1 ? "" : "s"}${data?.capped ? " (showing first 1,000)" : ""}`}
        </span>
        <div className="w-40">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 py-1 text-xs">
            {DRILL_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </Select>
        </div>
      </div>
      {loading && <Skeleton className="h-24 rounded-lg" />}
      {!loading && !rows.length && <div className="py-3 text-center text-xs text-muted">No matching calls.</div>}
      {!loading && rows.length > 0 && (
        <div className="max-h-72 overflow-auto rounded-lg border border-line bg-panel">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-elev">
              <tr className="text-left text-muted">
                <th className="px-3 py-2 font-medium">Phone</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Duration</th>
                <th className="px-3 py-2 text-right font-medium">Time (IST)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.to}-${i}`} className="border-t border-line/60 hover:bg-ink/[0.025]">
                  <td className="px-3 py-1.5 tabular-nums">{r.to}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={STATUS_TONE[r.outcome] || "muted"}>{statusLabel(r.outcome)}</Badge>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.durationSec ? mmss(r.durationSec) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-muted">{istStamp(r.triggeredAt)}</td>
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
  background: "rgb(var(--c-panel))",
  border: "1px solid rgb(var(--c-line))",
  borderRadius: 8,
  fontSize: 12,
  color: "rgb(var(--c-ink))",
};

