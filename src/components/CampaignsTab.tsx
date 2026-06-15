"use client";

import { useState } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Megaphone,
  Music,
  Globe,
  Phone,
  Copy,
  PhoneCall,
  Calendar,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button, Card, Input, Label, Select, Textarea, Badge, EmptyState, Section, Modal, IconButton, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { Audio, Campaign } from "@/lib/models";

function isValidHttpsUrl(v: string) {
  if (!v.trim()) return true; // blank is allowed (falls back to env)
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function formatDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function CampaignsTab() {
  const { data: cdata, reload: reloadC } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const { data: adata } = useFetch<{ audios: Audio[] }>("/api/audios");
  const campaigns = cdata?.campaigns ?? [];
  const audios = adata?.audios ?? [];
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [clone, setClone] = useState<Campaign | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Campaign | null>(null);
  const [testFor, setTestFor] = useState<Campaign | null>(null);

  function startClone(c: Campaign) {
    // Prefill the create form with this campaign's values (new record).
    setClone({ ...c, id: "", name: `${c.name} (copy)`, createdAt: "" });
    setEditing(null);
    setCreating(false);
  }

  async function remove(c: Campaign) {
    try {
      await api(`/api/campaigns/${c.id}`, { method: "DELETE" });
      reloadC();
      toast("Campaign deleted", "ok");
    } catch (e: any) {
      toast(e.message || "Delete failed", "danger");
    } finally {
      setConfirmDelete(null);
    }
  }

  const editorOpen = creating || !!editing || !!clone;

  return (
    <Section>
      <div className="flex justify-end">
        <Button leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
          New campaign
        </Button>
      </div>

      {!campaigns.length ? (
        <Card>
          <EmptyState
            icon={<Megaphone size={20} />}
            title="No campaigns yet"
            description="A campaign bundles the audio, prompt, press-1 webhook, and from-number. Pick one when dialing."
            action={
              <Button leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
                Create campaign
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {campaigns.map((c) => {
            const a = audios.find((a) => a.id === c.audioId);
            const hasWebhook = !!c.webhookUrl;
            const created = formatDate(c.createdAt);
            return (
              <Card key={c.id} className="group hover:border-line2 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-8 h-8 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
                        <Megaphone size={14} />
                      </div>
                      <div className="font-medium truncate">{c.name}</div>
                    </div>
                    <div className="space-y-1 text-xs text-muted ml-10">
                      <div className="flex items-center gap-1.5">
                        <Music size={11} />
                        <span className="truncate">{a?.label || "Fallback day1.mp3"}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Globe size={11} />
                        <span className="truncate">
                          {hasWebhook ? "Custom Pabbly webhook" : "Default (env)"}
                        </span>
                        {hasWebhook && <Badge tone="accent" className="ml-0.5">override</Badge>}
                      </div>
                      {c.fromNumber && (
                        <div className="flex items-center gap-1.5">
                          <Phone size={11} />
                          <span className="font-mono">{c.fromNumber}</span>
                        </div>
                      )}
                      {created && (
                        <div className="flex items-center gap-1.5">
                          <Calendar size={11} />
                          <span>Created {created}</span>
                        </div>
                      )}
                    </div>
                    <div className="ml-10 mt-2.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        leftIcon={<PhoneCall size={12} />}
                        onClick={() => setTestFor(c)}
                      >
                        Test call
                      </Button>
                    </div>
                  </div>
                  <div className="opacity-60 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                    <IconButton icon={<Edit2 size={14} />} onClick={() => setEditing(c)} title="Edit" />
                    <IconButton icon={<Copy size={14} />} onClick={() => startClone(c)} title="Clone" />
                    <IconButton
                      icon={<Trash2 size={14} />}
                      variant="danger"
                      onClick={() => setConfirmDelete(c)}
                      title="Delete"
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {editorOpen && (
        <CampaignEditor
          audios={audios}
          initial={editing}
          cloneFrom={clone}
          onClose={() => {
            setCreating(false);
            setEditing(null);
            setClone(null);
          }}
          onSaved={() => {
            reloadC();
            setCreating(false);
            setEditing(null);
            setClone(null);
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          open
          onClose={() => setConfirmDelete(null)}
          title="Delete campaign"
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" leftIcon={<Trash2 size={14} />} onClick={() => remove(confirmDelete)}>
                Delete campaign
              </Button>
            </>
          }
        >
          <div className="text-sm text-ink2">
            Delete <span className="font-medium text-ink">{confirmDelete.name}</span>? This removes the
            campaign config (audio, prompt, webhook, from-number). Existing call records are kept. This
            cannot be undone.
          </div>
        </Modal>
      )}

      {testFor && (
        <TestCallModal campaign={testFor} onClose={() => setTestFor(null)} />
      )}
    </Section>
  );
}

function TestCallModal({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; status?: number; to?: string; callUuid?: string } | null>(null);

  const trimmed = to.trim();
  const canDial = trimmed.length >= 6 && !busy;

  async function placeTest() {
    if (!canDial) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ ok: boolean; status: number; to: string; callUuid: string }>("/api/call", {
        method: "POST",
        body: JSON.stringify({ phone: trimmed, campaignId: campaign.id, callerName: "Test" }),
      });
      setResult(r);
      toast(r.ok ? `Test call queued to ${r.to}` : `Plivo error ${r.status}`, r.ok ? "ok" : "danger");
    } catch (e: any) {
      setResult({ ok: false });
      toast(e.message || "Test call failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Test call — ${campaign.name}`}
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={placeTest} disabled={!canDial} loading={busy} leftIcon={<PhoneCall size={14} />}>
            {busy ? "Dialing…" : "Place test call"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label hint="India: auto-prefix +91">Phone to call</Label>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") placeTest(); }}
            placeholder="9876543210 or +14155551234"
            autoFocus
          />
          <div className="text-xs text-muted mt-1">
            Places one real call using this campaign&apos;s audio, prompt, and webhook.
          </div>
        </div>

        {result && (
          <div
            className={`flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
              result.ok ? "bg-ok/10 border-ok/25 text-ok" : "bg-danger/10 border-danger/25 text-danger"
            }`}
          >
            {result.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <XCircle size={16} className="mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <div className="font-medium">
                {result.ok ? "Queued at Plivo" : `Failed${result.status ? ` (${result.status})` : ""}`}
              </div>
              {result.ok && (
                <div className="text-xs font-mono text-ink2 mt-0.5 truncate">
                  {result.to} · {result.callUuid}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function CampaignEditor({
  initial,
  cloneFrom,
  audios,
  onClose,
  onSaved,
}: {
  initial: Campaign | null;
  cloneFrom: Campaign | null;
  audios: Audio[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // `initial` = editing an existing record; `cloneFrom` = prefilled new record.
  const seed = initial ?? cloneFrom;
  const [name, setName] = useState(seed?.name ?? "");
  const [audioId, setAudioId] = useState(seed?.audioId ?? "");
  const [prompt, setPrompt] = useState(seed?.prompt ?? "Press 1 to receive your WhatsApp message.");
  const [webhookUrl, setWebhookUrl] = useState(seed?.webhookUrl ?? "");
  const [fromNumber, setFromNumber] = useState(seed?.fromNumber ?? "");
  const [busy, setBusy] = useState(false);

  const webhookValid = isValidHttpsUrl(webhookUrl);
  const fromEmpty = !fromNumber.trim();
  const canSave = !!name.trim() && webhookValid;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const payload = { name, audioId: audioId || null, prompt, webhookUrl, fromNumber };
      if (initial) {
        await api(`/api/campaigns/${initial.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api("/api/campaigns", { method: "POST", body: JSON.stringify(payload) });
      }
      toast("Saved", "ok");
      onSaved();
    } catch (e: any) {
      toast(e.message || "Save failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? "Edit campaign" : cloneFrom ? "Clone campaign" : "New campaign"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave} loading={busy}>
            {initial ? "Save changes" : "Create campaign"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Day-1 outreach" />
        </div>
        <div>
          <Label hint={audios.length ? `${audios.length} available` : "Audios tab to add"}>Audio</Label>
          <Select value={audioId ?? ""} onChange={(e) => setAudioId(e.target.value)}>
            <option value="">— None (fallback day1.mp3) —</option>
            {audios.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label hint="optional">Press-1 webhook URL</Label>
          <Input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://connect.pabbly.com/..."
            className={!webhookValid ? "border-danger/60 focus:border-danger/60" : ""}
          />
          {webhookValid ? (
            <div className="text-xs text-muted mt-1">Blank = use PABBLY_WEBHOOK_URL env var.</div>
          ) : (
            <div className="text-xs text-danger mt-1 flex items-center gap-1">
              Must be a valid https:// URL.
            </div>
          )}
        </div>
        <div>
          <Label hint="optional">From number</Label>
          <Input
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            placeholder="+918031340818"
          />
          {fromEmpty && (
            <div className="text-xs text-warn mt-1">
              No from-number set — calls will use the PLIVO_FROM_NUMBER env default.
            </div>
          )}
        </div>
        <div>
          <Label>Prompt spoken after audio</Label>
          <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
