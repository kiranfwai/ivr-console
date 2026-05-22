"use client";

import { useState } from "react";
import { Phone, PhoneCall, Megaphone, ArrowRight, CheckCircle2, XCircle } from "lucide-react";
import { Button, Card, Input, Label, Select, Badge, EmptyState, Section, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { Campaign } from "@/lib/models";

export default function DialTab() {
  const { data: c } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const campaigns = c?.campaigns ?? [];
  const [campaignId, setCampaignId] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [callerName, setCallerName] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);

  const selectedCampaign = campaigns.find((c) => c.id === campaignId);

  async function dial() {
    if (!campaignId || !phone) return;
    setBusy(true);
    try {
      const r = await api("/api/call", {
        method: "POST",
        body: JSON.stringify({ phone, campaignId, callerName: callerName || undefined }),
      });
      setLast(r);
      toast(`Dialing ${phone}`, "ok");
      setPhone("");
    } catch (e: any) {
      toast(e.message || "Failed", "danger");
    } finally {
      setBusy(false);
    }
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
            <Label hint="India: auto-prefix +91">Phone</Label>
            <Input
              placeholder="9876543210 or +14155551234"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") dial(); }}
            />
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
              onClick={dial}
              disabled={!campaignId || !phone}
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
                  <ArrowRight size={11} />
                  <span className="truncate">{last.callUuid}</span>
                </div>
              </div>
            </div>
            <Badge tone={last.ok ? "ok" : "danger"}>
              {last.ok ? "queued" : "failed"}
            </Badge>
          </div>
        </Card>
      )}
    </Section>
  );
}
