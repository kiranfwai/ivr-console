"use client";
import { fmtDate } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

import { ReactNode, useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Megaphone,
  Copy,
  Phone,
  PhoneCall,
  CheckCircle2,
  XCircle,
  AudioLines,
  Pointer,
  MessageCircle,
  ChevronRight,
} from "lucide-react";
import {
  Button, Card, Input, Label, Select, Textarea, EmptyState, Loading, Section, Modal,
  DataTable, TH, TD, Kebab, ConfirmDialog, IconButton, toast,
} from "./ui";
import { useFetch, api } from "./useData";
import type { Audio, Campaign } from "@/lib/models";
import { Avatar, Drawer, Pager, PlayIcon, PlayRound, Seg, SearchField, WaveBars, fmtSec, seedOf } from "./CampaignsKit";

type WaTrigger = "answer" | "press1" | "always" | "never";
type Filter = "all" | WaTrigger;

/** Anything unrecognised (or unset, on old campaigns) is the original press-1 behaviour. */
function toTrigger(v: unknown): WaTrigger {
  return v === "answer" || v === "always" || v === "never" ? v : "press1";
}

/** Label, colour and short line for each WhatsApp setting — one place, used by the
 *  summary bar, the filter, the table pill and the drawer. */
const TRIG: Record<WaTrigger, { label: string; short: string; dot: string; pill: string; flow: string }> = {
  answer: {
    label: "When they pick up",
    short: "Pick up",
    dot: "bg-ok2",
    pill: "bg-ok/[0.09] text-ok border-ok/25",
    flow: "when they pick up",
  },
  always: {
    label: "Everyone, on dial",
    short: "Everyone",
    dot: "bg-brand2",
    pill: "bg-brand2/[0.09] text-brand2 border-brand2/25",
    flow: "as soon as it dials",
  },
  press1: {
    label: "Only on press 1",
    short: "Press 1",
    dot: "bg-warn2",
    pill: "bg-warn/[0.09] text-warn border-warn/25",
    flow: "only if they press 1",
  },
  never: {
    label: "Don’t send",
    short: "Don’t send",
    dot: "bg-muted",
    pill: "bg-elev text-muted border-line",
    flow: "not sent",
  },
};
const TRIG_ORDER: WaTrigger[] = ["answer", "always", "press1", "never"];

function TrigPill({ t }: { t: WaTrigger }) {
  return (
    <span className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-xs font-medium ${TRIG[t].pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${TRIG[t].dot}`} />
      {TRIG[t].label}
    </span>
  );
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
  return fmtDate(iso);
}

const PER_PAGE = 10;

export default function CampaignsTab({ onCreated }: { onCreated?: (campaignId: string) => void }) {
  const { data: cdata, loading: loadingC, reload: reloadC } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const { data: adata } = useFetch<{ audios: Audio[] }>("/api/audios");
  const campaigns = cdata?.campaigns ?? [];
  const audios = adata?.audios ?? [];
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);
  const [clone, setClone] = useState<Campaign | null>(null);
  // Search + filter + paging: one live account has 100+ campaigns.
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
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
  const counts: Record<WaTrigger, number> = { answer: 0, always: 0, press1: 0, never: 0 };
  campaigns.forEach((c) => counts[toTrigger(c.whatsappTrigger)]++);
  const noFromCount = campaigns.filter((c) => !c.fromNumber).length;
  const audiosInUse = new Set(campaigns.map((c) => c.audioId).filter(Boolean)).size;

  const audioOf = (c: Campaign) => audios.find((a) => a.id === c.audioId);
  const needle = q.trim().toLowerCase();
  const matching = campaigns.filter(
    (c) =>
      (filter === "all" || toTrigger(c.whatsappTrigger) === filter) &&
      (!needle || c.name.toLowerCase().includes(needle) || (audioOf(c)?.label || "").toLowerCase().includes(needle)),
  );
  const pages = Math.max(1, Math.ceil(matching.length / PER_PAGE));
  const pg = Math.min(page, pages - 1);
  const shown = matching.slice(pg * PER_PAGE, (pg + 1) * PER_PAGE);

  return (
    <Section>
      {loadingC && !cdata ? (
        <Card>
          <Loading label="Loading campaigns…" />
        </Card>
      ) : !campaigns.length ? (
        <Card>
          <EmptyState
            icon={<Megaphone size={20} />}
            title="No campaigns yet"
            description="A campaign bundles the audio, the prompt, when the WhatsApp goes out and which number calls. Pick one when dialling."
            action={
              <Button leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
                Create campaign
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* One summary card: how many, how they send WhatsApp, caller ID. */}
          <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-line bg-panel shadow-card lg:grid-cols-[220px_minmax(0,1fr)_240px]">
            <div className="px-[22px] py-[18px]">
              <div className="text-[13px] font-medium text-muted">Campaigns</div>
              <div className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] tabular-nums">{campaigns.length}</div>
              <div className="mt-1 text-[12.5px] text-muted">
                using {audiosInUse} audio{audiosInUse === 1 ? "" : "s"}
              </div>
            </div>
            <div className="border-t border-line px-[22px] py-[18px] lg:border-l lg:border-t-0">
              <div className="text-[13px] font-medium text-muted">How they send WhatsApp</div>
              <div className="mt-3.5 flex h-2.5 gap-[3px] overflow-hidden rounded-full bg-line/60">
                {TRIG_ORDER.filter((t) => counts[t] > 0).map((t) => (
                  <span key={t} className={`block h-full rounded-[3px] ${TRIG[t].dot}`} style={{ flex: counts[t] }} />
                ))}
              </div>
              <div className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {TRIG_ORDER.map((t) => (
                  <div key={t} className={`min-w-0 ${counts[t] ? "" : "opacity-50"}`}>
                    <div className="flex items-center gap-[7px] whitespace-nowrap text-[12.5px] text-muted">
                      <i className={`h-2 w-2 shrink-0 rounded-[2px] ${TRIG[t].dot}`} />
                      <span className="truncate">{TRIG[t].label}</span>
                    </div>
                    <b className="mt-0.5 block text-[18px] font-semibold tracking-[-0.03em] text-ink tabular-nums">{counts[t]}</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="border-t border-line px-[22px] py-[18px] lg:border-l lg:border-t-0">
              <div className="text-[13px] font-medium text-muted">Caller ID</div>
              {noFromCount ? (
                <>
                  <div className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em] tabular-nums">
                    {noFromCount}
                    <span className="text-sm font-medium tracking-normal text-muted"> of {campaigns.length}</span>
                  </div>
                  <div className="mt-1 text-[12.5px] text-muted">use the account default number</div>
                </>
              ) : (
                <>
                  <div className="mt-1.5 text-[28px] font-semibold leading-tight tracking-[-0.035em]">All set</div>
                  <div className="mt-1 text-[12.5px] text-ok">every campaign has its own number</div>
                </>
              )}
            </div>
          </div>

          <div className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card">
            <div className="flex flex-wrap items-center gap-2.5 px-5 py-4">
              <Seg<Filter>
                ariaLabel="Filter by WhatsApp setting"
                value={filter}
                onChange={(f) => {
                  setFilter(f);
                  setPage(0);
                }}
                options={[
                  { value: "all", label: "All", count: campaigns.length },
                  ...TRIG_ORDER.map((t) => ({ value: t, label: TRIG[t].short, count: counts[t], dot: TRIG[t].dot })),
                ]}
              />
              <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
                <SearchField
                  value={q}
                  onChange={(v) => {
                    setQ(v);
                    setPage(0);
                  }}
                  placeholder="Search name or audio"
                  className="min-w-0 flex-1 sm:w-[250px] sm:flex-none"
                />
                <Button leftIcon={<Plus size={14} />} onClick={() => setCreating(true)}>
                  New campaign
                </Button>
              </div>
            </div>
            <DataTable>
              <thead>
                <tr>
                  <th className={TH}>Campaign</th>
                  <th className={TH}>WhatsApp</th>
                  <th className={`${TH} hidden md:table-cell`}>Caller ID</th>
                  <th className={`${TH} hidden lg:table-cell`}>Created</th>
                  <th className={`${TH} w-[140px]`} />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => {
                  const a = audioOf(c);
                  const created = formatDate(c.createdAt);
                  const trigger = toTrigger(c.whatsappTrigger);
                  return (
                    <tr key={c.id} className="group transition-colors hover:bg-ink/[0.022]">
                      <td className={TD}>
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar name={c.name} />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-ink">{c.name}</div>
                            <div className="mt-0.5 truncate text-[12.5px] text-muted">
                              {a ? (
                                <>
                                  {a.label}
                                  {fmtSec(a.durationSec) && <span className="tabular-nums"> · {fmtSec(a.durationSec)}</span>}
                                </>
                              ) : (
                                <span className="text-warn">No audio</span>
                              )}
                              {c.webhookUrl && <span> · custom webhook</span>}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className={TD}>
                        <TrigPill t={trigger} />
                      </td>
                      <td className={`${TD} hidden md:table-cell`}>
                        {c.fromNumber ? (
                          <span className="whitespace-nowrap text-ink2 tabular-nums">{formatPhone(c.fromNumber)}</span>
                        ) : (
                          <span className="whitespace-nowrap text-muted">Account default</span>
                        )}
                      </td>
                      <td className={`${TD} hidden whitespace-nowrap text-muted lg:table-cell`}>{created ?? "—"}</td>
                      <td className={TD}>
                        <div className="flex items-center justify-end gap-0.5">
                          <div className="flex items-center gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                            {a?.url && <PlayIcon src={a.url} label={a.label} />}
                            <IconButton size="sm" icon={<Phone size={14} />} title="Test call" onClick={() => setTestFor(c)} />
                            <IconButton size="sm" icon={<Pencil size={14} />} title="Edit" onClick={() => setEditing(c)} />
                          </div>
                          <Kebab
                            items={[
                              { label: "Test call", icon: <PhoneCall size={13} />, onClick: () => setTestFor(c) },
                              { label: "Edit", icon: <Pencil size={13} />, onClick: () => setEditing(c) },
                              { label: "Clone", icon: <Copy size={13} />, onClick: () => startClone(c) },
                              { label: "Delete", icon: <Trash2 size={13} />, danger: true, onClick: () => setConfirmDelete(c) },
                            ]}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!shown.length && (
                  <tr>
                    <td colSpan={5}>
                      <EmptyState icon={<Megaphone size={20} />} title="No campaigns match" description="Try another filter or search." />
                    </td>
                  </tr>
                )}
              </tbody>
            </DataTable>
            <Pager
              page={pg}
              pages={pages}
              from={matching.length ? pg * PER_PAGE + 1 : 0}
              to={pg * PER_PAGE + shown.length}
              total={matching.length}
              onPage={setPage}
            />
          </div>
        </>
      )}

      {editorOpen && (
        <CampaignEditor
          audios={audios}
          initial={editing}
          cloneFrom={clone}
          onTest={(c) => setTestFor(c)}
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

      {testFor && <TestCallModal campaign={testFor} onClose={() => setTestFor(null)} />}
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
      toast(r.ok ? `Test call queued to ${r.to}` : `Call could not be placed (error ${r.status})`, r.ok ? "ok" : "danger");
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
      title="Test call"
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={placeTest} disabled={!canDial} loading={busy} leftIcon={<PhoneCall size={14} />}>
            {busy ? "Dialling…" : "Call me"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink2">
          We’ll call your phone with <span className="font-medium text-ink">{campaign.name}</span> so you can hear it
          exactly as leads do. It is one real call, using this campaign’s audio, prompt and webhook.
        </p>
        <div>
          <Label hint="India: +91 added for you">Your phone</Label>
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") placeTest(); }}
            placeholder="9876543210 or +14155551234"
            autoFocus
          />
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
                {result.ok ? "Call placed" : `Failed${result.status ? ` (${result.status})` : ""}`}
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

/** One section of the drawer form. */
function Sect({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="mb-6">
      <h4 className="text-sm font-semibold tracking-[-0.01em] text-ink">{title}</h4>
      {sub && <p className="mb-3.5 mt-0.5 text-[13px] text-muted">{sub}</p>}
      {children}
    </section>
  );
}

/** "How this call will go": ring → audio → prompt → WhatsApp, live from the form. */
function FlowStrip({
  from,
  audioLen,
  hangUp,
  trigger,
}: {
  from: string;
  audioLen: string;
  hangUp: string;
  trigger: WaTrigger;
}) {
  const off = trigger === "never";
  const steps = [
    { icon: <Phone size={16} />, title: "Call rings", sub: from },
    { icon: <AudioLines size={16} />, title: "Plays audio", sub: audioLen },
    { icon: <Pointer size={16} />, title: "Speaks the prompt", sub: hangUp },
  ];
  return (
    <div className="mb-[22px] rounded-xl border border-line bg-elev px-3 py-3.5">
      <div className="mb-2.5 px-1 text-xs font-medium text-muted">How this call will go</div>
      <div className="grid grid-cols-2 gap-y-3 sm:flex sm:items-stretch">
        {steps.map((s, i) => (
          <FlowStep key={s.title} first={i === 0} icon={s.icon} title={s.title} sub={s.sub} />
        ))}
        <FlowStep
          icon={<MessageCircle size={16} />}
          title="WhatsApp"
          sub={TRIG[trigger].flow}
          tone={off ? "off" : "send"}
        />
      </div>
    </div>
  );
}

function FlowStep({
  icon,
  title,
  sub,
  first,
  tone,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  first?: boolean;
  tone?: "send" | "off";
}) {
  const bub =
    tone === "send"
      ? "bg-ok/10 border-ok/25 text-ok"
      : tone === "off"
      ? "bg-ink/[0.04] border-line text-muted"
      : "bg-panel border-line text-muted";
  return (
    <div className="relative flex-1 px-1 text-center">
      {!first && (
        <span aria-hidden="true" className="absolute -left-3.5 top-[17px] hidden w-7 border-t-[1.5px] border-dashed border-line2 sm:block" />
      )}
      <div className={`mx-auto mb-[7px] grid h-9 w-9 place-items-center rounded-[11px] border shadow-xs ${bub}`}>{icon}</div>
      <b className={`block text-xs font-semibold ${tone === "off" ? "text-muted line-through" : "text-ink"}`}>{title}</b>
      <span className="block truncate text-[11.5px] text-muted">{sub}</span>
    </div>
  );
}

function CampaignEditor({
  initial,
  cloneFrom,
  audios,
  onClose,
  onSaved,
  onCreated,
  onTest,
}: {
  initial: Campaign | null;
  cloneFrom: Campaign | null;
  audios: Audio[];
  onClose: () => void;
  onSaved: () => void;
  onCreated?: (campaignId: string) => void;
  onTest: (c: Campaign) => void;
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
  // Require a name AND a selected audio (plus a valid webhook / from number).
  const nameValid = !!name.trim();
  const audioValid = !!audioId;
  const canSave = nameValid && audioValid && webhookValid && !fromErr;
  // Open Advanced straight away when something in it needs fixing.
  const advancedHasError = !webhookValid || !!fromErr;
  const [advOpen, setAdvOpen] = useState(advancedHasError);
  useEffect(() => {
    if (advancedHasError) setAdvOpen(true);
  }, [advancedHasError]);

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
        // Jump to Bulk with this campaign pre-selected.
        onCreated?.(res.campaign.id);
      }
    } catch (e: any) {
      toast(e.message || "Save failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  const OPTS: { k: WaTrigger; title: string; sub: string }[] = [
    { k: "answer", title: "When they pick up", sub: "Everyone who answers. Press 1 still counted." },
    { k: "press1", title: "Only if they press 1", sub: "Answering alone sends nothing." },
    { k: "always", title: "Everyone, on dial", sub: "Even if they don’t answer. Never to DND." },
    { k: "never", title: "Don’t send", sub: "Calls only. No WhatsApp." },
  ];

  return (
    <Drawer
      open
      onClose={onClose}
      title={initial ? "Edit campaign" : cloneFrom ? "Clone campaign" : "New campaign"}
      description="Everything here can be changed later."
      footer={
        <>
          {initial && (
            <Button variant="ghost" leftIcon={<Phone size={14} />} onClick={() => onTest(initial)}>
              Test call
            </Button>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!canSave} loading={busy}>
            {initial ? "Save changes" : "Create campaign"}
          </Button>
        </>
      }
    >
      <FlowStrip
        from={fromNumber.trim() && !fromErr ? `from ${formatPhone(fromNumber.trim())}` : "from account default"}
        audioLen={fmtSec(audioDuration) || (selectedAudio ? "length unknown" : "no audio yet")}
        hangUp={callEndSec.trim() ? `hangs up at ${callEndSec.trim()}s` : "then hangs up"}
        trigger={whatsappTrigger}
      />

      <Sect title="Basics" sub="What it’s called and what people hear.">
        <div className="space-y-3.5">
          <div>
            <Label required>Campaign name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Day-1 outreach" invalid={!nameValid} />
          </div>
          <div>
            <Label required hint={audios.length ? `${audios.length} available` : "add one under Audios"}>Audio</Label>
            <Select value={audioId ?? ""} onChange={(e) => setAudioId(e.target.value)} invalid={!audioValid}>
              <option value="">Select an audio</option>
              {audios.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {fmtSec(a.durationSec) ? ` · ${fmtSec(a.durationSec)}` : ""}
                </option>
              ))}
            </Select>
            {!audioValid && (
              <div className="mt-1 text-xs text-danger">
                {audios.length ? "Select an audio for this campaign." : "No audios yet — add one under Audios first."}
              </div>
            )}
            {selectedAudio?.url && (
              <div className="mt-2 flex items-center gap-3 rounded-[10px] border border-line bg-elev py-2 pl-2 pr-3">
                <PlayRound src={selectedAudio.url} label={selectedAudio.label} size={32} />
                <WaveBars seed={seedOf(selectedAudio.id)} count={56} height={26} />
                <span className="text-[12.5px] text-muted tabular-nums">{fmtSec(audioDuration) || "—"}</span>
              </div>
            )}
          </div>
        </div>
      </Sect>

      <Sect title="WhatsApp message" sub="When should this campaign send its WhatsApp?">
        <div role="radiogroup" aria-label="When to send the WhatsApp message" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {OPTS.map((o) => {
            const on = whatsappTrigger === o.k;
            return (
              <button
                key={o.k}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setWhatsappTrigger(o.k)}
                className={`flex gap-2.5 rounded-[11px] border p-3 text-left transition-[border-color,box-shadow,background-color] focus-visible:outline-none focus-visible:shadow-glow ${
                  on
                    ? "border-accent bg-accent/[0.06] shadow-[inset_0_0_0_1px_rgb(var(--c-accent)),0_0_0_4px_rgb(var(--c-accent)/0.12)]"
                    : "border-line bg-panel hover:border-line2 hover:shadow-xs"
                }`}
              >
                <span
                  className={`mt-px grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px] ${on ? "border-accent" : "border-line2"}`}
                >
                  {on && <span className="h-2 w-2 rounded-full bg-accent" />}
                </span>
                <span className="min-w-0">
                  <b className="block text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                    {o.title}
                    {o.k === "answer" && (
                      <em className="ml-1.5 inline-flex h-[18px] items-center rounded-full border border-ok/25 bg-ok/[0.09] px-1.5 align-[1px] text-[10.5px] font-semibold not-italic text-ok">
                        Recommended
                      </em>
                    )}
                  </b>
                  <span className="mt-0.5 block text-[12.5px] leading-snug text-muted">{o.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-2.5 text-xs leading-relaxed text-muted">
          {whatsappTrigger === "always"
            ? "Every lead gets the WhatsApp + email the moment their call is placed — answered, busy, no answer, failed or low balance alike. Numbers on your Do not disturb list are never messaged. Pickup and press 1 are still counted but send nothing more, and a lead is never messaged twice."
            : whatsappTrigger === "never"
            ? "This campaign only places calls. No WhatsApp is sent — not on pickup, not on press 1. Press 1 is still counted in reports."
            : whatsappTrigger === "answer"
            ? "Everyone who answers gets the message. Press 1 still works and is still counted — it just isn't what sends it, and nobody gets two messages."
            : "Only leads who press 1 get the message. Anyone who answers and doesn't press gets nothing."}
        </div>
      </Sect>

      <Sect title="After the audio" sub="Spoken once the recording ends.">
        <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </Sect>

      {/* Wiring, not settings: leave every one blank and the account defaults
          are used. Collapsed so nobody thinks they skipped a step. */}
      <details
        className="group rounded-xl border border-line"
        open={advOpen}
        onToggle={(e) => setAdvOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-3 marker:content-['']">
          <ChevronRight size={14} className="text-muted transition-transform group-open:rotate-90" />
          <span className="min-w-0">
            <b className="block text-sm font-semibold text-ink">Advanced</b>
            <span className="block text-[12.5px] text-muted">Hang-up time, webhook URL, call-from number. Leave blank to use your account defaults.</span>
          </span>
        </summary>
        <div className="space-y-4 border-t border-line px-3.5 py-4">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              <Label hint={audioDuration ? `audio is ${audioDuration}s` : "auto-filled from audio"}>Hang up after (seconds)</Label>
              <Input
                type="number"
                min={5}
                value={callEndSec}
                onChange={(e) => {
                  setCallEndTouched(true);
                  setCallEndSec(e.target.value);
                }}
                placeholder="auto"
                className="tabular-nums"
              />
            </div>
            <div>
              <Label hint="optional">Call from</Label>
              <Input
                value={fromNumber}
                onChange={(e) => setFromNumber(e.target.value)}
                placeholder="+918031340818"
                className={fromErr ? "border-danger/60 focus:border-danger/60" : ""}
              />
              {fromErr ? (
                <div className="mt-1 text-xs text-danger">{fromErr}</div>
              ) : fromEmpty ? (
                <div className="mt-1 text-xs text-muted">Blank — calls use the account default.</div>
              ) : null}
            </div>
          </div>
          <div className="text-xs text-muted">
            The call hangs up automatically after this many seconds, so the audio plays once and the line
            doesn&apos;t stay connected. Auto-filled from the audio length; adjust if needed.
            {!audioDuration && selectedAudio && (
              <span className="text-warn"> This audio has no detected length — re-add it under Audios to auto-fill, or set a value here.</span>
            )}
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
              <div className="mt-1 text-xs text-muted">Blank = use the account’s default webhook.</div>
            ) : (
              <div className="mt-1 text-xs text-danger">Must be a valid https:// URL.</div>
            )}
          </div>
        </div>
      </details>
    </Drawer>
  );
}
