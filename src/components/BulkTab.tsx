"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Play, Square, RotateCw, Users, AlertCircle, Wifi, WifiOff, CheckCircle2, XCircle, Phone, PhoneOff, Zap, Clock, Download, Gauge, Server, Activity } from "lucide-react";
import { Button, Card, Input, Label, Select, Textarea, Badge, EmptyState, Section, CsvFilePicker, Modal, toast } from "./ui";
import { useFetch, api, apiRetry, usePersistentState } from "./useData";
import { parseContacts, type Contact } from "@/lib/contacts";
import type { BulkJobWithCounts, BulkRow, Campaign } from "@/lib/models";

// Large-upload guardrails (FEATURE 4).
const WARN_THRESHOLD = 5000;   // warn + offer split above this
const MAX_CONTACTS = 30000;    // hard block above this
const SPLIT_SIZE = 10000;      // "Split & upload" chunk size

type Counts = ReturnType<typeof summarize>;
type SummaryData = { job: BulkJobWithCounts; durationSum: number; durationCount: number };
// Account-wide dialing telemetry. `live` = this app's live calls; `accountLive`
// = TRUE Plivo account-wide live calls (all apps), or null if the lookup failed.
type AcctStats = { cps: number; maxLive: number; live: number; accountLive: number | null };

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

  // Persisted across tab switches + refresh so uploaded contacts and the active
  // campaign are never lost (BUG 1). Live progress is re-fetched from the server
  // by the polling effect once activeJobId rehydrates.
  const [campaignId, setCampaignId] = usePersistentState("ivr.bulk.campaignId", "");
  const [csv, setCsv] = usePersistentState("ivr.bulk.csv", "phone,name,email\n");
  const [concurrency, setConcurrency] = usePersistentState("ivr.bulk.concurrency", 50);
  const [batchDelay, setBatchDelay] = usePersistentState("ivr.bulk.batchDelay", 0); // ms between batches (FEATURE 1)
  const [activeJobId, setActiveJobId] = usePersistentState<string | null>("ivr.bulk.activeJobId", null);
  const [job, setJob] = useState<BulkJobWithCounts | null>(null);
  const [log, setLog] = useState<BulkRow[]>([]);
  const [failed, setFailed] = useState<BulkRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [confirm, setConfirm] = useState<null | "warn" | "blocked">(null); // FEATURE 4
  const [testPhone, setTestPhone] = useState(""); // FEATURE 5 — test call before launch
  const [testing, setTesting] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [cpm, setCpm] = useState(0);
  // Account-wide dialing telemetry (CPS limit, live-call cap, current live calls).
  const [acct, setAcct] = useState<AcctStats | null>(null);
  const sampleRef = useRef<{ t: number; dialed: number } | null>(null);
  // FEATURE 6 — post-campaign summary
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const prevStatusRef = useRef<string | null>(null);
  const summaryShownRef = useRef<Set<string>>(new Set());

  const counts = useMemo(() => (job ? summarize(job) : null), [job]);
  const running = job?.status === "running";
  // Parse once; reuse rows + the transparent counts (BUG 4).
  const parsed = useMemo(() => parseContacts(csv), [csv]);
  const previewCount = parsed.rows.length;

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
        // Keep account-wide CPS / live-concurrency fresh alongside job progress.
        api<AcctStats>("/api/plivo-stats")
          .then((a) => alive && setAcct(a)).catch(() => {});
        // FEATURE 6 — surface the full summary once, on the running→completed edge.
        if (
          j.status === "completed" &&
          prevStatusRef.current === "running" &&
          !summaryShownRef.current.has(j.id)
        ) {
          summaryShownRef.current.add(j.id);
          openSummary(j.id);
        }
        prevStatusRef.current = j.status;
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
    // Poll fast while running so live counts stay near-real-time (low latency).
    const h = setInterval(tick, job?.status === "running" ? 1000 : 6000);
    return () => { alive = false; clearInterval(h); };
  }, [activeJobId, job?.status]);

  // Load account-wide CPS / live-cap once on mount so the Start card can show the
  // shared limits before any campaign is running.
  useEffect(() => {
    let alive = true;
    api<AcctStats>("/api/plivo-stats")
      .then((a) => alive && setAcct((prev) => prev ?? a)).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Warn before leaving while a campaign is actively dialing (BUG 1). The backend
  // keeps dialing even if the tab closes, but the operator should confirm intent.
  useEffect(() => {
    if (!running) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show their own generic text; returnValue must be set.
      e.returnValue = "You have an active campaign running. Are you sure you want to leave?";
      return e.returnValue;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [running]);

  // Single POST for a set of rows. Stable idempotency key across the auto-retries
  // so a 503/504 retry never double-queues (BUG 5).
  async function submitRows(rows: Contact[]): Promise<BulkJobWithCounts> {
    const idempotencyKey = `idem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const { job } = await apiRetry<{ job: BulkJobWithCounts }>("/api/bulk", {
      method: "POST",
      body: JSON.stringify({ campaignId, rows, concurrency, delayMs: batchDelay, idempotencyKey }),
    });
    return job;
  }

  function setActive(j: BulkJobWithCounts) {
    setActiveJobId(j.id);
    setJob(j);
    sampleRef.current = null;
    setLog([]); setFailed([]);
  }

  // Gate the Start button on the large-upload thresholds (FEATURE 4).
  function onStart() {
    if (!campaignId || !previewCount) return;
    if (previewCount > MAX_CONTACTS) { setConfirm("blocked"); return; }
    if (previewCount > WARN_THRESHOLD) { setConfirm("warn"); return; }
    start();
  }

  // Fetch the completion summary (counts + call-duration aggregates) (FEATURE 6).
  async function openSummary(jobId: string) {
    try {
      const s = await api<SummaryData>(`/api/bulk/${jobId}/summary`);
      setSummary(s);
    } catch {
      /* summary is best-effort; the on-page panel still shows the outcome */
    }
  }

  // Place a single test call with the selected campaign before launching (FEATURE 5).
  async function testCall() {
    const phone = testPhone.trim();
    if (!campaignId || !phone) return;
    setTesting(true);
    try {
      const r = await api<{ ok: boolean; status: number; to: string }>("/api/call", {
        method: "POST",
        body: JSON.stringify({ phone, campaignId, callerName: "Test" }),
      });
      toast(r.ok ? `Test call placed to ${r.to}` : `Plivo error ${r.status}`, r.ok ? "ok" : "danger");
    } catch (e: any) {
      toast(e.message || "Test call failed", "danger");
    } finally {
      setTesting(false);
    }
  }

  async function start() {
    const rows = parsed.rows;
    if (!campaignId || !rows.length) return;
    setConfirm(null);
    setSubmitting(true);
    try {
      const j = await submitRows(rows);
      setActive(j);
      setCsv("phone,name,email\n");
      reloadJobs();
      toast(`Queued ${rows.length.toLocaleString()} calls — dialing in the background. Safe to close this tab.`, "ok");
    } catch (e: any) {
      toast(e.message || "Failed to queue", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  // Split a large list into ≤SPLIT_SIZE campaigns and queue each (FEATURE 4).
  async function startSplit() {
    const rows = parsed.rows;
    if (!campaignId || !rows.length) return;
    setConfirm(null);
    setSubmitting(true);
    try {
      const chunks: Contact[][] = [];
      for (let i = 0; i < rows.length; i += SPLIT_SIZE) chunks.push(rows.slice(i, i + SPLIT_SIZE));
      let first: BulkJobWithCounts | null = null;
      for (const chunk of chunks) {
        const j = await submitRows(chunk);
        if (!first) first = j;
      }
      if (first) setActive(first);
      setCsv("phone,name,email\n");
      reloadJobs();
      toast(`Split into ${chunks.length} campaigns of up to ${SPLIT_SIZE.toLocaleString()} — all queued.`, "ok");
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

  // Under the CPS model the dial rate is bounded by the account-wide CPS, not by
  // the per-campaign live cap. Estimate placement time as total / CPS; long calls
  // with a small live cap can extend it (the cap throttles turnover).
  const acctCps = acct?.cps ?? 0;
  const estSec = acctCps > 0 ? Math.ceil(previewCount / acctCps) : 0;
  const estMin = Math.max(1, Math.ceil(estSec / 60));

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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="col-span-2 md:col-span-2">
            <Label>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Choose campaign…</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </div>
          <div>
            <Label hint="max calls live at once">Max live calls</Label>
            <Select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
              {[25, 50, 75, 100, 125, 150, 175, 200].map((v) => <option key={v} value={v}>{v}</option>)}
            </Select>
          </div>
          <div>
            <Label hint="delay between batches">Batch delay</Label>
            <Select value={batchDelay} onChange={(e) => setBatchDelay(Number(e.target.value))}>
              {[0, 250, 500, 1000, 2000, 5000].map((v) => (
                <option key={v} value={v}>{v === 0 ? "0ms (off)" : `${v}ms`}</option>
              ))}
            </Select>
          </div>
          <div className="flex items-end">
            <Button onClick={onStart} disabled={!campaignId || !previewCount || submitting} loading={submitting}
              leftIcon={<Play size={14} />} className="w-full" size="lg">
              {submitting ? "Queuing…" : `Start · ${previewCount.toLocaleString()}`}
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center gap-1">
            <Server size={12} className="text-muted" />
            Account CPS limit <span className="text-ink2 font-medium tabular-nums">{acctCps || "—"}/s</span> (shared by all campaigns)
          </span>
          <span className="text-line">·</span>
          <span>This campaign dials up to <span className="text-ink2 font-medium tabular-nums">{acctCps || "—"}/s</span>, max <span className="text-ink2 font-medium tabular-nums">{concurrency}</span> live at once</span>
          {previewCount > 0 && acctCps > 0 && (
            <>
              <span className="text-line">·</span>
              <span>~<span className="text-ink2 font-medium tabular-nums">{estMin}</span> min for {previewCount.toLocaleString()} numbers</span>
            </>
          )}
        </p>

        {/* FEATURE 5 — test one number with this campaign before launching. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted whitespace-nowrap">Test before launch:</span>
          <div className="w-44">
            <Input
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") testCall(); }}
              placeholder="9876543210"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={testCall}
            disabled={!campaignId || !testPhone.trim() || testing}
            loading={testing}
            leftIcon={<Phone size={13} />}
          >
            Test call
          </Button>
        </div>

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
          {previewCount > 0 && (
            <div className="mt-2 flex items-start gap-2 text-xs bg-ok/5 border border-ok/20 rounded-lg px-3 py-2">
              <CheckCircle2 size={14} className="text-ok shrink-0 mt-0.5" />
              <span className="text-ink2">
                <span className="text-ok font-semibold">✓ {previewCount.toLocaleString()} contacts loaded</span>
                {parsed.stats.duplicates > 0 && (
                  <> · {parsed.stats.duplicates.toLocaleString()} duplicate{parsed.stats.duplicates === 1 ? "" : "s"} removed</>
                )}
                {parsed.stats.noPhone > 0 && (
                  <> · <span className="text-warn">{parsed.stats.noPhone.toLocaleString()} row{parsed.stats.noPhone === 1 ? "" : "s"} skipped — no phone</span></>
                )}
              </span>
            </div>
          )}
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
          <LiveDashboard counts={counts} cpm={cpm} running={running} />

          <RatePanel
            acct={acct}
            campaignCps={running ? cpm / 60 : 0}
            campaignLive={counts.dialing + counts.ok}
            cap={job.concurrency}
            campaignSec={
              job.startedAt
                ? Math.max(0, Math.floor(
                    ((job.completedAt ? Date.parse(job.completedAt) : Date.now()) - Date.parse(job.startedAt)) / 1000,
                  ))
                : 0
            }
            running={running}
          />

          {/* Granular breakdown — complements the live rollup above (Connected /
              Failed / No Answer) without repeating those labels. "Connected" and
              "No answer" are intentionally omitted here so each label shows once. */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Stat label="Press 1" value={counts.press1} tone="ok" />
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

      {/* FEATURE 4 — large-upload warning */}
      {confirm === "warn" && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title="⚠️ Large contact list detected"
          maxWidth="max-w-md"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant="ghost" onClick={startSplit}>Split &amp; upload</Button>
              <Button onClick={start}>Upload anyway</Button>
            </>
          }
        >
          <div className="text-sm text-ink2 space-y-2">
            <p>
              You&apos;ve uploaded <span className="font-semibold text-ink">{previewCount.toLocaleString()}</span> contacts.
              At the account CPS limit{acctCps ? ` of ${acctCps}/s` : ""}, this will take approximately{" "}
              <span className="font-semibold text-ink">{estMin} min</span>.
            </p>
            <p className="text-muted">
              Tip: split into batches of {SPLIT_SIZE.toLocaleString()} for better reliability.
              “Split &amp; upload” queues {Math.ceil(previewCount / SPLIT_SIZE)} campaigns automatically.
            </p>
          </div>
        </Modal>
      )}

      {/* FEATURE 4 — hard limit */}
      {confirm === "blocked" && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title="❌ Upload limit exceeded"
          maxWidth="max-w-md"
          footer={<Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>}
        >
          <div className="text-sm text-ink2 space-y-2">
            <p>
              Maximum supported contacts per campaign:{" "}
              <span className="font-semibold text-ink">{MAX_CONTACTS.toLocaleString()}</span>.
            </p>
            <p>
              Your file has <span className="font-semibold text-danger">{previewCount.toLocaleString()}</span> rows.
              Please split the file into smaller lists and upload them separately.
            </p>
          </div>
        </Modal>
      )}

      {/* FEATURE 6 — post-campaign summary */}
      {summary && (
        <CampaignSummaryModal
          data={summary}
          onClose={() => setSummary(null)}
          onNew={() => {
            setSummary(null);
            setActiveJobId(null);
            setJob(null);
            sampleRef.current = null;
          }}
        />
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

// Real-time dialing dashboard (FEATURE 2). Percentages are of *dialed* (settled)
// rows, so Connected + Failed + No Answer ≈ 100% as the campaign progresses.
function LiveDashboard({ counts, cpm, running }: { counts: Counts; cpm: number; running: boolean }) {
  const total = counts.total || 0;
  const dialed = counts.dialed;
  const dialedPct = total ? Math.round((dialed / total) * 100) : 0;
  const connected = counts.good;
  const noAnswer = counts.noAnswer;
  const failed = counts.busy + counts.rejected + counts.error + counts.failed;
  const pctOf = (n: number) => (dialed > 0 ? Math.round((n / dialed) * 100) : 0);
  const etaSec = running && cpm > 0 && counts.pending > 0 ? Math.round((counts.pending / cpm) * 60) : 0;

  return (
    <div className="rounded-xl border border-line bg-bg/50 p-4 space-y-3">
      <div>
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="flex items-center gap-1.5 text-ink2"><Phone size={13} /> Dialed</span>
          <span className="font-mono tabular-nums text-ink">
            {dialed.toLocaleString()} / {total.toLocaleString()} · {dialedPct}%
          </span>
        </div>
        <div className="w-full h-2.5 bg-line rounded-full overflow-hidden flex" title="green: connected · amber: dialing">
          <div className="h-full bg-ok transition-all duration-500" style={{ width: `${total ? (connected / total) * 100 : 0}%` }} />
          <div className="h-full bg-danger transition-all duration-500" style={{ width: `${total ? (failed / total) * 100 : 0}%` }} />
          <div className="h-full bg-warn/70 transition-all duration-500" style={{ width: `${total ? (noAnswer / total) * 100 : 0}%` }} />
          <div className="h-full bg-warn transition-all duration-500" style={{ width: `${total ? (counts.dialing / total) * 100 : 0}%` }} />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <DashRow icon={<CheckCircle2 size={13} />} label="Connected" value={connected} pct={pctOf(connected)} tone="text-ok" />
        <DashRow icon={<XCircle size={13} />} label="Failed" value={failed} pct={pctOf(failed)} tone="text-danger" />
        <DashRow icon={<PhoneOff size={13} />} label="No Answer" value={noAnswer} pct={pctOf(noAnswer)} tone="text-warn" />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 text-sm pt-1 border-t border-line/60">
        <span className="flex items-center gap-1.5">
          <Zap size={13} className="text-ok" />
          <span className="text-muted">Speed</span>
          <span className="font-mono tabular-nums text-ok font-semibold">{(running ? cpm : 0).toLocaleString()} calls/min</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Clock size={13} className="text-muted" />
          <span className="text-muted">Est. time</span>
          <span className="font-mono tabular-nums text-ink">
            {etaSec > 0 ? `${fmtEta(etaSec)} remaining` : counts.pending > 0 ? "—" : "complete"}
          </span>
        </span>
      </div>
    </div>
  );
}

function DashRow({ icon, label, value, pct, tone }: { icon: ReactNode; label: string; value: number; pct: number; tone: string }) {
  return (
    <div className="flex items-center justify-between bg-bg/40 border border-line rounded-lg px-3 py-2">
      <span className={`flex items-center gap-1.5 text-xs ${tone}`}>{icon} {label}</span>
      <span className="font-mono tabular-nums text-sm">
        <span className="text-ink">{value.toLocaleString()}</span> <span className="text-muted text-xs">({pct}%)</span>
      </span>
    </div>
  );
}

// Campaign- and account-level dialing meters: CPS (with progress vs the account
// limit), live concurrency (vs the per-campaign cap and the account ceiling),
// and how long the campaign has been running / took.
function RatePanel({ acct, campaignCps, campaignLive, cap, campaignSec, running }: {
  acct: AcctStats | null;
  campaignCps: number;
  campaignLive: number;
  cap: number;
  campaignSec: number;
  running: boolean;
}) {
  const accCps = acct?.cps ?? 0;
  const maxLive = acct?.maxLive ?? 0;
  const appLive = acct?.live ?? 0;
  // Real Plivo account-wide live calls (all apps); fall back to this app's count.
  const accountLive = acct?.accountLive ?? null;
  const shownAccLive = accountLive ?? appLive;
  const otherApps = accountLive != null ? Math.max(0, accountLive - appLive) : 0;
  const cpsPct = accCps > 0 ? (campaignCps / accCps) * 100 : 0;
  const livePct = cap > 0 ? (campaignLive / cap) * 100 : 0;
  const accLivePct = maxLive > 0 ? (shownAccLive / maxLive) * 100 : 0;

  return (
    <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
      {/* This campaign */}
      <div className="rounded-xl border border-line bg-bg/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 text-sm text-ink2">
            <Activity size={13} className="text-ok" /> This campaign
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Clock size={11} /> {running ? "elapsed" : "duration"}{" "}
            <span className="font-mono tabular-nums text-ink2">{fmtClockShort(campaignSec)}</span>
          </span>
        </div>
        <Meter label="CPS (calls / sec)" value={`${campaignCps.toFixed(1)}/s`} sub={accCps ? `of ${accCps}/s limit` : ""} pct={cpsPct} tone="bg-ok" />
        <div className="h-2.5" />
        <Meter label="Live calls" value={campaignLive.toLocaleString()} sub={`of ${cap} cap`} pct={livePct} tone="bg-brand" />
      </div>

      {/* Plivo account */}
      <div className="rounded-xl border border-line bg-bg/50 p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="flex items-center gap-1.5 text-sm text-ink2">
            <Server size={13} className="text-muted" /> Plivo account
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Gauge size={11} /> shared limits
          </span>
        </div>
        <Meter label="CPS limit" value={`${accCps || "—"}/s`} sub="all campaigns combined" pct={100} tone="bg-line" muted />
        <div className="h-2.5" />
        <Meter label="Live concurrency" value={shownAccLive.toLocaleString()} sub={maxLive ? `of ${maxLive} max` : ""} pct={accLivePct} tone="bg-warn" />
        <div className="mt-1.5 text-[11px] text-muted flex items-center gap-2">
          {accountLive != null ? (
            <>
              <span className="inline-flex items-center gap-1">
                <Activity size={10} className="text-ok" /> this app{" "}
                <span className="text-ink2 tabular-nums">{appLive.toLocaleString()}</span>
              </span>
              <span className="text-line">·</span>
              <span className="inline-flex items-center gap-1">
                <Users size={10} /> other apps{" "}
                <span className="text-ink2 tabular-nums">{otherApps.toLocaleString()}</span>
              </span>
            </>
          ) : (
            <span className="text-warn/80">Plivo live API unavailable — showing this app only</span>
          )}
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value, sub, pct, tone, muted }: {
  label: string; value: string; sub?: string; pct: number; tone: string; muted?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs text-muted">{label}</span>
        <span className="font-mono tabular-nums text-sm">
          <span className={muted ? "text-ink2" : "text-ink"}>{value}</span>
          {sub && <span className="text-muted text-xs ml-1.5">{sub}</span>}
        </span>
      </div>
      <div className="w-full h-2 bg-line rounded-full overflow-hidden">
        <div className={`h-full ${tone} transition-all duration-500`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}

// "12:05" (m:ss) or "1:03:20" (h:m:ss) for the running/elapsed campaign clock.
function fmtClockShort(sec: number): string {
  if (sec <= 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---- Post-campaign summary modal (FEATURE 6) --------------------------------
function CampaignSummaryModal({ data, onClose, onNew }: { data: SummaryData; onClose: () => void; onNew: () => void }) {
  const c = summarize(data.job);
  const total = c.total;
  const connected = c.good;                              // lifted / connected
  const press1 = c.press1;
  const busy = c.busy;
  const noAnswer = c.noAnswer;
  const failedError = c.rejected + c.error + c.failed;   // place/carrier failures + invalid
  const dialed = connected + busy + noAnswer;            // calls that actually reached the network

  const pctOf = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 100) : 0);
  const pct1 = (n: number, base: number) => (base > 0 ? Math.round((n / base) * 1000) / 10 : 0);
  const avgDur = data.durationCount > 0 ? Math.round(data.durationSum / data.durationCount) : 0;
  const campaignSec =
    data.job.startedAt && data.job.completedAt
      ? Math.max(0, Math.round((Date.parse(data.job.completedAt) - Date.parse(data.job.startedAt)) / 1000))
      : 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={`✅ Campaign complete — ${data.job.id}`}
      maxWidth="max-w-lg"
      footer={
        <>
          <Button
            variant="ghost"
            leftIcon={<Download size={14} />}
            onClick={() => window.open(`/api/bulk/${data.job.id}/csv`, "_blank")}
          >
            Download full report CSV
          </Button>
          <Button variant="ghost" onClick={onClose}>View details</Button>
          <Button leftIcon={<Play size={14} />} onClick={onNew}>Start new campaign</Button>
        </>
      }
    >
      <div className="space-y-1.5">
        <SumRow label="Total Contacts" value={total.toLocaleString()} />
        <SumRow label="Successfully Dialed" value={`${dialed.toLocaleString()} ✅`} tone="text-ink" />
        <SumRow label="Connected (Lifted)" value={`${connected.toLocaleString()}`} pct={`${pctOf(connected, dialed)}%`} tone="text-ok" />
        <SumRow label="└─ Pressed 1" value={`${press1.toLocaleString()}`} pct={`${pct1(press1, total)}%`} sub />
        <SumRow label="Busy" value={`${busy.toLocaleString()}`} pct={`${pctOf(busy, dialed)}%`} tone="text-warn" />
        <SumRow label="No Answer" value={`${noAnswer.toLocaleString()}`} pct={`${pctOf(noAnswer, dialed)}%`} tone="text-warn" />
        <SumRow label="Failed / Error" value={`${failedError.toLocaleString()}`} pct={`${pctOf(failedError, total)}%`} tone="text-danger" />
        <div className="h-px bg-line my-2.5" />
        <SumRow label="Avg Call Duration" value={`${avgDur} seconds`} />
        <SumRow label="Total Duration" value={`~${formatCallTime(data.durationSum)} of call time`} />
        <SumRow label="Campaign Duration" value={campaignSec > 0 ? formatClock(campaignSec) : "—"} />
      </div>
    </Modal>
  );
}

function SumRow({ label, value, pct, tone, sub }: { label: string; value: string; pct?: string; tone?: string; sub?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 text-sm ${sub ? "pl-4" : ""}`}>
      <span className={sub ? "text-muted" : "text-ink2"}>{label}</span>
      <span className="font-mono tabular-nums">
        <span className={tone || "text-ink"}>{value}</span>
        {pct && <span className="text-muted ml-2">({pct})</span>}
      </span>
    </div>
  );
}

// "~205 hours" / "40 min" / "30s" of total call time.
function formatCallTime(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  const h = sec / 3600;
  return `${h >= 10 ? Math.round(h) : h.toFixed(1)} hours`;
}

// "9 minutes 42 seconds" for the wall-clock campaign duration.
function formatClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h > 1 ? "s" : ""}`);
  if (m) parts.push(`${m} minute${m > 1 ? "s" : ""}`);
  parts.push(`${s} second${s === 1 ? "" : "s"}`);
  return parts.join(" ");
}

function fmtEta(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`;
}
