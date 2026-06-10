"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Play, Square, RotateCw, MessageCircle, Zap, CheckCircle2, AlertCircle } from "lucide-react";
import { Button, Card, Input, Label, Textarea, Badge, EmptyState, Section, CsvFilePicker, toast } from "./ui";
import { useFetch, api } from "./useData";
import type { BulkJob } from "@/lib/models";

type Mode = "single" | "bulk";

export default function WhatsAppTab() {
  const [mode, setMode] = useState<Mode>("single");
  return (
    <Section>
      <div className="inline-flex p-1 bg-elev/60 border border-line rounded-lg">
        <ModeBtn active={mode === "single"} onClick={() => setMode("single")} icon={<Send size={12} />} label="Single" />
        <ModeBtn active={mode === "bulk"} onClick={() => setMode("bulk")} icon={<Zap size={12} />} label="Bulk" />
      </div>
      {mode === "single" ? <SingleSend /> : <BulkSend />}
    </Section>
  );
}

function ModeBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-all ${
        active ? "bg-brand/15 text-brand" : "text-ink2 hover:text-ink"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function SingleSend() {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<any>(null);

  async function send() {
    if (!phone) return;
    setBusy(true);
    try {
      let extraObj: any = undefined;
      if (extra.trim()) {
        try { extraObj = JSON.parse(extra); }
        catch { toast("Extra must be valid JSON", "danger"); setBusy(false); return; }
      }
      const r = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          name: name || undefined,
          webhookUrl: webhookUrl || undefined,
          extra: extraObj,
        }),
      });
      const j = await r.json();
      setLast(j);
      if (r.ok && j.ok) toast(`Pabbly ${j.status} · ${j.ms}ms`, "ok");
      else toast(`Failed: ${j.error || j.status}`, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title="Send a single WhatsApp" description="Fires Pabbly directly, no Plivo involved.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" />
          </div>
          <div>
            <Label hint="optional">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Animesh" />
          </div>
          <div className="md:col-span-2">
            <Label hint="optional · falls back to PABBLY_WEBHOOK_URL">Pabbly webhook URL</Label>
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://connect.pabbly.com/webhook-listener/..."
            />
          </div>
          <div className="md:col-span-2">
            <Label hint="optional · merged into payload">Extra JSON</Label>
            <Textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder='{"campaign": "day1"}' />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={send} disabled={!phone} loading={busy} leftIcon={<Send size={14} />}>
              Send via Pabbly
            </Button>
          </div>
        </div>
      </Card>

      {last && (
        <Card title="Last response" action={
          <Badge tone={last.ok ? "ok" : "danger"}>{last.ok ? `${last.status} · ${last.ms}ms` : "failed"}</Badge>
        }>
          <pre className="text-xs font-mono bg-bg/60 border border-line p-3 rounded-md overflow-auto max-h-64">
            {JSON.stringify(last, null, 2)}
          </pre>
        </Card>
      )}
    </>
  );
}

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

function delayMsForRate(ratePerMin: number, jitterPct: number): number {
  const baseMs = 60000 / Math.max(1, ratePerMin);
  const jitter = baseMs * (jitterPct / 100);
  return Math.round(baseMs - jitter + Math.random() * jitter * 2);
}

function BulkSend() {
  const { data: jdata, reload: reloadJobs } = useFetch<{ jobs: BulkJob[] }>("/api/bulk");
  const jobs = (jdata?.jobs ?? []).filter((j) => j.kind === "whatsapp");

  const [csv, setCsv] = useState<string>("phone,name,email\n");
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
            email: row.email,
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
      <Card title="Bulk WhatsApp via Pabbly" description="Browser-paced trickle send. Persists across tab close.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Label hint="optional · falls back to PABBLY_WEBHOOK_URL">Pabbly webhook URL</Label>
            <Input
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://connect.pabbly.com/webhook-listener/..."
            />
          </div>

          <div>
            <Label hint={`${rate} msg/min`}>Rate</Label>
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
            <Label hint={`±${jitterPct}%`}>Jitter</Label>
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
          <div className="flex items-center justify-between mb-1.5">
            <Label>Recipients · CSV with headers phone, name, email</Label>
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="tabular-nums">
                {previewCount}
                {previewCount > 0 && ` · ~${estimatedMin}m`}
              </span>
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

        <div className="mt-4 flex justify-end">
          <Button onClick={start} disabled={!previewCount || running} loading={running} leftIcon={<Play size={14} />} size="lg">
            {running ? "Sending…" : `Start · ${previewCount} sends`}
          </Button>
        </div>
      </Card>

      {activeJob && counts && (
        <Card
          title={
            <div className="flex items-center gap-2">
              <span>Active WA job</span>
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
            <Stat label="Sent" value={counts.ok} tone="ok" />
            <Stat label="Failed" value={counts.failedAll} tone="danger" />
            <Stat label="Pending" value={counts.pending} tone="muted" />
            <Stat label="Total" value={counts.total} tone="muted" />
          </div>
        </Card>
      )}

      {!!jobs.length && (
        <Card title="Recent WA jobs">
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
                    <MessageCircle size={14} className="text-muted shrink-0" />
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
    </>
  );
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
  let ok = 0, failed = 0, pending = 0, dialing = 0;
  for (const r of job.rows) {
    if (r.status === "ok") ok++;
    else if (r.status === "failed") failed++;
    else if (r.status === "dialing") dialing++;
    else pending++;
  }
  return {
    ok,
    failedAll: failed,
    pending,
    dialing,
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
