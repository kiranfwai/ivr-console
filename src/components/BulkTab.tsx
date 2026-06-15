"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, RotateCw, Users, AlertCircle, Wifi, WifiOff } from "lucide-react";
import { Button, Card, Label, Select, Textarea, Badge, EmptyState, Section, CsvFilePicker, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { BulkJobWithCounts, BulkRow, Campaign } from "@/lib/models";

const PHONE_KEYS = ["phone", "mobile", "number", "contact", "tel", "mob", "msisdn"];
const NAME_KEYS  = ["name", "full name", "fullname", "lead", "first name", "firstname"];
const EMAIL_KEYS = ["email", "email address", "e-mail", "emailid", "email id"];

function parseRows(csv: string): { phone: string; name?: string; email?: string }[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const firstLower = lines[0].toLowerCase();
  if (PHONE_KEYS.some((k) => firstLower.includes(k))) {
    const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
    const pIdx = header.findIndex((h) => PHONE_KEYS.includes(h));
    const nIdx = header.findIndex((h) => NAME_KEYS.includes(h));
    const eIdx = header.findIndex((h) => EMAIL_KEYS.includes(h));
    return lines.slice(1).map((line) => {
      const cols = line.split(",").map((c) => c.trim());
      const phone = (pIdx >= 0 ? cols[pIdx] : cols[0] || "").trim();
      return {
        phone,
        name: nIdx >= 0 ? cols[nIdx] || undefined : undefined,
        email: eIdx >= 0 ? cols[eIdx] || undefined : undefined,
      };
    }).filter((r) => /\d/.test(r.phone));
  }
  return lines.map((line) => {
    const [phone, ...rest] = line.split(",");
    return { phone: phone.trim(), name: rest.join(",").trim() || undefined };
  }).filter((r) => /\d/.test(r.phone));
}

type Counts = ReturnType<typeof summarize>;

function summarize(job: BulkJobWithCounts) {
  const c = job.counts || {};
  const press1 = c.press1 ?? 0, connected = c.connected ?? 0, ok = c.ok ?? 0;
  const busy = c.busy ?? 0, noAnswer = c["no-answer"] ?? 0, rejected = c.rejected ?? 0;
  const error = c.error ?? 0, failed = c.failed ?? 0;
  const pending = c.pending ?? 0, dialing = c.dialing ?? 0;
  const total = job.total || 0;
  const good = press1 + connected + ok;
  const bad = busy + noAnswer + rejected + error + failed;
  const dialed = total - pending - dialing;
  return {
    press1, connected, ok, busy, noAnswer, rejected, error, failed, pending, dialing,
    total, good, bad, dialed,
    retryable: busy + noAnswer + error + failed,
    donePct: total ? Math.round(((good + bad) / total) * 100) : 0,
  };
}

export default function BulkTab() {
  const { data: cdata } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const { data: jdata, reload: reloadJobs } = useFetch<{ jobs: BulkJobWithCounts[] }>("/api/bulk");
  const campaigns = cdata?.campaigns ?? [];
  const jobs = (jdata?.jobs ?? []).filter((j) => (j.kind ?? "call") === "call");

  const [campaignId, setCampaignId] = useState("");
  const [csv, setCsv] = useState("phone,name,email\n");
  const [concurrency, setConcurrency] = useState(30);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [job, setJob] = useState<BulkJobWithCounts | null>(null);
  const [log, setLog] = useState<BulkRow[]>([]);
  const [failed, setFailed] = useState<BulkRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [cpm, setCpm] = useState(0);
  const sampleRef = useRef<{ t: number; dialed: number } | null>(null);

  const counts = useMemo(() => (job ? summarize(job) : null), [job]);
  const running = job?.status === "running";
  const previewCount = useMemo(() => parseRows(csv).length, [csv]);

  // Poll the active job for live progress. Display-only — the backend dials.
  useEffect(() => {
    if (!activeJobId) return;
    let alive = true;
    const tick = async () => {
      try {
        const { job: j } = await api<{ job: BulkJobWithCounts }>(`/api/bulk/${activeJobId}`);
        if (!alive) return;
        setJob(j);
        setStale(false);
        setUpdatedAt(Date.now());
        const s = summarize(j);
        const now = Date.now();
        const prev = sampleRef.current;
        if (prev && now > prev.t && j.status === "running") {
          const dt = (now - prev.t) / 60000;
          setCpm(dt > 0 ? Math.max(0, Math.round((s.dialed - prev.dialed) / dt)) : 0);
        } else if (j.status !== "running") {
          setCpm(0);
        }
        sampleRef.current = { t: now, dialed: s.dialed };
        if (j.status === "running") {
          api<{ rows: BulkRow[] }>(`/api/bulk/${activeJobId}/rows?view=recent&limit=12`)
            .then((r) => alive && setLog(r.rows)).catch(() => {});
        }
        api<{ rows: BulkRow[] }>(`/api/bulk/${activeJobId}/rows?view=failed&limit=100`)
          .then((r) => alive && setFailed(r.rows)).catch(() => {});
      } catch {
        if (alive) setStale(true);
      }
    };
    tick();
    const h = setInterval(tick, job?.status === "running" ? 2000 : 6000);
    return () => { alive = false; clearInterval(h); };
  }, [activeJobId, job?.status]);

  async function start() {
    const rows = parseRows(csv);
    if (!campaignId || !rows.length) return;
    setSubmitting(true);
    try {
      const { job: j } = await api<{ job: BulkJobWithCounts }>("/api/bulk", {
        method: "POST",
        body: JSON.stringify({ campaignId, rows, concurrency }),
      });
      setActiveJobId(j.id);
      setJob(j);
      sampleRef.current = null;
      setLog([]); setFailed([]);
      setCsv("phone,name,email\n");
      reloadJobs();
      toast(`Queued ${rows.length} calls — dialing in the background. Safe to close this tab.`, "ok");
    } catch (e: any) {
      toast(e.message || "Failed to queue", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  async function pause() {
    if (!job) return;
    try {
      const { job: j } = await api<{ job: BulkJobWithCounts }>(`/api/bulk/${job.id}/pause`, { method: "POST" });
      setJob({ ...j, counts: job.counts });
      reloadJobs();
      toast("Paused — remaining calls held. Resume any time.", "ok");
    } catch (e: any) {
      toast(e.message || "Failed to pause", "danger");
    }
  }

  async function resume(id: string) {
    setActiveJobId(id);
    sampleRef.current = null;
    try {
      const { job: j } = await api<{ job: BulkJobWithCounts }>(`/api/bulk/${id}/resume`, { method: "POST" });
      setJob((prev) => ({ ...j, counts: prev?.counts ?? {} }));
      reloadJobs();
      toast("Resumed — backend is dialing the remaining numbers.", "ok");
    } catch (e: any) {
      toast(e.message || "Failed to resume", "danger");
    }
  }

  async function retry(id: string) {
    try {
      const r = await api<{ job: BulkJobWithCounts; count: number }>(`/api/bulk/${id}/retry`, { method: "POST" });
      setActiveJobId(r.job.id);
      setJob(r.job);
      sampleRef.current = null;
      setLog([]); setFailed([]);
      reloadJobs();
      toast(`Queued ${r.count} failed numbers for retry — running in the background.`, "ok");
    } catch (e: any) {
      toast(e.message || "No retry-able rows", "danger");
    }
  }

  const ratePerMin = Math.round(concurrency * 60 / 1.5); // rough: ~1.5s per call slot

  if (!campaigns.length) {
    return (
      <Section>
        <Card>
          <EmptyState
            icon={<Users size={20} />}
            title="Create a campaign first"
            description="Bulk dialing needs a campaign for audio, prompt and the press-1 webhook. Head to Campaigns."
          />
        </Card>
      </Section>
    );
  }

  return (
    <Section>
      <Card title="Start a campaign" description="Submitted to the backend — it dials on the server, not your browser.">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2 md:col-span-2">
            <Label>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Choose campaign…</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label hint="parallel calls">Concurrency</Label>
            <Select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
              {[10, 20, 30, 40].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={start} disabled={!campaignId || !previewCount || submitting} loading={submitting}
              leftIcon={<Play size={14} />} className="w-full" size="lg">
              {submitting ? "Queuing…" : `Start · ${previewCount}`}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted mt-3">
          ~{ratePerMin.toLocaleString()} calls/min at concurrency {concurrency}
          {previewCount > 0 && ` · ~${Math.max(1, Math.ceil(previewCount / ratePerMin))} min for ${previewCount.toLocaleString()} numbers`}.
          Backend caps parallelism for box safety.
        </p>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <Label>Numbers · CSV with headers phone, name, email</Label>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="tabular-nums">{previewCount.toLocaleString()} recipients</span>
              <CsvFilePicker onLoad={setCsv} />
              <button onClick={() => setCsv("phone,name,email\n")}
                className="px-2 py-1 rounded-md bg-elev/60 hover:bg-elev text-ink2 hover:text-ink border border-line transition-colors">
                Clear
              </button>
            </div>
          </div>
          <Textarea rows={6} value={csv} onChange={(e) => setCsv(e.target.value)}
            placeholder={"phone,name,email\n9876543210,Animesh,animesh@example.com\n9123456789,Test,"} />
        </div>
      </Card>

      {job && counts && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <span>Campaign progress</span>
              <StatusPill status={job.status} pending={counts.pending} />
            </div>
          }
          description={
            <span className="flex items-center gap-2 font-mono text-xs">
              {job.id}
              <ConnDot stale={stale} updatedAt={updatedAt} />
            </span>
          }
          action={
            <div className="flex gap-2">
              {running
                ? <Button variant="danger" leftIcon={<Square size={12} />} onClick={pause}>Stop</Button>
                : counts.pending > 0
                  ? <Button leftIcon={<Play size={12} />} onClick={() => resume(job.id)}>Resume</Button>
                  : null}
            </div>
          }
        >
          <StackedBar counts={counts} />

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs">
            <span className="text-ink tabular-nums font-semibold">{counts.donePct}% complete</span>
            <span className="text-muted tabular-nums">{(counts.good + counts.bad).toLocaleString()} / {counts.total.toLocaleString()}</span>
            {running && <span className="text-ok tabular-nums font-semibold">{cpm.toLocaleString()} calls/min</span>}
            {running && cpm > 0 && counts.pending > 0 && (
              <span className="text-muted">ETA ~{fmtEta(Math.round((counts.pending / cpm) * 60))}</span>
            )}
            {counts.dialing > 0 && <span className="text-warn tabular-nums">{counts.dialing} dialing</span>}
          </div>

          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Press 1" value={counts.press1} tone="ok" />
            <Stat label="Connected" value={counts.connected} tone="ok" />
            <Stat label="No answer" value={counts.noAnswer} tone="warn" />
            <Stat label="Busy" value={counts.busy} tone="warn" />
            <Stat label="Rejected" value={counts.rejected} tone="danger" />
            <Stat label="Error" value={counts.error + counts.failed} tone="danger" />
            <Stat label="Pending" value={counts.pending} tone="muted" />
            <Stat label="Total" value={counts.total} tone="muted" />
          </div>

          {running && log.length > 0 && (
            <div className="mt-4">
              <Label>Live dispatch</Label>
              <div className="mt-1.5 max-h-56 overflow-auto rounded-lg border border-line bg-bg/50 divide-y divide-line/60">
                {log.map((r, i) => (
                  <div key={`${r.idx}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs font-mono">
                    <span className="truncate">
                      <span className="text-muted">[{r.idx}]</span> {r.phone}
                      {r.name && <span className="text-muted ml-1">— {r.name}</span>}
                    </span>
                    <RowStatus row={r} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {counts.retryable > 0 && job.status !== "running" && (
            <div className="mt-4 flex items-center justify-between gap-3 bg-warn/5 border border-warn/20 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2.5">
                <AlertCircle size={16} className="text-warn shrink-0" />
                <div className="text-sm">
                  <span className="text-ink">{counts.retryable.toLocaleString()} numbers didn&apos;t connect.</span>
                  <span className="text-muted ml-1">Retry no-answer / busy / errors in a new campaign.</span>
                </div>
              </div>
              <Button leftIcon={<RotateCw size={12} />} onClick={() => retry(job.id)}>Retry failed</Button>
            </div>
          )}

          {failed.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-muted cursor-pointer hover:text-ink">
                See failed numbers ({failed.length}{failed.length >= 100 ? "+" : ""})
              </summary>
              <div className="mt-2 max-h-64 overflow-auto text-xs font-mono space-y-0.5 bg-bg/50 rounded-md p-2">
                {failed.map((r, i) => (
                  <div key={`${r.idx}-${i}`} className="flex justify-between gap-3 py-0.5">
                    <span><span className="text-muted">[{r.idx}]</span> {r.phone}{r.name && <span className="text-muted ml-1">— {r.name}</span>}</span>
                    <span className="text-muted">{r.status}{r.hangupCause ? ` · ${r.hangupCause}` : ""}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </Card>
      )}

      {!!jobs.length && (
        <Card title="Recent campaigns">
          <div className="space-y-1">
            {jobs.slice(0, 8).map((j) => {
              const s = summarize(j);
              const isActive = activeJobId === j.id;
              return (
                <button key={j.id} onClick={() => { setActiveJobId(j.id); setJob(j); sampleRef.current = null; }}
                  className={`w-full text-left rounded-lg px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                    isActive ? "bg-brand/10 border border-brand/25" : "hover:bg-elev/60 border border-transparent"
                  }`}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Users size={14} className="text-muted shrink-0" />
                    <div className="min-w-0">
                      <div className="font-mono text-xs truncate">{j.id}</div>
                      <div className="text-xs text-muted">{new Date(j.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <StatusPill status={j.status} pending={s.pending} small />
                    <Badge tone="ok">{s.good.toLocaleString()}</Badge>
                    {s.bad > 0 && <Badge tone="danger">{s.bad.toLocaleString()}</Badge>}
                    <span className="text-muted">/ {s.total.toLocaleString()}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </Section>
  );
}

function StatusPill({ status, pending, small }: { status: string; pending: number; small?: boolean }) {
  const map: Record<string, { tone: "ok" | "warn" | "muted"; label: string; dot?: boolean }> = {
    running: { tone: "warn", label: "running", dot: true },
    paused: { tone: "muted", label: pending > 0 ? "paused" : "stopped" },
    completed: { tone: "ok", label: "complete" },
  };
  const m = map[status] ?? { tone: "muted", label: status };
  return <Badge tone={m.tone} dot={m.dot}>{m.label}</Badge>;
}

function ConnDot({ stale, updatedAt }: { stale: boolean; updatedAt: number | null }) {
  const [, force] = useState(0);
  useEffect(() => { const h = setInterval(() => force((n) => n + 1), 1000); return () => clearInterval(h); }, []);
  if (stale) {
    return <span className="inline-flex items-center gap-1 text-warn"><WifiOff size={11} /> reconnecting…</span>;
  }
  const ago = updatedAt ? Math.round((Date.now() - updatedAt) / 1000) : null;
  return <span className="inline-flex items-center gap-1 text-muted"><Wifi size={11} /> {ago === null ? "" : `updated ${ago}s ago`}</span>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "danger" | "muted" }) {
  const c = { ok: "text-ok", warn: "text-warn", danger: "text-danger", muted: "text-ink2" }[tone];
  return (
    <div className="bg-bg/60 border border-line rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${c}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function RowStatus({ row }: { row: BulkRow }) {
  const tone =
    row.status === "press1" || row.status === "connected" || row.status === "ok" ? "text-ok"
      : row.status === "dialing" ? "text-warn"
      : row.status === "pending" ? "text-muted"
      : "text-danger";
  return <span className={`${tone} whitespace-nowrap`}>{row.status}{row.hangupCause ? ` · ${row.hangupCause}` : ""}</span>;
}

function StackedBar({ counts }: { counts: Counts }) {
  const t = counts.total || 1;
  const seg = (n: number) => `${(n / t) * 100}%`;
  return (
    <div className="w-full h-3 bg-line rounded-full overflow-hidden flex" title="green: engaged/connected · red: failed · amber: dialing · grey: pending">
      <div className="h-full bg-ok transition-all duration-500" style={{ width: seg(counts.good) }} />
      <div className="h-full bg-danger transition-all duration-500" style={{ width: seg(counts.bad) }} />
      <div className="h-full bg-warn transition-all duration-500" style={{ width: seg(counts.dialing) }} />
    </div>
  );
}

function fmtEta(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}
