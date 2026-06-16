"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link as LinkIcon, Upload, Trash2, Music, X, Clock } from "lucide-react";
import { Button, Card, Input, Label, Badge, EmptyState, Section, IconButton, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { Audio } from "@/lib/models";

/* -------------------- helpers -------------------- */
function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return "";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// http(s) and looks like an audio resource (known extension, or a query/path
// without a conflicting extension — we stay permissive but reject obvious non-audio).
function validateAudioUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "Enter a URL.";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "That doesn't look like a valid URL.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return "URL must start with http:// or https://";
  }
  const path = u.pathname.toLowerCase();
  const audioExt = /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm)$/;
  const nonAudioExt = /\.(html?|php|aspx?|jpe?g|png|gif|svg|pdf|json|txt|mp4|mov|zip)$/;
  if (nonAudioExt.test(path)) {
    return "That URL points to a non-audio file.";
  }
  if (!audioExt.test(path)) {
    // No recognizable audio extension — warn but allow (e.g. signed URLs / CDN paths).
    return "URL has no audio extension (e.g. .mp3). It may not be an audio file.";
  }
  return null;
}

const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB (FEATURE 5)

/** Validate a picked/dropped audio file: MP3 or WAV, ≤ 10 MB. Returns an error string or null. */
function validateAudioFile(f: File): string | null {
  const okType =
    /\.(mp3|wav)$/i.test(f.name) ||
    /^audio\/(mpeg|mp3|wav|x-wav|wave|vnd\.wave)$/i.test(f.type);
  if (!okType) return "Only MP3 or WAV files are supported.";
  if (f.size > MAX_AUDIO_BYTES) return `File is ${fmtBytes(f.size)} — the maximum is 10 MB.`;
  return null;
}

/* -------------------- waveform preview -------------------- */
function drawWave(canvas: HTMLCanvasElement, audio: AudioBuffer) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const data = audio.getChannelData(0);
  const bars = 140;
  const block = Math.floor(data.length / bars) || 1;
  const mid = H / 2;
  const barW = W / bars;
  ctx.fillStyle = "#5eead4";
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(data[i * block + j] || 0);
      if (v > peak) peak = v;
    }
    const h = Math.max(1, peak * H * 0.92);
    ctx.fillRect(i * barW, mid - h / 2, Math.max(1, barW - 1), h);
  }
}

// Decode the file locally (Web Audio) and draw its waveform — no server round-trip.
function Waveform({ file }: { file: File }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    (async () => {
      try {
        const buf = await file.arrayBuffer();
        const AC: typeof AudioContext =
          window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AC();
        const audio = await ctx.decodeAudioData(buf.slice(0));
        ctx.close().catch(() => {});
        if (cancelled) return;
        if (canvasRef.current) drawWave(canvasRef.current, audio);
        setStatus("ok");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [file]);

  return (
    <div className="md:col-span-3 rounded-lg border border-line bg-bg/40 px-3 py-2.5">
      <div className="text-xs font-medium text-ink2 uppercase tracking-wider mb-2">Waveform</div>
      <div className="relative h-16">
        <canvas ref={canvasRef} width={760} height={64} className="w-full h-16" />
        {status !== "ok" && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted">
            {status === "loading" ? "Rendering waveform…" : "Couldn’t render waveform (file still uploads fine)."}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------- audio metadata probe -------------------- */
function useAudioMeta(src: string | null) {
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setDuration(null);
    setError(false);
    if (!src) return;
    const el = document.createElement("audio");
    el.preload = "metadata";
    const onMeta = () => setDuration(el.duration);
    const onErr = () => setError(true);
    el.addEventListener("loadedmetadata", onMeta);
    el.addEventListener("error", onErr);
    el.src = src;
    return () => {
      el.removeEventListener("loadedmetadata", onMeta);
      el.removeEventListener("error", onErr);
      el.src = "";
    };
  }, [src]);

  return { duration, error };
}

/* -------------------- library row -------------------- */
function AudioRow({
  a,
  selected,
  onToggle,
  onRemove,
}: {
  a: Audio;
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const { duration } = useAudioMeta(a.url);
  return (
    <Card className="group hover:border-line2 transition-colors">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${a.label}`}
            className="shrink-0 w-4 h-4 accent-brand cursor-pointer"
          />
          <div className="w-9 h-9 rounded-lg bg-brand/10 text-brand flex items-center justify-center shrink-0">
            <Music size={15} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="font-medium truncate">{a.label}</div>
              <Badge tone={a.source === "blob" ? "accent" : "muted"}>{a.source}</Badge>
              {duration != null && (
                <span className="inline-flex items-center gap-1 text-xs text-muted tabular-nums">
                  <Clock size={11} />
                  {fmtDuration(duration)}
                </span>
              )}
            </div>
            <div className="text-xs text-muted truncate mt-0.5">{a.url}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <audio controls preload="none" src={a.url} className="h-8 w-full min-w-0 sm:w-[220px]" />
          <IconButton icon={<Trash2 size={14} />} variant="danger" onClick={onRemove} />
        </div>
      </div>
    </Card>
  );
}

/* -------------------- preview (URL or file) -------------------- */
function Preview({ src, label }: { src: string | null; label: string }) {
  const { duration, error } = useAudioMeta(src);
  if (!src) return null;
  return (
    <div className="md:col-span-3 rounded-lg border border-line bg-bg/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-medium text-ink2 uppercase tracking-wider">Preview</div>
        <div className="text-xs text-muted tabular-nums flex items-center gap-2">
          {error ? (
            <span className="text-warn">Couldn’t read metadata</span>
          ) : (
            <>{label}{duration != null && <span className="inline-flex items-center gap-1"><Clock size={11} />{fmtDuration(duration)}</span>}</>
          )}
        </div>
      </div>
      <audio controls src={src} className="h-9 w-full" />
    </div>
  );
}

export default function AudiosTab() {
  const { data, reload } = useFetch<{ audios: Audio[] }>("/api/audios");
  const audios = data?.audios ?? [];
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null); // 0..100, null = indeterminate while busy
  const fileRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  // selected file + its preview object URL
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileObjUrl, setFileObjUrl] = useState<string | null>(null);

  // Validate then accept a picked/dropped file (FEATURE 5).
  function pickFile(f: File | null | undefined) {
    if (!f) return;
    const err = validateAudioFile(f);
    if (err) {
      toast(err, "danger");
      return;
    }
    setFile(f);
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, ""));
  }
  useEffect(() => {
    if (!file) {
      setFileObjUrl(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setFileObjUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  // bulk selection
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => {
    // prune ids that no longer exist after reloads
    setSel((prev) => {
      const ids = new Set(audios.map((a) => a.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (ids.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const urlError = useMemo(() => (url.trim() ? validateAudioUrl(url) : null), [url]);
  // Block only on hard errors; the "no extension" hint is a soft warning.
  const urlBlocked = !!urlError && !urlError.startsWith("URL has no audio extension");

  async function addUrl() {
    const v = url.trim();
    if (!v || urlBlocked) return;
    setBusy(true);
    setProgress(null);
    try {
      await api("/api/audios", {
        method: "POST",
        body: JSON.stringify({ label: label || "Untitled", url: v }),
      });
      setUrl("");
      setLabel("");
      reload();
      toast("Audio added", "ok");
    } catch (e: any) {
      toast(e.message || "Failed", "danger");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  function uploadFile() {
    const f = file;
    if (!f) return;
    setBusy(true);
    setProgress(0);

    const fd = new FormData();
    fd.append("file", f);
    fd.append("label", label || f.name);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open("POST", "/api/audios/upload");

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      else setProgress(null); // indeterminate
    };
    // Once the body is fully sent, we're waiting on the server (S3 put) — go indeterminate.
    xhr.upload.onload = () => setProgress(null);

    const finish = () => {
      setBusy(false);
      setProgress(null);
      xhrRef.current = null;
    };

    xhr.onload = () => {
      let j: any = null;
      try {
        j = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        setLabel("");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        reload();
        toast("Audio uploaded", "ok");
      } else {
        toast(j?.error || `Upload failed (HTTP ${xhr.status})`, "danger");
      }
      finish();
    };
    xhr.onerror = () => {
      toast("Upload failed — check your connection", "danger");
      finish();
    };
    xhr.onabort = () => {
      toast("Upload cancelled", "info");
      finish();
    };

    xhr.send(fd);
  }

  function cancelUpload() {
    xhrRef.current?.abort();
  }

  async function remove(id: string) {
    if (!confirm("Delete this audio? Campaigns using it will fall back to default.")) return;
    try {
      await api(`/api/audios/${id}`, { method: "DELETE" });
      reload();
      toast("Deleted", "ok");
    } catch (e: any) {
      toast(e.message || "Delete failed", "danger");
    }
  }

  async function removeSelected() {
    const ids = [...sel];
    if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} audio${ids.length > 1 ? "s" : ""}? Campaigns using them will fall back to default.`)) return;
    const results = await Promise.allSettled(ids.map((id) => api(`/api/audios/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected").length;
    setSel(new Set());
    reload();
    if (failed) toast(`Deleted ${ids.length - failed}, ${failed} failed`, "danger");
    else toast(`Deleted ${ids.length}`, "ok");
  }

  const allSelected = audios.length > 0 && sel.size === audios.length;
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(audios.map((a) => a.id)));
  }
  function toggleOne(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Section>
      <Card
        title="Add audio"
        description="Paste a public audio URL, or upload a file to S3."
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
                <Label>Public audio URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://.../day1.mp3"
                  error={urlBlocked ? urlError ?? undefined : undefined}
                  hint={!urlBlocked && urlError ? urlError : undefined}
                />
              </div>

              {url.trim() && !urlBlocked && <Preview src={url.trim()} label="" />}

              <div className="md:col-span-3 flex justify-end">
                <Button
                  onClick={addUrl}
                  disabled={!url.trim() || urlBlocked}
                  loading={busy && mode === "url"}
                  leftIcon={<LinkIcon size={14} />}
                >
                  Add
                </Button>
              </div>
            </>
          ) : (
            <>
              <div className="md:col-span-2">
                <Label hint="MP3 or WAV · max 10 MB">Audio file</Label>
                <label
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    pickFile(e.dataTransfer.files?.[0]);
                  }}
                  className={`flex items-center gap-3 px-3 py-3 border rounded-lg cursor-pointer transition-colors ${
                    dragOver ? "bg-brand/10 border-brand/40" : "bg-bg/60 border-line hover:border-line2"
                  }`}
                >
                  <Upload size={14} className="text-muted shrink-0" />
                  <span className="text-sm text-ink2 flex-1 min-w-0 truncate">
                    {file ? `${file.name} · ${fmtBytes(file.size)}` : dragOver ? "Drop the audio file here" : "Drag & drop, or click to choose an MP3/WAV"}
                  </span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                    onChange={(e) => pickFile(e.target.files?.[0])}
                    className="hidden"
                  />
                </label>
              </div>

              {file && <Waveform file={file} />}
              {fileObjUrl && <Preview src={fileObjUrl} label={file ? fmtBytes(file.size) : ""} />}

              {busy && mode === "upload" && (
                <div className="md:col-span-3">
                  <div className="flex items-center justify-between text-xs text-ink2 mb-1.5">
                    <span>{progress == null ? "Processing on server…" : `Uploading… ${progress}%`}</span>
                    <button onClick={cancelUpload} className="text-muted hover:text-danger inline-flex items-center gap-1">
                      <X size={11} /> Cancel
                    </button>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-elev overflow-hidden">
                    {progress == null ? (
                      <div className="h-full w-1/3 bg-brand/70 rounded-full animate-pulse" />
                    ) : (
                      <div className="h-full bg-brand rounded-full transition-all duration-150" style={{ width: `${progress}%` }} />
                    )}
                  </div>
                </div>
              )}

              <div className="md:col-span-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-muted">
                  Goes to S3 (requires <code className="text-brand">S3_BUCKET</code> + AWS credentials).
                </div>
                <Button
                  onClick={uploadFile}
                  disabled={busy || !file}
                  loading={busy && mode === "upload"}
                  leftIcon={<Upload size={14} />}
                >
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
        <>
          <div className="flex items-center justify-between gap-3 px-1">
            <label className="inline-flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all"
                className="w-4 h-4 accent-brand cursor-pointer"
              />
              {sel.size ? `${sel.size} selected` : `${audios.length} audio${audios.length > 1 ? "s" : ""}`}
            </label>
            {sel.size > 0 && (
              <Button variant="danger" size="sm" onClick={removeSelected} leftIcon={<Trash2 size={13} />}>
                Delete {sel.size}
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {audios.map((a) => (
              <AudioRow
                key={a.id}
                a={a}
                selected={sel.has(a.id)}
                onToggle={() => toggleOne(a.id)}
                onRemove={() => remove(a.id)}
              />
            ))}
          </div>
        </>
      )}
    </Section>
  );
}
