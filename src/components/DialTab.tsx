"use client";
import CampaignSelect from "./CampaignSelect";
import { fmtDateTime } from "@/lib/format";

import { formatPhone, isDiallablePhone, normalizePhone } from "@/lib/phone";
import { useCallback, useEffect, useState } from "react";
import { Phone, PhoneCall, Megaphone, CheckCircle2, XCircle, Copy, Check, RefreshCw, AudioLines, Target, MessageCircle } from "lucide-react";
import { Button, Input, Label, Badge, EmptyState, Loading, Section, IconButton, DataTable, TH, TD, Spinner, toast } from "./ui";
import { useFetch, api, usePersistentState } from "./useData";
import type { Campaign } from "@/lib/models";
import { CardHead, Panel } from "./DashboardParts";

interface CallResult {
  ok: boolean;
  status?: number;
  to?: string;
  callUuid?: string;
}

/** A call as the server has it — this is what survives a refresh. */
interface RecentCall {
  callUuid: string;
  to: string;
  campaignId: string | null;
  campaignName: string;
  outcome: string;
  status: string;
  digit: string;
  durationSec: number | null;
  triggeredAt: string;
}

// E.164-ish: a leading +<country><number> (8–15 digits), OR a bare 10-digit
// Indian mobile (we auto-prefix +91 server-side).
function isValidPhone(raw: string) {
  const v = raw.trim();
  if (/^\+[1-9]\d{7,14}$/.test(v)) return true;
  const digits = v.replace(/\D/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return true; // 10-digit Indian mobile
  return false;
}

/** "2 min ago" for anything today, a date beyond that. */
function whenLabel(iso: string): string {
  const t = Date.parse(iso);
  if (!isFinite(t)) return "—";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
  return fmtDateTime(iso, { short: true });
}

function mmss(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

/** Outcome as a pill. */
function OutcomeBadge({ outcome }: { outcome: string }) {
  const label: Record<string, string> = {
    press1: "Pressed 1",
    connected: "Answered",
    busy: "Busy",
    "no-answer": "No answer",
    rejected: "Rejected",
    error: "Failed",
    "in-progress": "In progress",
  };
  const tone =
    outcome === "press1"
      ? "ok"
      : outcome === "connected"
        ? "accent"
        : outcome === "in-progress"
          ? "info"
          : outcome === "busy"
            ? "warn"
            : outcome === "no-answer"
              ? "muted"
              : "danger";
  return (
    <Badge tone={tone as "ok" | "accent" | "info" | "warn" | "muted" | "danger"} dot={outcome === "in-progress"}>
      {label[outcome] ?? outcome}
    </Badge>
  );
}

/** Plain-language line for when the campaign's WhatsApp goes out. */
function whatsappLine(c: Campaign | undefined): { title: string; sub: string } {
  switch (c?.whatsappTrigger) {
    case "answer":
      return { title: "WhatsApp goes out", sub: "The moment they pick up." };
    case "always":
      return { title: "WhatsApp goes out", sub: "As soon as the call is placed, whatever the outcome." };
    case "never":
      return { title: "No WhatsApp", sub: "This campaign doesn’t send one. Press 1 is still counted." };
    default:
      return { title: "WhatsApp goes out", sub: "Only when they press 1." };
  }
}

export default function DialTab() {
  const { data: c, loading: loadingCampaigns } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const campaigns = c?.campaigns ?? [];
  // Selected campaign + caller name persist across tab switches / refresh (BUG 1).
  const [campaignId, setCampaignId] = usePersistentState<string>("ivr.dial.campaignId", "");
  const [phone, setPhone] = useState("");
  const [callerName, setCallerName] = usePersistentState("ivr.dial.callerName", "");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<CallResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // The calls the SERVER has. These were always being recorded — the page just
  // never asked for them, which is why the list used to empty on refresh.
  const [recent, setRecent] = useState<RecentCall[] | null>(null);
  const [recentBusy, setRecentBusy] = useState(false);

  const loadRecent = useCallback(async () => {
    setRecentBusy(true);
    try {
      const r = await api<{ rows: RecentCall[] }>("/api/calls/recent?limit=20");
      setRecent(r.rows);
    } catch {
      // Non-fatal: the dialer still works without the history panel.
      setRecent((cur) => cur ?? []);
    } finally {
      setRecentBusy(false);
    }
  }, []);

  useEffect(() => { loadRecent(); }, [loadRecent]);

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);
  const phoneValid = isValidPhone(phone);
  const phoneTouched = phone.trim().length > 0;
  const canDial = !!campaignId && phoneValid && !busy;

  async function dial(overridePhone?: string, overrideCampaignId?: string) {
    const dialPhone = (overridePhone ?? phone).trim();
    const dialCampaignId = overrideCampaignId ?? campaignId;
    if (!dialCampaignId || !isValidPhone(dialPhone)) return;
    setBusy(true);
    try {
      const r = await api<CallResult>("/api/call", {
        method: "POST",
        body: JSON.stringify({ phone: dialPhone, campaignId: dialCampaignId, callerName: callerName || undefined }),
      });
      setLast(r);
      setCopied(null);
      toast(r.ok ? `Dialing ${r.to ?? dialPhone}` : `Call could not be placed (error ${r.status})`, r.ok ? "ok" : "danger");
      if (!overridePhone) setPhone("");
      // Pull it straight away so the row appears, then again once the call has
      // had time to settle so the outcome stops saying "in progress".
      loadRecent();
      setTimeout(loadRecent, 8000);
    } catch (e: any) {
      toast(e.message || "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function copyUuid(uuid: string) {
    try {
      await navigator.clipboard.writeText(uuid);
      setCopied(uuid);
      toast("Call ID copied", "ok");
      setTimeout(() => setCopied((cur) => (cur === uuid ? null : cur)), 1500);
    } catch {
      toast("Copy failed", "danger");
    }
  }

  if (loadingCampaigns && !c) {
    return (
      <Section>
        <Panel>
          <Loading label="Loading campaigns…" />
        </Panel>
      </Section>
    );
  }

  if (!campaigns.length) {
    return (
      <Section>
        <Panel>
          <EmptyState
            icon={<Megaphone size={20} />}
            title="No campaigns yet"
            description="Create a campaign first so calls have audio, a prompt, and a press-1 webhook to fire."
            action={<Badge tone="accent">Head to the Campaigns tab</Badge>}
          />
        </Panel>
      </Section>
    );
  }

  const wa = whatsappLine(selectedCampaign);
  const steps: { icon: React.ReactNode; tone: string; title: string; sub: string }[] = [
    {
      icon: <Phone size={16} />,
      tone: "bg-accent/10 text-accent",
      title: "Their phone rings",
      sub: selectedCampaign?.fromNumber ? `From ${selectedCampaign.fromNumber}, the campaign’s caller ID.` : "From the campaign’s caller ID.",
    },
    {
      icon: <AudioLines size={16} />,
      tone: "bg-accent/10 text-accent",
      title: "Audio plays",
      sub: !selectedCampaign
        ? "The campaign’s recording."
        : selectedCampaign.audioId
          ? "The campaign’s recording."
          : "No audio linked, so the default recording plays.",
    },
    {
      icon: <Target size={16} />,
      tone: "bg-info/10 text-info",
      title: "Asked to press 1",
      sub: selectedCampaign?.prompt ? `“${selectedCampaign.prompt}”` : "Pressing 1 marks them as a lead.",
    },
    {
      icon: <MessageCircle size={16} />,
      tone: wa.title === "No WhatsApp" ? "bg-elev text-muted" : "bg-ok/10 text-ok",
      title: wa.title,
      sub: selectedCampaign ? wa.sub : "Depends on the campaign’s WhatsApp setting.",
    },
  ];

  return (
    <Section>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---- form ---- */}
        <Panel>
          <CardHead title="Place a call" sub="The caller ID comes from the campaign." border />
          <div className="p-5">
            <Label>Campaign</Label>
            <CampaignSelect campaigns={campaigns} value={campaignId} onChange={setCampaignId} emptyLabel="Choose a campaign…" />

            <div className="mt-3.5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Phone</Label>
                <div className="relative">
                  <Phone size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted" />
                  <Input
                    placeholder="9876543210 or +14155551234"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && canDial) dial(); }}
                    invalid={phoneTouched && !phoneValid}
                    className="h-10 pl-9 tabular-nums"
                  />
                </div>
                {phoneTouched && !phoneValid ? (
                  <div className="mt-1 text-xs text-danger">Enter a 10-digit Indian mobile or a +country number.</div>
                ) : (
                  <div className="mt-1 text-xs text-muted">India numbers get +91 added.</div>
                )}
              </div>
              <div>
                <Label hint="optional">Caller name</Label>
                <Input
                  value={callerName}
                  onChange={(e) => setCallerName(e.target.value)}
                  placeholder="Their first name"
                  className="h-10"
                />
                <div className="mt-1 text-xs text-muted">Sent with the lead, e.g. in the WhatsApp message.</div>
              </div>
            </div>

            <div className="mt-[18px] flex flex-wrap items-center gap-2.5">
              <Button
                onClick={() => dial()}
                disabled={!canDial}
                loading={busy}
                leftIcon={<PhoneCall size={15} />}
                size="lg"
              >
                {busy ? "Dialing…" : "Call now"}
              </Button>
              {selectedCampaign?.fromNumber && (
                <span className="text-xs text-muted">
                  From <span className="font-mono text-ink2">{selectedCampaign.fromNumber}</span>
                </span>
              )}
            </div>

            {last && (
              <div
                className={`mt-4 flex items-center gap-3 rounded-[10px] border px-3.5 py-3 ${
                  last.ok ? "border-ok/25 bg-ok/[0.06]" : "border-danger/25 bg-danger/[0.06]"
                }`}
              >
                <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${last.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"}`}>
                  {last.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">
                    {last.ok ? `Call placed to ${last.to ?? ""}` : `Call could not be placed (error ${last.status})`}
                  </div>
                  {last.callUuid && (
                    <button
                      type="button"
                      onClick={() => copyUuid(last.callUuid!)}
                      title="Copy call ID"
                      className="inline-flex max-w-full items-center gap-1 font-mono text-xs text-muted transition-colors hover:text-ink2"
                    >
                      <span className="truncate">{last.callUuid}</span>
                      {copied === last.callUuid ? <Check size={11} className="shrink-0 text-ok" /> : <Copy size={11} className="shrink-0" />}
                    </button>
                  )}
                </div>
                <Badge tone={last.ok ? "ok" : "danger"}>{last.ok ? "Queued" : "Failed"}</Badge>
              </div>
            )}
          </div>
        </Panel>

        {/* ---- what will happen ---- */}
        <Panel>
          <CardHead title="What will happen" sub={selectedCampaign ? selectedCampaign.name : "Pick a campaign to see its exact steps."} border />
          <div className="grid gap-3.5 p-5">
            {steps.map((s) => (
              <div key={s.title} className="flex items-start gap-3">
                <div className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[10px] ${s.tone}`}>{s.icon}</div>
                <div className="min-w-0">
                  <b className="text-[13.5px] font-semibold text-ink">{s.title}</b>
                  <div className="break-words text-xs text-muted">{s.sub}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* The real, recorded history — survives a refresh, because it is read
          back from the calls the server was already storing. */}
      <Panel>
        <CardHead
          title="Recent calls"
          sub="Your last 20 calls, across every campaign."
          right={
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw size={13} className={recentBusy ? "animate-spin" : ""} />}
              onClick={loadRecent}
              disabled={recentBusy}
            >
              Refresh
            </Button>
          }
        />
        {recent === null ? (
          <div className="flex justify-center py-10 text-muted"><Spinner size={16} /></div>
        ) : recent.length === 0 ? (
          <div className="px-5 pb-5 text-sm text-muted">
            No calls yet. Ones you place here — and ones placed by bulk or by a sheet — will show up.
          </div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Time</th>
                <th className={TH}>Number</th>
                <th className={`${TH} hidden sm:table-cell`}>Campaign</th>
                <th className={TH}>Outcome</th>
                <th className={`${TH} text-right`}>Duration</th>
                <th className={`${TH} w-[90px]`} />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => {
                const talked = r.durationSec != null && r.durationSec > 0 && (r.outcome === "press1" || r.outcome === "connected");
                return (
                  <tr key={r.callUuid} className="transition-colors hover:bg-elev">
                    <td className={`${TD} whitespace-nowrap text-muted`}>{whenLabel(r.triggeredAt)}</td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {formatPhone(r.to)}
                      {!isDiallablePhone(normalizePhone(r.to)) && (
                        <span className="ml-2 text-[11px] text-warn" title="Too few or too many digits — calls to this number are now refused">
                          invalid number
                        </span>
                      )}
                    </td>
                    <td className={`${TD} hidden text-ink2 sm:table-cell`}>{r.campaignName || "—"}</td>
                    <td className={TD}><OutcomeBadge outcome={r.outcome} /></td>
                    <td className={`${TD} text-right tabular-nums ${talked ? "" : "text-muted"}`}>
                      {talked ? mmss(r.durationSec!) : "—"}
                    </td>
                    <td className={TD}>
                      <div className="flex justify-end gap-0.5">
                        <IconButton
                          size="sm"
                          icon={<Phone size={14} />}
                          onClick={() => {
                            setPhone(r.to);
                            if (r.campaignId) setCampaignId(r.campaignId);
                            dial(r.to, r.campaignId ?? undefined);
                          }}
                          disabled={busy}
                          title="Call again"
                        />
                        <IconButton
                          size="sm"
                          icon={copied === r.callUuid ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
                          onClick={() => copyUuid(r.callUuid)}
                          title="Copy call ID"
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </Section>
  );
}
