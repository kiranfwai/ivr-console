"use client";

import { useState } from "react";
import { Button, Card, KPI, Badge, Select } from "./ui";
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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function offsetDay(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
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
const OUTCOME_TONE: Record<string, "ok" | "warn" | "danger" | "muted" | "accent"> = {
  press1: "ok",
  connected: "ok",
  busy: "warn",
  "no-answer": "warn",
  rejected: "danger",
  error: "danger",
  pending: "muted",
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

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-muted mb-1">Range</div>
            <div className="flex gap-1 flex-wrap">
              <Button variant={from === todayKey() && to === todayKey() ? "primary" : "ghost"} onClick={() => setPreset(todayKey(), todayKey())}>Today</Button>
              <Button variant={from === offsetDay(-1) && to === offsetDay(-1) ? "primary" : "ghost"} onClick={() => setPreset(offsetDay(-1), offsetDay(-1))}>Yesterday</Button>
              <Button variant={from === offsetDay(-6) && to === todayKey() ? "primary" : "ghost"} onClick={() => setPreset(offsetDay(-6), todayKey())}>7 days</Button>
              <Button variant={from === offsetDay(-29) && to === todayKey() ? "primary" : "ghost"} onClick={() => setPreset(offsetDay(-29), todayKey())}>30 days</Button>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <div className="text-xs text-muted mb-1">From</div>
              <input
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
                className="bg-bg border border-line rounded-lg px-2 py-2 text-sm"
              />
            </div>
            <div>
              <div className="text-xs text-muted mb-1">To</div>
              <input
                type="date"
                value={to}
                min={from}
                onChange={(e) => setTo(e.target.value)}
                className="bg-bg border border-line rounded-lg px-2 py-2 text-sm"
              />
            </div>
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs text-muted mb-1">Campaign</div>
            <Select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={reload}>{loading ? "Refreshing…" : "Refresh"}</Button>
            <Button onClick={downloadCsv} disabled={!data?.totals.total}>Download CSV</Button>
          </div>
        </div>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI label="Calls" value={data.totals.total} />
            <KPI label="Lifted" value={data.totals.lifted} sub={`${data.totals.liftRate}% lift rate`} />
            <KPI label="Press 1" value={data.totals.press1} sub={`${data.totals.press1Rate}%`} />
            <KPI label="Not lifted" value={data.totals.notLifted} sub="busy + no-answer" />
            <KPI label="Avg duration" value={`${data.totals.avgDurationSec}s`} />
          </div>

          <Card>
            <div className="text-sm text-muted mb-3">Outcome breakdown</div>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 text-xs">
              {[
                ["press1", data.outcomes.press1],
                ["connected", data.outcomes.connected],
                ["busy", data.outcomes.busy],
                ["no-answer", data.outcomes.noAnswer],
                ["rejected", data.outcomes.rejected],
                ["error", data.outcomes.error],
              ].map(([k, v]) => (
                <div key={k as string} className="bg-bg/60 border border-line rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <Badge tone={OUTCOME_TONE[k as string]}>{OUTCOME_LABEL[k as string]}</Badge>
                  </div>
                  <div className="text-2xl font-semibold">{v as number}</div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="text-sm text-muted mb-2">By hour</div>
            <HourBars byHour={data.byHour} />
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Card>
              <div className="text-sm text-muted mb-2">By campaign</div>
              <KVList rows={data.byCampaign} />
            </Card>
            <Card>
              <div className="text-sm text-muted mb-2">Hangup causes (Plivo)</div>
              <KVList rows={data.hangupCauseCounts} />
            </Card>
          </div>

          <Card>
            <div className="text-sm text-muted mb-2">Recent calls</div>
            <RecentTable rows={data.recent} />
          </Card>
        </>
      )}
    </div>
  );
}

function HourBars({ byHour }: { byHour: Record<string, number> }) {
  const entries = Object.entries(byHour).sort();
  if (!entries.length) return <div className="text-sm text-muted">No data.</div>;
  const max = Math.max(...entries.map(([, v]) => v));
  return (
    <div className="flex items-end gap-1 h-32">
      {entries.map(([k, v]) => (
        <div key={k} className="flex-1 flex flex-col items-center gap-1" title={`${k}: ${v}`}>
          <div className="w-full bg-accent rounded-t" style={{ height: `${(v / max) * 100}%` }} />
          <div className="text-[10px] text-muted">{k.slice(11)}</div>
        </div>
      ))}
    </div>
  );
}

function KVList({ rows }: { rows: Record<string, number> }) {
  const entries = Object.entries(rows).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <div className="text-sm text-muted">No data.</div>;
  return (
    <div className="space-y-1 text-sm">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between">
          <span className="truncate">{k}</span>
          <Badge tone="muted">{v}</Badge>
        </div>
      ))}
    </div>
  );
}

function RecentTable({ rows }: { rows: (CallRecord & { outcome: string | null })[] }) {
  if (!rows.length) return <div className="text-sm text-muted">No calls yet.</div>;
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1">Time</th>
            <th>To</th>
            <th>Campaign</th>
            <th>Outcome</th>
            <th>Digit</th>
            <th>Dur</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const o = r.outcome || "pending";
            return (
              <tr key={r.callUuid} className="border-t border-line">
                <td className="py-1 font-mono text-xs">{r.triggeredAt.slice(11, 19)}</td>
                <td className="font-mono">{r.to}</td>
                <td className="truncate max-w-[160px]">{r.campaignName}</td>
                <td>
                  <Badge tone={OUTCOME_TONE[o] || "muted"}>{OUTCOME_LABEL[o] || o}</Badge>
                </td>
                <td>{r.digit || "—"}</td>
                <td>{r.durationSec ? `${r.durationSec}s` : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
