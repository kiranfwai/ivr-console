import type { TxnType, TxnTypeMeta } from "./types";

// Mirrors the Badge tones in ui.tsx (not exported there, so kept local).
export type Tone = "muted" | "ok" | "warn" | "danger" | "accent" | "info";

/** Badge label + colour tone for each transaction type. */
export const TXN_TYPE_META: Record<TxnType, TxnTypeMeta> = {
  topup: { label: "Topup", tone: "ok" },
  usage: { label: "Usage", tone: "danger" },
  adjustment: { label: "Adjustment", tone: "warn" },
  refund: { label: "Refund", tone: "info" },
};

/** Order the filter tabs appear in. `null` = the "All" tab. */
export const TXN_FILTERS: { value: TxnType | null; label: string }[] = [
  { value: null, label: "All" },
  { value: "topup", label: "Topup" },
  { value: "usage", label: "Usage" },
  { value: "adjustment", label: "Adjustment" },
  { value: "refund", label: "Refund" },
];
