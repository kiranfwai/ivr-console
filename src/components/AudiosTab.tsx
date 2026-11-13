"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Link as LinkIcon, Upload, Trash2, Music, X, Clock, Plus } from "lucide-react";
import {
  Button, Card, Input, Label, EmptyState, Loading, Section, Modal,
  Kebab, ConfirmDialog, toast,
} from "./ui";
import { useFetch, api } from "./useData";
import type { Audio, Campaign } from "@/lib/models";
import { fmtDate } from "@/lib/format";
import { PlayRound, Seg, SearchField, WaveBars, seedOf } from "./CampaignsKit";

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
  // Canvas can't resolve CSS variables, so read the theme token's value.
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--c-accent").trim() || "27 43 107";
  ctx.fillStyle = `rgb(${accent.split(/\s+/).join(",")})`;
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
    <div className="rounded-[10px] border border-line bg-elev px-3 py-2.5">
      <div className="mb-2 text-xs font-medium text-muted">Waveform</div>
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

/** "https://…/day-1%20voice.mp3?sig=…" → "day-1 voice.mp3" (the file name, for the card's sub-line). */
function fileNameOf(url: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last);
  } catch {
    return "";
  }
}

/* -------------------- library card -------------------- */
function AudioCard({
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
  // The length was measured and STORED when the audio was added. Only probe
  // the file when the stored value is missing (audios added before the field
  // existed), so opening this screen doesn't re-fetch every file.
  const needsProbe = !(a.durationSec && a.durationSec > 0);
  const probed = useAudioMeta(needsProbe ? a.url : null);
  const duration = needsProbe ? probed.duration : a.durationSec!;
  const file = fileNameOf(a.url);
  const added = a.createdAt ? fmtDate(a.createdAt) : "";

  return (
    <div
      className={`relative rounded-xl border bg-panel p-4 shadow-card transition-[border-color,box-shadow] ${
        selected ? "border-accent shadow-[inset_0_0_0_1px_rgb(var(--c-accent))]" : "border-line hover:shadow-pop"
      }`}
    >
      <div className="flex items-start gap-2.5">
        <label className="group/sel relative grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-[10px] bg-accent/10 text-accent">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={`Select ${a.label}`}
            className={`absolute inset-0 m-auto h-4 w-4 cursor-pointer accent-brand ${selected ? "" : "opacity-0 group-hover/sel:opacity-100 focus:opacity-100"}`}
          />
          <Music size={16} className={selected ? "invisible" : "group-hover/sel:invisible"} />
        </label>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-sm font-semibold text-ink" title={a.label}>{a.label}</b>
          <div className="mt-px truncate text-[12.5px] text-muted" title={file}>
            {a.source === "blob" ? "Uploaded" : "Link"}
            {file && <> · {file}</>}
          </div>
        </div>
        <Kebab items={[{ label: "Delete", icon: <Trash2 size={13} />, danger: true, onClick: onRemove }]} />
      </div>

      <div className="mt-3.5 flex items-center gap-2.5 rounded-[10px] border border-line bg-elev px-2.5 py-2">
        <PlayRound src={a.url} label={a.label} />
        <WaveBars seed={seedOf(a.id)} />
        <span className="text-xs text-muted tabular-nums">{fmtDuration(duration) || "—"}</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 text-[12.5px] text-muted">
        {usedBy.length === 0 ? (
          <span className="inline-flex h-[22px] items-center rounded-full border border-warn/25 bg-warn/[0.09] px-2 text-xs font-medium text-warn">
            Not used
          </span>
        ) : (
          <span
            title={usedBy.join(", ")}
            className="inline-flex h-[22px] items-center rounded-full border border-ok/25 bg-ok/[0.09] px-2 text-xs font-medium text-ok"
          >
            Used by {usedBy.length} campaign{usedBy.length === 1 ? "" : "s"}
          </span>
        )}
        {added && <span className="truncate">Added {added}</span>}
      </div>
    </div>
  );
}

/* -------------------- preview (URL or file) -------------------- */
function Preview({ src, label }: { src: string | null; label: string }) {
  const { duration, error } = useAudioMeta(src);
  if (!src) return null;
  return (
    <div className="rounded-[10px] border border-line bg-elev px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted">Preview</div>
        <div className="flex items-center gap-2 text-xs text-muted tabular-nums">
          {error ? (
            <span className="text-warn">Couldn’t read the length</span>
          ) : (
            <>
              {label}
              {duration != null && (
                <span className="inline-flex items-center gap-1">
                  <Clock size={11} />
                  {fmtDuration(duration)}
                </span>
              )}
            </>
          )}
        </div>
      </div>
      <audio controls src={src} className="h-9 w-full" />
    </div>
  );
}

type UseFilter = "all" | "used" | "unused";

export default function AudiosTab() {
  const { data, loading, reload } = useFetch<{ audios: Audio[] }>("/api/audios");
  const audios = data?.audios ?? [];
  // Which campaigns point at each audio, so deleting shows its blast radius first.
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
  const [useFilter, setUseFilter] = useState<UseFilter>("all");
  const [confirmDel, setConfirmDel] = useState<Audio | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [mode, setMode] = useState<"url" | "upload">("upload");
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
  // later auto-fill a campaign's Call Ending Duration.
  const urlMeta = useAudioMeta(mode === "url" && url.trim() ? url.trim() : null);
  const fileMeta = useAudioMeta(mode === "upload" ? fileObjUrl : null);

  // Validate then accept a picked/dropped file.
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
      setAddOpen(false);
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
        setAddOpen(false);
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

  // Filter + search narrow the list; select-all only ever picks what is on
  // screen, so a bulk Delete never removes cards the filter is hiding.
  const isUsed = (a: Audio) => !!usedByAudio.get(a.id)?.length;
  const visible = audios
    .filter((a) => useFilter === "all" || (useFilter === "used" ? isUsed(a) : !isUsed(a)))
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
  const unusedCount = audios.filter((a) => !isUsed(a)).length;
  const usedCount = audios.length - unusedCount;

  // Closing the dialog doesn't stop an upload in flight; it finishes and the
  // library reloads, exactly as before.
  function closeAdd() {
    setAddOpen(false);
  }

  const strip = [
    { label: "Audio files", value: audios.length, tone: "" },
    { label: "Total length", value: fmtDuration(totalSec) || "0:00", tone: "" },
    { label: "Used by campaigns", value: usedCount, tone: "" },
    { label: "Not used", value: unusedCount, tone: unusedCount ? "text-warn" : "" },
  ];

  return (
    <Section>
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-line bg-panel shadow-card lg:grid-cols-4">
        {strip.map((s, i) => (
          <div
            key={s.label}
            className={`px-5 py-4 ${i % 2 ? "border-l border-line" : ""} ${i >= 2 ? "border-t border-line lg:border-t-0" : ""} ${
              i === 2 ? "lg:border-l" : ""
            }`}
          >
            <div className="text-[13px] font-medium text-muted">{s.label}</div>
            <div className={`mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.035em] tabular-nums ${s.tone}`}>{s.value}</div>
          </div>
        ))}
      </div>

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
            action={<Button leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>Add audio</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <Seg<UseFilter>
              ariaLabel="Filter audios"
              value={useFilter}
              onChange={(v) => {
                setUseFilter(v);
                setSel(new Set());
              }}
              options={[
                { value: "all", label: "All", count: audios.length },
                { value: "used", label: "Used", count: usedCount },
                { value: "unused", label: "Not used", count: unusedCount },
              ]}
            />
            {visible.length > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted hover:text-ink">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 cursor-pointer accent-brand" />
                Select all
              </label>
            )}
            {sel.size > 0 && (
              <Button variant="danger" size="sm" leftIcon={<Trash2 size={13} />} onClick={() => setConfirmBulk(true)}>
                Delete {sel.size}
              </Button>
            )}
            <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <SearchField
                value={q}
                onChange={(v) => {
                  setQ(v);
                  setSel(new Set());
                }}
                placeholder="Search audios"
                className="min-w-0 flex-1 sm:w-[240px] sm:flex-none"
              />
              <Button leftIcon={<Plus size={14} />} onClick={() => setAddOpen(true)}>
                Add audio
              </Button>
            </div>
          </div>

          {visible.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {visible.map((a) => (
                <AudioCard
                  key={a.id}
                  a={a}
                  usedBy={usedByAudio.get(a.id) ?? []}
                  selected={sel.has(a.id)}
                  onToggle={() => toggleOne(a.id)}
                  onRemove={() => setConfirmDel(a)}
                />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState icon={<Music size={20} />} title="No audios match" description="Try another filter or search." />
            </Card>
          )}
        </>
      )}

      <Modal
        open={addOpen}
        onClose={closeAdd}
        title="Add audio"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={closeAdd}>
              Cancel
            </Button>
            {mode === "url" ? (
              <Button onClick={addUrl} disabled={!url.trim() || urlBlocked} loading={busy} leftIcon={<LinkIcon size={14} />}>
                Add audio
              </Button>
            ) : (
              <Button onClick={uploadFile} disabled={busy || !file} loading={busy} leftIcon={<Upload size={14} />}>
                Add audio
              </Button>
            )}
          </>
        }
      >
        <div className="mb-4 flex gap-5 border-b border-line">
          {(["upload", "url"] as const).map((m) => (
            <button
              key={m}
              type="button"
              disabled={busy}
              onClick={() => setMode(m)}
              className={`-mb-px border-b-2 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                mode === m ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {m === "upload" ? "Upload a file" : "Paste a link"}
            </button>
          ))}
        </div>

        <div className="space-y-3.5">
          {mode === "url" ? (
            <>
              <div>
                <Label>Public audio URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://.../day1.mp3"
                  error={urlBlocked ? urlError ?? undefined : undefined}
                  hint={!urlBlocked && urlError ? urlError : undefined}
                  autoFocus
                />
              </div>
              {url.trim() && !urlBlocked && <Preview src={url.trim()} label="" />}
            </>
          ) : (
            <>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  pickFile(e.dataTransfer.files?.[0]);
                }}
                className={`block cursor-pointer rounded-xl border-[1.5px] border-dashed p-[22px] text-center transition-colors ${
                  dragOver ? "border-accent bg-accent/[0.06]" : "border-line2 bg-elev hover:border-accent hover:bg-accent/[0.04]"
                }`}
              >
                <span className="mx-auto mb-2.5 grid h-[42px] w-[42px] place-items-center rounded-[11px] border border-line bg-panel text-muted shadow-xs">
                  <Upload size={18} />
                </span>
                {file ? (
                  <div className="text-sm">
                    <b className="font-semibold text-ink">{file.name}</b>
                    <div className="mt-0.5 text-xs text-muted">{fmtBytes(file.size)} · click to choose another</div>
                  </div>
                ) : (
                  <div className="text-sm text-ink2">
                    <b className="font-semibold text-accent">Click to upload</b> or drag and drop
                    <div className="mt-1 text-xs text-muted">MP3 or WAV · up to 10 MB</div>
                  </div>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                  onChange={(e) => pickFile(e.target.files?.[0])}
                  className="hidden"
                />
              </label>

              {file && <Waveform file={file} />}
              {fileObjUrl && <Preview src={fileObjUrl} label={file ? fmtBytes(file.size) : ""} />}

              {busy && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between text-xs text-ink2">
                    <span>{progress == null ? "Processing on server…" : `Uploading… ${progress}%`}</span>
                    <button onClick={cancelUpload} className="inline-flex items-center gap-1 text-muted hover:text-danger">
                      <X size={11} /> Cancel upload
                    </button>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
                    {progress == null ? (
                      <div className="h-full w-1/3 animate-pulse rounded-full bg-accent/70" />
                    ) : (
                      <div className="h-full rounded-full bg-brand transition-all duration-150" style={{ width: `${progress}%` }} />
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          <div>
            <Label>Name</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Day-1 voice" />
          </div>
        </div>
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
