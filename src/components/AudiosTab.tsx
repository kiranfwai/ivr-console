"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link as LinkIcon, Upload, Trash2, Music, X, Clock, Play, Pause } from "lucide-react";
import {
  Button, Card, Input, Label, Badge, EmptyState, Loading, Section, Modal,
  Tiles, Tile, DataPanel, DataTable, TH, TD, Kebab, ConfirmDialog, toast,
} from "./ui";
import { useFetch, api } from "./useData";
import type { Audio, Campaign } from "@/lib/models";

/* -------------------- helpers -------------------- */

/**
 * A small dark play/pause button for the library rows. The browser's own
 * <audio controls> drew a white bar per row that read "0:00 / 0:00" until
 * played, on a dark page. One shared player: starting a row stops the last.
 */
let sharedPlayer: HTMLAudioElement | null = null;
const PLAY_EVENT = "ivr-audio-play";
function PlayButton({ src, label }: { src: string; label: string }) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const other = (e: Event) => { if ((e as CustomEvent).detail !== src) setPlaying(false); };
    window.addEventListener(PLAY_EVENT, other);
    return () => window.removeEventListener(PLAY_EVENT, other);
  }, [src]);
  function toggle() {
    if (playing) { sharedPlayer?.pause(); setPlaying(false); return; }
    sharedPlayer?.pause();
    sharedPlayer = new Audio(src);
    sharedPlayer.onended = () => setPlaying(false);
    sharedPlayer.onerror = () => { setPlaying(false); toast("Couldn't play this audio", "danger"); };
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: src }));
    void sharedPlayer.play().catch(() => setPlaying(false));
    setPlaying(true);
  }
  return (
    <button type="button" onClick={toggle} aria-label={`${playing ? "Pause" : "Play"} ${label}`}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors ${
        playing ? "border-accent/40 bg-accent/10 text-accent" : "border-line text-ink2 hover:text-ink hover:bg-elev/60"}`}>
      {playing ? <Pause size={13} /> : <Play size={13} />}
      {playing ? "Pause" : "Play"}
    </button>
  );
}
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
  ctx.fillStyle = "rgb(var(--c-accent))";
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
  usedBy,
  selected,
  onToggle,
  onRemove,
}: {
  a: Audio;
  /** Campaigns currently pointing at this audio — the blast radius of deleting it. */
  usedBy: string[];
  selected: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  // The length was measured and STORED when the audio was added, and the API
  // returns it. The old row ignored that and mounted a hidden <audio
  // preload="metadata"> per row instead, so opening this screen re-fetched a
  // slice of every file, every time. Only probe when the stored value is
  // missing (audios added before the field existed).
  const needsProbe = !(a.durationSec && a.durationSec > 0);
  const probed = useAudioMeta(needsProbe ? a.url : null);
  const duration = needsProbe ? probed.duration : a.durationSec!;

  return (
    <tr className="transition-colors hover:bg-ink/[0.022]">
      <td className={TD}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${a.label}`}
          className="w-4 h-4 accent-brand cursor-pointer"
        />
      </td>
      <td className={TD}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent shadow-[inset_0_0_0_1px_rgb(var(--c-accent)/0.25)]">
            <Music size={13} />
          </span>
          <span className="font-semibold truncate">{a.label}</span>
        </div>
      </td>
      <td className={`${TD} tabular-nums text-ink2`}>{fmtDuration(duration) || "—"}</td>
      <td className={TD}>
        <Badge tone={a.source === "blob" ? "accent" : "muted"}>
          {a.source === "blob" ? "Uploaded" : "Link"}
        </Badge>
      </td>
      <td className={TD}>
        {usedBy.length === 0 ? (
          <Badge tone="warn">Not used</Badge>
        ) : (
          <span className="text-ink2" title={usedBy.join(", ")}>
            {usedBy.length} campaign{usedBy.length === 1 ? "" : "s"}
          </span>
        )}
      </td>
      <td className={TD}>
        <PlayButton src={a.url} label={a.label} />
      </td>
      <td className={TD}>
        <Kebab items={[{ label: "Delete", icon: <Trash2 size={13} />, danger: true, onClick: onRemove }]} />
      </td>
    </tr>
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
  const { data, loading, reload } = useFetch<{ audios: Audio[] }>("/api/audios");
  const audios = data?.audios ?? [];
  // Which campaigns point at each audio. Free — the campaigns list is already
  // fetched on the next screen over, and it turns "campaigns using it will fall
  // back to default" into a number you can see BEFORE you delete.
  const { data: campData } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const usedByAudio = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of campData?.campaigns ?? []) {
      if (!c.audioId) continue;
      m.set(c.audioId, [...(m.get(c.audioId) ?? []), c.name]);
    }
    return m;
  }, [campData]);
  const [addOpen, setAddOpen] = useState(false);
  const [q, setQ] = useState("");
  const [onlyUnused, setOnlyUnused] = useState(false);
  const [confirmDel, setConfirmDel] = useState<Audio | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
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

  // Detect playback duration in the browser so we can store it on the audio and
  // later auto-fill a campaign's Call Ending Duration. Probes the current URL (URL
  // mode) or the picked file's object URL (upload mode).
  const urlMeta = useAudioMeta(mode === "url" && url.trim() ? url.trim() : null);
  const fileMeta = useAudioMeta(mode === "upload" ? fileObjUrl : null);

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
        body: JSON.stringify({
          label: label || "Untitled",
          url: v,
          durationSec: urlMeta.duration && isFinite(urlMeta.duration) ? Math.round(urlMeta.duration) : undefined,
        }),
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
    if (fileMeta.duration && isFinite(fileMeta.duration)) {
      fd.append("durationSec", String(Math.round(fileMeta.duration)));
    }

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
    const results = await Promise.allSettled(ids.map((id) => api(`/api/audios/${id}`, { method: "DELETE" })));
    const failed = results.filter((r) => r.status === "rejected").length;
    setSel(new Set());
    reload();
    if (failed) toast(`Deleted ${ids.length - failed}, ${failed} failed`, "danger");
    else toast(`Deleted ${ids.length}`, "ok");
  }

  // Search / Unused narrow the list; select-all must only ever pick what is
  // on screen, or a bulk Delete would remove rows the filter is hiding.
  const visible = audios
    .filter((a) => !onlyUnused || !(usedByAudio.get(a.id)?.length))
    .filter((a) => !q.trim() || a.label.toLowerCase().includes(q.trim().toLowerCase()));
  const allSelected = visible.length > 0 && visible.every((a) => sel.has(a.id));
  function toggleAll() {
    setSel(allSelected ? new Set() : new Set(visible.map((a) => a.id)));
  }
  function toggleOne(id: string) {
    setSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const totalSec = audios.reduce((n, a) => n + (a.durationSec || 0), 0);
  const unusedCount = audios.filter((a) => !usedByAudio.get(a.id)?.length).length;

  return (
    <Section>
      <Tiles>
        <Tile label="Audio files" value={audios.length}
              sub={`${audios.filter((a) => a.source === "blob").length} uploaded · ${audios.filter((a) => a.source !== "blob").length} linked`} />
        <Tile label="Total length" value={fmtDuration(totalSec) || "0:00"}
              sub={audios.length ? `longest ${fmtDuration(Math.max(...audios.map((a) => a.durationSec || 0))) || "—"}` : "nothing yet"} />
        <Tile label="Used by campaigns" value={audios.length - unusedCount} sub="linked to at least one" />
        <Tile label="Unused" value={unusedCount}
              sub={unusedCount ? "not linked to any campaign" : "all in use"}
              tone={unusedCount ? "warn" : "muted"} />
      </Tiles>

      {loading && !data ? (
        <Card>
          <Loading label="Loading your audio library…" />
        </Card>
      ) : !audios.length ? (
        <Card>
          <EmptyState
            icon={<Music size={20} />}
            title="No audios yet"
            description="Add one, then link it to a campaign under Campaigns."
            action={<Button leftIcon={<Upload size={14} />} onClick={() => setAddOpen(true)}>Add audio</Button>}
          />
        </Card>
      ) : (
        <DataPanel
          title="Audio library"
          meta={`${audios.length} file${audios.length === 1 ? "" : "s"}`}
          action={
            <>
              <Input value={q} onChange={(e) => { setQ(e.target.value); setSel(new Set()); }} placeholder="Search audios…" className="w-40 sm:w-48" />
              <Button size="sm" variant={onlyUnused ? "primary" : "ghost"} onClick={() => { setOnlyUnused((v) => !v); setSel(new Set()); }}
                      title="Show only audios no campaign uses">
                Unused{unusedCount ? ` (${unusedCount})` : ""}
              </Button>
              {sel.size > 0 && (
                <Button variant="danger" size="sm" leftIcon={<Trash2 size={13} />} onClick={() => setConfirmBulk(true)}>
                  Delete {sel.size}
                </Button>
              )}
              <Button size="sm" leftIcon={<Upload size={13} />} onClick={() => setAddOpen(true)}>
                Add audio
              </Button>
            </>
          }
        >
          <DataTable>
            <thead>
              <tr>
                <th className={`${TH} w-[44px]`}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                    className="w-4 h-4 accent-brand cursor-pointer"
                  />
                </th>
                <th className={TH}>Label</th>
                <th className={TH}>Length</th>
                <th className={TH}>Source</th>
                <th className={TH}>Used by</th>
                <th className={TH}>Preview</th>
                <th className={`${TH} w-[52px]`} />
              </tr>
            </thead>
            <tbody>
              {visible.map((a) => (
                <AudioRow
                  key={a.id}
                  a={a}
                  usedBy={usedByAudio.get(a.id) ?? []}
                  selected={sel.has(a.id)}
                  onToggle={() => toggleOne(a.id)}
                  onRemove={() => setConfirmDel(a)}
                />
              ))}
            </tbody>
          </DataTable>
        </DataPanel>
      )}

      {/* Adding moved off the page and into a dialog. Same URL/upload switch,
          same waveform, same progress bar — it just no longer occupies the top
          half of the screen when you only came to find a file. */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add audio" maxWidth="max-w-3xl">
      <Card
        title="Add audio"
        description="Paste a public audio URL, or upload a file to S3."
        action={
          <div className="inline-flex p-1 bg-elev/60 border border-line rounded-lg">
            <button
              onClick={() => setMode("url")}
              className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 transition-all ${
                mode === "url" ? "bg-accent/15 text-accent" : "text-ink2 hover:text-ink"
              }`}
            >
              <LinkIcon size={12} />
              Paste URL
            </button>
            <button
              onClick={() => setMode("upload")}
              className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1.5 transition-all ${
                mode === "upload" ? "bg-accent/15 text-accent" : "text-ink2 hover:text-ink"
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
                    dragOver ? "bg-accent/10 border-accent/40" : "bg-bg/60 border-line hover:border-line2"
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
                      <div className="h-full w-1/3 bg-accent/70 rounded-full animate-pulse" />
                    ) : (
                      <div className="h-full bg-brand rounded-full transition-all duration-150" style={{ width: `${progress}%` }} />
                    )}
                  </div>
                </div>
              )}

              <div className="md:col-span-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="text-xs text-muted">
                  Goes to S3 (requires <code className="text-accent">S3_BUCKET</code> + AWS credentials).
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

      </Modal>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete audio"
        confirmLabel="Delete audio"
        body={
          <>
            Delete <span className="font-medium text-ink">{confirmDel?.label}</span>?
            {(() => {
              const names = confirmDel ? usedByAudio.get(confirmDel.id) ?? [] : [];
              return names.length ? (
                <>
                  {" "}It is used by <span className="font-medium text-ink">{names.length} campaign
                  {names.length === 1 ? "" : "s"}</span> ({names.join(", ")}), which will fall back to the
                  default audio.
                </>
              ) : (
                <> No campaign is using it.</>
              );
            })()}
          </>
        }
        onConfirm={() => {
          if (confirmDel) remove(confirmDel.id);
          setConfirmDel(null);
        }}
        onClose={() => setConfirmDel(null)}
      />

      <ConfirmDialog
        open={confirmBulk}
        title={`Delete ${sel.size} audio${sel.size === 1 ? "" : "s"}`}
        confirmLabel={`Delete ${sel.size}`}
        body={
          <>
            Delete {sel.size} selected file{sel.size === 1 ? "" : "s"}? Any campaign using one of them falls
            back to the default audio.
          </>
        }
        onConfirm={() => {
          removeSelected();
          setConfirmBulk(false);
        }}
        onClose={() => setConfirmBulk(false)}
      />
    </Section>
  );
}
