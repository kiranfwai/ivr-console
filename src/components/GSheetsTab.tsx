"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileSpreadsheet,
  RefreshCw,
  Phone,
  Trash2,
  Link2Off,
  CheckCircle2,
  Clock,
  AlertCircle,
  Power,
  Plus,
  Edit2,
  BarChart3,
  ExternalLink,
  X,
  Search,
} from "lucide-react";
import {
  Button,
  Card,
  Section,
  Input,
  Label,
  Select,
  Badge,
  Spinner,
  EmptyState,
  Loading,
  DataPanel,
  DataTable,
  TH,
  TD,
  Kebab,
  ConfirmDialog,
  IconButton,
  toast,
} from "@/components/ui";
import { api } from "@/components/useData";
import type { GSheetConn, GSheetLead, LeadStatus, CallOutcome } from "@/lib/gsheets";
import { describeTab, extractSheetTarget } from "@/lib/gsheet-tab";
import { fmtDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import SheetReportPanel from "./SheetReportPanel";
import { CheckBox } from "./ReportsTabUi";

/** Reply from /api/gsheets/preview — what one tab holds, before anything is saved. */
interface SheetPreview {
  ok: boolean;
  tab: { name: string; gid: string | null };
  rows: number;
  usable: number;
  invalid: number;
  blank: number;
  duplicates: number;
  header: string[];
  error: string | null;
}

type Campaign = { id: string; name: string };
type Tone = "ok" | "accent" | "warn" | "danger" | "muted" | "info";

const STATUS_META: Record<LeadStatus, { label: string; tone: Tone }> = {
  queued:  { label: "Queued",  tone: "muted"  },
  calling: { label: "Calling", tone: "accent" },
  called:  { label: "Called",  tone: "ok"     },
  failed:  { label: "Failed",  tone: "danger" },
};

const OUTCOME_META: Record<CallOutcome, { label: string; tone: Tone }> = {
  connected:  { label: "Answered",       tone: "ok"     },
  press1:     { label: "Pressed 1",      tone: "ok"     },
  busy:       { label: "Busy",           tone: "warn"   },
  "no-answer":{ label: "No answer",      tone: "muted"  },
  rejected:   { label: "Invalid number", tone: "danger" },
  error:      { label: "Error",          tone: "danger" },
  failed:     { label: "Failed",         tone: "danger" },
};

type StatusFilter = "all" | LeadStatus;

function fmtHour(h: number) {
  const ampm = h >= 12 ? "pm" : "am";
  const h12  = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

function fmtTime(iso: string | null) {
  return fmtDateTime(iso, { short: true });
}

/** "just now", "4 min ago", "3 h ago", else the date. */
function ago(iso: string | null): string {
  if (!iso) return "Never";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "—";
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return fmtTime(iso);
}

function sheetHref(conn: GSheetConn) {
  return `https://docs.google.com/spreadsheets/d/${conn.sheetId}${conn.gid ? `/edit#gid=${conn.gid}` : ""}`;
}

type PollReply = { ok: boolean; newRows: number; called: number; queued: number; flushed: number; error?: string };

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export default function GSheetsTab() {
  const [connections, setConnections] = useState<GSheetConn[] | undefined>(undefined); // undefined = loading
  const [leads, setLeads]             = useState<GSheetLead[]>([]);
  // Separate from `leads.length`, because an empty list before the first
  // response and an empty list after one mean opposite things to the reader.
  const [leadsLoaded, setLeadsLoaded]  = useState(false);
  const [campaigns, setCampaigns]     = useState<Campaign[]>([]);
  // The connect / edit drawer: null = closed, "new" = connect, else the connection being edited.
  const [drawer, setDrawer]           = useState<GSheetConn | "new" | null>(null);
  const [polling, setPolling]         = useState(false);
  const [clearing, setClearing]       = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [callingSelected, setCallingSelected] = useState(false);
  const [confirmCallSelected, setConfirmCallSelected] = useState(false);
  const [reportFor, setReportFor]     = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadConnections = useCallback(async () => {
    try {
      const d = await api<{ connections: GSheetConn[] }>("/api/gsheets/config");
      setConnections(d.connections ?? []);
    } catch {
      setConnections([]);
    }
  }, []);

  const loadLeads = useCallback(async () => {
    try {
      const d = await api<{ leads: GSheetLead[] }>("/api/gsheets/leads");
      setLeads(d.leads);
    } catch {
      /* non-fatal */
    } finally {
      // Marked loaded even on failure: the queue then reads as empty rather
      // than spinning forever, and the 10s refresh will correct it.
      setLeadsLoaded(true);
    }
  }, []);

  const loadCampaigns = useCallback(async () => {
    try {
      const d = await api<{ campaigns: Campaign[] }>("/api/campaigns");
      setCampaigns(Array.isArray(d.campaigns) ? d.campaigns : []);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    loadConnections();
    loadLeads();
    loadCampaigns();
    const t = setTimeout(() => void loadCampaigns(), 3000);
    return () => clearTimeout(t);
  }, [loadConnections, loadLeads, loadCampaigns]);

  // Auto-refresh leads every 10s so call outcomes appear without manual reload.
  useEffect(() => {
    const interval = setInterval(() => void loadLeads(), 10_000);
    return () => clearInterval(interval);
  }, [loadLeads]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadConnections(), loadLeads()]);
  }, [loadConnections, loadLeads]);

  async function pollAll() {
    setPolling(true);
    try {
      const r = await api<PollReply>("/api/gsheets/poll", { method: "POST" });
      if (r.error) toast(`Poll warning: ${r.error}`, "danger");
      else toast(`Checked — ${r.newRows} new row(s), ${r.called} called, ${r.queued} queued, ${r.flushed} flushed.`, "ok");
      await refreshAll();
    } catch (e: any) {
      toast(e.message || "Check failed", "danger");
    }
    setPolling(false);
  }

  async function clearAll() {
    setClearing(true);
    try {
      await api("/api/gsheets/leads", { method: "DELETE" });
      toast("All leads cleared.", "info");
      setLeads([]);
      setSelectedIds(new Set());
      setConfirmClear(false);
    } catch (e: any) {
      toast(e.message || "Could not clear", "danger");
    }
    setClearing(false);
  }

  async function callLead(id: number) {
    try {
      const r = await api<{ ok: boolean; error?: string }>(`/api/gsheets/leads/${id}/call`, { method: "POST" });
      if (r.ok) toast("Call triggered.", "ok");
      else toast(r.error || "Call failed", "danger");
      await loadLeads();
    } catch (e: any) {
      toast(e.message || "Error", "danger");
    }
  }

  async function removeLead(id: number) {
    try {
      await api(`/api/gsheets/leads/${id}`, { method: "DELETE" });
      setLeads((l) => l.filter((x) => x.id !== id));
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch (e: any) {
      toast(e.message || "Could not remove", "danger");
    }
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const queuedLeads = leads.filter((l) => l.status === "queued");
  const allQueuedSelected = queuedLeads.length > 0 && queuedLeads.every((l) => selectedIds.has(l.id));

  function toggleSelectAllQueued() {
    if (allQueuedSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(queuedLeads.map((l) => l.id)));
  }

  async function deleteSelected() {
    if (!selectedIds.size) return;
    setDeletingSelected(true);
    const ids = Array.from(selectedIds);
    try {
      for (const id of ids) {
        await api(`/api/gsheets/leads/${id}`, { method: "DELETE" });
      }
      setLeads((l) => l.filter((x) => !selectedIds.has(x.id)));
      setSelectedIds(new Set());
      toast(`${ids.length} lead(s) removed.`, "info");
    } catch (e: any) {
      toast(e.message || "Could not delete selected", "danger");
    }
    setDeletingSelected(false);
  }

  // Selected leads that can be called now (same rule as the per-row button).
  const callableSelected = leads.filter(
    (l) => selectedIds.has(l.id) && (l.status === "queued" || l.status === "failed"),
  );

  async function callSelected() {
    setCallingSelected(true);
    let ok = 0;
    let bad = 0;
    for (const l of callableSelected) {
      try {
        const r = await api<{ ok: boolean; error?: string }>(`/api/gsheets/leads/${l.id}/call`, { method: "POST" });
        if (r.ok) ok++;
        else bad++;
      } catch {
        bad++;
      }
    }
    toast(bad ? `${ok} call(s) triggered, ${bad} failed.` : `${ok} call(s) triggered.`, bad ? "danger" : "ok");
    setSelectedIds(new Set());
    setConfirmCallSelected(false);
    setCallingSelected(false);
    await loadLeads();
  }

  // Search + status + paging over the loaded queue (the server returns the newest 300).
  const [leadQuery, setLeadQuery] = useState("");
  const [leadPage, setLeadPage] = useState(0);
  const LEAD_PAGE = 50;
  const filteredLeads = useMemo(() => {
    const q = leadQuery.trim().toLowerCase();
    const byStatus = statusFilter === "all" ? leads : leads.filter((l) => l.status === statusFilter);
    if (!q) return byStatus;
    const qd = q.replace(/\D+/g, "");
    return byStatus.filter((l) =>
      (l.name || "").toLowerCase().includes(q) ||
      (qd && l.phone.replace(/\D+/g, "").includes(qd)));
  }, [leads, leadQuery, statusFilter]);
  const pageCount = Math.max(1, Math.ceil(filteredLeads.length / LEAD_PAGE));
  const page = Math.min(leadPage, pageCount - 1);
  const pageLeads = filteredLeads.slice(page * LEAD_PAGE, (page + 1) * LEAD_PAGE);
  const showNames = leads.some((l) => !!l.name);

  if (connections === undefined) {
    return (
      <div className="flex justify-center py-20 text-muted">
        <Spinner size={20} />
      </div>
    );
  }

  const counts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.status] = (acc[l.status] ?? 0) + 1;
    return acc;
  }, {});

  const connMap = new Map(connections.map((c) => [c.id, c]));
  const campaignName = (id: string) => campaigns.find((c) => c.id === id)?.name ?? id;
  const reportConn = reportFor ? connMap.get(reportFor) : undefined;
  const someSelected = selectedIds.size > 0;

  return (
    <Section>
      {/* Screen actions */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-muted">
          {connections.length
            ? `${connections.length} sheet${connections.length === 1 ? "" : "s"} connected · checked every 5 minutes`
            : "No sheets connected yet"}
        </span>
        <span className="flex-1" />
        {connections.length > 0 && (
          <Button variant="ghost" leftIcon={!polling && <RefreshCw size={14} />} onClick={pollAll} loading={polling}>
            Check now
          </Button>
        )}
        <Button leftIcon={<Plus size={14} />} onClick={() => setDrawer("new")}>
          Connect a sheet
        </Button>
      </div>

      {/* Connection cards */}
      {connections.length === 0 ? (
        <Card>
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="Connect your first Google Sheet"
            description="New rows in the sheet get called automatically, inside your calling window."
            action={
              <Button leftIcon={<Plus size={14} />} onClick={() => setDrawer("new")}>
                Connect a sheet
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {connections.map((conn) => (
            <SheetConnectionCard
              key={conn.id}
              conn={conn}
              campaignName={campaignName(conn.campaignId)}
              queued={leads.filter((l) => l.connId === conn.id && l.status === "queued").length}
              reporting={reportFor === conn.id}
              onReport={() => setReportFor((r) => (r === conn.id ? null : conn.id))}
              onEdit={() => setDrawer(conn)}
              onRefresh={refreshAll}
            />
          ))}
        </div>
      )}

      {reportConn && (
        <SheetReportPanel
          key={reportConn.id}
          conn={reportConn}
          campaignName={campaignName(reportConn.campaignId)}
          onClose={() => setReportFor(null)}
        />
      )}

      {/* Lead queue — shown only when at least one connection exists */}
      {connections.length > 0 && (
        <DataPanel
          title="Lead queue"
          meta={`Every row your sheets sent, and what happened to it.${leads.length >= 300 ? " Showing the newest 300." : ""}`}
          action={
            <>
              <div className="inline-flex flex-wrap gap-0.5 rounded-[10px] border border-line bg-ink/[0.04] p-[3px]">
                {(["all", "queued", "calling", "called", "failed"] as StatusFilter[]).map((s) => {
                  const n = s === "all" ? leads.length : counts[s] || 0;
                  const on = statusFilter === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setStatusFilter(s); setLeadPage(0); }}
                      className={`flex h-7 items-center gap-1.5 rounded-[7px] px-2.5 text-[13px] font-medium transition-colors ${
                        on ? "bg-panel text-ink shadow-xs" : "text-muted hover:text-ink"
                      }`}
                    >
                      {s === "all" ? "All" : STATUS_META[s].label}
                      {n > 0 && <span className="text-[11.5px] tabular-nums text-muted">{n}</span>}
                    </button>
                  );
                })}
              </div>
              <Button size="sm" variant="subtle" leftIcon={<Trash2 size={13} />} disabled={!leads.length} onClick={() => setConfirmClear(true)}>
                Clear all
              </Button>
            </>
          }
          footer={
            pageCount > 1 ? (
              <div className="flex items-center justify-between">
                <span>
                  Showing <b className="font-medium text-ink">{page * LEAD_PAGE + 1}–{Math.min(filteredLeads.length, (page + 1) * LEAD_PAGE)}</b> of {filteredLeads.length}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setLeadPage(page - 1)}>Previous</Button>
                  <Button size="sm" variant="ghost" disabled={page >= pageCount - 1} onClick={() => setLeadPage(page + 1)}>Next</Button>
                </div>
              </div>
            ) : undefined
          }
        >
          {!leadsLoaded ? (
            <Loading label="Loading the lead queue…" />
          ) : leads.length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet size={20} />}
              title="No leads yet"
              description="Press “Check now” or wait for the background check to pick up new rows from your sheets."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
                <div className="relative w-full max-w-xs">
                  <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <Input
                    value={leadQuery}
                    onChange={(e) => { setLeadQuery(e.target.value); setLeadPage(0); }}
                    placeholder={showNames ? "Search name or phone" : "Search phone"}
                    className="pl-8"
                  />
                </div>
                {(leadQuery || statusFilter !== "all") && (
                  <span className="text-xs text-muted">{filteredLeads.length} match{filteredLeads.length === 1 ? "" : "es"}</span>
                )}
              </div>

              {someSelected && (
                <div className="flex flex-wrap items-center gap-2.5 border-y border-accent/20 bg-accent/[0.06] px-5 py-2.5 text-[13px] font-medium text-accent">
                  <span>{selectedIds.size} selected</span>
                  <button type="button" className="text-xs font-normal text-muted hover:text-ink" onClick={() => setSelectedIds(new Set())}>
                    Clear selection
                  </button>
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="ghost"
                    leftIcon={<Phone size={13} />}
                    disabled={!callableSelected.length || callingSelected}
                    onClick={() => setConfirmCallSelected(true)}
                  >
                    Call now{callableSelected.length && callableSelected.length !== selectedIds.size ? ` (${callableSelected.length})` : ""}
                  </Button>
                  <Button size="sm" variant="danger" leftIcon={<Trash2 size={13} />} onClick={deleteSelected} loading={deletingSelected}>
                    Remove
                  </Button>
                </div>
              )}

              <DataTable>
                <thead>
                  <tr>
                    <th className={`${TH} w-11 pr-0`}>
                      <button
                        type="button"
                        onClick={toggleSelectAllQueued}
                        disabled={queuedLeads.length === 0}
                        title="Select all queued"
                        aria-label="Select all queued"
                        className="disabled:opacity-40"
                      >
                        <CheckBox on={allQueuedSelected} part={!allQueuedSelected && someSelected} />
                      </button>
                    </th>
                    <th className={TH}>Lead</th>
                    <th className={`${TH} hidden sm:table-cell`}>Sheet</th>
                    <th className={TH}>Status</th>
                    <th className={`${TH} hidden md:table-cell`}>Result</th>
                    <th className={`${TH} hidden md:table-cell`}>Called at</th>
                    <th className={`${TH} w-[130px]`} />
                  </tr>
                </thead>
                <tbody>
                  {pageLeads.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      conn={lead.connId ? connMap.get(lead.connId) : undefined}
                      selected={selectedIds.has(lead.id)}
                      onToggleSelect={() => toggleSelect(lead.id)}
                      onCall={() => callLead(lead.id)}
                      onRemove={() => removeLead(lead.id)}
                    />
                  ))}
                  {!pageLeads.length && (
                    <tr>
                      <td colSpan={7} className="px-5 py-8 text-center text-sm text-muted">No leads match.</td>
                    </tr>
                  )}
                </tbody>
              </DataTable>
            </>
          )}
        </DataPanel>
      )}

      {drawer && (
        <ConnectSheetDrawer
          existing={drawer === "new" ? undefined : drawer}
          campaigns={campaigns}
          onSaved={async () => {
            setDrawer(null);
            await refreshAll();
          }}
          onClose={() => setDrawer(null)}
        />
      )}

      <ConfirmDialog
        open={confirmClear}
        title="Clear all leads?"
        body={
          <>
            Every lead across all connections is removed from the queue. This cannot be undone.
            <div className="mt-2 text-muted">Row-progress pointers are kept, so no rows will be re-dialled.</div>
          </>
        }
        confirmLabel="Clear all"
        busy={clearing}
        onConfirm={clearAll}
        onClose={() => setConfirmClear(false)}
      />
      <ConfirmDialog
        open={confirmCallSelected}
        title={`Call ${callableSelected.length} lead${callableSelected.length === 1 ? "" : "s"} now?`}
        body="Each selected queued or failed lead is called right away, ahead of the queue. Numbers on your Do not disturb list are still skipped."
        confirmLabel="Call now"
        tone="primary"
        busy={callingSelected}
        onConfirm={callSelected}
        onClose={() => setConfirmCallSelected(false)}
      />
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Individual connection card
// ---------------------------------------------------------------------------

function SheetConnectionCard({
  conn,
  campaignName,
  queued,
  reporting,
  onReport,
  onEdit,
  onRefresh,
}: {
  conn: GSheetConn;
  campaignName: string;
  queued: number;
  reporting: boolean;
  onReport: () => void;
  onEdit: () => void;
  onRefresh: () => Promise<void>;
}) {
  const [toggling, setToggling] = useState(false);
  const [polling, setPolling]   = useState(false);
  const [busy, setBusy]         = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function toggleEnabled() {
    setToggling(true);
    try {
      await api(`/api/gsheets/config/${conn.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !conn.enabled }),
      });
      toast(conn.enabled ? "Sync paused." : "Sync resumed.", "info");
      await onRefresh();
    } catch (e: any) {
      toast(e.message || "Could not toggle", "danger");
    }
    setToggling(false);
  }

  async function pollNow() {
    setPolling(true);
    try {
      const r = await api<PollReply>(
        "/api/gsheets/poll",
        { method: "POST", body: JSON.stringify({ connId: conn.id }) },
      );
      if (r.error) toast(`Poll warning: ${r.error}`, "danger");
      else toast(`Checked — ${r.newRows} new row(s), ${r.called} called, ${r.queued} queued, ${r.flushed} flushed.`, "ok");
      await onRefresh();
    } catch (e: any) {
      toast(e.message || "Check failed", "danger");
    }
    setPolling(false);
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api(`/api/gsheets/config/${conn.id}`, { method: "DELETE" });
      toast("Sheet disconnected.", "info");
      setConfirmDisconnect(false);
      await onRefresh();
    } catch (e: any) {
      toast(e.message || "Could not disconnect", "danger");
    }
    setBusy(false);
  }

  const status = conn.lastError
    ? <Badge tone="danger" dot>Not syncing</Badge>
    : conn.enabled
      ? <Badge tone="ok" dot>Active</Badge>
      : <Badge tone="muted">Paused</Badge>;

  return (
    <div className={`flex flex-col rounded-xl border bg-panel px-5 py-[18px] shadow-card ${reporting ? "border-accent/40" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-ok/25 bg-ok/[0.09] text-ok">
          <FileSpreadsheet size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold tracking-[-0.01em]" title={conn.connName || undefined}>
            {conn.connName || "Sheet connected"}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-muted">Tab: {describeTab(conn)}</div>
        </div>
        {status}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="accent"><span className="max-w-[200px] truncate">{campaignName}</span></Badge>
        <Badge tone="muted">
          <Clock size={11} />
          {fmtHour(conn.callStartHour)}–{fmtHour(conn.callEndHour)}
        </Badge>
      </div>

      {conn.lastError && (
        <div className="mt-3 flex gap-2.5 rounded-[10px] border border-danger/25 bg-danger/[0.07] px-3 py-2.5 text-[13px] leading-snug text-danger">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{conn.lastError}</span>
        </div>
      )}

      <div className="mt-3.5 grid grid-cols-3 gap-2">
        <MiniTile label="Queued" value={String(queued)} />
        <MiniTile label="Rows read" value={conn.lastRow.toLocaleString("en-IN")} />
        <MiniTile label="Last check" value={ago(conn.lastSyncedAt)} small title={fmtTime(conn.lastSyncedAt)} />
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3.5">
        <a
          href={sheetHref(conn)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-line bg-panel px-2.5 text-[12.5px] font-semibold text-ink shadow-xs transition-colors hover:border-line2 hover:bg-elev"
        >
          <ExternalLink size={13} /> Open sheet
        </a>
        <Button size="sm" variant="ghost" leftIcon={!polling && <RefreshCw size={13} />} onClick={pollNow} loading={polling} disabled={!conn.enabled}>
          Check now
        </Button>
        <span className="flex-1" />
        <Kebab
          label="Sheet actions"
          items={[
            { label: reporting ? "Hide report" : "Sheet report", icon: <BarChart3 size={14} />, onClick: onReport },
            { label: toggling ? "Working…" : conn.enabled ? "Pause" : "Resume", icon: <Power size={14} />, onClick: () => { if (!toggling) void toggleEnabled(); } },
            { label: "Edit", icon: <Edit2 size={14} />, onClick: onEdit },
            { label: "Disconnect", icon: <Link2Off size={14} />, danger: true, onClick: () => setConfirmDisconnect(true) },
          ]}
        />
      </div>

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect this sheet?"
        body={<>“{conn.connName || describeTab(conn)}” stops being checked, and all its lead records are deleted.</>}
        confirmLabel="Disconnect"
        busy={busy}
        onConfirm={disconnect}
        onClose={() => setConfirmDisconnect(false)}
      />
    </div>
  );
}

function MiniTile({ label, value, small, title }: { label: string; value: string; small?: boolean; title?: string }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-line bg-elev/60 px-3 py-2" title={title}>
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 truncate font-semibold tabular-nums ${small ? "pt-1 text-[13px]" : "text-[19px] tracking-[-0.02em]"}`}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect / Edit drawer
// ---------------------------------------------------------------------------

function ConnectSheetDrawer({
  existing,
  campaigns,
  onSaved,
  onClose,
}: {
  existing?: GSheetConn;
  campaigns: Campaign[];
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const [connName, setConnName]     = useState(existing?.connName ?? "");
  const [sheetUrl, setSheetUrl]     = useState(
    existing
      ? `https://docs.google.com/spreadsheets/d/${existing.sheetId}` +
        (existing.gid ? `/edit#gid=${existing.gid}` : "")
      : "",
  );
  const [tabName, setTabName]       = useState(existing?.tabName ?? "Sheet1");
  // How this connection picks its tab. "gid" means the tab the pasted link was
  // open on — exact, and unaffected by the tab being renamed later. Existing
  // connections keep whatever they were saved with.
  const [tabMode, setTabMode]       = useState<"gid" | "name">(existing?.gid ? "gid" : "name");
  const [touchedMode, setTouchedMode] = useState(false);
  const [campaignId, setCampaignId] = useState(existing?.campaignId ?? "");
  const [startHour, setStartHour]   = useState(String(existing?.callStartHour ?? 9));
  const [endHour, setEndHour]       = useState(String(existing?.callEndHour ?? 21));
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState<string | null>(null);
  // "What is actually in this sheet?" — answered before saving, so a sheet with
  // no phone column, or the wrong tab, is caught here instead of by nobody being
  // called and no one noticing for a week.
  const [checking, setChecking]     = useState(false);
  const [preview, setPreview]       = useState<SheetPreview | null>(null);

  const HOURS = Array.from({ length: 25 }, (_, i) => i);

  // The very function the server parses the URL with, so the form can name the
  // tab it is about to dial before anything is saved.
  const urlGid = extractSheetTarget(sheetUrl).gid;

  // A pasted link that names a tab is almost always the tab they want, so pick
  // that up automatically — until they say otherwise, then leave their choice be.
  useEffect(() => {
    if (touchedMode) return;
    setTabMode(urlGid ? "gid" : "name");
  }, [urlGid, touchedMode]);

  // Escape closes (unless a save is in flight).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  function chooseMode(mode: "gid" | "name") {
    setTouchedMode(true);
    setTabMode(mode);
    setPreview(null);
  }

  async function checkSheet() {
    setChecking(true);
    setErr(null);
    try {
      const r = await api<SheetPreview>("/api/gsheets/preview", {
        method: "POST",
        body: JSON.stringify({ sheetUrl, tabName: tabName.trim() || "Sheet1", tabMode }),
      });
      setPreview(r);
    } catch (e: any) {
      setPreview(null);
      setErr(e.message || "Could not read that sheet");
    }
    setChecking(false);
  }

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (existing) {
        // Edit existing connection
        await api(`/api/gsheets/config/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            connName:      connName.trim() || null,
            sheetUrl,
            tabName:       tabName.trim() || "Sheet1",
            tabMode,
            campaignId,
            callStartHour: Number(startHour),
            callEndHour:   Number(endHour),
          }),
        });
        toast("Connection updated.", "ok");
      } else {
        // Create new connection
        await api("/api/gsheets/config", {
          method: "POST",
          body: JSON.stringify({
            connName:      connName.trim() || null,
            sheetUrl,
            tabName:       tabName.trim() || "Sheet1",
            tabMode,
            campaignId,
            callStartHour: Number(startHour),
            callEndHour:   Number(endHour),
          }),
        });
        toast("Sheet connected.", "ok");
      }
      await onSaved();
    } catch (e: any) {
      setErr(e.message || "Save failed");
    }
    setBusy(false);
  }

  return (
    <div className="fixed inset-0 z-40 animate-fade-in" role="dialog" aria-modal="true" aria-label={existing ? "Edit sheet connection" : "Connect a Google Sheet"}>
      <div className="absolute inset-0 bg-scrim/50 backdrop-blur-[3px]" onClick={() => !busy && onClose()} />
      <div className="absolute bottom-2.5 right-2.5 top-2.5 flex w-[min(580px,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop animate-slide-up">
        <div className="flex items-start gap-3 border-b border-line px-6 pb-[18px] pt-5">
          <div className="min-w-0 flex-1">
            <div className="text-[19px] font-semibold tracking-[-0.025em]">{existing ? "Edit sheet connection" : "Connect a Google Sheet"}</div>
            <div className="mt-0.5 text-[13px] text-muted">New rows will be called inside your calling window.</div>
          </div>
          <IconButton icon={<X size={16} />} onClick={onClose} disabled={busy} aria-label="Close" />
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {err && (
            <div className="flex items-start gap-2 rounded-[10px] border border-danger/25 bg-danger/[0.07] px-3 py-2.5 text-[13px] text-danger">
              <AlertCircle size={15} className="mt-0.5 shrink-0" /> {err}
            </div>
          )}

          <div>
            <Label required>Google Sheet link</Label>
            <Input
              value={sheetUrl}
              onChange={(e) => { setSheetUrl(e.target.value); setPreview(null); }}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              autoFocus
            />
            <p className="mt-1 text-xs text-muted">Share the sheet as “Anyone with the link can view”. Paste the full link — the sheet ID is read from it.</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={checkSheet} loading={checking} disabled={!sheetUrl.trim()} type="button">
                Check this sheet
              </Button>
              <span className="text-xs text-muted">Counts what is in the tab. Calls nobody.</span>
            </div>
            {preview && (
              <div className={`mt-2.5 rounded-[10px] border px-3 py-2.5 text-[13px] ${preview.error ? "border-danger/25 bg-danger/[0.06]" : "border-ok/25 bg-ok/[0.06]"}`}>
                {preview.error ? (
                  <>
                    <div className="text-danger">{preview.error}</div>
                    {preview.header.length > 0 && (
                      <div className="mt-1 text-xs text-muted">
                        Columns found: {preview.header.filter((h) => h.trim()).join(", ") || "none"}. One of them
                        must be named exactly <span className="font-mono">phone</span>, in the first row.
                      </div>
                    )}
                    {preview.rows > 0 && (
                      <div className="mt-1 text-xs text-muted">The tab has {preview.rows} row(s), so the tab itself is being read.</div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-ink">
                      <CheckCircle2 size={14} className="text-ok" />
                      {preview.rows} row(s), <span className="font-medium text-ok">{preview.usable} number(s) to call</span>
                    </div>
                    {(preview.invalid > 0 || preview.blank > 0 || preview.duplicates > 0) && (
                      <div className="mt-1 text-xs text-muted">
                        {preview.invalid > 0 && <>{preview.invalid} with an unreadable phone. </>}
                        {preview.blank > 0 && <>{preview.blank} with no phone at all. </>}
                        {preview.duplicates > 0 && <>{preview.duplicates} duplicate number(s) — each person is called once.</>}
                      </div>
                    )}
                    <div className="mt-1 text-xs text-muted">
                      Reading {preview.tab.gid ? `the tab from your link (gid ${preview.tab.gid})` : `the tab named “${preview.tab.name}”`}
                      {preview.header.length > 0 && <> · columns: {preview.header.filter((h) => h.trim()).join(", ")}</>}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Which tab to dial</Label>
              <div className="inline-flex gap-0.5 rounded-[10px] border border-line bg-ink/[0.04] p-[3px]">
                {([["gid", "From the link"], ["name", "By name"]] as const).map(([m, l]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => chooseMode(m)}
                    disabled={m === "gid" && !urlGid}
                    className={`h-7 rounded-[7px] px-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
                      tabMode === m ? "bg-panel text-ink shadow-xs" : "text-muted hover:text-ink"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              {tabMode === "name" ? (
                <>
                  <Input
                    className="mt-2"
                    value={tabName}
                    onChange={(e) => { setTabName(e.target.value); setPreview(null); }}
                    placeholder="Sheet1"
                  />
                  <p className="mt-1 text-xs text-muted">
                    Must match the tab name in Google exactly. Renaming the tab there breaks this connection.
                  </p>
                  {urlGid && (
                    <p className="mt-1 text-xs text-warn">
                      Your link points at a specific tab (gid {urlGid}), but this will read the tab named
                      “{tabName.trim() || "Sheet1"}” instead.
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs text-muted">
                  Reads the tab your link was open on (gid {urlGid}). Survives the tab being renamed.
                </p>
              )}
              {!urlGid && (
                <p className="mt-1 text-xs text-muted">
                  To pick the tab from the link instead, open that tab in Google Sheets and copy the URL from
                  the address bar — it ends in <span className="font-mono">#gid=…</span>
                </p>
              )}
            </div>
            <div>
              <Label hint="optional">Name</Label>
              <Input
                value={connName}
                onChange={(e) => setConnName(e.target.value)}
                placeholder="e.g. Evening leads"
              />
              <p className="mt-1 text-xs text-muted">Shown on the card and in call logs.</p>
            </div>
          </div>

          <div>
            <Label required>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} invalid={!campaignId}>
              <option value="">Choose campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            {campaigns.length === 0 && (
              <p className="mt-1 text-xs text-warn">No campaigns yet — create one in Campaigns first.</p>
            )}
          </div>

          <div>
            <Label>Calling window</Label>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
              <Select value={startHour} onChange={(e) => setStartHour(e.target.value)}>
                {HOURS.slice(0, 24).map((h) => (
                  <option key={h} value={h}>{fmtHour(h)}</option>
                ))}
              </Select>
              <span className="text-sm text-muted">to</span>
              <Select value={endHour} onChange={(e) => setEndHour(e.target.value)}>
                {HOURS.slice(1).map((h) => (
                  <option key={h} value={h}>{fmtHour(h)}</option>
                ))}
              </Select>
            </div>
            <p className="mt-1 text-xs text-muted">
              Rows found inside this window are called right away. Outside it they are queued and called when the window opens.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-line bg-elev/60 px-6 py-3.5">
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy} disabled={!sheetUrl.trim() || !campaignId}>
            {existing ? "Save changes" : "Connect sheet"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lead row
// ---------------------------------------------------------------------------

function LeadRow({
  lead,
  conn,
  selected,
  onToggleSelect,
  onCall,
  onRemove,
}: {
  lead: GSheetLead;
  conn: GSheetConn | undefined;
  selected: boolean;
  onToggleSelect: () => void;
  onCall: () => Promise<void>;
  onRemove: () => void;
}) {
  const [calling, setCalling] = useState(false);
  const meta = STATUS_META[lead.status] ?? { label: lead.status, tone: "muted" as const };
  const canCall = lead.status === "queued" || lead.status === "failed";

  async function handleCall() {
    setCalling(true);
    await onCall();
    setCalling(false);
  }

  const connLabel = conn
    ? (conn.connName || describeTab(conn))
    : lead.connId
      ? lead.connId.replace(/^legacy-/, "")
      : "—";

  const outcome = lead.callOutcome ? OUTCOME_META[lead.callOutcome] : null;

  return (
    <tr className={`transition-colors ${selected ? "bg-accent/[0.05]" : "hover:bg-ink/[0.025]"}`}>
      <td className={`${TD} w-11 pr-0`}>
        <button type="button" onClick={onToggleSelect} aria-label={selected ? "Deselect lead" : "Select lead"} aria-pressed={selected}>
          <CheckBox on={selected} />
        </button>
      </td>
      <td className={TD}>
        <div className="max-w-[180px] truncate font-medium" title={lead.name ?? ""}>
          {lead.name || <span className="font-normal tabular-nums">{formatPhone(lead.phone)}</span>}
        </div>
        {lead.name && <div className="text-xs tabular-nums text-muted">{formatPhone(lead.phone)}</div>}
      </td>
      <td className={`${TD} hidden max-w-[200px] truncate text-muted sm:table-cell`} title={connLabel}>
        {connLabel} · row {lead.rowIndex}
      </td>
      <td className={TD}>
        <Badge tone={meta.tone} dot={lead.status === "calling"}>{meta.label}</Badge>
        {lead.error && (
          <div className="mt-0.5 max-w-[160px] truncate text-[11px] text-danger" title={lead.error}>
            {lead.error}
          </div>
        )}
      </td>
      <td className={`${TD} hidden md:table-cell`}>
        {outcome ? (
          // The carrier's code (USER_BUSY, NORMAL_CLEARING…) stays in the tooltip
          // for support; the outcome label is what people read.
          <span title={lead.hangupCause || undefined} className="text-ink2">
            {outcome.label}
            {lead.durationSec != null && lead.durationSec > 0 && (
              <span className="tabular-nums text-muted"> · {Math.floor(lead.durationSec / 60)}:{String(lead.durationSec % 60).padStart(2, "0")}</span>
            )}
          </span>
        ) : (
          <span className="text-muted">—</span>
        )}
      </td>
      <td className={`${TD} hidden whitespace-nowrap tabular-nums text-muted md:table-cell`}>
        {fmtTime(lead.calledAt)}
      </td>
      <td className={TD}>
        <div className="flex items-center justify-end gap-1">
          {canCall && (
            <Button size="sm" variant="ghost" onClick={handleCall} loading={calling} leftIcon={!calling && <Phone size={12} />}>
              Call now
            </Button>
          )}
          {conn && (
            <a
              href={sheetHref(conn)}
              target="_blank"
              rel="noreferrer"
              title="Open in sheet"
              aria-label="Open in sheet"
              className="inline-flex rounded-[9px] p-1.5 text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink"
            >
              <ExternalLink size={14} />
            </a>
          )}
          <IconButton size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={onRemove} title="Remove from queue" />
        </div>
      </td>
    </tr>
  );
}
