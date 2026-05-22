"use client";

import { useState } from "react";
import { Button, Card, Input, Label, Select, Textarea, Badge, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { Audio, Campaign } from "@/lib/models";

export default function CampaignsTab() {
  const { data: cdata, reload: reloadC } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const { data: adata } = useFetch<{ audios: Audio[] }>("/api/audios");
  const campaigns = cdata?.campaigns ?? [];
  const audios = adata?.audios ?? [];
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [creating, setCreating] = useState(false);

  async function remove(id: string) {
    if (!confirm("Delete this campaign?")) return;
    await api(`/api/campaigns/${id}`, { method: "DELETE" });
    reloadC();
    toast("Deleted", "ok");
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)}>+ New campaign</Button>
      </div>

      {!campaigns.length && (
        <Card>
          <div className="text-sm text-muted">
            No campaigns yet. Create one to choose its audio, prompt, and press-1 webhook.
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {campaigns.map((c) => {
          const a = audios.find((a) => a.id === c.audioId);
          return (
            <Card key={c.id}>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted mt-1">audio: {a?.label || "(none — fallback day1)"}</div>
                  {c.fromNumber && <div className="text-xs text-muted">from: {c.fromNumber}</div>}
                  <div className="text-xs text-muted truncate mt-1">
                    {c.webhookUrl ? `webhook: ${c.webhookUrl}` : "webhook: default (env)"}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Button variant="ghost" onClick={() => setEditing(c)}>Edit</Button>
                  <Button variant="danger" onClick={() => remove(c.id)}>Delete</Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {(creating || editing) && (
        <CampaignEditor
          audios={audios}
          initial={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => {
            reloadC();
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function CampaignEditor({
  initial,
  audios,
  onClose,
  onSaved,
}: {
  initial: Campaign | null;
  audios: Audio[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [audioId, setAudioId] = useState(initial?.audioId ?? "");
  const [prompt, setPrompt] = useState(initial?.prompt ?? "Press 1 to receive your WhatsApp message.");
  const [webhookUrl, setWebhookUrl] = useState(initial?.webhookUrl ?? "");
  const [fromNumber, setFromNumber] = useState(initial?.fromNumber ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      if (initial) {
        await api(`/api/campaigns/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name, audioId: audioId || null, prompt, webhookUrl, fromNumber }),
        });
      } else {
        await api("/api/campaigns", {
          method: "POST",
          body: JSON.stringify({ name, audioId: audioId || null, prompt, webhookUrl, fromNumber }),
        });
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
    <div className="fixed inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <div className="text-lg font-semibold mb-3">{initial ? "Edit campaign" : "New campaign"}</div>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Day-1 outreach" />
          </div>
          <div>
            <Label>Audio</Label>
            <Select value={audioId} onChange={(e) => setAudioId(e.target.value)}>
              <option value="">— None (fallback day1.mp3) —</option>
              {audios.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Press-1 webhook URL (optional — falls back to PABBLY_WEBHOOK_URL)</Label>
            <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://connect.pabbly.com/..." />
          </div>
          <div>
            <Label>From number (optional — falls back to PLIVO_FROM_NUMBER)</Label>
            <Input value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+918031340818" />
          </div>
          <div>
            <Label>Prompt spoken after audio</Label>
            <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {busy ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
