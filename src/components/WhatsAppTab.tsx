"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, Input, Label, Textarea, Badge, CsvFilePicker, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { BulkJob } from "@/lib/models";

type Mode = "single" | "bulk";

export default function WhatsAppTab() {
  const [mode, setMode] = useState<Mode>("single");
  return (
    <div className="space-y-4">
      <Card className="!p-2">
        <div className="flex gap-1">
          <Button variant={mode === "single" ? "primary" : "ghost"} onClick={() => setMode("single")}>
            Single
          </Button>
          <Button variant={mode === "bulk" ? "primary" : "ghost"} onClick={() => setMode("bulk")}>
            Bulk
          </Button>
        </div>
      </Card>
      {mode === "single" ? <SingleSend /> : <BulkSend />}
    </div>
  );
}

function SingleSend() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);

  async function send() {
    if (!phone) return;
    setBusy(true);
    try {
      let extraObj: any = undefined;
      if (extra.trim()) {
        try {
          extraObj = JSON.parse(extra);
        } catch {
          toast("Extra must be valid JSON", "danger");
          setBusy(false);
          return;
        }
      }
      const r = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: name || undefined, extra: extraObj }),
      });
      const j = await r.json();
      setLast(j);
      if (r.ok && j.ok) toast(`Pabbly ${j.status} in ${j.ms}ms`, "ok");
      else toast(`Failed: ${j.error || j.status}`, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" />
          </div>
          <div>
            <Label>Name (optional)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Animesh" />
          </div>
          <div className="md:col-span-2">
            <Label>Extra fields (optional, JSON merged into payload)</Label>
            <Textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder='{"campaign": "day1"}' />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={send} disabled={busy || !phone}>
              {busy ? "Sending…" : "Send via Pabbly"}
            </Button>
          </div>
        </div>
      </Card>

      {last && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm text-muted">Last response</div>
            <Badge tone={last.ok ? "ok" : "danger"}>{last.ok ? `${last.status} · ${last.ms}ms` : "failed"}</Badge>
          </div>
          <pre className="text-xs font-mono bg-bg p-3 rounded overflow-auto max-h-64">
            {JSON.stringify(last, null, 2)}
          </pre>
        </Card>
      )}
    </>
  );
}

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

function delayMsForRate(ratePerMin: number, jitterPct: number): number {
  const baseMs = 60000 / Math.max(1, ratePerMin);
  const jitter = baseMs * (jitterPct / 100);
  return Math.round(baseMs - jitter + Math.random() * jitter * 2);
}

function BulkSend() {
  const { data: jdata, reload: reloadJobs } = useFetch<{ jobs: BulkJob[] }>("/api/bulk");
  const allJobs = jdata?.jobs ?? [];
  const jobs = allJobs.filter((j) => j.kind === "whatsapp");

  const [csv, setCsv] = useState<string>("phone,name\n");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [rate, setRate] = useState(6);
  const [jitterPct, setJitterPct] = useState(30);
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
    if (!rows.length) return;
    try {
      const r = await api<{ job: BulkJob }>("/api/bulk", {
        method: "POST",
        body: JSON.stringify({
          kind: "whatsapp",
          rows,
          webhookUrl: webhookUrl || undefined,
          delayMs: Math.round(60000 / Math.max(1, rate)),
          jitterPct,
        }),
      });
      setActiveJobId(r.job.id);
      setActiveJob(r.job);
      reloadJobs();
      toast(`Queued ${rows.length} WhatsApp sends`, "ok");
      drive(r.job.id, webhookUrl);
    } catch (e: any) {
      toast(e.message || "Failed", "danger");
    }
  }

  async function drive(jobId: string, hookOverride: string) {
    stopRef.current = false;
    setRunning(true);
    try {
      while (!stopRef.current) {
        const nx = await api<{ done: boolean; index?: number }>(`/api/bulk/${jobId}/next`);
        if (nx.done) break;
        const j = await api<{ job: BulkJob }>(`/api/bulk/${jobId}`);
        const row = j.job.rows[nx.index!];
        const hookForRow = hookOverride || j.job.webhookUrl || undefined;
        await api(`/api/whatsapp/send`, {
          method: "POST",
          body: JSON.stringify({
            phone: row.phone,
            name: row.name,
            webhookUrl: hookForRow,
            bulkJobId: jobId,
            bulkRowIndex: nx.index,
          }),
        }).catch(() => {});
        await sleep(delayMsForRate(rate, jitterPct));
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
    drive(jobId, webhookUrl);
  }

  const counts = activeJob ? tally(activeJob) : null;
  const previewCount = parseRows(csv).length;
  const estimatedMin = previewCount > 0 ? Math.max(1, Math.ceil(previewCount / Math.max(1, rate))) : 0;

  return (
    <>
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label>Pabbly webhook URL (optional — falls back to PABBLY_WEBHOOK_URL)</Label>
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://connect.pabbly.com/webhook-listener/..."
            />
          </div>

          <div>
            <Label>Rate ({rate} msg/min)</Label>
            <input
              type="range"
              min={1}
              max={60}
              value={rate}
              onChange={(e) => setRate(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div>
            <Label>Jitter (±{jitterPct}%)</Label>
            <input
              type="range"
              min={0}
              max={80}
              value={jitterPct}
              onChange={(e) => setJitterPct(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1">
            <Label>Recipients (one per line, &quot;phone,name&quot;)</Label>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>
                {previewCount} recipients
                {previewCount > 0 && ` · ~${estimatedMin} min`}
              </span>
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
            placeholder={"phone,name\n9876543210,Animesh\n9123456789,Test"}
          />
        </div>

        <div className="mt-3 flex justify-end">
          <Button onClick={start} disabled={!previewCount || running}>
            {running ? "Sending…" : "Start"}
          </Button>
        </div>
      </Card>

      {activeJob && counts && (
        <Card>
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-sm text-muted">Active WA job</div>
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
          <div className="mt-3 flex gap-2 text-xs">
            <Badge tone="accent">total {counts.total}</Badge>
            <Badge tone="ok">sent {counts.ok}</Badge>
            <Badge tone="danger">failed {counts.failed}</Badge>
            <Badge tone="warn">pending {counts.pending}</Badge>
          </div>
          {counts.failed > 0 && (
            <details className="mt-3">
              <summary className="text-sm text-muted cursor-pointer">Failed rows ({counts.failed})</summary>
              <div className="mt-2 max-h-64 overflow-auto text-xs font-mono space-y-1">
                {activeJob.rows
                  .map((r, i) => ({ r, i }))
                  .filter((x) => x.r.status === "failed")
                  .map(({ r, i }) => (
                    <div key={i}>
                      [{i}] {r.phone} — {r.error || "error"}
                    </div>
                  ))}
              </div>
            </details>
          )}
        </Card>
      )}

      {!!jobs.length && (
        <Card>
          <div className="text-sm text-muted mb-2">Recent WA jobs</div>
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
                    {c.ok}/{c.total} sent · {c.failed} failed
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}
    </>
  );
}

function tally(job: BulkJob) {
  let ok = 0, failed = 0, pending = 0, dialing = 0;
  for (const r of job.rows) {
    if (r.status === "ok") ok++;
    else if (r.status === "failed") failed++;
    else if (r.status === "dialing") dialing++;
    else pending++;
  }
  return { ok, failed, pending, dialing, total: job.rows.length };
}

function Progress({ counts }: { counts: { ok: number; failed: number; pending: number; total: number } }) {
  const okPct = (counts.ok / counts.total) * 100;
  const failPct = (counts.failed / counts.total) * 100;
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
