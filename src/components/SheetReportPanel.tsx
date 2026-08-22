"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import { Download, PhoneCall, PhoneIncoming, Clock, Hash, X } from "lucide-react";
import { Button, Card, KPI, Badge, Select, EmptyState, Skeleton } from "./ui";
import { useFetch } from "./useData";
import {
  OUTCOME_LABEL, OUTCOME_ORDER, OUTCOME_COLOR, OUTCOME_TONE,
  istStamp, istToday, istDayOffset, fmtDuration,
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

const PAGE = 25;

/**
 * What one sheet connection actually did.  Lives inside the Sheet Auto-Dial tab
 * next to the connection it describes, because that is where the sheet is
 * managed — the campaign Reports tab still shows these calls, but merged in with
 * every other call on the same campaign.
 */
export default function SheetReportPanel({
  conn,
  campaignName,
  onClose,
}: {
  conn: GSheetConn;
  campaignName: string;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<Preset>("7d");
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

  const pieData = useMemo(
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
    () => (s ? s.byDay.map((d) => ({ day: d.day.slice(5), dialled: d.dialled, lifted: d.lifted })) : []),
    [s],
  );

  const rows = data?.rows ?? [];
  const shown = rows.slice(0, visible);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <PhoneCall size={16} className="text-brand" />
          <span>Report — {conn.connName || conn.tabName}</span>
        </span>
      }
      description={`Calls this sheet placed through “${campaignName}”. Queued rows that were never dialled are not counted.`}
      action={
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" variant="ghost" leftIcon={<Download size={13} />} onClick={() => download("csv")} disabled={!s?.dialled}>
            CSV
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<Download size={13} />} onClick={() => download("xlsx")} disabled={!s?.dialled}>
            Excel
          </Button>
          <Button size="sm" variant="ghost" leftIcon={<X size={13} />} onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {/* range presets + outcome filter */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => { setPreset(p.key); setVisible(PAGE); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              preset === p.key
                ? "bg-brand/10 border-brand/40 text-brand"
                : "bg-elev border-line text-muted hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
        <div className="ml-auto w-48">
          <Select
            value={outcome}
            onChange={(e) => { setOutcome(e.target.value); setVisible(PAGE); }}
          >
            <option value="">All outcomes</option>
            <option value="lifted">Lifted (any)</option>
            {OUTCOME_ORDER.map((k) => (
              <option key={k} value={k}>{OUTCOME_LABEL[k]}</option>
            ))}
          </Select>
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          Could not load the report: {err}
        </div>
      )}

      {loading && !s && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
        </div>
      )}

      {s && s.dialled === 0 && (
        <EmptyState
          icon={<PhoneCall size={20} />}
          title="No calls in this range"
          description={
            preset === "all"
              ? "This sheet has not dialled anyone yet. Leads still sitting in the queue are not counted here."
              : "Nothing was dialled in this range — try a wider one."
          }
        />
      )}

      {s && s.dialled > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KPI label="Calls placed" value={s.dialled} icon={<PhoneCall size={18} />} tone="accent"
                 sub={s.uniqueNumbers !== s.dialled ? `${s.uniqueNumbers} unique numbers` : undefined} />
            <KPI label="Lifted" value={s.lifted} icon={<PhoneIncoming size={18} />} tone="ok"
                 sub={`${s.liftRate}% of calls`} />
            <KPI label="Pressed 1" value={s.outcomes.press1 || 0} icon={<Hash size={18} />} tone="ok"
                 sub={`${s.press1Rate}% of calls`} />
            <KPI label="Avg duration" value={fmtDuration(s.avgDurationSec)} icon={<Clock size={18} />} tone="muted"
                 sub="across lifted calls" />
            <KPI label="Talk time" value={fmtDuration(s.talkTimeSec)} icon={<Clock size={18} />} tone="muted"
                 sub={s.lastCallAt ? `last call ${istStamp(s.lastCallAt)}` : undefined} />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <Card title="Outcome breakdown">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={80} paddingAngle={2}>
                      {pieData.map((d) => <Cell key={d.key} fill={OUTCOME_COLOR[d.key] || "#7A8597"} />)}
                    </Pie>
                    <Tooltip contentStyle={TOOLTIP} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-2 mt-2">
                {pieData.map((d) => (
                  <button
                    key={d.key}
                    onClick={() => { setOutcome(outcome === d.key ? "" : d.key); setVisible(PAGE); }}
                    className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg border transition-colors ${
                      outcome === d.key ? "border-brand/40 bg-brand/10" : "border-line hover:border-line2"
                    }`}
                  >
                    <span className="w-2 h-2 rounded-full" style={{ background: OUTCOME_COLOR[d.key] }} />
                    <span className="text-ink2">{d.name}</span>
                    <span className="tabular-nums text-muted">{d.value}</span>
                  </button>
                ))}
              </div>
            </Card>

            <Card title="Calls by day (IST)">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dayData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E2430" vertical={false} />
                    <XAxis dataKey="day" stroke="#7A8597" fontSize={11} tickLine={false} />
                    <YAxis stroke="#7A8597" fontSize={11} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={TOOLTIP} cursor={{ fill: "#ffffff08" }} />
                    <Bar dataKey="dialled" name="Placed" fill="#5EEAD4" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="lifted" name="Lifted" fill="#22C55E" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          {/* lead-level table */}
          <div className="mt-4 overflow-x-auto">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-ink2">
                {outcome ? `${rows.length} ${OUTCOME_LABEL[outcome] ?? outcome} call(s)` : `${rows.length} call(s)`}
                {data?.capped && <span className="text-warn"> · showing the first {rows.length}, narrow the range for the rest</span>}
              </div>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-line">
                  <th className="py-2 pr-3 font-medium">Called (IST)</th>
                  <th className="py-2 pr-3 font-medium">Row</th>
                  <th className="py-2 pr-3 font-medium">Name</th>
                  <th className="py-2 pr-3 font-medium">Phone</th>
                  <th className="py-2 pr-3 font-medium">Outcome</th>
                  <th className="py-2 pr-3 font-medium text-right">Duration</th>
                  <th className="py-2 pr-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.leadId} className="border-b border-line/60 hover:bg-elev/50">
                    <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-ink2">{istStamp(r.calledAt)}</td>
                    <td className="py-2 pr-3 tabular-nums text-muted">{r.rowIndex}</td>
                    <td className="py-2 pr-3 truncate max-w-[14rem]">
                      {r.name || <span className="text-muted">—</span>}
                      {r.removedFromQueue && (
                        <span className="ml-1.5 text-[10px] text-muted" title="Cleared from the queue after this call">cleared</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums whitespace-nowrap">{r.phone}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={OUTCOME_TONE[r.outcome] ?? "muted"}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-ink2">{fmtDuration(r.durationSec)}</td>
                    <td className="py-2 pr-3 text-xs text-muted truncate max-w-[16rem]">
                      {r.error || r.hangupCause || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible < rows.length && (
              <div className="mt-3 text-center">
                <Button size="sm" variant="ghost" onClick={() => setVisible((v) => v + PAGE)}>
                  Show {Math.min(PAGE, rows.length - visible)} more
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

const TOOLTIP = {
  background: "#12161F",
  border: "1px solid #1E2430",
  borderRadius: 10,
  fontSize: 12,
  color: "#E8ECF3",
};
