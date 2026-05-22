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
  };
  byHour: Record<string, number>;
  byCampaign: Record<string, number>;
  hangupCauseCounts: Record<string, number>;
  recent: CallRecord[];
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

export default function ReportsTab() {
  const [day, setDay] = useState<string>(todayKey());
  const [campaign, setCampaign] = useState<string>("");
  const { data: cdata } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const campaigns = cdata?.campaigns ?? [];
  const qs = new URLSearchParams();
  if (day) qs.set("day", day);
  if (campaign) qs.set("campaign", campaign);
  const { data, loading, reload } = useFetch<Report>(`/api/reports?${qs.toString()}`, [day, campaign]);

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs text-muted mb-1">Day</div>
            <div className="flex gap-1">
              <Button variant={day === todayKey() ? "primary" : "ghost"} onClick={() => setDay(todayKey())}>Today</Button>
              <Button variant={day === offsetDay(-1) ? "primary" : "ghost"} onClick={() => setDay(offsetDay(-1))}>Yesterday</Button>
              <input
                type="date"
                value={day}
                onChange={(e) => setDay(e.target.value)}
                className="bg-bg border border-line rounded-lg px-2 py-1 text-sm"
              />
            </div>
          </div>
          <div className="min-w-[200px]">
            <div className="text-xs text-muted mb-1">Campaign</div>
            <Select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
              <option value="">All campaigns</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="ml-auto">
            <Button variant="ghost" onClick={reload}>{loading ? "Refreshing…" : "Refresh"}</Button>
          </div>
        </div>
      </Card>

      {data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <KPI label="Calls" value={data.totals.total} />
            <KPI label="Answered" value={data.totals.answered} sub={`${data.totals.answerRate}%`} />
            <KPI label="Press 1" value={data.totals.press1} sub={`${data.totals.press1Rate}%`} />
            <KPI label="Failed" value={data.totals.failed} />
            <KPI label="Avg duration" value={`${data.totals.avgDurationSec}s`} />
          </div>

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

function RecentTable({ rows }: { rows: CallRecord[] }) {
  if (!rows.length) return <div className="text-sm text-muted">No calls yet.</div>;
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1">Time</th>
            <th>To</th>
            <th>Campaign</th>
            <th>Status</th>
            <th>Digit</th>
            <th>Dur</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.callUuid} className="border-t border-line">
              <td className="py-1 font-mono text-xs">{r.triggeredAt.slice(11, 19)}</td>
              <td className="font-mono">{r.to}</td>
              <td className="truncate max-w-[160px]">{r.campaignName}</td>
              <td>
                <Badge tone={r.status === "press1" ? "ok" : r.status === "failed" ? "danger" : "muted"}>
                  {r.status}
                </Badge>
              </td>
              <td>{r.digit || "—"}</td>
              <td>{r.durationSec ? `${r.durationSec}s` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
