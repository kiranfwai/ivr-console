"use client";

import { useEffect, useState } from "react";
import {
  Plus,
  Edit2,
  Trash2,
  Megaphone,
  Copy,
  PhoneCall,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Button, Card, Input, Label, Select, Textarea, Badge, EmptyState, Loading, Section, Modal,
  Tiles, Tile, DataPanel, DataTable, TH, TD, Kebab, ConfirmDialog, toast,
} from "./ui";
import { useFetch, api } from "./useData";
import type { Audio, Campaign } from "@/lib/models";

type WaTrigger = "answer" | "press1" | "always";

/** Anything unrecognised (or unset, on old campaigns) is the original press-1 behaviour. */
function toTrigger(v: unknown): WaTrigger {
  return v === "answer" || v === "always" ? v : "press1";
}

function isValidHttpsUrl(v: string) {
  if (!v.trim()) return true; // blank is allowed (falls back to env)
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A caller ID must reach Plivo in E.164. A bare "8031805258" is accepted by
 * Plivo's API only as a 400, and because this field is per-campaign that breaks
 * EVERY call on the campaign — which reads as "the whole system is down".
 * Blank is fine: it falls back to the account default.
 */
function fromNumberError(v: string): string | null {
  const raw = v.trim();
  if (!raw) return null;
  if (!/^\+/.test(raw)) {
    const digits = raw.replace(/\D+/g, "");
    if (digits.length === 10) {
      return `Missing the country code. Write it as +91${digits}.`;
    }
    return "Must start with + and the country code, e.g. +918031340818.";
  }
  if (!/^\+[1-9]\d{7,14}$/.test(raw.replace(/[\s-]/g, ""))) {
    return "That doesn't look like a valid number. Use the full E.164 form, e.g. +918031340818.";
  }
  return null;
}

function formatDate(iso?: string) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function CampaignsTab({ onCreated }: { onCreated?: (campaignId: string) => void }) {
  const { data: cdata, loading: loadingC, reload: reloadC } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
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
  const onAnswerCount = campaigns.filter((c) => c.whatsappTrigger === "answer").length;
  const alwaysCount = campaigns.filter((c) => c.whatsappTrigger === "always").length;
  const press1Count = campaigns.length - onAnswerCount - alwaysCount;
  const noFromCount = campaigns.filter((c) => !c.fromNumber).length;

  return (
    <Section>
      <div className="flex justify-end">
        <Button leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
          New campaign
        </Button>
      </div>

      {loadingC && !cdata ? (
        <Card>
          <Loading label="Loading campaigns…" />
        </Card>
      ) : !campaigns.length ? (
        <Card>
          <EmptyState
            icon={<Megaphone size={20} />}
            title="No campaigns yet"
            description="A campaign bundles the audio, prompt, WhatsApp trigger and from-number. Pick one when dialing."
            action={
              <Button leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
                Create campaign
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Tiles>
            <Tile label="Campaigns" value={campaigns.length} sub={`${audios.length} audio${audios.length === 1 ? "" : "s"} available`} />
            <Tile
              label="Message on answer"
              value={onAnswerCount}
              sub="everyone who picks up gets it"
            />
            <Tile
              label="Message everyone"
              value={alwaysCount}
              sub="sent when the call is placed"
            />
            <Tile
              label="Only on press 1"
              value={press1Count}
              sub={press1Count ? "nothing sent unless they press" : "none"}
              tone={press1Count ? "warn" : "muted"}
            />
            <Tile
              label="No caller ID set"
              value={noFromCount}
              sub={noFromCount ? "using the account default" : "all have their own"}
              tone={noFromCount ? "warn" : "muted"}
            />
          </Tiles>

          <DataPanel
            title="Your campaigns"
            meta={`${campaigns.length} total`}
            action={
              <Button size="sm" leftIcon={<Plus size={13} />} onClick={() => setCreating(true)}>
                New campaign
              </Button>
            }
          >
            <DataTable>
              <thead>
                <tr>
                  <th className={TH}>Campaign</th>
                  <th className={TH}>Audio</th>
                  <th className={TH}>WhatsApp message</th>
                  <th className={TH}>Caller ID</th>
                  <th className={TH}>Created</th>
                  <th className={`${TH} w-[52px]`} />
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => {
                  const a = audios.find((a) => a.id === c.audioId);
                  const created = formatDate(c.createdAt);
                  // Anything saved before this setting existed has no value and
                  // keeps the old press-1 behaviour until someone changes it.
                  const trigger = c.whatsappTrigger;
                  return (
                    <tr key={c.id} className="transition-colors hover:bg-white/[0.022]">
                      <td className={TD}>
                        <div className="font-semibold">{c.name}</div>
                        {c.webhookUrl && (
                          <div className="mt-0.5 text-[11.5px] text-muted">own Pabbly webhook</div>
                        )}
                      </td>
                      <td className={TD}>
                        {a ? (
                          <>
                            <span className="text-ink2">{a.label}</span>
                            {a.durationSec ? (
                              <div className="text-[11.5px] text-muted tabular-nums">
                                {Math.floor(a.durationSec / 60)}:{String(Math.round(a.durationSec % 60)).padStart(2, "0")}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <Badge tone="warn">No audio</Badge>
                        )}
                      </td>
                      <td className={TD}>
                        {/* The setting that decides whether a lead gets a message
                            at all. It was previously only visible by opening the
                            campaign one at a time. */}
                        {trigger === "always" ? (
                          <Badge tone="ok">Everyone, when the call is placed</Badge>
                        ) : trigger === "answer" ? (
                          <Badge tone="ok">As soon as they pick up</Badge>
                        ) : (
                          <Badge tone="warn">Only if they press 1</Badge>
                        )}
                      </td>
                      <td className={TD}>
                        {c.fromNumber ? (
                          <span className="font-mono text-[12.5px] tabular-nums">{c.fromNumber}</span>
                        ) : (
                          <Badge tone="muted">Account default</Badge>
                        )}
                      </td>
                      <td className={`${TD} whitespace-nowrap text-muted`}>{created ?? "—"}</td>
                      <td className={TD}>
                        <Kebab
                          items={[
                            { label: "Test call", icon: <PhoneCall size={13} />, onClick: () => setTestFor(c) },
                            { label: "Edit", icon: <Edit2 size={13} />, onClick: () => setEditing(c) },
                            { label: "Clone", icon: <Copy size={13} />, onClick: () => startClone(c) },
                            { label: "Delete", icon: <Trash2 size={13} />, danger: true, onClick: () => setConfirmDelete(c) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </DataPanel>
        </>
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
          onCreated={onCreated}
        />
      )}

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete campaign"
        confirmLabel="Delete campaign"
        body={
          <>
            Delete <span className="font-medium text-ink">{confirmDelete?.name}</span>? This removes the
            campaign config — audio, prompt, webhook, from-number. Calls already placed are kept and still
            appear in reports. This cannot be undone.
          </>
        }
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
      />

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
  onCreated,
}: {
  initial: Campaign | null;
  cloneFrom: Campaign | null;
  audios: Audio[];
  onClose: () => void;
  onSaved: () => void;
  onCreated?: (campaignId: string) => void;
}) {
  // `initial` = editing an existing record; `cloneFrom` = prefilled new record.
  const seed = initial ?? cloneFrom;
  const [name, setName] = useState(seed?.name ?? "");
  const [audioId, setAudioId] = useState(seed?.audioId ?? "");
  const [prompt, setPrompt] = useState(seed?.prompt ?? "Press 1 to receive your WhatsApp message.");
  const [webhookUrl, setWebhookUrl] = useState(seed?.webhookUrl ?? "");
  const [fromNumber, setFromNumber] = useState(seed?.fromNumber ?? "");
  // Call Ending Duration (seconds). The call auto-hangs-up after this long, so
  // the audio plays once and the line doesn't linger. Auto-filled from the linked
  // audio's detected length (+ a small buffer) but editable.
  const CALL_END_BUFFER_SEC = 5;
  const [callEndSec, setCallEndSec] = useState(seed?.callEndSec ? String(seed.callEndSec) : "");
  // Once the user types their own value we stop auto-overwriting it from the audio.
  const [callEndTouched, setCallEndTouched] = useState(!!seed?.callEndSec);
  // What sends the WhatsApp message. New campaigns send on answer; a campaign
  // saved before this setting existed has no value and keeps the press-1
  // behaviour until someone changes it here.
  const [whatsappTrigger, setWhatsappTrigger] = useState<WaTrigger>(
    seed ? toTrigger(seed.whatsappTrigger) : "answer",
  );
  const [busy, setBusy] = useState(false);

  const selectedAudio = audios.find((a) => a.id === audioId) ?? null;
  const audioDuration = selectedAudio?.durationSec;

  // Auto-suggest the call-ending duration from the selected audio's length,
  // unless the user has already entered one manually.
  useEffect(() => {
    if (callEndTouched) return;
    if (audioDuration && audioDuration > 0) {
      setCallEndSec(String(Math.round(audioDuration) + CALL_END_BUFFER_SEC));
    }
  }, [audioDuration, callEndTouched]);

  const webhookValid = isValidHttpsUrl(webhookUrl);
  const fromEmpty = !fromNumber.trim();
  const fromErr = fromNumberError(fromNumber);
  // FEATURE 5: require a name AND a selected audio (plus a valid webhook).
  const nameValid = !!name.trim();
  const audioValid = !!audioId;
  const canSave = nameValid && audioValid && webhookValid && !fromErr;

  async function save() {
    if (!canSave) return;
    setBusy(true);
    try {
      const payload = {
        name,
        audioId: audioId || null,
        prompt,
        webhookUrl,
        fromNumber,
        callEndSec: callEndSec.trim() ? Number(callEndSec) : null,
        whatsappTrigger,
      };
      if (initial) {
        await api(`/api/campaigns/${initial.id}`, { method: "PATCH", body: JSON.stringify(payload) });
        toast("Saved", "ok");
        onSaved();
      } else {
        const res = await api<{ campaign: Campaign }>("/api/campaigns", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast("Campaign created", "ok");
        onSaved();
        // Jump to Bulk with this campaign pre-selected (FEATURE 5).
        onCreated?.(res.campaign.id);
      }
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
          <Label hint={audios.length ? `${audios.length} available` : "add one in the Audios tab"}>Audio</Label>
          <Select value={audioId ?? ""} onChange={(e) => setAudioId(e.target.value)}>
            <option value="">— Select an audio —</option>
            {audios.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </Select>
          {!audioValid && (
            <div className="text-xs text-danger mt-1">
              {audios.length ? "Select an audio for this campaign." : "No audios yet — add one in the Audios tab first."}
            </div>
          )}
        </div>
        <div>
          <Label>Send the WhatsApp message</Label>
          <Select
            value={whatsappTrigger}
            onChange={(e) => setWhatsappTrigger(toTrigger(e.target.value))}
          >
            <option value="answer">As soon as they pick up</option>
            <option value="press1">Only if they press 1</option>
            <option value="always">Everyone, when the call is placed (no conditions)</option>
          </Select>
          <div className="text-xs text-muted mt-1">
            {whatsappTrigger === "always"
              ? "Every lead gets the WhatsApp + email the moment their call is placed — answered, busy, no answer, failed, DND or low balance alike. Pickup and press 1 are still counted but send nothing more, and a lead is never messaged twice."
              : whatsappTrigger === "answer"
              ? "Everyone who answers gets the message. Press 1 still works and is still counted — it just isn't what sends it, and nobody gets two messages."
              : "Only leads who press 1 get the message. Anyone who answers and doesn't press gets nothing."}
          </div>
        </div>
        <div>
          <Label>Prompt spoken after audio</Label>
          <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>

        {/* The three fields below are wiring, not settings: leave every one of
            them blank and the campaign uses the account defaults. They used to
            sit in the middle of this form looking as important as the name,
            which had clients believing they'd skipped a step. Collapsed, not
            removed — every client still has them, one click down. */}
        <details className="group rounded-xl border border-dashed border-brand/30 bg-brand/[0.035] px-3.5 py-3 open:bg-brand/[0.05]">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-ink2 marker:content-['']">
            <span className="text-brand transition-transform group-open:rotate-90">&#9656;</span>
            <b className="font-semibold text-ink">Advanced</b>
            <span className="ml-auto text-right text-[11px] leading-tight text-muted">
              call ending duration &middot; webhook URL &middot; from number
              <br />
              leave blank and your account defaults are used
            </span>
          </summary>
          <div className="mt-4 space-y-4">
        <div>
          <Label hint={audioDuration ? `audio is ${audioDuration}s` : "auto-filled from audio"}>
            Call ending duration (seconds)
          </Label>
          <Input
            type="number"
            min={5}
            value={callEndSec}
            onChange={(e) => {
              setCallEndTouched(true);
              setCallEndSec(e.target.value);
            }}
            placeholder="auto"
          />
          <div className="text-xs text-muted mt-1">
            The call hangs up automatically after this many seconds, so the audio plays once and the line
            doesn&apos;t stay connected. Auto-filled from the audio length; adjust if needed.
            {!audioDuration && selectedAudio && (
              <span className="text-warn"> This audio has no detected length — re-add it in the Audios tab to auto-fill, or set a value here.</span>
            )}
          </div>
        </div>
        <div>
          <Label hint="optional">WhatsApp webhook URL</Label>
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
            className={fromErr ? "border-danger/60 focus:border-danger/60" : ""}
          />
          {fromErr ? (
            <div className="text-xs text-danger mt-1">{fromErr}</div>
          ) : fromEmpty ? (
            <div className="text-xs text-warn mt-1">
              No from-number set — calls will use the account default.
            </div>
          ) : null}
        </div>
          </div>
        </details>
      </div>
    </Modal>
  );
}
