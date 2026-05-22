"use client";

import { useRef, useState } from "react";
import { Link as LinkIcon, Upload, Trash2, Music, Play } from "lucide-react";
import { Button, Card, Input, Label, Badge, EmptyState, Section, IconButton, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { Audio } from "@/lib/models";

export default function AudiosTab() {
  const { data, reload } = useFetch<{ audios: Audio[] }>("/api/audios");
  const audios = data?.audios ?? [];
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addUrl() {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await api("/api/audios", {
        method: "POST",
        body: JSON.stringify({ label: label || "Untitled", url }),
      });
      setUrl("");
      setLabel("");
      reload();
      toast("Audio added", "ok");
    } catch (e: any) {
      toast(e.message || "Failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function uploadFile() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("label", label || file.name);
      const r = await fetch("/api/audios/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || "Upload failed");
      setLabel("");
      if (fileRef.current) fileRef.current.value = "";
      reload();
      toast("Audio uploaded", "ok");
    } catch (e: any) {
      toast(e.message || "Upload failed", "danger");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this audio? Campaigns using it will fall back to default.")) return;
    await api(`/api/audios/${id}`, { method: "DELETE" });
    reload();
    toast("Deleted", "ok");
  }

  return (
    <Section>
      <Card
        title="Add audio"
        description="Paste a public MP3 URL, or upload a file to Vercel Blob."
        action={
          <div className="inline-flex p-1 bg-elev/60 border border-line rounded-lg">
            <button
              onClick={() => setMode("url")}
              className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 transition-all ${
                mode === "url" ? "bg-brand/15 text-brand" : "text-ink2 hover:text-ink"
              }`}
            >
              <LinkIcon size={12} />
              Paste URL
            </button>
            <button
              onClick={() => setMode("upload")}
              className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 transition-all ${
                mode === "upload" ? "bg-brand/15 text-brand" : "text-ink2 hover:text-ink"
              }`}
            >
              <Upload size={12} />
              Upload
            </button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Day-1 voice" />
          </div>
          {mode === "url" ? (
            <>
              <div className="md:col-span-2">
                <Label>Public MP3 URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://.../day1.mp3"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button onClick={addUrl} disabled={!url.trim()} loading={busy} leftIcon={<LinkIcon size={14} />}>
                  Add
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2">
                <Label>MP3 file</Label>
                <label className="flex items-center gap-3 px-3 py-2 bg-bg/60 border border-line rounded-lg cursor-pointer hover:border-line2 transition-colors">
                  <Upload size={14} className="text-muted" />
                  <input
                    ref={fileRef}
                    type="file"
                    accept="audio/*"
                    className="text-sm text-ink2 flex-1 outline-none"
                  />
                </label>
              </div>
              <div className="md:col-span-3 flex items-center justify-between gap-3">
                <div className="text-xs text-muted">
                  Goes to Vercel Blob (requires <code className="text-brand">BLOB_READ_WRITE_TOKEN</code>).
                </div>
                <Button onClick={uploadFile} disabled={busy} loading={busy} leftIcon={<Upload size={14} />}>
                  Upload
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      {!audios.length ? (
        <Card>
          <EmptyState
            icon={<Music size={20} />}
            title="No audios yet"
            description="Add one above. Once added, link it to a campaign in the Campaigns tab."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {audios.map((a) => (
            <Card key={a.id} className="group hover:border-line2 transition-colors">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
                    <Music size={15} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{a.label}</div>
                      <Badge tone={a.source === "blob" ? "accent" : "muted"}>{a.source}</Badge>
                    </div>
                    <div className="text-xs text-muted truncate mt-0.5">{a.url}</div>
                  </div>
                </div>
                <audio controls src={a.url} className="h-8 max-w-[220px]" />
                <IconButton icon={<Trash2 size={14} />} variant="danger" onClick={() => remove(a.id)} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </Section>
  );
}
