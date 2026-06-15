"use client";

import { useState } from "react";
import { Phone, PhoneCall, Megaphone, ArrowRight, CheckCircle2, XCircle, Copy, Check, History, RotateCcw } from "lucide-react";
import { Button, Card, Input, Label, Select, Badge, EmptyState, Section, IconButton, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { Campaign } from "@/lib/models";

interface CallResult {
  ok: boolean;
  status?: number;
  to?: string;
  callUuid?: string;
}

interface HistoryEntry {
  id: number;
  phone: string;       // what the user typed
  campaignId: string;
  campaignName: string;
  at: number;          // epoch ms
  ok: boolean;
  to?: string;         // normalized number Plivo dialed
  callUuid?: string;
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

function timeAgo(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

let historyCounter = 1;

export default function DialTab() {
  const { data: c } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const campaigns = c?.campaigns ?? [];
  const [campaignId, setCampaignId] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [callerName, setCallerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<CallResult | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [copied, setCopied] = useState(false);

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
      setHistory((prev) => [
        {
          id: historyCounter++,
          phone: dialPhone,
          campaignId: dialCampaignId,
          campaignName: campaign?.name ?? "—",
          at: Date.now(),
          ok: r.ok,
          to: r.to,
          callUuid: r.callUuid,
        },
        ...prev,
      ].slice(0, 10));
      toast(r.ok ? `Dialing ${r.to ?? dialPhone}` : `Plivo error ${r.status}`, r.ok ? "ok" : "danger");
      if (!overridePhone) setPhone("");
    } catch (e: any) {
      setHistory((prev) => [
        {
          id: historyCounter++,
          phone: dialPhone,
          campaignId: dialCampaignId,
          campaignName: campaign?.name ?? "—",
          at: Date.now(),
          ok: false,
        },
        ...prev,
      ].slice(0, 10));
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

  function redial(h: HistoryEntry) {
    setPhone(h.phone);
    setCampaignId(h.campaignId);
    dial(h.phone, h.campaignId);
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

      {history.length > 0 && (
        <Card title={<span className="flex items-center gap-1.5"><History size={14} /> Recent calls</span>} description="This session only — not persisted.">
          <div className="divide-y divide-line">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    h.ok ? "bg-ok/10 text-ok" : "bg-danger/10 text-danger"
                  }`}>
                    {h.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-mono truncate">{h.to ?? h.phone}</div>
                    <div className="text-xs text-muted truncate">
                      {h.campaignName} · {timeAgo(h.at)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={h.ok ? "ok" : "danger"}>{h.ok ? "queued" : "failed"}</Badge>
                  <IconButton
                    icon={<RotateCcw size={13} />}
                    onClick={() => redial(h)}
                    disabled={busy}
                    title="Redial"
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </Section>
  );
}
