/**
 * Map the wallet Transaction-History UI filter (All / Top-up / Usage /
 * Adjustment) to the underlying `wallet_txn.type` values. "Usage" is the
 * per-call charge; refunds only surface under "All". Read-side only — this never
 * affects how charges/credits are computed, only which rows are listed.
 */
export function txnTypesForFilter(filter: string | null | undefined): string[] | undefined {
  switch ((filter || "all").toLowerCase()) {
    case "topup":
      return ["topup"];
    case "usage":
      return ["charge"];
    case "adjustment":
      return ["adjustment"];
    case "all":
    default:
      return undefined; // no type filter
  }
}
