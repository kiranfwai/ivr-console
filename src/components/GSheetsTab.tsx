"use client";

import { useCallback, useEffect, useState } from "react";
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
  ChevronDown,
  ChevronUp,
  Edit2,
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
  toast,
} from "@/components/ui";
import { api } from "@/components/useData";
import type { GSheetConn, GSheetLead, LeadStatus, CallOutcome } from "@/lib/gsheets";

type Campaign = { id: string; name: string };

const STATUS_META: Record<LeadStatus, { label: string; tone: "ok" | "accent" | "warn" | "danger" | "muted" }> = {
  queued:  { label: "Queued",  tone: "accent" },
  calling: { label: "Calling", tone: "warn"   },
  called:  { label: "Called",  tone: "ok"     },
  failed:  { label: "Failed",  tone: "danger" },
};

const OUTCOME_META: Record<CallOutcome, { label: string; tone: "ok" | "accent" | "warn" | "danger" | "muted" }> = {
  connected:  { label: "Answered",     tone: "ok"     },
  press1:     { label: "Pressed 1",    tone: "accent" },
  busy:       { label: "Busy",         tone: "warn"   },
  "no-answer":{ label: "No Answer",    tone: "muted"  },
  rejected:   { label: "Invalid No.",  tone: "danger" },
  error:      { label: "Error",        tone: "danger" },
  failed:     { label: "Failed",       tone: "danger" },
};

function fmtHour(h: number) {
  const ampm = h >= 12 ? "PM" : "AM";
  const h12  = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Main tab component
// ---------------------------------------------------------------------------

export default function GSheetsTab() {
  const [connections, setConnections] = useState<GSheetConn[] | undefined>(undefined); // undefined = loading
  const [leads, setLeads]             = useState<GSheetLead[]>([]);
  const [campaigns, setCampaigns]     = useState<Campaign[]>([]);
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [polling, setPolling]         = useState(false);
  const [clearing, setClearing]       = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

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
    } catch { /* non-fatal */ }
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

  async function pollAll() {
    setPolling(true);
    try {
      const r = await api<{ ok: boolean; newRows: number; called: number; queued: number; flushed: number; error?: string }>(
        "/api/gsheets/poll", { method: "POST" },
      );
      if (r.error) toast(`Poll warning: ${r.error}`, "danger");
      else toast(`Polled — ${r.newRows} new row(s), ${r.called} called, ${r.queued} queued, ${r.flushed} flushed.`, "ok");
      await Promise.all([loadConnections(), loadLeads()]);
    } catch (e: any) {
      toast(e.message || "Poll failed", "danger");
    }
    setPolling(false);
  }

  async function clearAll() {
    if (!window.confirm("Clear ALL leads across all connections? This cannot be undone.\n\nRow-progress pointers are kept so no rows will be re-dialled.")) return;
    setClearing(true);
    try {
      await api("/api/gsheets/leads", { method: "DELETE" });
      toast("All leads cleared.", "info");
      setLeads([]);
      setSelectedIds(new Set());
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

  return (
    <Section>
      {/* Connection cards */}
      {connections.length === 0 && !showConnectForm ? (
        <Card
          title={
            <span className="flex items-center gap-2">
              <FileSpreadsheet size={16} className="text-brand" /> Sheet Auto-Dial
            </span>
          }
          description="Connect a Google Sheet to automatically dial leads within a calling window."
        >
          <Button
            leftIcon={<Plus size={14} />}
            onClick={() => setShowConnectForm(true)}
          >
            Connect a Google Sheet
          </Button>
        </Card>
      ) : (
        <>
          {connections.map((conn) => (
            <SheetConnectionCard
              key={conn.id}
              conn={conn}
              campaigns={campaigns}
              onRefresh={async () => {
                await Promise.all([loadConnections(), loadLeads()]);
              }}
            />
          ))}

          {/* New connection form */}
          {showConnectForm ? (
            <ConnectSheetForm
              campaigns={campaigns}
              onSaved={async () => {
                setShowConnectForm(false);
                await Promise.all([loadConnections(), loadLeads()]);
              }}
              onCancel={() => setShowConnectForm(false)}
            />
          ) : (
            <div className="flex">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Plus size={14} />}
                onClick={() => setShowConnectForm(true)}
              >
                Connect another sheet
              </Button>
            </div>
          )}
        </>
      )}

      {/* Lead Queue — shown only when at least one connection exists */}
      {connections.length > 0 && (
        <Card
          title={
            <span className="flex items-center gap-2">
              <Clock size={16} className="text-brand" /> Lead Queue
            </span>
          }
          description="Rows picked up from all connected sheets — called automatically within each connection's window, queued outside it."
          action={
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone="muted">{leads.length} total</Badge>
              {counts.queued  ? <Badge tone="accent">{counts.queued} queued</Badge>  : null}
              {counts.called  ? <Badge tone="ok">{counts.called} called</Badge>      : null}
              {counts.failed  ? <Badge tone="danger">{counts.failed} failed</Badge>  : null}
              <Button
                size="sm"
                variant="ghost"
                leftIcon={<RefreshCw size={13} />}
                onClick={pollAll}
                loading={polling}
              >
                Poll all
              </Button>
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="danger"
                  leftIcon={<Trash2 size={13} />}
                  onClick={deleteSelected}
                  loading={deletingSelected}
                >
                  Delete selected ({selectedIds.size})
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                leftIcon={<Trash2 size={13} />}
                onClick={clearAll}
                loading={clearing}
                disabled={leads.length === 0}
              >
                Clear all
              </Button>
            </div>
          }
        >
          {leads.length === 0 ? (
            <EmptyState
              icon={<FileSpreadsheet size={20} />}
              title="No leads yet"
              description="Click 'Poll all' or wait for the background sync to pick up new rows from your sheets."
            />
          ) : (
            <div className="overflow-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                    <th className="py-2 px-1 w-6">
                      <input
                        type="checkbox"
                        checked={allQueuedSelected}
                        disabled={queuedLeads.length === 0}
                        onChange={toggleSelectAllQueued}
                        title="Select all queued"
                        className="cursor-pointer accent-brand"
                      />
                    </th>
                    <th className="font-medium py-2 px-1">Name</th>
                    <th className="font-medium px-1">Phone</th>
                    <th className="font-medium px-1 hidden sm:table-cell">Connection</th>
                    <th className="font-medium px-1">Status</th>
                    <th className="font-medium px-1">Call Result</th>
                    <th className="font-medium px-1 hidden md:table-cell">Duration</th>
                    <th className="font-medium px-1 hidden md:table-cell">Called at</th>
                    <th className="font-medium px-1 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((lead) => (
                    <LeadRow
                      key={lead.id}
                      lead={lead}
                      conn={lead.connId ? connMap.get(lead.connId) : undefined}
                      campaigns={campaigns}
                      selected={selectedIds.has(lead.id)}
                      onToggleSelect={() => toggleSelect(lead.id)}
                      onCall={() => callLead(lead.id)}
                      onRemove={() => removeLead(lead.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Individual connection card
// ---------------------------------------------------------------------------

function SheetConnectionCard({
  conn,
  campaigns,
  onRefresh,
}: {
  conn: GSheetConn;
  campaigns: Campaign[];
  onRefresh: () => Promise<void>;
}) {
  const [editing, setEditing]   = useState(false);
  const [toggling, setToggling] = useState(false);
  const [polling, setPolling]   = useState(false);
  const [busy, setBusy]         = useState(false);

  const campaignName = campaigns.find((c) => c.id === conn.campaignId)?.name ?? conn.campaignId;

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
      const r = await api<{ ok: boolean; newRows: number; called: number; queued: number; flushed: number; error?: string }>(
        "/api/gsheets/poll",
        { method: "POST", body: JSON.stringify({ connId: conn.id }) },
      );
      if (r.error) toast(`Poll warning: ${r.error}`, "danger");
      else toast(`Polled — ${r.newRows} new row(s), ${r.called} called, ${r.queued} queued, ${r.flushed} flushed.`, "ok");
      await onRefresh();
    } catch (e: any) {
      toast(e.message || "Poll failed", "danger");
    }
    setPolling(false);
  }

  async function disconnect() {
    if (!window.confirm("Disconnect this sheet? All its lead records will be deleted.")) return;
    setBusy(true);
    try {
      await api(`/api/gsheets/config/${conn.id}`, { method: "DELETE" });
      toast("Sheet disconnected.", "info");
      await onRefresh();
    } catch (e: any) {
      toast(e.message || "Could not disconnect", "danger");
    }
    setBusy(false);
  }

  if (editing) {
    return (
      <ConnectSheetForm
        existing={conn}
        campaigns={campaigns}
        onSaved={async () => {
          setEditing(false);
          await onRefresh();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <CheckCircle2 size={16} className={conn.enabled ? "text-ok" : "text-muted"} />
          <span>Sheet connected</span>
          {conn.enabled ? (
            <Badge tone="ok">Active</Badge>
          ) : (
            <Badge tone="muted">Paused</Badge>
          )}
        </span>
      }
      description={`Polls every 5 min · Window: ${fmtHour(conn.callStartHour)} – ${fmtHour(conn.callEndHour)}`}
      action={
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<RefreshCw size={13} />}
            onClick={pollNow}
            loading={polling}
            disabled={!conn.enabled}
          >
            Poll
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Power size={13} />}
            onClick={toggleEnabled}
            loading={toggling}
          >
            {conn.enabled ? "Pause" : "Resume"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leftIcon={<Edit2 size={13} />}
            onClick={() => setEditing(true)}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="danger"
            leftIcon={<Link2Off size={13} />}
            onClick={disconnect}
            disabled={busy}
          >
            Disconnect
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <StatBox label="Sheet ID" value={conn.sheetId} />
        <StatBox label="Tab / Campaign" value={`${conn.tabName} → ${campaignName}`} />
        <StatBox label="Last synced" value={fmtTime(conn.lastSyncedAt)} />
        <StatBox label="Rows processed" value={String(conn.lastRow)} />
      </div>
      {conn.lastError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{conn.lastError}</span>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Connect / Edit form
// ---------------------------------------------------------------------------

function ConnectSheetForm({
  existing,
  campaigns,
  onSaved,
  onCancel,
}: {
  existing?: GSheetConn;
  campaigns: Campaign[];
  onSaved: () => Promise<void>;
  onCancel: () => void;
}) {
  const [sheetUrl, setSheetUrl]     = useState(existing ? `https://docs.google.com/spreadsheets/d/${existing.sheetId}` : "");
  const [tabName, setTabName]       = useState(existing?.tabName ?? "Sheet1");
  const [campaignId, setCampaignId] = useState(existing?.campaignId ?? "");
  const [startHour, setStartHour]   = useState(String(existing?.callStartHour ?? 9));
  const [endHour, setEndHour]       = useState(String(existing?.callEndHour ?? 21));
  const [busy, setBusy]             = useState(false);
  const [err, setErr]               = useState<string | null>(null);

  const HOURS = Array.from({ length: 25 }, (_, i) => i);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (existing) {
        // Edit existing connection
        await api(`/api/gsheets/config/${existing.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            sheetUrl,
            tabName:       tabName.trim() || "Sheet1",
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
            sheetUrl,
            tabName:       tabName.trim() || "Sheet1",
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
    <Card
      title={
        <span className="flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-brand" />
          {existing ? "Edit sheet connection" : "Connect a Google Sheet"}
        </span>
      }
      description="Paste your Google Sheet URL. The sheet must be shared as 'Anyone with the link can view'."
    >
      <div className="space-y-4 max-w-xl">
        {err && (
          <div className="text-sm text-danger flex items-center gap-1.5">
            <AlertCircle size={14} /> {err}
          </div>
        )}

        <div>
          <Label required>Google Sheet URL</Label>
          <Input
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
          />
          <p className="mt-1 text-xs text-muted">Paste the full URL — the Sheet ID is extracted automatically.</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label hint="optional">Tab name</Label>
            <Input
              value={tabName}
              onChange={(e) => setTabName(e.target.value)}
              placeholder="Sheet1"
            />
          </div>
          <div>
            <Label required>Campaign (IVR audio)</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Choose campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            {campaigns.length === 0 && (
              <p className="mt-1 text-xs text-warn">No campaigns yet — create one in the Campaigns tab first.</p>
            )}
          </div>
        </div>

        <div>
          <Label>Calling window</Label>
          <div className="flex items-center gap-3 mt-1">
            <Select value={startHour} onChange={(e) => setStartHour(e.target.value)} className="w-32">
              {HOURS.slice(0, 24).map((h) => (
                <option key={h} value={h}>{fmtHour(h)}</option>
              ))}
            </Select>
            <span className="text-muted text-sm">to</span>
            <Select value={endHour} onChange={(e) => setEndHour(e.target.value)} className="w-32">
              {HOURS.slice(1).map((h) => (
                <option key={h} value={h}>{fmtHour(h)}</option>
              ))}
            </Select>
          </div>
          <p className="mt-1 text-xs text-muted">
            Rows detected inside this window are called immediately. Outside it they are queued and called when the window opens.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={save}
            loading={busy}
            disabled={!sheetUrl.trim() || !campaignId}
            leftIcon={<CheckCircle2 size={14} />}
          >
            {existing ? "Save changes" : "Connect sheet"}
          </Button>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lead row
// ---------------------------------------------------------------------------

function LeadRow({
  lead,
  conn,
  campaigns,
  selected,
  onToggleSelect,
  onCall,
  onRemove,
}: {
  lead: GSheetLead;
  conn: GSheetConn | undefined;
  campaigns: Campaign[];
  selected: boolean;
  onToggleSelect: () => void;
  onCall: () => void;
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
    ? `${conn.tabName}`
    : lead.connId
      ? lead.connId.replace(/^legacy-/, "")
      : "—";

  return (
    <tr className={`border-t border-line hover:bg-elev/40 ${selected ? "bg-brand/5" : ""}`}>
      <td className="py-2 px-1 w-6">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="cursor-pointer accent-brand"
        />
      </td>
      <td className="py-2 px-1 font-medium truncate max-w-[120px]" title={lead.name ?? ""}>
        {lead.name || <span className="text-muted">—</span>}
      </td>
      <td className="px-1 font-mono tabular-nums text-xs whitespace-nowrap">{lead.phone}</td>
      <td className="px-1 text-xs text-muted truncate max-w-[120px] hidden sm:table-cell" title={connLabel}>
        {connLabel}
      </td>
      <td className="px-1">
        <div className="flex flex-col gap-0.5">
          <Badge tone={meta.tone}>{meta.label}</Badge>
          {lead.error && (
            <span className="text-[10px] text-danger truncate max-w-[120px]" title={lead.error}>
              {lead.error}
            </span>
          )}
        </div>
      </td>
      <td className="px-1">
        {lead.callOutcome ? (
          <div className="flex flex-col gap-0.5">
            <Badge tone={OUTCOME_META[lead.callOutcome]?.tone ?? "muted"}>
              {OUTCOME_META[lead.callOutcome]?.label ?? lead.callOutcome}
            </Badge>
            {lead.hangupCause && (
              <span className="text-[10px] text-muted truncate max-w-[120px]" title={lead.hangupCause}>
                {lead.hangupCause}
              </span>
            )}
          </div>
        ) : (
          <span className="text-muted text-xs">—</span>
        )}
      </td>
      <td className="px-1 text-xs text-muted tabular-nums whitespace-nowrap hidden md:table-cell">
        {lead.durationSec != null ? `${lead.durationSec}s` : "—"}
      </td>
      <td className="px-1 text-xs text-muted tabular-nums whitespace-nowrap hidden md:table-cell">
        {fmtTime(lead.calledAt)}
      </td>
      <td className="px-1 text-right">
        <div className="inline-flex items-center gap-1">
          {canCall && (
            <button
              onClick={handleCall}
              disabled={calling}
              className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-brand px-2 py-1 rounded-md hover:bg-elev disabled:opacity-50"
              title="Trigger call now"
            >
              {calling ? <Spinner size={12} /> : <Phone size={12} />}
              Call
            </button>
          )}
          <button
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-danger px-2 py-1 rounded-md hover:bg-elev"
            title="Remove from queue"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg/50 border border-line rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-sm font-medium text-ink truncate">{value}</div>
    </div>
  );
}
