"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Square, RotateCw, Users, CheckCircle2, AlertCircle, Phone } from "lucide-react";
import { Button, Card, Input, Label, Select, Textarea, Badge, EmptyState, Section, CsvFilePicker, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { BulkJob, Campaign } from "@/lib/models";

function parseRows(csv: string): { phone: string; name?: string }[] {
  return csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [phone, ...rest] = line.split(",");
      const name = rest.join(",").trim();
      return { phone: phone.trim(), name: name || undefined };
    })
    .filter((r) => /\d/.test(r.phone));
}

export default function BulkTab() {
  const { data: cdata } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");
  const { data: jdata, reload: reloadJobs } = useFetch<{ jobs: BulkJob[] }>("/api/bulk");
  const campaigns = cdata?.campaigns ?? [];
  const jobs = (jdata?.jobs ?? []).filter((j) => (j.kind ?? "call") === "call");

  const [campaignId, setCampaignId] = useState<string>("");
  const [csv, setCsv] = useState<string>("phone,name\n");
  const [delayMs, setDelayMs] = useState<number>(2000);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<BulkJob | null>(null);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!activeJobId) return;
    const fn = async () => {
      try {
        const j = await api<{ job: BulkJob }>(`/api/bulk/${activeJobId}`);
        setActiveJob(j.job);
      } catch {}
    };
    fn();
    const h = setInterval(fn, running ? 1500 : 5000);
    return () => clearInterval(h);
  }, [activeJobId, running]);

  async function start() {
    const rows = parseRows(csv);
    if (!campaignId || !rows.length) return;
    try {
      const r = await api<{ job: BulkJob }>("/api/bulk", {
        method: "POST",
        body: JSON.stringify({ campaignId, rows, delayMs }),
      });
      setActiveJobId(r.job.id);
      setActiveJob(r.job);
      setCsv("phone,name\n");
      reloadJobs();
      toast(`Queued ${rows.length} calls`, "ok");
      drive(r.job.id);
    } catch (e: any) {
      toast(e.message || "Failed", "danger");
    }
  }

  async function drive(jobId: string) {
    stopRef.current = false;
    setRunning(true);
    try {
      while (!stopRef.current) {
        const nx = await api<{ done: boolean; index?: number; campaignId?: string; delayMs?: number }>(`/api/bulk/${jobId}/next`);
        if (nx.done) break;
        const j = await api<{ job: BulkJob }>(`/api/bulk/${jobId}`);
        const row = j.job.rows[nx.index!];
        await api(`/api/call`, {
          method: "POST",
          body: JSON.stringify({
            phone: row.phone,
            campaignId: nx.campaignId,
            callerName: row.name,
            bulkJobId: jobId,
            bulkRowIndex: nx.index,
          }),
        }).catch(() => {});
        await sleep(nx.delayMs ?? 2000);
      }
    } finally {
      setRunning(false);
      reloadJobs();
    }
  }

  function stop() {
    stopRef.current = true;
    setRunning(false);
  }

  async function resume(jobId: string) {
    setActiveJobId(jobId);
    drive(jobId);
  }

  async function retry(jobId: string) {
    try {
      const r = await api<{ job: BulkJob; count: number }>(`/api/bulk/${jobId}/retry`, { method: "POST" });
      setActiveJobId(r.job.id);
      setActiveJob(r.job);
      reloadJobs();
      toast(`Retrying ${r.count} failed rows`, "ok");
      drive(r.job.id);
    } catch (e: any) {
      toast(e.message || "No retry-able rows", "danger");
    }
  }

  const counts = activeJob ? tally(activeJob) : null;
  const previewCount = parseRows(csv).length;

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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Choose campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label hint="ms between dials">Delay</Label>
            <Input
              type="number"
              min={250}
              value={delayMs}
              onChange={(e) => setDelayMs(Math.max(250, Number(e.target.value) || 0))}
            />
          </div>
          <div className="flex items-end">
            <Button
              onClick={start}
              disabled={!campaignId || !previewCount}
              loading={running}
              leftIcon={<Play size={14} />}
              className="w-full"
              size="lg"
            >
              {running ? "Dialing…" : `Start · ${previewCount} recipients`}
            </Button>
          </div>
        </div>

        <div className="mt-5">
          <div className="flex items-center justify-between mb-1.5">
            <Label>Numbers · one per line, optional &quot;,name&quot;</Label>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="tabular-nums">{previewCount} recipients</span>
              <CsvFilePicker onLoad={setCsv} />
              <button
                onClick={() => setCsv("phone,name\n")}
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
            placeholder={"phone,name\n9876543210,Animesh\n9123456789,Test"}
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

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
