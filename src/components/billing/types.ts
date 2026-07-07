import type { Tone } from "./meta";

/** The kinds of ledger entries a billing account can have. */
export type TxnType = "topup" | "usage" | "adjustment" | "refund";

/** A single row in the credits transaction ledger. */
export interface Transaction {
  id: string;
  /** ISO timestamp. */
  date: string;
  type: TxnType;
  description: string;
  /** Signed credit delta: positive for topup/refund, negative for usage. */
  amount: number;
  /** Credit balance immediately after this transaction was applied. */
  balanceAfter: number;
}

/** A wallet ledger entry (money in ₹, not credits). */
export interface WalletTxn {
  id: string;
  date: string;
  type: "topup" | "charge";
  description: string;
  /** Signed ₹ amount: positive top-up, negative charge. */
  amount: number;
  balanceAfter: number;
}

/** An owned/rented phone number and its billing state. */
export interface OwnedNumber {
  id: string;
  number: string;
  active: boolean;
  /** ISO date of the next monthly rental charge. */
  nextCharge: string;
  /** Monthly rental cost in ₹. */
  monthlyCostInr: number;
}

/** Presentation metadata per transaction type. */
export interface TxnTypeMeta {
  label: string;
  tone: Tone;
}
