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

export interface BulkJob {
  id: string;
  kind: BulkKind;
  campaignId: string;       // for "call" kind. For "whatsapp" use webhookUrl below; campaignId may be "".
  webhookUrl?: string;       // WhatsApp bulk: optional Pabbly override (falls back to env)
  rows: BulkRow[];
  delayMs: number;           // base delay in ms (effective delay is delayMs ± jitter)
  jitterPct?: number;        // 0-80, WhatsApp-only pacing randomness
  concurrency?: number;      // call-jobs: parallel calls the backend worker fires per batch
  paused?: boolean;          // call-jobs: when true the worker skips this job (Stop button)
  createdAt: string;
  startedAt?: string;        // first time the worker fired a batch for this job
  completedAt?: string;
}
