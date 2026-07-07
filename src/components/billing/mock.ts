import type { Transaction, TxnType, WalletTxn, OwnedNumber } from "./types";

// Placeholder data until the real billing/payment backend is wired up.
// Everything here is generated deterministically (fixed seed + fixed base
// date) so balances stay internally consistent and there's no SSR/client
// hydration drift. Replace these exports with API calls later.

/** Fixed reference instant so mock dates don't shift between renders. */
const BASE_MS = Date.parse("2026-07-04T10:00:00+05:30");
const DAY_MS = 24 * 60 * 60 * 1000;

/** Tiny deterministic PRNG (mulberry32) so mock data is stable across renders. */
function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const USAGE_NOTES = [
  "Bulk campaign — Diwali offer",
  "IVR calls — loan reminder",
  "Single call charges",
  "WhatsApp broadcast",
  "Missed-call service",
];

function buildTransactions(): Transaction[] {
  const rand = seeded(20260704);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];

  // Build chronologically (oldest → newest) so the running balance is correct.
  const chronological: Omit<Transaction, "balanceAfter">[] = [];
  let cursor = BASE_MS - 90 * DAY_MS;

  // Seed the account with an opening top-up.
  chronological.push({
    id: "txn-0",
    date: new Date(cursor).toISOString(),
    type: "topup",
    description: "Initial credit purchase",
    amount: 2000,
  });

  for (let i = 1; i < 64; i++) {
    cursor += Math.floor(rand() * 2 * DAY_MS) + DAY_MS / 2;
    if (cursor > BASE_MS) break;

    const roll = rand();
    let type: TxnType;
    if (roll < 0.62) type = "usage";
    else if (roll < 0.85) type = "topup";
    else if (roll < 0.95) type = "adjustment";
    else type = "refund";

    let amount = 0;
    let description = "";
    switch (type) {
      case "usage":
        amount = -(Math.floor(rand() * 180) + 10);
        description = pick(USAGE_NOTES);
        break;
      case "topup":
        amount = (Math.floor(rand() * 10) + 1) * 100;
        description = "Credits top-up (UPI)";
        break;
      case "adjustment":
        amount = Math.floor(rand() * 60) - 30;
        description = "Manual adjustment by support";
        break;
      case "refund":
        amount = Math.floor(rand() * 120) + 20;
        description = "Refund — failed campaign credits";
        break;
    }

    chronological.push({
      id: `txn-${i}`,
      date: new Date(cursor).toISOString(),
      type,
      description,
      amount,
    });
  }

  // Apply the running balance, then present newest-first.
  let balance = 0;
  const withBalance: Transaction[] = chronological.map((t) => {
    balance += t.amount;
    return { ...t, balanceAfter: balance };
  });
  return withBalance.reverse();
}

export const MOCK_TRANSACTIONS: Transaction[] = buildTransactions();

/** Credits remaining = balance after the most recent transaction. */
export const MOCK_CREDITS_REMAINING: number =
  MOCK_TRANSACTIONS[0]?.balanceAfter ?? 0;

/* -------------------- Wallet -------------------- */

export const MOCK_WALLET_BALANCE_INR = 1250;

export const MOCK_WALLET_TXNS: WalletTxn[] = (() => {
  const rows: Omit<WalletTxn, "balanceAfter">[] = [
    { id: "w-3", date: new Date(BASE_MS - 2 * DAY_MS).toISOString(), type: "charge", description: "Phone number rental — +91 80 4718 2200", amount: -149 },
    { id: "w-2", date: new Date(BASE_MS - 11 * DAY_MS).toISOString(), type: "topup", description: "Wallet top-up (UPI)", amount: 1000 },
    { id: "w-1", date: new Date(BASE_MS - 26 * DAY_MS).toISOString(), type: "charge", description: "Phone number rental — +91 80 4718 2200", amount: -149 },
    { id: "w-0", date: new Date(BASE_MS - 40 * DAY_MS).toISOString(), type: "topup", description: "Wallet top-up (Card)", amount: 548 },
  ];
  // Rows are newest-first; walk oldest-first to compute balances.
  let balance = 0;
  const chronological = [...rows].reverse().map((r) => {
    balance += r.amount;
    return { ...r, balanceAfter: balance };
  });
  return chronological.reverse();
})();

/* -------------------- Phone numbers -------------------- */

export const MOCK_OWNED_NUMBERS: OwnedNumber[] = [
  { id: "num-1", number: "+91 80 4718 2200", active: true, nextCharge: new Date(BASE_MS + 8 * DAY_MS).toISOString(), monthlyCostInr: 149 },
  { id: "num-2", number: "+91 22 6140 5533", active: true, nextCharge: new Date(BASE_MS + 15 * DAY_MS).toISOString(), monthlyCostInr: 149 },
  { id: "num-3", number: "+91 11 4004 9088", active: true, nextCharge: new Date(BASE_MS + 22 * DAY_MS).toISOString(), monthlyCostInr: 199 },
  { id: "num-4", number: "+91 40 6620 1177", active: false, nextCharge: new Date(BASE_MS + 3 * DAY_MS).toISOString(), monthlyCostInr: 149 },
];
