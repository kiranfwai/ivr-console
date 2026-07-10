"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone, PhoneCall, Wallet, Download, Users2 } from "lucide-react";
import { Card, Section, Badge, KPI, Spinner, EmptyState } from "../ui";
import { api } from "../useData";
import { fmtMoney, istToday, istDaysAgo } from "./money";
import { RangeControl } from "./shared";

interface CallerRow {
  clientId: string;
  clientName: string;
  to: string;
  campaignName: string;
  outcome: string;
  durationSec: number | null;
  charge: number;
  triggeredAt: string;
}
interface CallsResp {
  range: { from: string; to: string };
  currency: string;
  rows: CallerRow[];
  totals: { total: number; connected: number; charge: number };
  capped: boolean;
}
interface ClientOpt {
  id: string;
  name: string;
  email: string;
}

const OUTCOME_META: Record<string, { label: string; tone: "ok" | "danger" | "accent" | "muted" | "warn" }> = {
  connected: { label: "Connected", tone: "ok" },
  press1: { label: "Pressed 1", tone: "accent" },
  busy: { label: "Busy", tone: "warn" },
  "no-answer": { label: "No answer", tone: "muted" },
  rejected: { label: "Rejected", tone: "danger" },
  error: { label: "Error", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
  "in-progress": { label: "In progress", tone: "muted" },
};

const STATUS_FILTERS: { id: string; label: string }[] = [
  { id: "", label: "All" },
  { id: "connected", label: "Connected" },
  { id: "no-answer", label: "No answer" },
  { id: "busy", label: "Busy" },
  { id: "failed", label: "Failed" },
];

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Admin caller-level view: every individual call (number dialed) across clients,
 * filterable by client, date range, and outcome — with totals and CSV export.
 */
export default function CallersView() {
  const [from, setFrom] = useState(istDaysAgo(6));
  const [to, setTo] = useState(istToday());
  const [client, setClient] = useState("all");
  const [status, setStatus] = useState("");
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [data, setData] = useState<CallsResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ clients: ClientOpt[] }>("/api/admin/clients")
      .then((r) => setClients(r.clients || []))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams({ client, from, to, status, limit: "2000" });
      const r = await api<CallsResp>(`/api/admin/calls?${qs.toString()}`);
      setData(r);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
    setLoading(false);
  }, [client, from, to, status]);

  useEffect(() => {
    load();
  }, [load]);

  const currency = data?.currency || "INR";

  function exportCsv() {
    if (!data?.rows.length) return;
    const head = ["Caller", "Client", "Campaign", "Outcome", "Duration (s)", `Charge (${currency})`, "Time (IST)"];
    const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = data.rows.map((r) =>
      [r.to, r.clientName, r.campaignName, r.outcome, r.durationSec ?? "", r.charge, fmtTime(r.triggeredAt)]
        .map(esc)
        .join(","),
    );
    const csv = [head.map(esc).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `callers_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const selectedName = useMemo(
    () => (client === "all" ? "All clients" : clients.find((c) => c.id === client)?.name || "Client"),
    [client, clients],
  );

  return (
    <Section>
      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-muted">
            <Users2 size={14} />
          </div>
          <select
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="bg-bg/60 border border-line hover:border-line2 focus:border-brand/60 rounded-lg px-2.5 py-1.5 text-xs outline-none max-w-[200px]"
          >
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.email}
              </option>
            ))}
          </select>
          <RangeControl from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </div>
        {loading && <Spinner size={16} />}
      </div>

      {/* Outcome filter chips */}
      <div className="flex flex-wrap items-center gap-1">
        {STATUS_FILTERS.map((s) => {
          const active = status === s.id;
          return (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${
                active ? "bg-brand/10 text-brand border-brand/25" : "text-ink2 border-line hover:bg-elev/60"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      {err && <div className="text-sm text-danger">{err}</div>}

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPI
          label="Calls"
          value={(data?.totals.total ?? 0).toLocaleString()}
          sub={selectedName}
          icon={<Phone size={18} />}
        />
        <KPI
          label="Connected"
          value={(data?.totals.connected ?? 0).toLocaleString()}
          sub="answered / pressed 1"
          icon={<PhoneCall size={18} />}
          tone="ok"
        />
        <KPI
          label="Total charged"
          value={fmtMoney(data?.totals.charge ?? 0, currency)}
          sub="connected × per-call rate"
          icon={<Wallet size={18} />}
          tone="accent"
        />
      </div>

      <Card
        title="Callers"
        description="Every number dialed in the range — per client, with the amount charged per connected call"
        action={
          <button
            onClick={exportCsv}
            disabled={!data?.rows.length}
            className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev disabled:opacity-40"
          >
            <Download size={13} /> Export CSV
          </button>
        }
      >
        {!data ? (
          <div className="flex items-center gap-2 text-muted text-sm py-6 justify-center">
            <Spinner size={16} /> Loading…
          </div>
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={<Phone size={20} />}
            title="No calls in this range"
            description="Adjust the client, date range, or outcome filter."
          />
        ) : (
          <>
            <div className="overflow-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                    <th className="font-medium py-2 px-2">Caller</th>
                    {client === "all" && <th className="font-medium px-2">Client</th>}
                    <th className="font-medium px-2">Campaign</th>
                    <th className="font-medium px-2">Outcome</th>
                    <th className="font-medium px-2 text-right">Duration</th>
                    <th className="font-medium px-2 text-right">Charge</th>
                    <th className="font-medium px-2 text-right">Time (IST)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r, i) => {
                    const meta = OUTCOME_META[r.outcome] || { label: r.outcome, tone: "muted" as const };
                    return (
                      <tr key={`${r.to}-${r.triggeredAt}-${i}`} className="border-t border-line hover:bg-elev/40">
                        <td className="py-2 px-2 font-mono text-ink2 whitespace-nowrap">{r.to}</td>
                        {client === "all" && (
                          <td className="px-2 text-ink2 max-w-[160px] truncate">{r.clientName}</td>
                        )}
                        <td className="px-2 text-muted max-w-[160px] truncate">{r.campaignName || "—"}</td>
                        <td className="px-2">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className="px-2 text-right tabular-nums text-ink2">{fmtDuration(r.durationSec)}</td>
                        <td className={`px-2 text-right tabular-nums ${r.charge > 0 ? "text-danger" : "text-muted"}`}>
                          {r.charge > 0 ? `−${fmtMoney(r.charge, currency)}` : "—"}
                        </td>
                        <td className="px-2 text-right text-muted whitespace-nowrap text-xs">{fmtTime(r.triggeredAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {data.capped && (
              <p className="text-xs text-muted mt-3">
                Showing the most recent 2000 calls. Narrow the date range or pick a client to see more.
              </p>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}
