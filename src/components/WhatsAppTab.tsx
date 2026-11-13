"use client";

import { useEffect, useMemo, useState } from "react";
import { Send, Play, Square, MessageCircle, X } from "lucide-react";
import {
  Button, Card, Input, Label, Textarea, Badge, Section, CsvFilePicker, DataPanel, DataTable, TH, TD, toast,
} from "./ui";
import { useFetch, api, apiRetry, usePersistentState } from "./useData";
import { parseContacts } from "@/lib/contacts";
import { fmtDateTime } from "@/lib/format";
import ScheduleCard from "./ScheduleCard";
import {
  Seg, StepsLayout, Step, SummaryCard, SumRow, SumTotal, FileChip, Chips, Callout,
  StatTiles, StatTile, Prog, ConfirmSendModal, ModalActions,
} from "./BulkTabParts";
import type { BulkJobWithCounts } from "@/lib/models";

type Mode = "single" | "bulk" | "sched";

export default function WhatsAppTab() {
  const [mode, setMode] = useState<Mode>("single");
  // Count for the "Scheduled" segment. ScheduleCard reports it after each load;
  // this first fetch fills it before that view has been opened.
  const { data: sdata } = useFetch<{ schedules: { kind: string }[] }>("/api/schedules");
  const [schedCount, setSchedCount] = useState<number | null>(null);
  const shownCount = schedCount ?? sdata?.schedules.filter((s) => s.kind === "whatsapp").length;

  return (
    <Section>
      <Seg<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { value: "single", label: "Single" },
          { value: "bulk", label: "Bulk send" },
          { value: "sched", label: "Scheduled", count: shownCount ?? undefined },
        ]}
      />
      {mode === "single" ? <SingleSend /> : <BulkSend view={mode} onSchedCount={setSchedCount} />}
    </Section>
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
      if (r.ok && j.ok) toast(`WhatsApp sent (${j.ms} ms)`, "ok");
      else toast(`Failed: ${j.error || j.status}`, "danger");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <div className="space-y-4">
        <Card noPadding>
          <div className="border-b border-line px-5 py-4">
            <div className="text-[15px] font-semibold tracking-[-0.015em]">Send one WhatsApp</div>
            <div className="mt-0.5 text-[13px] text-muted">Goes out now to one number. No call is placed.</div>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" inputMode="tel" />
              </div>
              <div>
                <Label hint="optional">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Their first name" />
              </div>
            </div>
            {/* Both fields below are optional and fall back to the account
                default. Collapsed, not removed. */}
            <details className="group mt-3.5 rounded-[10px] border border-dashed border-line2 px-3 py-2.5">
              <summary className="cursor-pointer list-none text-[13.5px] font-medium text-ink marker:content-['']">
                <span className="mr-1.5 inline-block text-muted transition-transform group-open:rotate-90">&#9656;</span>
                Advanced <span className="font-normal text-muted">· webhook URL, extra fields</span>
              </summary>
              <div className="mt-3 space-y-3.5">
                <div>
                  <Label hint="optional">Webhook URL</Label>
                  <Input
                    value={webhookUrl}
                    onChange={(e) => setWebhookUrl(e.target.value)}
                    placeholder="Leave blank to use your account default"
                  />
                </div>
                <div>
                  <Label hint="optional · merged into the payload">Extra fields (JSON)</Label>
                  <Textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder='{"campaign": "day1"}' />
                </div>
              </div>
            </details>
            <Button onClick={send} disabled={!phone} loading={busy} leftIcon={<Send size={15} />} size="lg" className="mt-[18px]">
              Send WhatsApp
            </Button>
          </div>
        </Card>

        {last && (
          <Card
            title="Last response"
            action={<Badge tone={last.ok ? "ok" : "danger"}>{last.ok ? `${last.status} · ${last.ms} ms` : "Failed"}</Badge>}
          >
            <pre className="max-h-64 overflow-auto rounded-[9px] border border-line bg-elev p-3 font-mono text-xs">
              {JSON.stringify(last, null, 2)}
            </pre>
          </Card>
        )}
      </div>

      <Card noPadding>
        <div className="border-b border-line px-5 py-4 text-[15px] font-semibold tracking-[-0.015em]">Good to know</div>
        <div className="grid gap-2.5 p-5">
          <Callout tone="info">Numbers on your Do Not Disturb list are never messaged, even here.</Callout>
          <Callout tone="warn">Each send uses your WhatsApp template credits with your provider.</Callout>
        </div>
      </Card>
    </div>
  );
}

// Rows claimed + sent concurrently by the server per batch request. The browser
// fires one batch, waits out the remainder of the batch's time budget, then fires
// the next — so overall throughput tracks the configured messages/minute while
// each batch goes out in parallel (server-side concurrency + retry).
const BATCH_SIZE = 20;

// Recommended safe ceiling; above this we warn (provider limits — see explainer).
const SAFE_MAX_RATE = 600;

const EMPTY_CSV = "phone,name,email\n";

function BulkSend({ view, onSchedCount }: { view: "bulk" | "sched"; onSchedCount: (n: number) => void }) {
  const { data: jdata, reload: reloadJobs } = useFetch<{ jobs: BulkJobWithCounts[] }>("/api/bulk");
  const jobs = (jdata?.jobs ?? []).filter((j) => j.kind === "whatsapp");

  // Persisted across tab switches + refresh (BUG 1) — recipients and settings survive.
  const [csv, setCsv] = usePersistentState<string>("ivr.wa.csv", EMPTY_CSV);
  const [webhookUrl, setWebhookUrl] = usePersistentState("ivr.wa.webhookUrl", "");
  // Messages per minute. New key (not the old "ivr.wa.rate", which capped at ~60)
  // so existing users pick up the faster default. 300/min ≈ 18k/hour.
  const [ratePerMin, setRatePerMin] = usePersistentState("ivr.wa.ratePerMin", 300);
  const [jitterPct, setJitterPct] = usePersistentState("ivr.wa.jitterPct", 20);
  const [activeJobId, setActiveJobId] = usePersistentState<string | null>("ivr.wa.activeJobId", null);
  const [activeJob, setActiveJob] = useState<BulkJobWithCounts | null>(null);
  // Reflects the job on the server, not a loop in this tab.
  const running = activeJob?.status === "running";
  // A send reaches real people, so "Review & send" only opens a confirmation;
  // `starting` locks the button while the request is in flight so a double
  // click can't queue the same list twice.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [showPaste, setShowPaste] = useState(false);

  // Keep the recent-sends list fresh without a manual refresh: poll the jobs
  // list (fast while a send is running, slow when idle).
  useEffect(() => {
    const h = setInterval(() => reloadJobs(), running ? 3000 : 10000);
    return () => clearInterval(h);
  }, [running, reloadJobs]);

  useEffect(() => {
    if (!activeJobId) return;
    const fn = async () => {
      try {
        const j = await api<{ job: BulkJobWithCounts }>(`/api/bulk/${activeJobId}`);
        setActiveJob(j.job);
      } catch {}
    };
    fn();
    const h = setInterval(fn, running ? 1500 : 5000);
    return () => clearInterval(h);
  }, [activeJobId, running]);

  const parsed = useMemo(() => parseContacts(csv), [csv]);
  const previewCount = parsed.rows.length;
  const estimatedMin = previewCount > 0 ? Math.max(1, Math.ceil(previewCount / Math.max(1, ratePerMin))) : 0;

  async function start() {
    const rows = parsed.rows;
    if (!rows.length || starting) return;
    setStarting(true);
    const idempotencyKey = `idem_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try {
      const r = await apiRetry<{ job: BulkJobWithCounts }>("/api/bulk", {
        method: "POST",
        body: JSON.stringify({
          kind: "whatsapp",
          rows,
          webhookUrl: webhookUrl || undefined,
          delayMs: Math.round(60000 / Math.max(1, ratePerMin)),
          jitterPct,
          idempotencyKey,
        }),
      });
      setActiveJobId(r.job.id);
      setActiveJob(r.job);
      reloadJobs();
      // Clear the list once it is queued. It used to stay saved in the browser,
      // so the next visit showed "Start · N sends" for people already messaged.
      setCsv(EMPTY_CSV);
      toast(`Queued ${rows.length.toLocaleString()} WhatsApp sends — you can close this tab`, "ok");
    } catch (e: any) {
      toast(e.message || "Failed", "danger");
    } finally {
      setStarting(false);
      setConfirmOpen(false);
    }
  }

  /**
   * Sending is done by the server worker, so these only flip the job's status.
   * It used to be paced by a loop in this component, which meant closing the tab
   * abandoned the rest of the send — and made scheduling one impossible.
   */
  async function stop() {
    if (!activeJobId) return;
    try {
      await api(`/api/bulk/${activeJobId}/pause`, { method: "POST" });
      toast("Paused.", "info");
      reloadJobs();
    } catch (e: any) {
      toast(e.message || "Could not pause", "danger");
    }
  }

  async function resume(jobId: string) {
    setActiveJobId(jobId);
    try {
      await api(`/api/bulk/${jobId}/resume`, { method: "POST" });
      toast("Resumed — sending continues on the server.", "ok");
      reloadJobs();
    } catch (e: any) {
      toast(e.message || "Could not resume", "danger");
    }
  }

  const counts = activeJob ? tally(activeJob) : null;
  const { stats } = parsed;
  const pl = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

  const scheduleCard = (
    <ScheduleCard
      kind="whatsapp"
      recipientCount={previewCount}
      title="Scheduled sends"
      description="Goes out on its own at the time you pick. The tab does not need to be open."
      emptyHint="Load recipients under Bulk send first, then schedule them here."
      onCount={onSchedCount}
      buildSpec={() => {
        if (!parsed.rows.length) {
          toast("Add recipients first.", "danger");
          return null;
        }
        return {
          webhookUrl: webhookUrl || undefined,
          recipients: parsed.rows,
          delayMs: Math.round(60000 / Math.max(1, ratePerMin)),
          jitterPct,
          concurrency: BATCH_SIZE,
        };
      }}
    />
  );

  if (view === "sched") {
    return (
      <>
        {previewCount > 0 && (
          <Callout tone="info">
            {pl(previewCount, "recipient", "recipients")} from Bulk send will be saved with a new schedule.
          </Callout>
        )}
        {scheduleCard}
      </>
    );
  }

  return (
    <>
      <StepsLayout
        steps={
          <>
            <Step
              n={1}
              done={previewCount > 0}
              title="Recipients"
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
                    : "Choose a CSV file, or paste the list below."
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
                </Chips>
              )}
              <button
                type="button"
                onClick={() => setShowPaste((v) => !v)}
                className="mt-3 text-[13px] font-medium text-accent hover:underline"
              >
                {showPaste ? "Hide the list" : "Paste or edit the list"}
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

            <Step n={2} done title="Message" description="The WhatsApp flow that sends your template.">
              <Label hint="optional">Webhook URL</Label>
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="Leave blank to use your account default flow"
              />
            </Step>

            <Step n={3} title="Pace" description="Slower sending looks more natural to WhatsApp.">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <div>
                  <Label>Messages per minute</Label>
                  <Input
                    type="number"
                    min={10}
                    max={1200}
                    step={10}
                    value={ratePerMin}
                    onChange={(e) => setRatePerMin(Math.max(1, Number(e.target.value) || 0))}
                    className="tabular-nums"
                  />
                  <div className="mt-1 text-xs text-muted">
                    {ratePerMin > SAFE_MAX_RATE ? (
                      <span className="text-warn">
                        Above {SAFE_MAX_RATE}/min — only go this high if your WhatsApp provider allows it.
                      </span>
                    ) : (
                      <>Recommended 300–600/min. About {Math.ceil(20000 / Math.max(1, ratePerMin))} min for 20,000.</>
                    )}
                  </div>
                </div>
                <div>
                  <Label hint={`± ${jitterPct}%`}>Randomise timing</Label>
                  <input
                    type="range"
                    min={0}
                    max={80}
                    value={jitterPct}
                    onChange={(e) => setJitterPct(Number(e.target.value))}
                    className="mt-2.5 w-full accent-accent"
                    aria-label="Randomise timing"
                  />
                  <div className="mt-1 text-xs text-muted">Varies the spacing so sends don&apos;t look robotic.</div>
                </div>
              </div>
            </Step>
          </>
        }
        summary={
          <SummaryCard>
            <SumRow label="Rows in file" value={stats.totalRows.toLocaleString()} />
            {stats.duplicates > 0 && <SumRow label="Duplicates" value={`− ${stats.duplicates.toLocaleString()}`} tone="muted" />}
            {stats.noPhone > 0 && <SumRow label="No phone number" value={`− ${stats.noPhone.toLocaleString()}`} tone="warn" />}
            <SumRow label="Takes about" value={previewCount > 0 ? `${estimatedMin.toLocaleString()} min` : "—"} />
            <SumTotal label="Will be messaged" value={previewCount.toLocaleString()} />
            <Button
              size="lg"
              className="mt-3.5 w-full"
              onClick={() => setConfirmOpen(true)}
              disabled={!previewCount || running || starting}
              loading={starting}
              leftIcon={<Send size={15} />}
            >
              {running ? "Sending…" : "Review & send"}
            </Button>
            <div className="mt-1.5 text-center text-xs text-muted">
              {running
                ? "Wait for the current send to finish, or stop it."
                : "You’ll confirm before anything is sent. Numbers on your DND list are skipped."}
            </div>
          </SummaryCard>
        }
      />

      <ConfirmSendModal
        open={confirmOpen}
        icon={<Send size={20} />}
        title={`Send to ${pl(previewCount, "person", "people")}?`}
        body="Messages can’t be recalled once sent. The list is cleared after it’s queued, so it can’t go out twice."
        facts={[
          ["Recipients", previewCount.toLocaleString()],
          ...(stats.duplicates + stats.noPhone > 0
            ? ([[
                "Left out",
                [
                  stats.duplicates > 0 ? pl(stats.duplicates, "duplicate", "duplicates") : "",
                  stats.noPhone > 0 ? `${stats.noPhone.toLocaleString()} without a phone` : "",
                ].filter(Boolean).join(" · "),
              ]] as [string, string][])
            : []),
          ["Do Not Disturb", "Numbers on the list are skipped"],
          ["Pace", `${ratePerMin.toLocaleString()} / min · about ${estimatedMin.toLocaleString()} min`],
          ["Flow", webhookUrl ? "Custom webhook" : "Account default"],
        ]}
        onClose={() => !starting && setConfirmOpen(false)}
        actions={
          <ModalActions>
            <Button variant="ghost" size="lg" onClick={() => setConfirmOpen(false)} disabled={starting}>Cancel</Button>
            <Button size="lg" onClick={start} loading={starting}>
              Send to {pl(previewCount, "person", "people")}
            </Button>
          </ModalActions>
        }
      />

      {activeJob && counts && (
        <Card noPadding>
          <div className="flex flex-wrap items-start gap-3 p-5 pb-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-[-0.015em]">
                {running ? "Sending now" : counts.pending > 0 ? "Paused" : "Last send"}
                <JobBadge job={activeJob} pending={counts.pending} />
              </div>
              <div className="mt-0.5 text-[13px] text-muted">
                Started {fmtDateTime(activeJob.createdAt)} · {Math.round(counts.donePct)}% done
              </div>
            </div>
            {running ? (
              <Button size="sm" variant="danger" leftIcon={<Square size={12} />} onClick={stop}>Stop</Button>
            ) : counts.pending > 0 ? (
              <Button size="sm" leftIcon={<Play size={12} />} onClick={() => resume(activeJob.id)}>Resume</Button>
            ) : null}
          </div>
          <div className="px-5 pb-5">
            <Prog
              height="h-2.5"
              total={counts.total}
              title="Sent · skipped (DND) · failed"
              parts={[
                { value: counts.ok, cls: "bg-ok" },
                // DND skips are finished rows too — without them a job that skipped one
                // number sat at "67% complete" forever.
                { value: counts.dnd, cls: "bg-muted/60" },
                { value: counts.failedAll, cls: "bg-danger" },
              ]}
            />
            <div className="mt-3.5">
              <StatTiles>
                <StatTile label="Total" value={counts.total} />
                <StatTile label="Sent" value={counts.ok} tone="ok" />
                <StatTile label="Pending" value={counts.pending} />
                <StatTile label="Failed" value={counts.failedAll} tone="danger" />
                <StatTile label="Skipped · DND" value={counts.dnd} tone="warn" />
              </StatTiles>
            </div>
          </div>
        </Card>
      )}

      {!!jobs.length && (
        <DataPanel title="Recent sends" meta="Click a row to follow it above.">
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Send</th>
                <th className={TH}>Status</th>
                <th className={`${TH} w-[30%]`}>Progress</th>
                <th className={`${TH} text-right`}>Sent</th>
                <th className={`${TH} hidden text-right sm:table-cell`}>Skipped</th>
                <th className={`${TH} hidden text-right sm:table-cell`}>Failed</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice(0, 8).map((j) => {
                const c = tally(j);
                const isActive = activeJobId === j.id;
                return (
                  <tr
                    key={j.id}
                    onClick={() => {
                      setActiveJobId(j.id);
                      setActiveJob(j);
                    }}
                    className={`cursor-pointer transition-colors ${isActive ? "bg-accent/[0.06]" : "hover:bg-ink/[0.03]"}`}
                  >
                    <td className={TD}>
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-accent/10 text-accent">
                          <MessageCircle size={14} />
                        </div>
                        <div className="min-w-0">
                          <div className="whitespace-nowrap font-medium text-ink">{c.total.toLocaleString()} recipients</div>
                          <div className="whitespace-nowrap text-xs text-muted" title={j.id}>{fmtDateTime(j.createdAt)}</div>
                        </div>
                      </div>
                    </td>
                    <td className={TD}><JobBadge job={j} pending={c.pending} /></td>
                    <td className={TD}>
                      <Prog
                        total={c.total}
                        parts={[
                          { value: c.ok, cls: "bg-ok" },
                          { value: c.dnd, cls: "bg-muted/60" },
                          { value: c.failedAll, cls: "bg-danger" },
                        ]}
                      />
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{c.ok.toLocaleString()}</td>
                    <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{c.dnd.toLocaleString()}</td>
                    <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{c.failedAll.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </DataPanel>
      )}
    </>
  );
}

function JobBadge({ job, pending }: { job: BulkJobWithCounts; pending: number }) {
  if (job.status === "running") return <Badge tone="accent" dot>Sending</Badge>;
  if (pending > 0) return <Badge tone="warn">Paused</Badge>;
  return <Badge tone="ok">Completed</Badge>;
}

function tally(job: BulkJobWithCounts) {
  const c = job.counts || {};
  const ok = c.ok ?? 0, failedAll = c.failed ?? 0, dnd = c.dnd ?? 0;
  const total = job.total || 0;
  return {
    ok,
    failedAll,
    pending: c.pending ?? 0,
    dnd,
    dialing: c.dialing ?? 0,
    total,
    donePct: total ? ((ok + failedAll + dnd) / total) * 100 : 0,
  };
}
