"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Square, RotateCw, Users, CheckCircle2, AlertCircle, Phone } from "lucide-react";
import { Button, Card, Input, Label, Select, Textarea, Badge, EmptyState, Section, CsvFilePicker, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { BulkJob, Campaign } from "@/lib/models";

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

type Metrics = { cpm: number; dispatched: number; etaSec: number };

export default function BulkTab() {
  const { data: cdata } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const { data: jdata, reload: reloadJobs } = useFetch<{ jobs: BulkJob[] }>("/api/bulk");
  const campaigns = cdata?.campaigns ?? [];
  const jobs = (jdata?.jobs ?? []).filter((j) => (j.kind ?? "call") === "call");

  const [campaignId, setCampaignId] = useState<string>("");
  const [csv, setCsv] = useState<string>("phone,name,email\n");
  const [delayMs, setDelayMs] = useState<number>(1000);
  const [concurrency, setConcurrency] = useState<number>(3);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<BulkJob | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  // Rolling sample to estimate calls/min from successive progress polls.
  const sampleRef = useRef<{ t: number; dispatched: number } | null>(null);

  const counts = activeJob ? tally(activeJob) : null;
  const previewCount = parseRows(csv).length;
  // The backend worker drives the job; "running" is derived purely from its state.
  const running = !!activeJob && !activeJob.paused && !!counts && counts.pending + counts.dialing > 0;

  // Poll the active job for progress. The browser no longer dials anything — the
  // server-side worker does — so this is display-only and safe to close any time.
  useEffect(() => {
    if (!activeJobId) return;
    const fn = async () => {
      try {
        const j = await api<{ job: BulkJob }>(`/api/bulk/${activeJobId}`);
        setActiveJob(j.job);
        const t = tally(j.job);
        const dispatched = t.total - t.pending - t.dialing;
        const pending = t.pending + t.dialing;
        const now = Date.now();
        const prev = sampleRef.current;
        if (prev && now > prev.t && !j.job.paused && pending > 0) {
          const dt = (now - prev.t) / 60000;
          const cpm = dt > 0 ? Math.max(0, Math.round((dispatched - prev.dispatched) / dt)) : 0;
          const etaSec = cpm > 0 ? Math.round((pending / cpm) * 60) : 0;
          setMetrics({ cpm, dispatched, etaSec });
        } else if (j.job.paused || pending === 0) {
          setMetrics(null);
        }
        sampleRef.current = { t: now, dispatched };
      } catch {}
    };
    fn();
    const h = setInterval(fn, running ? 2500 : 7000);
    return () => clearInterval(h);
  }, [activeJobId, running]);

  async function start() {
    const rows = parseRows(csv);
    if (!campaignId || !rows.length) return;
    setSubmitting(true);
    try {
      const r = await api<{ job: BulkJob }>("/api/bulk", {
        method: "POST",
        body: JSON.stringify({ campaignId, rows, delayMs, concurrency }),
      });
      setActiveJobId(r.job.id);
      setActiveJob(r.job);
      sampleRef.current = null;
      setCsv("phone,name,email\n");
      reloadJobs();
      toast(`Queued ${rows.length} calls — dialing in the background. You can close this tab.`, "ok");
    } catch (e: any) {
      toast(e.message || "Failed", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  // Stop = pause on the backend. Pending rows stay queued; Resume continues.
  async function stop() {
    if (!activeJob) return;
    try {
      const r = await api<{ job: BulkJob }>(`/api/bulk/${activeJob.id}/pause`, { method: "POST" });
      setActiveJob(r.job);
      setMetrics(null);
      reloadJobs();
      toast("Paused — remaining calls are held. Resume any time.", "ok");
    } catch (e: any) {
      toast(e.message || "Failed to pause", "danger");
    }
  }

  async function resume(jobId: string) {
    setActiveJobId(jobId);
    sampleRef.current = null;
    try {
      const r = await api<{ job: BulkJob }>(`/api/bulk/${jobId}/resume`, { method: "POST" });
      setActiveJob(r.job);
      reloadJobs();
      toast("Resumed — backend is dialing the remaining numbers.", "ok");
    } catch (e: any) {
      toast(e.message || "Failed to resume", "danger");
    }
  }

  async function retry(jobId: string) {
    try {
      const r = await api<{ job: BulkJob; count: number }>(`/api/bulk/${jobId}/retry`, { method: "POST" });
      setActiveJobId(r.job.id);
      setActiveJob(r.job);
      sampleRef.current = null;
      reloadJobs();
      toast(`Queued ${r.count} failed rows for retry — running in the background.`, "ok");
    } catch (e: any) {
      toast(e.message || "No retry-able rows", "danger");
    }
  }

  if (!campaigns.length) {
    return (
      <Section>
        <Card>
          <EmptyState
            icon={<Users size={20} />}
            title="Create a campaign first"
            description="Bulk dialing needs a campaign to pull audio + webhook from. Head to Campaigns."
          />
        </Card>
      </Section>
    );
  }

  return (
    <Section>
      <Card title="Start a bulk run">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2 md:col-span-1">
            <Label>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Choose campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label hint="parallel calls per batch">Concurrency</Label>
            <Select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
              {[1, 3, 10, 20, 30, 50, 75, 100].map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label hint="ms between batches">Batch delay</Label>
            <Select value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))}>
              {[150, 200, 250, 500, 1000, 2000, 5000].map((v) => (
                <option key={v} value={v}>{v} ms</option>
              ))}
            </Select>
            {delayMs < 250 && (
              <div className="flex items-start gap-1 mt-1.5 text-xs text-warn">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                <span>Delays below 250 ms increase risk of rate limiting from your telephony provider (e.g. Plivo). Use with caution.</span>
              </div>
            )}
          </div>
          <div className="flex items-end col-span-2 md:col-span-1">
            <Button
              onClick={start}
              disabled={!campaignId || !previewCount || submitting}
              loading={submitting}
              leftIcon={<Play size={14} />}
              className="w-full"
              size="lg"
            >
              {submitting ? "Queuing…" : `Start · ${previewCount} recipients`}
            </Button>
          </div>
        </div>
        {!running && (
          <p className="text-xs text-muted mt-3">
            Est. rate: ~{Math.round((concurrency / Math.max(delayMs, 150)) * 60000)} calls/min ·{" "}
            {previewCount > 0
              ? `${Math.ceil(previewCount / Math.max(1, Math.round((concurrency / Math.max(delayMs, 150)) * 60000)))} min for ${previewCount} contacts`
              : "upload a CSV to see estimate"}
          </p>
        )}
        {running && metrics && (
          <div className="mt-3 flex flex-wrap items-center gap-4 text-xs">
            <span className="text-ok font-semibold tabular-nums">{metrics.cpm} calls/min</span>
            <span className="text-muted">{metrics.dispatched} dispatched</span>
            {metrics.etaSec > 0 && (
              <span className="text-muted">ETA ~{metrics.etaSec < 60 ? `${metrics.etaSec}s` : `${Math.round(metrics.etaSec / 60)}m`}</span>
            )}
          </div>
        )}

        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <Label>Numbers · CSV with headers phone, name, email</Label>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="tabular-nums">{previewCount} recipients</span>
              <CsvFilePicker onLoad={setCsv} />
              <button
                onClick={() => setCsv("phone,name,email\n")}
                className="px-2 py-1 rounded-md bg-elev/60 hover:bg-elev text-ink2 hover:text-ink border border-line transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
          <Textarea
            rows={6}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"phone,name,email\n9876543210,Animesh,animesh@example.com\n9123456789,Test,"}
          />
        </div>
      </Card>

      {activeJob && counts && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <span>Active job</span>
              <Badge tone={running ? "warn" : counts.pending > 0 ? "warn" : "ok"} dot={running}>
                {running ? "running" : counts.pending > 0 ? "paused" : "complete"}
              </Badge>
            </div>
          }
          description={<span className="font-mono">{activeJob.id}</span>}
          action={
            <div className="flex gap-2">
              {running ? (
                <Button variant="danger" leftIcon={<Square size={12} />} onClick={stop}>Stop</Button>
              ) : counts.pending > 0 ? (
                <Button leftIcon={<Play size={12} />} onClick={() => resume(activeJob.id)}>Resume</Button>
              ) : null}
            </div>
          }
        >
          <ProgressBar counts={counts} />
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

          {counts.retryable > 0 && !running && (
            <div className="mt-4 flex items-center justify-between gap-3 bg-warn/5 border border-warn/20 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2.5">
                <AlertCircle size={16} className="text-warn shrink-0" />
                <div className="text-sm">
                  <span className="text-ink">{counts.retryable} rows didn&apos;t connect.</span>
                  <span className="text-muted ml-1">Retry no-answer / busy / errors in a new job.</span>
                </div>
              </div>
              <Button leftIcon={<RotateCw size={12} />} onClick={() => retry(activeJob.id)}>
                Retry failed
              </Button>
            </div>
          )}

          {counts.retryable > 0 && (
            <details className="mt-3">
              <summary className="text-xs text-muted cursor-pointer hover:text-ink">
                See {counts.retryable} failed rows
              </summary>
              <div className="mt-2 max-h-64 overflow-auto text-xs font-mono space-y-1 bg-bg/50 rounded-md p-2">
                {activeJob.rows
                  .map((r, i) => ({ r, i }))
                  .filter((x) => isRetryable(x.r.status))
                  .map(({ r, i }) => (
                    <div key={i} className="flex justify-between gap-3 py-0.5">
                      <span>
                        <span className="text-muted">[{i}]</span> {r.phone}
                        {r.name && <span className="text-muted ml-1">— {r.name}</span>}
                      </span>
                      <span className="text-muted">
                        {r.status}
                        {r.hangupCause ? ` · ${r.hangupCause}` : ""}
                      </span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </Card>
      )}

      {!!jobs.length && (
        <Card title="Recent bulk jobs">
          <div className="space-y-1">
            {jobs.slice(0, 8).map((j) => {
              const c = tally(j);
              const isActive = activeJobId === j.id;
              return (
                <button
                  key={j.id}
                  onClick={() => {
                    setActiveJobId(j.id);
                    setActiveJob(j);
                  }}
                  className={`w-full text-left rounded-lg px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                    isActive ? "bg-brand/10 border border-brand/25" : "hover:bg-elev/60 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Users size={14} className="text-muted shrink-0" />
                    <div className="min-w-0">
                      <div className="font-mono text-xs truncate">{j.id}</div>
                      <div className="text-xs text-muted">
                        {new Date(j.createdAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone="ok">{c.ok}</Badge>
                    {c.failedAll > 0 && <Badge tone="danger">{c.failedAll}</Badge>}
                    <span className="text-muted">/ {c.total}</span>
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

const RETRY_SET = new Set(["no-answer", "busy", "error", "failed"]);
function isRetryable(status: string) {
  return RETRY_SET.has(status);
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "danger" | "muted" }) {
  const c = {
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
    muted: "text-ink2",
  }[tone];
  return (
    <div className="bg-bg/60 border border-line rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${c}`}>{value}</div>
    </div>
  );
}

function tally(job: BulkJob) {
  let press1 = 0, connected = 0, noAnswer = 0, busy = 0, rejected = 0,
      errorCount = 0, failedCount = 0, okCount = 0, pending = 0, dialing = 0;
  for (const r of job.rows) {
    switch (r.status) {
      case "press1": press1++; break;
      case "connected": connected++; break;
      case "no-answer": noAnswer++; break;
      case "busy": busy++; break;
      case "rejected": rejected++; break;
      case "error": errorCount++; break;
      case "failed": failedCount++; break;
      case "ok": okCount++; break;
      case "dialing": dialing++; break;
      default: pending++;
    }
  }
  const retryable = noAnswer + busy + errorCount + failedCount;
  return {
    press1, connected, noAnswer, busy, rejected,
    error: errorCount,
    failed: failedCount,
    okCount,
    pending, dialing,
    retryable,
    ok: press1 + connected + okCount,
    failedAll: retryable + rejected,
    total: job.rows.length,
  };
}

function ProgressBar({ counts }: { counts: { ok: number; failedAll: number; total: number } }) {
  const okPct = (counts.ok / counts.total) * 100;
  const failPct = (counts.failedAll / counts.total) * 100;
  const donePct = okPct + failPct;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted">{Math.round(donePct)}% complete</span>
        <span className="font-mono text-ink2 tabular-nums">{counts.ok + counts.failedAll} / {counts.total}</span>
      </div>
      <div className="w-full h-2 bg-line rounded-full overflow-hidden flex">
        <div className="h-full bg-ok transition-all duration-500" style={{ width: `${okPct}%` }} />
        <div className="h-full bg-danger transition-all duration-500" style={{ width: `${failPct}%` }} />
      </div>
    </div>
  );
}
