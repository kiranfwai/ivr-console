"use client";

import { useRef, useState } from "react";
import { Button, Card, Input, Label, Badge, toast } from "./ui";
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
      await api("/api/audios", { method: "POST", body: JSON.stringify({ label: label || "Untitled", url }) });
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
      toast("Uploaded", "ok");
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
    <div className="space-y-4">
      <Card>
        <div className="flex gap-2 mb-3">
          <Button variant={mode === "url" ? "primary" : "ghost"} onClick={() => setMode("url")}>
            Paste URL
          </Button>
          <Button variant={mode === "upload" ? "primary" : "ghost"} onClick={() => setMode("upload")}>
            Upload file
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div>
            <Label>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Day-1 voice" />
          </div>
          {mode === "url" ? (
            <>
              <div className="md:col-span-2">
                <Label>Public MP3 URL</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://.../day1.mp3" />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button onClick={addUrl} disabled={busy || !url.trim()}>
                  Add
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2">
                <Label>MP3 file</Label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  className="text-sm text-muted file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-accent file:text-bg file:font-medium"
                />
              </div>
              <div className="md:col-span-3 flex justify-end">
                <Button onClick={uploadFile} disabled={busy}>
                  Upload
                </Button>
              </div>
              <div className="md:col-span-3 text-xs text-muted">
                Uploads go to Vercel Blob (requires <code>BLOB_READ_WRITE_TOKEN</code>). If you haven&apos;t set
                that env var, use <b>Paste URL</b> with a hosted MP3 instead.
              </div>
            </>
          )}
        </div>
      </Card>

      {!audios.length && (
        <Card>
          <div className="text-sm text-muted">No audios yet. Add one above.</div>
        </Card>
      )}

      <div className="space-y-2">
        {audios.map((a) => (
          <Card key={a.id}>
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <div className="font-medium">{a.label}</div>
                  <Badge tone={a.source === "blob" ? "accent" : "muted"}>{a.source}</Badge>
                </div>
                <div className="text-xs text-muted truncate mt-0.5">{a.url}</div>
              </div>
              <audio controls src={a.url} className="h-8" />
              <Button variant="danger" onClick={() => remove(a.id)}>Delete</Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
