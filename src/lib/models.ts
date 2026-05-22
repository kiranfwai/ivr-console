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

export type BulkRowStatus = "pending" | "dialing" | "ok" | "failed";

export interface BulkRow {
  phone: string;
  name?: string;
  status: BulkRowStatus;
  callUuid?: string;
  error?: string;
  attemptedAt?: string;
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
  createdAt: string;
  completedAt?: string;
}
