"use client";
import { fmtDateTime } from "@/lib/format";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone, Download, Building2 } from "lucide-react";
import { Section, Badge, Button, Spinner, EmptyState, Loading, DataTable, TH, TD } from "../ui";
import { Seg, SearchBox, Panel } from "../AdminTabKit";
import { api } from "../useData";
import { fmtMoney, istToday, istDaysAgo } from "./money";
import { RangeControl } from "./shared";
import { formatPhone, isDiallablePhone, normalizePhone } from "@/lib/phone";

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
  return fmtDateTime(iso, { short: true });
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
  const [q, setQ] = useState("");

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

  // Phone search filters the rows already loaded (digits only, so spaces/+91 don't matter).
  const digits = q.replace(/\D/g, "");
  const shown = useMemo(
    () => (data ? (digits ? data.rows.filter((r) => r.to.replace(/\D/g, "").includes(digits)) : data.rows) : []),
    [data, digits],
  );

  return (
    <Section>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={q} onChange={setQ} placeholder="Search a phone number" className="w-full sm:w-[260px]" />
        <label className="relative flex h-[34px] items-center gap-2 rounded-[9px] border border-line bg-panel pl-2.5 pr-1 text-[13px] shadow-xs focus-within:border-accent focus-within:shadow-glow">
          <Building2 size={15} className="flex-none text-muted" />
          <select
            value={client}
            onChange={(e) => setClient(e.target.value)}
            className="h-full max-w-[200px] cursor-pointer bg-transparent pr-1 text-ink outline-none"
            aria-label="Client"
          >
            <option value="all">All clients</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name || c.email}
              </option>
            ))}
          </select>
        </label>
        <RangeControl from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        {loading && <Spinner size={16} />}
        <span className="flex-1" />
        <Button variant="ghost" leftIcon={<Download size={14} />} onClick={exportCsv} disabled={!data?.rows.length}>
          CSV
        </Button>
      </div>

      {err && <div className="text-sm text-danger">{err}</div>}

      <Panel
        title="Callers"
        sub={
          data
            ? `${selectedName} · ${data.totals.total.toLocaleString("en-IN")} calls · ${data.totals.connected.toLocaleString("en-IN")} connected · ${fmtMoney(data.totals.charge, currency)} charged`
            : "Every number dialled in the range"
        }
        right={
          <Seg
            value={status}
            onChange={setStatus}
            size="sm"
            options={STATUS_FILTERS}
          />
        }
      >
        {!data ? (
          <Loading label="Loading calls…" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<Phone size={20} />}
            title={data.rows.length === 0 ? "No calls in this range" : "No number matches"}
            description={
              data.rows.length === 0
                ? "Adjust the client, date range, or outcome filter."
                : "Check the digits, or clear the search."
            }
          />
        ) : (
          <>
            <DataTable>
              <thead>
                <tr>
                  <th className={TH}>Number</th>
                  {client === "all" && <th className={TH}>Client</th>}
                  <th className={`${TH} hidden md:table-cell`}>Campaign</th>
                  <th className={`${TH} hidden sm:table-cell`}>Called</th>
                  <th className={TH}>Outcome</th>
                  <th className={`${TH} hidden text-right sm:table-cell`}>Duration</th>
                  <th className={`${TH} text-right`}>Charge</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r, i) => {
                  const meta = OUTCOME_META[r.outcome] || { label: r.outcome, tone: "muted" as const };
                  return (
                    <tr key={`${r.to}-${r.triggeredAt}-${i}`} className="transition-colors hover:bg-elev">
                      <td className={`${TD} whitespace-nowrap font-semibold tabular-nums text-ink`}>
                        {formatPhone(r.to)}
                        {!isDiallablePhone(normalizePhone(r.to)) && (
                          <span className="ml-2 text-[11px] font-normal text-warn">invalid number</span>
                        )}
                      </td>
                      {client === "all" && <td className={`${TD} max-w-[180px] truncate text-ink2`}>{r.clientName}</td>}
                      <td className={`${TD} hidden max-w-[200px] truncate text-ink2 md:table-cell`}>{r.campaignName || "—"}</td>
                      <td className={`${TD} hidden whitespace-nowrap text-muted sm:table-cell`}>{fmtTime(r.triggeredAt)}</td>
                      <td className={TD}>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      {/* Talk time only means something on a connected call; on a
                          no-answer the carrier reports ring time, which read as a
                          36s "no answer". */}
                      <td className={`${TD} hidden text-right tabular-nums text-ink2 sm:table-cell`}>
                        {r.outcome === "connected" || r.outcome === "press1" ? fmtDuration(r.durationSec) : "—"}
                      </td>
                      <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>
                        {r.charge > 0 ? fmtMoney(r.charge, currency) : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
            {data.capped && (
              <p className="m-0 border-t border-line px-5 py-3 text-[12.5px] text-muted">
                The table lists the newest {data.rows.length.toLocaleString("en-IN")} of {data.totals.total.toLocaleString("en-IN")} calls —
                the totals above cover all of them. Narrow the date range or pick a client to list the rest.
              </p>
            )}
          </>
        )}
      </Panel>
    </Section>
  );
}
