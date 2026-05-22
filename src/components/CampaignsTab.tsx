"use client";

import { useState } from "react";
import { Plus, Edit2, Trash2, Megaphone, Music, Globe, Phone } from "lucide-react";
import { Button, Card, Input, Label, Select, Textarea, Badge, EmptyState, Section, Modal, IconButton, toast } from "./ui";
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
    toast("Campaign deleted", "ok");
  }

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
                    </div>
                  </div>
                  <div className="opacity-60 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                    <IconButton icon={<Edit2 size={14} />} onClick={() => setEditing(c)} />
                    <IconButton
                      icon={<Trash2 size={14} />}
                      variant="danger"
                      onClick={() => remove(c.id)}
                    />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

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
    </Section>
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
      title={initial ? "Edit campaign" : "New campaign"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!name.trim()} loading={busy}>
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
          <Select value={audioId} onChange={(e) => setAudioId(e.target.value)}>
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
          />
          <div className="text-xs text-muted mt-1">Blank = use PABBLY_WEBHOOK_URL env var.</div>
        </div>
        <div>
          <Label hint="optional">From number</Label>
          <Input
            value={fromNumber}
            onChange={(e) => setFromNumber(e.target.value)}
            placeholder="+918031340818"
          />
        </div>
        <div>
          <Label>Prompt spoken after audio</Label>
          <Textarea rows={2} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
