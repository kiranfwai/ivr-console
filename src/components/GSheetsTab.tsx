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
  ChevronDown,
  ChevronUp,
  Power,
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
import type { GSheetConfig, GSheetLead, LeadStatus, CallOutcome } from "@/lib/gsheets";

// Re-export types needed in this file (gsheets.ts is server-only so we only use the types).
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

export default function GSheetsTab() {
  const [config, setConfig]     = useState<GSheetConfig | null | undefined>(undefined); // undefined = loading
  const [leads, setLeads]       = useState<GSheetLead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [polling, setPolling]   = useState(false);
  const [clearing, setClearing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const d = await api<{ config: GSheetConfig | null }>("/api/gsheets/config");
      setConfig(d.config);
    } catch {
      setConfig(null);
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
    loadConfig();
    loadLeads();
    loadCampaigns();
    // Retry campaigns once after a short delay in case the first request hit a
    // transient DB connection error (e.g. 53300 too_many_connections on startup).
    const t = setTimeout(() => void loadCampaigns(), 3000);
    return () => clearTimeout(t);
  }, [loadConfig, loadLeads, loadCampaigns]);

  // Auto-refresh leads every 10s so call outcomes (Answered / Busy / No Answer)
  // appear without a manual reload after Plivo fires the hangup webhook.
  useEffect(() => {
    const interval = setInterval(() => void loadLeads(), 10_000);
    return () => clearInterval(interval);
  }, [loadLeads]);

  async function pollNow() {
    setPolling(true);
    try {
      const r = await api<{ ok: boolean; newRows: number; called: number; queued: number; flushed: number; error?: string }>(
        "/api/gsheets/poll", { method: "POST" },
      );
      if (r.error) {
        toast(`Poll error: ${r.error}`, "danger");
      } else {
        toast(
          `Polled — ${r.newRows} new row(s), ${r.called} called, ${r.queued} queued, ${r.flushed} flushed.`,
          "ok",
        );
      }
      await Promise.all([loadConfig(), loadLeads()]);
    } catch (e: any) {
      toast(e.message || "Poll failed", "danger");
    }
    setPolling(false);
  }

  async function clearAll() {
    if (!window.confirm("Clear all leads from the queue? This cannot be undone.\n\nNote: already-processed row progress is kept so no rows will be re-dialled.")) return;
    setClearing(true);
    try {
      await api("/api/gsheets/leads", { method: "DELETE" });
      toast("Queue cleared.", "info");
      setLeads([]);
    } catch (e: any) {
      toast(e.message || "Could not clear", "danger");
    }
    setClearing(false);
  }

  async function callLead(id: number) {
    try {
      const r = await api<{ ok: boolean; error?: string }>(
        `/api/gsheets/leads/${id}/call`, { method: "POST" },
      );
      if (r.ok) {
        toast("Call triggered.", "ok");
      } else {
        toast(r.error || "Call failed", "danger");
      }
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
    if (allQueuedSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(queuedLeads.map((l) => l.id)));
    }
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

  if (config === undefined) {
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

  return (
    <Section>
      <SheetConfigCard
        config={config}
        campaigns={campaigns}
        onSaved={async () => { await loadConfig(); await loadLeads(); }}
      />

      {config && (
        <>
          <StatusCard config={config} counts={counts} />

          <Card
            title={
              <span className="flex items-center gap-2">
                <Clock size={16} className="text-brand" /> Lead Queue
              </span>
            }
            description="Rows picked up from the sheet — calls triggered automatically within the window, queued outside it."
            action={
              <div className="flex items-center gap-2 flex-wrap">
                <Badge tone="muted">{leads.length} total</Badge>
                {counts.queued  ? <Badge tone="accent">{counts.queued} queued</Badge>   : null}
                {counts.called  ? <Badge tone="ok">{counts.called} called</Badge>       : null}
                {counts.failed  ? <Badge tone="danger">{counts.failed} failed</Badge>   : null}
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={<RefreshCw size={13} />}
                  onClick={pollNow}
                  loading={polling}
                  disabled={!config.enabled}
                >
                  Poll now
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
                description="Click 'Poll now' or wait for the background sync to pick up new rows from your sheet."
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
                      <th className="font-medium px-1 hidden sm:table-cell">Email</th>
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
        </>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LeadRow({
  lead,
  selected,
  onToggleSelect,
  onCall,
  onRemove,
}: {
  lead: GSheetLead;
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
      <td className="px-1 text-ink2 text-xs truncate max-w-[140px] hidden sm:table-cell" title={lead.email ?? ""}>
        {lead.email || "—"}
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

function StatusCard({ config, counts }: { config: GSheetConfig; counts: Record<string, number> }) {
  return (
    <Card
      title="Sync status"
      description={`Polls every 5 minutes · Calling window: ${fmtHour(config.callStartHour)} – ${fmtHour(config.callEndHour)}`}
    >
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <StatBox label="Last synced" value={config.lastSyncedAt ? fmtTime(config.lastSyncedAt) : "Never"} />
        <StatBox label="Rows processed" value={String(config.lastRow)} />
        <StatBox label="Queued" value={String(counts.queued ?? 0)} />
        <StatBox label="Called" value={String(counts.called ?? 0)} />
      </div>
      {config.lastError && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{config.lastError}</span>
        </div>
      )}
    </Card>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg/50 border border-line rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="text-sm font-medium text-ink truncate">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sheet config card — connect / edit / disconnect
// ---------------------------------------------------------------------------

function SheetConfigCard({
  config,
  campaigns,
  onSaved,
}: {
  config: GSheetConfig | null;
  campaigns: Campaign[];
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(!config);
  const [sheetUrl, setSheetUrl]       = useState(config ? `https://docs.google.com/spreadsheets/d/${config.sheetId}` : "");
  const [tabName, setTabName]         = useState(config?.tabName ?? "Sheet1");
  const [campaignId, setCampaignId]   = useState(config?.campaignId ?? "");
  const [startHour, setStartHour]     = useState(String(config?.callStartHour ?? 9));
  const [endHour, setEndHour]         = useState(String(config?.callEndHour ?? 21));
  const [busy, setBusy]               = useState(false);
  const [toggling, setToggling]       = useState(false);
  const [err, setErr]                 = useState<string | null>(null);

  // Sync form when config changes from outside
  useEffect(() => {
    if (config) {
      setSheetUrl(`https://docs.google.com/spreadsheets/d/${config.sheetId}`);
      setTabName(config.tabName);
      setCampaignId(config.campaignId);
      setStartHour(String(config.callStartHour));
      setEndHour(String(config.callEndHour));
    }
    if (!config) setEditing(true);
  }, [config]);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
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
      setEditing(false);
      await onSaved();
    } catch (e: any) {
      setErr(e.message || "Save failed");
    }
    setBusy(false);
  }

  async function disconnect() {
    if (!window.confirm("Disconnect this sheet? All lead records will be deleted.")) return;
    setBusy(true);
    try {
      await api("/api/gsheets/config", { method: "DELETE" });
      toast("Sheet disconnected.", "info");
      await onSaved();
    } catch (e: any) {
      toast(e.message || "Could not disconnect", "danger");
    }
    setBusy(false);
  }

  async function toggleEnabled() {
    if (!config) return;
    setToggling(true);
    try {
      await api("/api/gsheets/config", {
        method: "PATCH",
        body: JSON.stringify({ enabled: !config.enabled }),
      });
      toast(config.enabled ? "Sync paused." : "Sync resumed.", "info");
      await onSaved();
    } catch (e: any) {
      toast(e.message || "Could not toggle", "danger");
    }
    setToggling(false);
  }

  // ---- Connected + not editing ----
  if (config && !editing) {
    const campaignName = campaigns.find((c) => c.id === config.campaignId)?.name ?? config.campaignId;
    return (
      <Card
        title={
          <span className="flex items-center gap-2">
            <CheckCircle2 size={16} className="text-ok" /> Sheet connected
            {!config.enabled && <Badge tone="muted">Paused</Badge>}
          </span>
        }
        description="New rows are detected automatically every 5 minutes and called within your window."
        action={
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<Power size={13} />}
              onClick={toggleEnabled}
              loading={toggling}
            >
              {config.enabled ? "Pause" : "Resume"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <StatBox label="Sheet ID" value={config.sheetId} />
          <StatBox label="Tab / Campaign" value={`${config.tabName} → ${campaignName}`} />
          <StatBox label="Calling window" value={`${fmtHour(config.callStartHour)} – ${fmtHour(config.callEndHour)}`} />
        </div>
      </Card>
    );
  }

  // ---- Connect / Edit form ----
  const HOURS = Array.from({ length: 25 }, (_, i) => i);

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <FileSpreadsheet size={16} className="text-brand" />
          {config ? "Edit sheet connection" : "Connect a Google Sheet"}
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
            Rows detected inside this window are called immediately. Outside it they're queued and called at the next window open.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={save}
            loading={busy}
            disabled={!sheetUrl.trim() || !campaignId}
            leftIcon={<CheckCircle2 size={14} />}
          >
            {config ? "Save changes" : "Connect sheet"}
          </Button>
          {config && (
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
