"use client";

import { useState } from "react";
import { Button, Card, Input, Label, Select, Badge, toast } from "./ui";
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

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Pick a campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            {!campaigns.length && (
              <div className="text-xs text-muted mt-2">
                No campaigns yet — go to <b>Campaigns</b> and create one.
              </div>
            )}
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              placeholder="9876543210 (India auto-prefixed) or +14155551234"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") dial();
              }}
            />
          </div>
          <div>
            <Label>Caller name (optional)</Label>
            <Input value={callerName} onChange={(e) => setCallerName(e.target.value)} placeholder="FWAI" />
          </div>
          <div className="flex items-end">
            <Button onClick={dial} disabled={!campaignId || !phone || busy} className="w-full">
              {busy ? "Placing…" : "Place call"}
            </Button>
          </div>
        </div>
      </Card>

      {last && (
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted">Last call</div>
              <div className="font-mono text-sm mt-1">{last.callUuid}</div>
              <div className="text-xs text-muted mt-1">→ {last.to}</div>
            </div>
            <Badge tone={last.ok ? "ok" : "danger"}>{last.ok ? "queued" : `failed (${last.status})`}</Badge>
          </div>
        </Card>
      )}
    </div>
  );
}
