"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, Label, Select, Textarea, Badge, CsvFilePicker, toast } from "./ui";
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
      setCsv("");
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

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Campaign</Label>
            <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
              <option value="">Pick a campaign…</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Delay between calls (ms)</Label>
            <Input type="number" value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value) || 0)} />
          </div>
          <div className="flex items-end">
            <Button onClick={start} disabled={!campaignId || !csv.trim() || running} className="w-full">
              {running ? "Dialing…" : "Start"}
            </Button>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <Label>Numbers (one per line, optional &quot;,name&quot;)</Label>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{parseRows(csv).length} recipients</span>
              <CsvFilePicker onLoad={setCsv} />
              <button
                onClick={() => setCsv("phone,name\n")}
                className="px-2 py-1 rounded bg-line/60 hover:bg-line text-ink"
              >
                Clear
              </button>
            </div>
          </div>
          <Textarea
            rows={6}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"phone,name\n9876543210,Animesh\n9123456789,Test\n+14155551234"}
          />
        </div>
      </Card>

      {activeJob && counts && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-muted">Active job</div>
              <div className="font-mono text-sm">{activeJob.id}</div>
            </div>
            <div className="flex gap-2">
              {running ? (
                <Button variant="danger" onClick={stop}>Stop</Button>
              ) : counts.pending > 0 ? (
                <Button onClick={() => resume(activeJob.id)}>Resume</Button>
              ) : null}
            </div>
          </div>
          <Progress counts={counts} />
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge tone="accent">total {counts.total}</Badge>
            <Badge tone="ok">press1 {counts.press1}</Badge>
            <Badge tone="ok">connected {counts.connected}</Badge>
            <Badge tone="warn">no-answer {counts.noAnswer}</Badge>
            <Badge tone="warn">busy {counts.busy}</Badge>
            <Badge tone="danger">rejected {counts.rejected}</Badge>
            <Badge tone="danger">error {counts.error + counts.failed}</Badge>
            {counts.pending > 0 && <Badge tone="muted">pending {counts.pending}</Badge>}
          </div>
          {counts.retryable > 0 && !running && (
            <div className="mt-3 flex items-center justify-between bg-bg/60 border border-line rounded-lg px-3 py-2">
              <div className="text-sm">
                <span className="text-muted">Retry-able rows (no-answer / busy / error / failed):</span>{" "}
                <span className="text-ink font-medium">{counts.retryable}</span>
              </div>
              <Button onClick={() => retry(activeJob.id)}>Retry failed</Button>
            </div>
          )}
          {counts.retryable > 0 && (
            <details className="mt-3">
              <summary className="text-sm text-muted cursor-pointer">Failed rows ({counts.retryable})</summary>
              <div className="mt-2 max-h-64 overflow-auto text-xs font-mono space-y-1">
                {activeJob.rows
                  .map((r, i) => ({ r, i }))
                  .filter((x) => isRetryable(x.r.status))
                  .map(({ r, i }) => (
                    <div key={i} className="flex justify-between gap-3">
                      <span>[{i}] {r.phone}</span>
                      <span className="text-muted">{r.status}{r.hangupCause ? ` · ${r.hangupCause}` : ""}</span>
                    </div>
                  ))}
              </div>
            </details>
          )}
        </Card>
      )}

      {!!jobs.length && (
        <Card>
          <div className="text-sm text-muted mb-2">Recent jobs</div>
          <div className="space-y-1 text-sm">
            {jobs.slice(0, 8).map((j) => {
              const c = tally(j);
              return (
                <button
                  key={j.id}
                  onClick={() => {
                    setActiveJobId(j.id);
                    setActiveJob(j);
                  }}
                  className="w-full text-left hover:bg-line/40 rounded px-2 py-1 flex items-center justify-between"
                >
                  <span className="font-mono text-xs">{j.id}</span>
                  <span className="text-xs text-muted">
                    {c.ok}/{c.total} ok · {c.failedAll} failed
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

const RETRY_SET = new Set(["no-answer", "busy", "error", "failed"]);
function isRetryable(status: string) {
  return RETRY_SET.has(status);
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
    // Aggregates for the progress bar:
    ok: press1 + connected + okCount,
    failedAll: retryable + rejected,
    total: job.rows.length,
  };
}

function Progress({ counts }: { counts: { ok: number; failedAll: number; total: number } }) {
  const okPct = (counts.ok / counts.total) * 100;
  const failPct = (counts.failedAll / counts.total) * 100;
  return (
    <div className="w-full h-2 bg-line rounded-full overflow-hidden flex">
      <div className="h-full bg-ok" style={{ width: `${okPct}%` }} />
      <div className="h-full bg-danger" style={{ width: `${failPct}%` }} />
    </div>
  );
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
