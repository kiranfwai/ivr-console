"use client";
import CampaignSelect from "./CampaignSelect";
import { fmtDateTime } from "@/lib/format";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square, RotateCw, Users, Wifi, WifiOff, Phone, Zap, Clock, Download, Gauge, Server, Activity, X, CalendarClock, AlertTriangle, XCircle } from "lucide-react";
import { Button, Card, Input, Label, Select, Textarea, Badge, EmptyState, Loading, Section, CsvFilePicker, Modal, DataPanel, DataTable, TH, TD, toast } from "./ui";
import { useFetch, api, apiRetry, usePersistentState } from "./useData";
import { parseContacts, type Contact } from "@/lib/contacts";
import ScheduleCard, { ScheduleFields, newScheduleDraft, saveSchedule, type ScheduleDraft, type ScheduleSpec } from "./ScheduleCard";
import {
  Seg, StepsLayout, Step, SummaryCard, SumRow, SumTotal, FileChip, Chips, Callout,
  StatTiles, StatTile, Prog, ConfirmSendModal, ModalActions,
} from "./BulkTabParts";
import type { BulkJobWithCounts, BulkRow, Campaign } from "@/lib/models";

// Large-upload guardrails (FEATURE 4).
const WARN_THRESHOLD = 5000;   // warn + offer split above this
const MAX_CONTACTS = 30000;    // hard block above this
const SPLIT_SIZE = 10000;      // "Split & upload" chunk size

const EMPTY_CSV = "phone,name,email\n";

type Counts = ReturnType<typeof summarize>;
type SummaryData = { job: BulkJobWithCounts; durationSum: number; durationCount: number };
// Account-wide dialing telemetry. `live` = this app's live calls; `accountLive`
// = TRUE Plivo account-wide live calls (all apps), or null if the lookup failed.
type AcctStats = { cps: number; maxLive: number; live: number; accountLive: number | null };

/** "8 Oct 2026, 6:14 pm" in IST — one date format across the console. */
const fmtWhen = (iso: string) => fmtDateTime(iso);

function summarize(job: BulkJobWithCounts) {
  const c = job.counts || {};
  const press1 = c.press1 ?? 0, connected = c.connected ?? 0, ok = c.ok ?? 0;
  const busy = c.busy ?? 0, noAnswer = c["no-answer"] ?? 0, rejected = c.rejected ?? 0;
  const error = c.error ?? 0, failed = c.failed ?? 0;
  const skipped = c.dnd ?? 0; // on the client's DND list — intentionally not dialed
  const pending = c.pending ?? 0, dialing = c.dialing ?? 0;
  const total = job.total || 0;
  // "Connected (lifted)" = calls Plivo confirmed were answered. This MUST match the
  // Reports/analytics definition (press1 + connected) so the two screens reconcile.
  // Note it excludes `ok`: on a call job `ok` means "place-call accepted but no
  // hangup callback ever scored a final outcome" — an unknown outcome, NOT a
  // confirmed connect. Folding `ok` in here is what made Bulk read higher than
  // Reports.
  const connectedLifted = press1 + connected;
  // `good` stays inclusive of `ok` for progress math only: an `ok` row is terminal
  // (won't be retried), so it counts toward "done", just not toward "connected".
  const good = connectedLifted + ok;
  const bad = busy + noAnswer + rejected + error + failed;
  // 'dialed' = anything no longer awaiting placement (includes DND-skipped rows,
  // which are terminal). 'skipped' also counts toward "done" so a job with DND
  // rows still reaches 100% and never looks stuck.
  const dialed = total - pending - dialing;
  return {
    press1, connected, ok, busy, noAnswer, rejected, error, failed, skipped, pending, dialing,
    total, good, connectedLifted, bad, dialed,
    retryable: busy + noAnswer + error + failed,
    donePct: total ? Math.round(((good + bad + skipped) / total) * 100) : 0,
  };
}

export default function BulkTab() {
  const { data: cdata, loading: loadingCampaigns } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const { data: jdata, reload: reloadJobs } = useFetch<{ jobs: BulkJobWithCounts[] }>("/api/bulk");
  // Wallet balance — to warn (before dialing) when it can't cover a connected call.
  const { data: wallet } = useFetch<{ balance: number; currency: string; rate: number; noClient?: boolean }>("/api/wallet");
  const lowBalance = !!wallet && !wallet.noClient && wallet.rate > 0 && wallet.balance < wallet.rate;
  const campaigns = cdata?.campaigns ?? [];
  // Jobs only carry a campaign id; show people the campaign's name.
  const campaignName = useMemo(() => {
    const m = new Map(campaigns.map((c) => [c.id, c.name]));
    return (id: string) => m.get(id) || "Deleted campaign";
  }, [campaigns]);
  const jobs = (jdata?.jobs ?? []).filter((j) => (j.kind ?? "call") === "call");

  // Past runs: server-paged history of every bulk-call job (10 a page).
  const HIST_PAGE = 10;
  const [histPage, setHistPage] = useState(0);
  const [histStatus, setHistStatus] = useState<"" | "running" | "paused" | "completed">("");
  const [histCampaign, setHistCampaign] = useState("");
  const [histFrom, setHistFrom] = useState("");
  const [histTo, setHistTo] = useState("");
  const histUrl = useMemo(() => {
    const q = new URLSearchParams({ kind: "call", limit: String(HIST_PAGE), offset: String(histPage * HIST_PAGE) });
    if (histStatus) q.set("status", histStatus);
    if (histCampaign) q.set("campaign", histCampaign);
    // Dates are picked in IST; send the IST day boundaries as instants.
    if (histFrom) q.set("from", new Date(`${histFrom}T00:00:00+05:30`).toISOString());
    if (histTo) q.set("to", new Date(new Date(`${histTo}T00:00:00+05:30`).getTime() + 86_400_000).toISOString());
    return `/api/bulk?${q.toString()}`;
  }, [histPage, histStatus, histCampaign, histFrom, histTo]);
  // Refetch whenever the live job list refreshes, so a run that just
  // finished updates here too.
  const { data: hdata, loading: histLoading } = useFetch<{ jobs: BulkJobWithCounts[]; total: number }>(histUrl, [jdata]);
  const hist = hdata?.jobs ?? [];
  const histTotal = hdata?.total ?? 0;
  const histPages = Math.max(1, Math.ceil(histTotal / HIST_PAGE));
  const histPageList = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < histPages; i++) {
      if (i === 0 || i === histPages - 1 || Math.abs(i - histPage) <= 1) out.push(i);
      else if (out[out.length - 1] !== -1) out.push(-1);
    }
    return out;
  }, [histPages, histPage]);

  // Persisted across tab switches + refresh so uploaded contacts and the active
  // campaign are never lost (BUG 1). Live progress is re-fetched from the server
  // by the polling effect once activeJobId rehydrates.
  const [campaignId, setCampaignId] = usePersistentState("ivr.bulk.campaignId", "");
  const [csv, setCsv] = usePersistentState("ivr.bulk.csv", EMPTY_CSV);
  const [concurrency, setConcurrency] = usePersistentState("ivr.bulk.concurrency", 50);
  const [batchDelay, setBatchDelay] = usePersistentState("ivr.bulk.batchDelay", 0); // ms between batches (FEATURE 1)
  const [activeJobId, setActiveJobId] = usePersistentState<string | null>("ivr.bulk.activeJobId", null);
  const [job, setJob] = useState<BulkJobWithCounts | null>(null);
  const [log, setLog] = useState<BulkRow[]>([]);
  const [failed, setFailed] = useState<BulkRow[]>([]);
  const [skipped, setSkipped] = useState<BulkRow[]>([]);
  const [submitting, setSubmitting] = useState(false);
  // FEATURE 4 large-list gates + the plain "Start calling N people?" check.
  const [confirm, setConfirm] = useState<null | "start" | "warn" | "blocked">(null);
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
  // "When" step: start now, or save as a schedule.
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [schedDraft, setSchedDraft] = useState<ScheduleDraft>(newScheduleDraft);
  const [scheduling, setScheduling] = useState(false);
  const [schedReload, setSchedReload] = useState(0);
  const [showPaste, setShowPaste] = useState(false);

  const counts = useMemo(() => (job ? summarize(job) : null), [job]);
  const running = job?.status === "running";
  // Parse once; reuse rows + the transparent counts (BUG 4).
  const parsed = useMemo(() => parseContacts(csv), [csv]);
  const previewCount = parsed.rows.length;
  const { stats } = parsed;

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
        // DND-skipped rows (never dialed) — shown as their own list, like failed.
        api<{ rows: BulkRow[] }>(`/api/bulk/${activeJobId}/rows?status=dnd&limit=100`)
          .then((r) => alive && setSkipped(r.rows)).catch(() => {});
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

  // Gate the Start button on the large-upload thresholds (FEATURE 4). Every
  // path ends in a confirmation before anything is dialed.
  function onStart() {
    if (!campaignId || !previewCount) return;
    if (previewCount > MAX_CONTACTS) { setConfirm("blocked"); return; }
    if (previewCount > WARN_THRESHOLD) { setConfirm("warn"); return; }
    setConfirm("start");
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
      toast(r.ok ? `Test call placed to ${r.to}` : `Call could not be placed (error ${r.status})`, r.ok ? "ok" : "danger");
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
      setCsv(EMPTY_CSV);
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
      setCsv(EMPTY_CSV);
      reloadJobs();
      toast(`Split into ${chunks.length} campaigns of up to ${SPLIT_SIZE.toLocaleString()} — all queued.`, "ok");
    } catch (e: any) {
      toast(e.message || "Failed to queue", "danger");
    } finally {
      setSubmitting(false);
    }
  }

  // What a schedule saves — exactly what "Start now" would have sent.
  function buildSpec(): ScheduleSpec | null {
    if (!campaignId) {
      toast("Choose a campaign first.", "danger");
      return null;
    }
    if (!parsed.rows.length) {
      toast("Add numbers first.", "danger");
      return null;
    }
    return {
      campaignId,
      recipients: parsed.rows,
      concurrency,
      delayMs: batchDelay,
    };
  }

  async function scheduleIt() {
    const spec = buildSpec();
    if (!spec || scheduling) return;
    setScheduling(true);
    try {
      await saveSchedule("call", schedDraft, spec);
      toast("Scheduled.", "ok");
      setSchedDraft(newScheduleDraft());
      setSchedReload((n) => n + 1);
    } catch (e: any) {
      toast(e?.message || "Could not save the schedule", "danger");
    } finally {
      setScheduling(false);
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
  const pl = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  const money = (n: number) => `${wallet?.currency === "INR" ? "₹" : ""}${n.toFixed(2)}`;
  const chosenName = campaignId ? campaignName(campaignId) : "";
  const fmtDelay = (v: number) => (v === 0 ? "No delay" : v >= 1000 ? `${v / 1000}s` : `${v}ms`);

  if (loadingCampaigns && !cdata) {
    return (
      <Section>
        <Card>
          <Loading label="Loading campaigns…" />
        </Card>
      </Section>
    );
  }

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

  const factsLeftOut: [string, string][] =
    stats.duplicates + stats.noPhone > 0
      ? [[
          "Left out",
          [
            stats.duplicates > 0 ? pl(stats.duplicates, "duplicate", "duplicates") : "",
            stats.noPhone > 0 ? `${stats.noPhone.toLocaleString()} without a phone` : "",
          ].filter(Boolean).join(" · "),
        ]]
      : [];
  const factsPace: [string, string] = [
    "Pace",
    `${concurrency} live calls${batchDelay ? ` · ${fmtDelay(batchDelay)} between batches` : ""}${previewCount && acctCps > 0 ? ` · about ${estMin} min` : ""}`,
  ];

  const jobCard = job && counts && (
    <JobCard
      job={job}
      counts={counts}
      title={campaignName(job.campaignId)}
      running={running}
      stale={stale}
      updatedAt={updatedAt}
      cpm={cpm}
      acct={acct}
      log={log}
      failed={failed}
      skipped={skipped}
      onPause={pause}
      onResume={() => resume(job.id)}
      onRetry={() => retry(job.id)}
    />
  );

  return (
    <Section>
      {/* While a batch is dialing its progress goes first, so you never scroll
          past the form to watch the thing you just started. Otherwise it sits
          under the form, as in the design. */}
      {running && jobCard}

      <StepsLayout
        steps={
          <>
            <Step n={1} done={!!campaignId} title="Campaign" description="Decides the audio, the WhatsApp rule and the caller ID.">
              <CampaignSelect campaigns={campaigns} value={campaignId} onChange={setCampaignId} emptyLabel="Choose a campaign…" />
              {/* FEATURE 5 — test one number with this campaign before launching. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="whitespace-nowrap text-[13px] text-muted">Test before launch</span>
                <div className="w-44">
                  <Input
                    value={testPhone}
                    onChange={(e) => setTestPhone(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") testCall(); }}
                    placeholder="98765 43210"
                    inputMode="tel"
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
            </Step>

            <Step
              n={2}
              done={previewCount > 0}
              title="Contacts"
              description={
                <>A CSV with a <span className="font-mono text-ink2">phone</span> column. <span className="font-mono text-ink2">name</span> and{" "}
                <span className="font-mono text-ink2">email</span> are optional.</>
              }
            >
              <FileChip
                title={previewCount > 0 ? "Your list" : "No list yet"}
                sub={
                  previewCount > 0
                    ? `${pl(stats.totalRows, "row", "rows")} · checked just now`
                    : "Choose a CSV file, or paste the numbers below."
                }
                action={
                  <>
                    <CsvFilePicker onLoad={setCsv} />
                    {previewCount > 0 && (
                      <Button size="sm" variant="subtle" leftIcon={<X size={13} />} onClick={() => setCsv(EMPTY_CSV)}>
                        Clear
                      </Button>
                    )}
                  </>
                }
              />
              {previewCount > 0 && (
                <Chips>
                  <Badge tone="ok">{pl(previewCount, "ready", "ready")}</Badge>
                  {stats.duplicates > 0 && <Badge tone="muted">{pl(stats.duplicates, "duplicate removed", "duplicates removed")}</Badge>}
                  {stats.noPhone > 0 && <Badge tone="warn">{pl(stats.noPhone, "row without a phone · skipped", "rows without a phone · skipped")}</Badge>}
                  {previewCount > WARN_THRESHOLD && previewCount <= MAX_CONTACTS && <Badge tone="warn">Large list</Badge>}
                  {previewCount > MAX_CONTACTS && <Badge tone="danger">Over the {MAX_CONTACTS.toLocaleString()} limit</Badge>}
                </Chips>
              )}
              <button
                type="button"
                onClick={() => setShowPaste((v) => !v)}
                className="mt-3 text-[13px] font-medium text-accent hover:underline"
              >
                {showPaste ? "Hide the list" : "Paste or edit the numbers"}
              </button>
              {showPaste && (
                <div className="mt-2">
                  <Textarea
                    rows={6}
                    value={csv}
                    onChange={(e) => setCsv(e.target.value)}
                    placeholder={"phone,name,email\n9876543210,Test,test@example.com\n9123456789,Test,"}
                  />
                </div>
              )}
            </Step>

            <Step
              n={3}
              title="Pace"
              description={
                acctCps > 0
                  ? <>How fast it dials. Your account allows up to <span className="tabular-nums">{acctCps}</span> new calls a second.</>
                  : "How fast it dials."
              }
            >
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <Label>Max live calls</Label>
                  <Select value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))}>
                    {[25, 50, 75, 100, 125, 150, 175, 200].map((v) => <option key={v} value={v}>{v}</option>)}
                  </Select>
                  <div className="mt-1 text-xs text-muted">Calls ringing at the same time.</div>
                </div>
                <div>
                  <Label>Gap between batches</Label>
                  <Select value={batchDelay} onChange={(e) => setBatchDelay(Number(e.target.value))}>
                    {[0, 250, 500, 1000, 2000, 5000].map((v) => (
                      <option key={v} value={v}>{fmtDelay(v)}</option>
                    ))}
                  </Select>
                </div>
              </div>
            </Step>

            <Step n={4} title="When" description="Start now, or let it start by itself later.">
              <Seg<"now" | "schedule">
                value={when}
                onChange={setWhen}
                options={[
                  { value: "now", label: "Start now" },
                  { value: "schedule", label: "Schedule" },
                ]}
              />
              {when === "schedule" && (
                <div className="mt-3.5">
                  <ScheduleFields kind="call" draft={schedDraft} onChange={setSchedDraft} />
                  <div className="mt-2 text-xs text-muted">
                    The list is saved with the schedule and used every time it runs. Times are IST.
                  </div>
                </div>
              )}
            </Step>
          </>
        }
        summary={
          <SummaryCard>
            <SumRow label="Rows in file" value={stats.totalRows.toLocaleString()} />
            {stats.duplicates > 0 && <SumRow label="Duplicates" value={`− ${stats.duplicates.toLocaleString()}`} tone="muted" />}
            {stats.noPhone > 0 && <SumRow label="No phone number" value={`− ${stats.noPhone.toLocaleString()}`} tone="warn" />}
            {previewCount > 0 && acctCps > 0 && <SumRow label="Takes about" value={`${estMin.toLocaleString()} min`} />}
            <SumTotal label="Will be called" value={previewCount.toLocaleString()} />
            {lowBalance && (
              <Callout tone="warn" className="mt-2.5">
                Low wallet balance — <b className="font-semibold text-ink">{money(wallet!.balance)}</b>. Calls cost{" "}
                {money(wallet!.rate)} per connected call, so dialing is blocked until you top up in Billing.
              </Callout>
            )}
            {when === "now" ? (
              <Button
                size="lg"
                className="mt-3.5 w-full"
                onClick={onStart}
                disabled={!campaignId || !previewCount || submitting}
                loading={submitting}
                leftIcon={<Phone size={15} />}
              >
                {submitting ? "Queuing…" : "Review & start"}
              </Button>
            ) : (
              <Button
                size="lg"
                className="mt-3.5 w-full"
                onClick={scheduleIt}
                disabled={!campaignId || !previewCount || scheduling}
                loading={scheduling}
                leftIcon={<CalendarClock size={15} />}
              >
                Schedule it
              </Button>
            )}
            <div className="mt-1.5 text-center text-xs text-muted">
              {when === "now"
                ? "You’ll confirm before any call is placed. Numbers on your DND list are skipped."
                : "Runs on the server at the time you pick — nothing needs to be open."}
            </div>
          </SummaryCard>
        }
      />

      {!running && jobCard}

      <ScheduleCard
        kind="call"
        recipientCount={previewCount}
        title="Scheduled campaigns"
        description="Dials by itself at the time you pick — once, or on a repeat."
        hideNew
        reloadKey={schedReload}
        emptyHint="Choose Schedule under When to add one."
        buildSpec={buildSpec}
      />

      {/* Every bulk-call run, newest first — paged and filterable, so older
          campaigns and runs are never out of reach (the old card showed 8). */}
      <DataPanel
        title="Past runs"
        meta={histTotal ? `${histTotal.toLocaleString()} run${histTotal === 1 ? "" : "s"} · click a row to open it` : "Every bulk call this workspace has run"}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-[10px] border border-line bg-elev p-[3px]">
              {([["", "All"], ["running", "Running"], ["paused", "Stopped"], ["completed", "Completed"]] as const).map(([v, l]) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => { setHistStatus(v); setHistPage(0); }}
                  className={`h-7 rounded-[7px] px-2.5 text-[12.5px] font-medium transition-colors ${histStatus === v ? "bg-panel text-ink shadow-card" : "text-muted hover:text-ink"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <select
              value={histCampaign}
              onChange={(e) => { setHistCampaign(e.target.value); setHistPage(0); }}
              className="h-[34px] max-w-[200px] rounded-[9px] border border-line bg-panel px-2.5 text-[13px] text-ink shadow-xs outline-none focus:border-accent"
              aria-label="Filter by campaign"
            >
              <option value="">All campaigns</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              type="date"
              value={histFrom}
              onChange={(e) => { setHistFrom(e.target.value); setHistPage(0); }}
              className="h-[34px] rounded-[9px] border border-line bg-panel px-2 text-[13px] text-ink shadow-xs outline-none focus:border-accent"
              aria-label="From date"
            />
            <span className="text-muted">–</span>
            <input
              type="date"
              value={histTo}
              onChange={(e) => { setHistTo(e.target.value); setHistPage(0); }}
              className="h-[34px] rounded-[9px] border border-line bg-panel px-2 text-[13px] text-ink shadow-xs outline-none focus:border-accent"
              aria-label="To date"
            />
            {(histStatus || histCampaign || histFrom || histTo) && (
              <button
                type="button"
                className="text-[13px] font-medium text-accent hover:underline"
                onClick={() => { setHistStatus(""); setHistCampaign(""); setHistFrom(""); setHistTo(""); setHistPage(0); }}
              >
                Clear
              </button>
            )}
          </div>
        }
        footer={histTotal > HIST_PAGE ? (
          <div className="flex items-center gap-2">
            <span>
              Showing <b className="font-semibold text-ink">{(histPage * HIST_PAGE + 1).toLocaleString()}–{Math.min(histTotal, (histPage + 1) * HIST_PAGE).toLocaleString()}</b> of {histTotal.toLocaleString()}
            </span>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" disabled={histPage === 0} onClick={() => setHistPage((p) => p - 1)}>Previous</Button>
            <div className="hidden gap-0.5 sm:flex">
              {histPageList.map((n, i) => n < 0 ? (
                <span key={`gap${i}`} className="grid h-[30px] w-6 place-items-center text-muted">…</span>
              ) : (
                <button
                  key={n}
                  type="button"
                  onClick={() => setHistPage(n)}
                  className={`h-[30px] min-w-[30px] rounded-[8px] px-1.5 text-[13px] font-medium tabular-nums ${n === histPage ? "bg-panel text-ink shadow-card ring-1 ring-line" : "text-muted hover:bg-ink/[0.05]"}`}
                >
                  {n + 1}
                </button>
              ))}
            </div>
            <Button size="sm" variant="ghost" disabled={(histPage + 1) * HIST_PAGE >= histTotal} onClick={() => setHistPage((p) => p + 1)}>Next</Button>
          </div>
        ) : undefined}
      >
        {histLoading && !hdata ? (
          <Loading label="Loading past runs…" />
        ) : hist.length === 0 ? (
          <EmptyState
            title={histStatus || histCampaign || histFrom || histTo ? "No runs match these filters" : "No bulk calls yet"}
            description={histStatus || histCampaign || histFrom || histTo ? "Try another status, campaign or date range." : "Runs you start or schedule will show up here."}
          />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Campaign</th>
                <th className={TH}>Status</th>
                <th className={`${TH} w-[24%]`}>Progress</th>
                <th className={`${TH} text-right`}>Answered</th>
                <th className={`${TH} hidden text-right sm:table-cell`}>Pressed 1</th>
                <th className={`${TH} hidden md:table-cell`}>Started</th>
                <th className={`${TH} w-[150px]`} />
              </tr>
            </thead>
            <tbody>
              {hist.map((j) => {
                const s = summarize(j);
                const isActive = activeJobId === j.id;
                return (
                  <tr
                    key={j.id}
                    onClick={() => { setActiveJobId(j.id); setJob(j); sampleRef.current = null; }}
                    className={`cursor-pointer transition-colors ${isActive ? "bg-accent/[0.06]" : "hover:bg-ink/[0.03]"}`}
                  >
                    <td className={TD}>
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-accent/10 text-accent">
                          <Users size={14} />
                        </div>
                        <div className="min-w-0">
                          <div className="max-w-[220px] truncate font-medium text-ink" title={j.id}>
                            {j.kind === "whatsapp" ? "WhatsApp send" : campaignName(j.campaignId)}
                          </div>
                          <div className="whitespace-nowrap text-xs text-muted">{pl(s.total, "contact", "contacts")}</div>
                        </div>
                      </div>
                    </td>
                    <td className={TD}><StatusPill status={j.status} remaining={s.pending + s.dialing} /></td>
                    <td className={TD}>
                      <Prog
                        total={s.total}
                        title={`${s.donePct}% done`}
                        parts={[
                          { value: s.connectedLifted, cls: "bg-ok" },
                          { value: s.ok + s.bad, cls: "bg-muted/50" },
                          { value: s.skipped, cls: "bg-warn/60" },
                        ]}
                      />
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{s.connectedLifted.toLocaleString()}</td>
                    <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{s.press1.toLocaleString()}</td>
                    <td className={`${TD} hidden whitespace-nowrap text-muted md:table-cell`}>{fmtWhen(j.createdAt)}</td>
                    <td className={TD}>
                      <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button
                          size="sm"
                          variant="subtle"
                          leftIcon={<Download size={13} />}
                          onClick={() => window.open(`/api/bulk/${j.id}/csv`, "_blank")}
                        >
                          CSV
                        </Button>
                        {s.retryable > 0 && j.status !== "running" && (
                          <Button size="sm" variant="ghost" leftIcon={<RotateCw size={12} />} onClick={() => retry(j.id)}>
                            Retry
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </DataPanel>

      {/* Plain start check — like every other send in the console. */}
      <ConfirmSendModal
        open={confirm === "start"}
        icon={<Phone size={20} />}
        title={`Start calling ${pl(previewCount, "person", "people")}?`}
        body="Calls start right away and run on the server. You can stop at any time. The list is cleared once it’s queued."
        facts={[
          ["Campaign", chosenName],
          ["Will be called", previewCount.toLocaleString()],
          ...factsLeftOut,
          ["Do Not Disturb", "Numbers on the list are skipped"],
          factsPace,
        ]}
        extra={lowBalance ? (
          <Callout tone="warn" className="mt-3">
            Your wallet ({money(wallet!.balance)}) is below the cost of one connected call, so dialing will not start until you top up.
          </Callout>
        ) : null}
        onClose={() => setConfirm(null)}
        actions={
          <ModalActions>
            <Button variant="ghost" size="lg" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button size="lg" onClick={start} loading={submitting}>Start {pl(previewCount, "call", "calls")}</Button>
          </ModalActions>
        }
      />

      {/* FEATURE 4 — large-upload warning */}
      <ConfirmSendModal
        open={confirm === "warn"}
        tone="warn"
        icon={<AlertTriangle size={20} />}
        title={`Large list — ${pl(previewCount, "contact", "contacts")}`}
        body={
          <>
            <p>
              At the account limit{acctCps ? ` of ${acctCps} calls a second` : ""}, this will take about{" "}
              <span className="font-semibold text-ink">{estMin} min</span>.
            </p>
            <p className="mt-2">
              Tip: split into batches of {SPLIT_SIZE.toLocaleString()} for better reliability. “Split &amp; upload” queues{" "}
              {Math.ceil(previewCount / SPLIT_SIZE)} campaigns automatically.
            </p>
          </>
        }
        facts={[["Campaign", chosenName], ...factsLeftOut, ["Do Not Disturb", "Numbers on the list are skipped"], factsPace]}
        onClose={() => setConfirm(null)}
        actions={
          <ModalActions>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
            <Button variant="ghost" onClick={startSplit}>Split &amp; upload</Button>
            <Button onClick={start}>Upload anyway</Button>
          </ModalActions>
        }
      />

      {/* FEATURE 4 — hard limit */}
      <ConfirmSendModal
        open={confirm === "blocked"}
        tone="danger"
        icon={<XCircle size={20} />}
        title="Upload limit exceeded"
        body={
          <>
            <p>
              Maximum supported contacts per campaign: <span className="font-semibold text-ink">{MAX_CONTACTS.toLocaleString()}</span>.
            </p>
            <p className="mt-2">
              Your file has <span className="font-semibold text-danger">{previewCount.toLocaleString()}</span> rows. Please
              split the file into smaller lists and upload them separately.
            </p>
          </>
        }
        onClose={() => setConfirm(null)}
        actions={
          <ModalActions>
            <Button variant="ghost" size="lg" onClick={() => setConfirm(null)}>Cancel</Button>
          </ModalActions>
        }
      />

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

/** The live (or last-followed) job: progress bar, stat tiles, speed, limits, lists. */
function JobCard({
  job, counts, title, running, stale, updatedAt, cpm, acct, log, failed, skipped, onPause, onResume, onRetry,
}: {
  job: BulkJobWithCounts;
  counts: Counts;
  title: string;
  running: boolean;
  stale: boolean;
  updatedAt: number | null;
  cpm: number;
  acct: AcctStats | null;
  log: BulkRow[];
  failed: BulkRow[];
  skipped: BulkRow[];
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
}) {
  const remaining = counts.pending + counts.dialing;
  const heading = running ? "Running now" : job.status === "completed" ? "Finished" : remaining > 0 ? "Paused" : "Stopped";
  const failedAll = counts.rejected + counts.error + counts.failed;
  const total = counts.total;
  const etaSec = running && cpm > 0 && counts.pending > 0 ? Math.round((counts.pending / cpm) * 60) : 0;

  return (
    <Card noPadding>
      <div className="flex flex-wrap items-start gap-3 p-5 pb-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-[-0.015em]">
            <span className="min-w-0 truncate">{heading} · {job.kind === "whatsapp" ? "WhatsApp send" : title}</span>
            <StatusPill status={job.status} remaining={remaining} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-muted">
            <span>Started {fmtWhen(job.createdAt)}</span>
            <span>·</span>
            <span className="tabular-nums">{counts.donePct}% done</span>
            <ConnDot stale={stale} updatedAt={updatedAt} />
          </div>
        </div>
        {running ? (
          <Button size="sm" variant="danger" leftIcon={<Square size={12} />} onClick={onPause}>Stop</Button>
        ) : remaining > 0 ? (
          <Button size="sm" leftIcon={<Play size={12} />} onClick={onResume}>Resume</Button>
        ) : null}
      </div>

      <div className="px-5 pb-5">
        <Prog
          height="h-2.5"
          total={total}
          title="Answered · no answer · busy · failed · skipped (DND) · ringing"
          parts={[
            { value: counts.connectedLifted, cls: "bg-ok" },
            { value: counts.ok, cls: "bg-ok/40" },
            { value: counts.noAnswer, cls: "bg-muted/50" },
            { value: counts.busy, cls: "bg-warn/70" },
            { value: failedAll, cls: "bg-danger" },
            { value: counts.skipped, cls: "bg-warn/40" },
            { value: counts.dialing, cls: "bg-accent" },
          ]}
        />

        <div className="mt-3.5">
          <StatTiles>
            <StatTile label="Total" value={total} />
            <StatTile label="Dialed" value={counts.dialed} tone="accent" />
            <StatTile label="Answered" value={counts.connectedLifted} tone="ok" />
            <StatTile label="Pressed 1" value={counts.press1} tone="ok" />
            <StatTile label="No answer" value={counts.noAnswer} />
            <StatTile label="Busy" value={counts.busy} tone="warn" />
            <StatTile label="Failed" value={failedAll} tone="danger" />
            <StatTile label="Skipped · DND" value={counts.skipped} tone="warn" />
          </StatTiles>
        </div>

        <div className="mt-3.5 flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[13px]">
          <span className="flex items-center gap-1.5">
            <Zap size={13} className="text-ok" />
            <span className="text-muted">Speed</span>
            <span className="font-semibold tabular-nums text-ink">{(running ? cpm : 0).toLocaleString()} calls/min</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Clock size={13} className="text-muted" />
            <span className="text-muted">Time left</span>
            <span className="tabular-nums text-ink">
              {etaSec > 0 ? fmtEta(etaSec) : counts.pending > 0 ? "—" : "Done"}
            </span>
          </span>
          {counts.pending > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted">Waiting</span>
              <span className="tabular-nums text-ink">{counts.pending.toLocaleString()}</span>
            </span>
          )}
          {counts.ok > 0 && (
            <span className="flex items-center gap-1.5" title="Placed, but no final status came back">
              <span className="text-muted">No final status</span>
              <span className="tabular-nums text-ink">{counts.ok.toLocaleString()}</span>
            </span>
          )}
        </div>

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

        {running && log.length > 0 && (
          <div className="mt-4">
            <Label>Live dispatch</Label>
            <div className="max-h-56 divide-y divide-line overflow-auto rounded-[10px] border border-line bg-elev">
              {log.map((r, i) => (
                <div key={`${r.idx}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5 font-mono text-xs">
                  <span className="truncate">
                    <span className="text-muted">[{r.idx}]</span> {r.phone}
                    {r.name && <span className="ml-1 text-muted">— {r.name}</span>}
                  </span>
                  <RowStatus row={r} />
                </div>
              ))}
            </div>
          </div>
        )}

        {counts.retryable > 0 && job.status !== "running" && (
          <Callout tone="warn" className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="text-ink">{counts.retryable.toLocaleString()} numbers didn&apos;t connect.</span>{" "}
                <span className="text-muted">Retry no-answer, busy and errors in a new campaign.</span>
              </span>
              <Button size="sm" variant="ghost" leftIcon={<RotateCw size={12} />} onClick={onRetry}>Retry failed</Button>
            </div>
          </Callout>
        )}

        {failed.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">
              See failed numbers ({failed.length}{failed.length >= 100 ? "+" : ""})
            </summary>
            <div className="mt-2 max-h-64 space-y-0.5 overflow-auto rounded-[9px] border border-line bg-elev p-2 font-mono text-xs">
              {failed.map((r, i) => (
                <div key={`${r.idx}-${i}`} className="flex justify-between gap-3 py-0.5">
                  <span><span className="text-muted">[{r.idx}]</span> {r.phone}{r.name && <span className="ml-1 text-muted">— {r.name}</span>}</span>
                  {/* Show the recorded error, not just the status. "failed"
                      alone tells you nothing; "Plivo 400" tells you the
                      caller ID is wrong. */}
                  <span className="text-muted">
                    {r.error || r.status}
                    {r.hangupCause ? ` · ${r.hangupCause}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

        {skipped.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">
              See skipped (DND) numbers ({skipped.length}{skipped.length >= 100 ? "+" : ""})
            </summary>
            <div className="mb-2 mt-1.5 text-xs text-muted">
              These numbers are on the Do Not Disturb list, so they were never called.
            </div>
            <div className="max-h-64 space-y-0.5 overflow-auto rounded-[9px] border border-line bg-elev p-2 font-mono text-xs">
              {skipped.map((r, i) => (
                <div key={`${r.idx}-${i}`} className="flex justify-between gap-3 py-0.5">
                  <span><span className="text-muted">[{r.idx}]</span> {r.phone}{r.name && <span className="ml-1 text-muted">— {r.name}</span>}</span>
                  <span className="text-muted">skipped · DND</span>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}

// `remaining` = rows still recoverable by a Resume (pending + dialing). A paused
// job with wedged 'dialing' rows has remaining > 0 even though pending is 0, so
// it reads "paused" (Resume-able), not "stopped" (truly nothing left to dial).
function StatusPill({ status, remaining }: { status: string; remaining: number }) {
  const map: Record<string, { tone: "ok" | "warn" | "muted" | "accent" | "danger"; label: string; dot?: boolean }> = {
    running: { tone: "accent", label: "Running", dot: true },
    paused: remaining > 0 ? { tone: "warn", label: "Paused" } : { tone: "danger", label: "Stopped" },
    completed: { tone: "ok", label: "Completed" },
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

function RowStatus({ row }: { row: BulkRow }) {
  const tone =
    row.status === "press1" || row.status === "connected" || row.status === "ok" ? "text-ok"
      : row.status === "dialing" ? "text-warn"
      : row.status === "pending" || row.status === "dnd" ? "text-muted"
      : "text-danger";
  const label = row.status === "dnd" ? "skipped · DND" : row.status;
  return <span className={`${tone} whitespace-nowrap`}>{label}{row.hangupCause ? ` · ${row.hangupCause}` : ""}</span>;
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
      <div className="rounded-[10px] border border-line2 bg-elev p-4">
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
      <div className="rounded-[10px] border border-line2 bg-elev p-4">
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
        <div className="mt-1.5 text-xs text-muted flex items-center gap-2">
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
            <span className="text-warn">Plivo live API unavailable — showing this app only</span>
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
  const connected = c.connectedLifted;                   // lifted / connected (answered) — matches Reports
  const press1 = c.press1;
  const placed = c.ok;                                   // place-call accepted, but no hangup callback → outcome unknown
  const busy = c.busy;
  const noAnswer = c.noAnswer;
  const failedError = c.rejected + c.error + c.failed;   // place/carrier failures + invalid
  const dialed = connected + placed + busy + noAnswer;   // calls that actually reached the network

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
      title="Campaign complete"
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
        <ModalRow label="Total contacts" value={total.toLocaleString()} />
        <ModalRow label="Successfully dialed" value={dialed.toLocaleString()} tone="text-ink" />
        <ModalRow label="Answered" value={`${connected.toLocaleString()}`} pct={`${pctOf(connected, dialed)}%`} tone="text-ok" />
        <ModalRow label="Pressed 1" value={`${press1.toLocaleString()}`} pct={`${pct1(press1, total)}%`} sub />
        {placed > 0 && (
          <ModalRow label="Placed – no final status" value={`${placed.toLocaleString()}`} pct={`${pctOf(placed, dialed)}%`} tone="text-muted" />
        )}
        <ModalRow label="Busy" value={`${busy.toLocaleString()}`} pct={`${pctOf(busy, dialed)}%`} tone="text-warn" />
        <ModalRow label="No answer" value={`${noAnswer.toLocaleString()}`} pct={`${pctOf(noAnswer, dialed)}%`} tone="text-warn" />
        <ModalRow label="Failed / error" value={`${failedError.toLocaleString()}`} pct={`${pctOf(failedError, total)}%`} tone="text-danger" />
        {c.skipped > 0 && (
          <ModalRow label="Skipped · DND" value={`${c.skipped.toLocaleString()}`} pct={`${pctOf(c.skipped, total)}%`} tone="text-muted" />
        )}
        <div className="h-px bg-line my-2.5" />
        <ModalRow label="Average call length" value={`${avgDur} seconds`} />
        <ModalRow label="Total call time" value={`~${formatCallTime(data.durationSum)} of call time`} />
        <ModalRow label="Campaign ran for" value={campaignSec > 0 ? formatClock(campaignSec) : "—"} />
      </div>
    </Modal>
  );
}

function ModalRow({ label, value, pct, tone, sub }: { label: string; value: string; pct?: string; tone?: string; sub?: boolean }) {
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
