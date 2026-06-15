export interface Audio {
  id: string;
  label: string;
  url: string;
  source: "url" | "blob";
  createdAt: string;
}

export interface Campaign {
  id: string;
  name: string;
  audioId: string | null;
  prompt: string;
  webhookUrl: string;
  fromNumber: string;
  createdAt: string;
}

export type CallStatus =
  | "triggered"
  | "queued"
  | "answered"
  | "press1"
  | "hangup"
  | "failed";

export interface CallRecord {
  callUuid: string;
  campaignId: string | null;
  campaignName: string;
  to: string;
  from: string;
  email?: string;
  audioId: string | null;
  webhookUrl: string;
  status: CallStatus;
  digit: string;
  triggeredAt: string;
  answeredAt?: string;
  hangupAt?: string;
  durationSec?: number;
  hangupCause?: string;
  pabblyStatus?: number;
  bulkJobId?: string;
}

export type BulkRowStatus =
  | "pending"     // not dialed yet
  | "dialing"     // place-call in flight
  | "ok"          // place-call succeeded (legacy / WhatsApp bulk uses this as the terminal happy state)
  | "failed"      // place-call request to Plivo failed (or generic failure for WhatsApp bulk)
  // Call outcomes (filled in by /api/hangup once the call ends):
  | "press1"      // engaged
  | "connected"   // answered, no press-1
  | "busy"        // line busy
  | "no-answer"   // rang, not picked up
  | "rejected"    // invalid number / blocked
  | "error";      // carrier / Plivo error reaching answer URL

export interface BulkRow {
  idx?: number;              // row index within the job (stable, 0-based)
  phone: string;
  name?: string;
  email?: string;
  status: BulkRowStatus;
  callUuid?: string;
  error?: string;
  attemptedAt?: string;
  hangupCause?: string;
  durationSec?: number;
}

export type BulkKind = "call" | "whatsapp";

export type BulkJobStatus = "running" | "paused" | "completed";

/**
 * A bulk job is now metadata only — the recipient rows live in their own
 * `bulk_row` table (a per-row work-queue), not inline. Use tallyJob()/getRows()
 * to read counts and rows. `BulkJob` is kept as the meta type for callers.
 */
export interface BulkJob {
  id: string;
  kind: BulkKind;
  campaignId: string;        // for "call" kind. For "whatsapp" use webhookUrl; campaignId may be "".
  webhookUrl?: string;       // WhatsApp bulk: optional Pabbly override (falls back to env)
  concurrency: number;       // call-jobs: max parallel calls the backend worker keeps in flight
  delayMs: number;           // optional pacing between claims (0 = run at full concurrency)
  jitterPct?: number;        // 0-80, WhatsApp-only pacing randomness
  status: BulkJobStatus;     // running | paused (Stop) | completed
  total: number;             // number of recipient rows
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

/** Count of rows in each status for a job (only non-zero buckets are present). */
export type BulkJobCounts = Partial<Record<BulkRowStatus, number>>;

export interface BulkJobWithCounts extends BulkJob {
  counts: BulkJobCounts;
}
