"use client";
import { fmtDayKey, fmtDateTime } from "@/lib/format";

import { ReactNode, useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { Download, PhoneCall, PhoneIncoming, Clock, MousePointerClick, AlertTriangle, X } from "lucide-react";
import { Button, Card, KPI, Badge, Select, EmptyState, Skeleton, DataPanel, DataTable, TH, TD } from "./ui";
import { useFetch } from "./useData";
import {
  OUTCOME_LABEL, OUTCOME_ORDER, OUTCOME_TONE,
  istToday, istDayOffset, fmtDuration,
} from "@/lib/gsheet-report-format";
import type { GSheetConn } from "@/lib/gsheets";

interface ReportRow {
  leadId: number;
  rowIndex: number;
  name: string | null;
  email: string | null;
  phone: string;
  outcome: string;
  hangupCause: string | null;
  durationSec: number | null;
  calledAt: string;
  callUuid: string | null;
  error: string | null;
  removedFromQueue: boolean;
}

interface ReportSummary {
  connId: string;
  connName: string;
  tabName: string;
  campaignId: string;
  from: string | null;
  to: string | null;
  dialled: number;
  lifted: number;
  outcomes: Record<string, number>;
  uniqueNumbers: number;
  talkTimeSec: number;
  avgDurationSec: number;
  liftRate: number;
  press1Rate: number;
  firstCallAt: string | null;
  lastCallAt: string | null;
  byDay: { day: string; dialled: number; lifted: number }[];
  byHour: Record<string, number>;
}

interface ReportResponse {
  summary: ReportSummary;
  rows: ReportRow[];
  capped: boolean;
}

type Preset = "today" | "7d" | "30d" | "all";

const PRESETS: { key: Preset; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "all", label: "All time" },
];

function presetRange(p: Preset): { from?: string; to?: string } {
  if (p === "all") return {};
  if (p === "today") return { from: istToday(), to: istToday() };
  return { from: istDayOffset(p === "7d" ? 6 : 29), to: istToday() };
}

/** Theme-token colours for each outcome (work in light and dark). */
const OUTCOME_FILL: Record<string, string> = {
  press1: "rgb(var(--c-ok))",
  connected: "rgb(var(--c-accent))",
  busy: "rgb(var(--c-warn))",
  "no-answer": "rgb(var(--c-warn2))",
  rejected: "rgb(var(--c-danger))",
  error: "rgb(var(--c-danger2))",
  failed: "rgb(var(--c-danger))",
  "in-progress": "rgb(var(--c-muted))",
};

const PAGE = 25;

/**
 * What one sheet connection actually did. Shown two ways: as the Sheet reports
 * page (no `onClose`) and as a panel under a connection in Sheet auto-dial.
 */
export default function SheetReportPanel({
  conn,
  campaignName,
  onClose,
  toolbarLead,
}: {
  conn: GSheetConn;
  campaignName: string;
  /** Omitted when the report IS the page (the Sheet reports screen) rather than
   *  an expandable panel inside Sheet Auto-Dial — then there is nothing to close. */
  onClose?: () => void;
  /** Extra controls shown first in the toolbar (the page puts its sheet picker here). */
  toolbarLead?: ReactNode;
}) {
  // A sheet that hasn't synced in the last week has nothing in "Last 7 days";
  // open it on all time instead of an empty report.
  const [preset, setPreset] = useState<Preset>(() => {
    const last = conn.lastSyncedAt ? new Date(conn.lastSyncedAt).getTime() : 0;
    return last > Date.now() - 7 * 864e5 ? "7d" : "all";
  });
  const [outcome, setOutcome] = useState<string>("");
  const [visible, setVisible] = useState(PAGE);

  const range = presetRange(preset);
  const qs = new URLSearchParams({ conn: conn.id });
  if (range.from) qs.set("from", range.from);
  if (range.to) qs.set("to", range.to);
  if (outcome) qs.set("outcome", outcome);

  const { data, loading, err } = useFetch<ReportResponse>(
    `/api/gsheets/report?${qs.toString()}`,
    [conn.id, preset, outcome],
  );

  // Exports carry whatever is on screen — same range, same outcome filter.
  function download(kind: "csv" | "xlsx") {
    window.open(`/api/gsheets/report/${kind}?${qs.toString()}`, "_blank");
  }

  const s = data?.summary;
  const embedded = !!onClose;

  const bars = useMemo(
    () =>
      s
        ? OUTCOME_ORDER.filter((k) => (s.outcomes[k] || 0) > 0).map((k) => ({
            key: k,
            name: OUTCOME_LABEL[k] ?? k,
            value: s.outcomes[k],
          }))
        : [],
    [s],
  );

  const dayData = useMemo(
    () => (s ? s.byDay.map((d) => ({ day: fmtDayKey(d.day), dialled: d.dialled, lifted: d.lifted })) : []),
    [s],
  );

  const rows = data?.rows ?? [];
  const shown = rows.slice(0, visible);
  const couldnt = s ? (s.outcomes.rejected || 0) + (s.outcomes.error || 0) + (s.outcomes.failed || 0) : 0;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {toolbarLead}
      <div className="inline-flex gap-0.5 rounded-[10px] border border-line bg-ink/[0.04] p-[3px]">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => { setPreset(p.key); setVisible(PAGE); }}
            className={`h-7 rounded-[7px] px-2.5 text-[13px] font-medium transition-colors ${
              preset === p.key ? "bg-panel text-ink shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="w-44">
        <Select
          value={outcome}
          onChange={(e) => { setOutcome(e.target.value); setVisible(PAGE); }}
          className="h-9 py-1.5"
        >
          <option value="">All outcomes</option>
          <option value="lifted">Answered (any)</option>
          {OUTCOME_ORDER.map((k) => (
            <option key={k} value={k}>{OUTCOME_LABEL[k]}</option>
          ))}
        </Select>
      </div>
      <span className="flex-1" />
      <Button
        variant="ghost"
        size={embedded ? "sm" : "md"}
        leftIcon={<Download size={13} />}
        onClick={() => download("xlsx")}
        disabled={!s?.dialled}
      >
        Excel
      </Button>
      <Button
        variant={embedded ? "ghost" : "primary"}
        size={embedded ? "sm" : "md"}
        leftIcon={<Download size={13} />}
        onClick={() => download("csv")}
        disabled={!s?.dialled}
      >
        Download CSV
      </Button>
      {onClose && (
        <Button size="sm" variant="subtle" leftIcon={<X size={13} />} onClick={onClose}>
          Close
        </Button>
      )}
    </div>
  );

  const body = (
    <div className="space-y-4">
      {toolbar}

      {err && (
        <div className="rounded-[10px] border border-danger/30 bg-danger/[0.06] px-3 py-2.5 text-[13px] text-danger">
          Could not load the report: {err}
        </div>
      )}

      {loading && !s && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[104px] w-full rounded-xl" />)}
        </div>
      )}

      {s && s.dialled === 0 && (
        <Card>
          <EmptyState
            icon={<PhoneCall size={20} />}
            title="No calls in this range"
            description={
              preset === "all"
                ? "This sheet has not dialled anyone yet. Leads still sitting in the queue are not counted here."
                : "Nothing was dialled in this range — try a wider one."
            }
          />
        </Card>
      )}

      {s && s.dialled > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <KPI label="Calls placed" value={s.dialled.toLocaleString("en-IN")} icon={<PhoneCall size={18} />} tone="accent"
                 sub={s.uniqueNumbers !== s.dialled ? `${s.uniqueNumbers} unique numbers` : "from this sheet"} />
            <KPI label="Answered" value={s.lifted.toLocaleString("en-IN")} icon={<PhoneIncoming size={18} />} tone="ok"
                 sub={`${s.liftRate}% of calls`} />
            <KPI label="Pressed 1" value={(s.outcomes.press1 || 0).toLocaleString("en-IN")} icon={<MousePointerClick size={18} />} tone="info"
                 sub={`${s.press1Rate}% of calls`} />
            <KPI label="Avg talk time" value={fmtDuration(s.avgDurationSec)} icon={<Clock size={18} />}
                 sub={`${fmtDuration(s.talkTimeSec)} in total`} />
            <KPI label="Couldn’t connect" value={couldnt.toLocaleString("en-IN")} icon={<AlertTriangle size={18} />} tone="warn"
                 sub="invalid number or network error" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Outcomes" description="Click one to filter the rows below.">
              <div className="space-y-0.5">
                {bars.map((d) => {
                  const on = outcome === d.key;
                  return (
                    <button
                      key={d.key}
                      type="button"
                      onClick={() => { setOutcome(on ? "" : d.key); setVisible(PAGE); }}
                      className={`grid w-full grid-cols-[120px_1fr_76px] items-center gap-3 rounded-[8px] px-1.5 py-2 text-left text-[13px] transition-colors hover:bg-ink/[0.04] ${
                        on ? "bg-accent/[0.07]" : ""
                      }`}
                    >
                      <span className="truncate text-ink2">{d.name}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-line">
                        <span className="block h-full rounded-full" style={{ width: `${(d.value / s.dialled) * 100}%`, background: OUTCOME_FILL[d.key] || "rgb(var(--c-muted))" }} />
                      </span>
                      <span className="text-right tabular-nums text-ink2">
                        {d.value.toLocaleString("en-IN")} · {Math.round((d.value / s.dialled) * 100)}%
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            <Card title="Calls by day" description="India time (IST).">
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dayData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                    <CartesianGrid stroke="rgb(var(--c-line))" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11, fill: "rgb(var(--c-muted))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "rgb(var(--c-muted))" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "rgb(var(--c-ink) / 0.03)" }} />
                    <Bar dataKey="dialled" name="Placed" fill="rgb(var(--c-accent))" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="lifted" name="Answered" fill="rgb(var(--c-ok2))" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <DataPanel
            title="Rows"
            meta={
              <>
                {outcome ? `${rows.length} ${(OUTCOME_LABEL[outcome] ?? outcome).toLowerCase()} call${rows.length === 1 ? "" : "s"}` : `${rows.length} call${rows.length === 1 ? "" : "s"}`}
                {" "}through “{campaignName}”
                {data?.capped && <span className="text-warn"> · showing the first {rows.length}, narrow the range for the rest</span>}
              </>
            }
          >
            <DataTable>
              <thead>
                <tr>
                  <th className={TH}>Row</th>
                  <th className={TH}>Lead</th>
                  <th className={`${TH} hidden sm:table-cell`}>Called (IST)</th>
                  <th className={TH}>Outcome</th>
                  <th className={`${TH} text-right`}>Duration</th>
                  <th className={`${TH} hidden md:table-cell`}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.leadId} className="transition-colors hover:bg-ink/[0.025]">
                    <td className={`${TD} tabular-nums text-muted`}>#{r.rowIndex}</td>
                    <td className={TD}>
                      <div className="max-w-[14rem] truncate font-medium">
                        {r.name || <span className="font-normal text-muted">No name</span>}
                        {r.removedFromQueue && (
                          <span className="ml-1.5 text-[11px] font-normal text-muted" title="Cleared from the queue after this call">cleared</span>
                        )}
                      </div>
                      <div className="text-xs tabular-nums text-muted">{r.phone}</div>
                    </td>
                    <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted sm:table-cell`}>{fmtDateTime(r.calledAt, { short: true })}</td>
                    <td className={TD}>
                      <Badge tone={OUTCOME_TONE[r.outcome] ?? "muted"}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</Badge>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{fmtDuration(r.durationSec)}</td>
                    <td className={`${TD} hidden max-w-[16rem] truncate text-xs text-muted md:table-cell`} title={r.error || r.hangupCause || ""}>
                      {r.error || r.hangupCause || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            {visible < rows.length && (
              <div className="flex justify-center py-3">
                <Button size="sm" variant="ghost" onClick={() => setVisible((v) => v + PAGE)}>
                  Show {Math.min(PAGE, rows.length - visible)} more
                </Button>
              </div>
            )}
          </DataPanel>
        </>
      )}
    </div>
  );

  if (!embedded) return body;

  return (
    <Card
      title={`Report — ${conn.connName || conn.tabName}`}
      description={`Calls this sheet placed through “${campaignName}”. Queued rows that were never dialled are not counted.`}
    >
      {body}
    </Card>
  );
}

const TOOLTIP = {
  background: "rgb(var(--c-panel))",
  border: "1px solid rgb(var(--c-line))",
  borderRadius: 10,
  fontSize: 12,
  color: "rgb(var(--c-ink))",
};
