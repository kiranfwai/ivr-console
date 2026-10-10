"use client";

import { formatPhone, isDiallablePhone, normalizePhone } from "@/lib/phone";
import { useCallback, useEffect, useState } from "react";
import { Phone, PhoneCall, Megaphone, ArrowRight, CheckCircle2, XCircle, Copy, Check, History, RotateCcw, RefreshCw } from "lucide-react";
import { Button, Card, Input, Label, Select, Badge, EmptyState, Loading, Section, IconButton, DataTable, TH, TD, Spinner, toast } from "./ui";
import { useFetch, api, usePersistentState } from "./useData";
import type { Campaign } from "@/lib/models";

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
  return new Date(t).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true,
  });
}

/** Outcome as a pill, with talk time when the call actually connected. */
function OutcomeBadge({ outcome, durationSec }: { outcome: string; durationSec: number | null }) {
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
    outcome === "press1" || outcome === "connected"
      ? "ok"
      : outcome === "busy" || outcome === "in-progress"
        ? "warn"
        : outcome === "no-answer"
          ? "muted"
          : "danger";
  const showDur = durationSec != null && durationSec > 0 && (outcome === "press1" || outcome === "connected");
  return (
    <Badge tone={tone as "ok" | "warn" | "muted" | "danger"}>
      {label[outcome] ?? outcome}
      {showDur && ` · ${Math.floor(durationSec! / 60)}:${String(durationSec! % 60).padStart(2, "0")}`}
    </Badge>
  );
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
  const [copied, setCopied] = useState(false);

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
    const campaign = campaigns.find((c) => c.id === dialCampaignId);
    if (!dialCampaignId || !isValidPhone(dialPhone)) return;
    setBusy(true);
    try {
      const r = await api<CallResult>("/api/call", {
        method: "POST",
        body: JSON.stringify({ phone: dialPhone, campaignId: dialCampaignId, callerName: callerName || undefined }),
      });
      setLast(r);
      setCopied(false);
      toast(r.ok ? `Dialing ${r.to ?? dialPhone}` : `Plivo error ${r.status}`, r.ok ? "ok" : "danger");
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
      setCopied(true);
      toast("Call UUID copied", "ok");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Copy failed", "danger");
    }
  }

  if (loadingCampaigns && !c) {
    return (
      <Section>
        <Card>
          <Loading label="Loading campaigns…" />
        </Card>
      </Section>
    );
  }

  if (!campaigns.length) {
    return (
      <Section>
        <Card>
          <EmptyState
            icon={<Megaphone size={20} />}
            title="No campaigns yet"
            description="Create a campaign first so calls have audio, a prompt, and a press-1 webhook to fire."
            action={<Badge tone="accent">Head to the Campaigns tab</Badge>}
          />
        </Card>
      </Section>
    );
  }

  return (
    <Section>
      <Card
        title="Place a call"
        description="Pick a campaign, enter a phone, and Plivo will dial."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Choose a campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            {selectedCampaign && (
              <div className="mt-2 text-xs text-muted">
                Audio: <span className="text-ink2">{selectedCampaign.audioId ? "configured" : "fallback day1.mp3"}</span>
                {selectedCampaign.fromNumber && (
                  <> · From: <span className="font-mono text-ink2">{selectedCampaign.fromNumber}</span></>
                )}
              </div>
            )}
          </div>

          <div>
            <Label>Phone</Label>
            <Input
              placeholder="9876543210 or +14155551234"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && canDial) dial(); }}
              className={phoneTouched && !phoneValid ? "border-danger/60 focus:border-danger/60" : ""}
            />
            {phoneTouched && !phoneValid ? (
              <div className="text-xs text-danger mt-1">
                Enter a 10-digit Indian mobile or a +country number.
              </div>
            ) : (
              <div className="text-xs text-muted mt-1">
                10-digit numbers get +91 auto-added.
              </div>
            )}
          </div>

          <div>
            <Label hint="optional">Caller name</Label>
            <Input
              value={callerName}
              onChange={(e) => setCallerName(e.target.value)}
              placeholder="FWAI"
            />
          </div>

          <div className="flex items-end">
            <Button
              onClick={() => dial()}
              disabled={!canDial}
              loading={busy}
              leftIcon={<PhoneCall size={14} />}
              className="w-full"
              size="lg"
            >
              {busy ? "Dialing…" : "Place call"}
            </Button>
          </div>
        </div>
      </Card>

      {last && (
        <Card>
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                last.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
              }`}>
                {last.ok ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {last.ok ? "Call queued at Plivo" : `Plivo error ${last.status}`}
                </div>
                <div className="text-xs text-muted font-mono truncate flex items-center gap-1.5">
                  <Phone size={11} />
                  {last.to}
                  {last.callUuid && (
                    <>
                      <ArrowRight size={11} />
                      <button
                        type="button"
                        onClick={() => copyUuid(last.callUuid!)}
                        title="Copy call UUID"
                        className="inline-flex items-center gap-1 truncate hover:text-ink2 transition-colors"
                      >
                        <span className="truncate">{last.callUuid}</span>
                        {copied ? <Check size={11} className="text-ok shrink-0" /> : <Copy size={11} className="shrink-0" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <Badge tone={last.ok ? "ok" : "danger"}>
              {last.ok ? "queued" : "failed"}
            </Badge>
          </div>
        </Card>
      )}

      {/* The real, recorded history — survives a refresh, because it is read
          back from the calls the server was already storing. */}
      <Card
        title={<span className="flex items-center gap-1.5"><History size={14} /> Recent calls</span>}
        description="Your last 20 calls, across every campaign."
        action={
          <IconButton
            icon={<RefreshCw size={14} className={recentBusy ? "animate-spin" : ""} />}
            onClick={loadRecent}
            disabled={recentBusy}
            title="Refresh"
          />
        }
        noPadding
      >
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
                <th className={TH}>Number</th>
                <th className={TH}>Campaign</th>
                <th className={TH}>Outcome</th>
                <th className={`${TH} text-right`}>When</th>
                <th className={`${TH} w-[52px]`} />
              </tr>
            </thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.callUuid} className="transition-colors hover:bg-white/[0.022]">
                  <td className={`${TD} font-mono tabular-nums whitespace-nowrap`}>
                    {formatPhone(r.to)}
                    {!isDiallablePhone(normalizePhone(r.to)) && (
                      <span className="ml-2 font-sans text-[11px] text-warn" title="Too few or too many digits — calls to this number are now refused">
                        invalid number
                      </span>
                    )}
                  </td>
                  <td className={`${TD} text-ink2`}>{r.campaignName || "—"}</td>
                  <td className={TD}><OutcomeBadge outcome={r.outcome} durationSec={r.durationSec} /></td>
                  <td className={`${TD} text-right text-muted whitespace-nowrap`}>{whenLabel(r.triggeredAt)}</td>
                  <td className={TD}>
                    <IconButton
                      icon={<RotateCcw size={13} />}
                      onClick={() => {
                        setPhone(r.to);
                        if (r.campaignId) setCampaignId(r.campaignId);
                        dial(r.to, r.campaignId ?? undefined);
                      }}
                      disabled={busy}
                      title="Dial this number again"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>

    </Section>
  );
}
