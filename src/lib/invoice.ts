import { query } from "./db";

/**
 * GST invoices for wallet top-ups.
 *
 * One invoice per successful Cashfree payment — a receipt for money taken, not a
 * usage statement. It is issued from `creditOrderPaid()`, the single point where
 * a payment becomes real, and is deliberately **best-effort**: if invoicing is
 * not configured or the PDF cannot be built, the customer's wallet is still
 * credited. Taking someone's money and then failing to credit it because a tax
 * field was blank would be a far worse bug than a missing invoice, and a missing
 * one can be back-filled later.
 *
 * All money is handled in integer paise. Two-decimal floats do not add up — the
 * taxable value plus the tax must equal the amount charged, exactly, because
 * that is what the customer paid and what the accountant will tie out.
 */

export type TaxMode = "inclusive" | "exclusive";

export interface SellerSettings {
  /** Nothing is issued until this is true AND the required fields are filled. */
  enabled: boolean;
  legalName: string;
  gstin: string;
  address: string;
  /** Place of supply for the seller, e.g. "Karnataka". */
  state: string;
  /** Two-digit GST state code, e.g. "29". Decides CGST+SGST vs IGST. */
  stateCode: string;
  email: string;
  phone: string;
  /** Prefix of the invoice number, e.g. "FWAI" -> FWAI/26-27/0001. */
  seriesPrefix: string;
  /** Whole percent, e.g. 18. */
  gstRate: number;
  taxMode: TaxMode;
  /** Service accounting code printed on the line item. */
  sacCode: string;
  /** Line-item wording. */
  description: string;
}

export const DEFAULT_SELLER: SellerSettings = {
  enabled: false,
  legalName: "",
  gstin: "",
  address: "",
  state: "",
  stateCode: "",
  email: "",
  phone: "",
  seriesPrefix: "INV",
  gstRate: 18,
  taxMode: "inclusive",
  sacCode: "998414",
  description: "Prepaid credit for outbound voice and messaging services",
};

export interface BuyerDetails {
  name: string;
  email: string;
  legalName: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
}

export interface InvoiceTotals {
  /** Everything in paise — integers, so the parts always sum to the whole. */
  taxableP: number;
  cgstP: number;
  sgstP: number;
  igstP: number;
  totalP: number;
  gstRate: number;
  taxMode: TaxMode;
  interState: boolean;
}

export interface Invoice {
  id: number;
  invoiceNo: string;
  orderId: string;
  clientId: string;
  issuedAt: string;
  totals: InvoiceTotals;
  seller: SellerSettings;
  buyer: BuyerDetails;
  /** Wallet credit the customer received, in paise. */
  creditP: number;
}

const CONFIG_KEY = "invoicing";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function sanitizeSeller(input: unknown): SellerSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rate = Number(o.gstRate);
  return {
    enabled: o.enabled === true,
    legalName: str(o.legalName),
    gstin: str(o.gstin).toUpperCase(),
    address: str(o.address),
    state: str(o.state),
    stateCode: str(o.stateCode).slice(0, 2),
    email: str(o.email),
    phone: str(o.phone),
    seriesPrefix: str(o.seriesPrefix, DEFAULT_SELLER.seriesPrefix) || DEFAULT_SELLER.seriesPrefix,
    gstRate: Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : DEFAULT_SELLER.gstRate,
    taxMode: o.taxMode === "exclusive" ? "exclusive" : "inclusive",
    sacCode: str(o.sacCode, DEFAULT_SELLER.sacCode) || DEFAULT_SELLER.sacCode,
    description: str(o.description, DEFAULT_SELLER.description) || DEFAULT_SELLER.description,
  };
}

export async function getSellerSettings(): Promise<SellerSettings> {
  const { rows } = await query<{ v: unknown }>(`SELECT v FROM app_config WHERE k=$1`, [CONFIG_KEY]);
  return rows.length ? sanitizeSeller(rows[0].v) : { ...DEFAULT_SELLER };
}

export async function setSellerSettings(input: unknown): Promise<SellerSettings> {
  const s = sanitizeSeller(input);
  await query(
    `INSERT INTO app_config (k, v) VALUES ($1, $2::jsonb)
     ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v`,
    [CONFIG_KEY, JSON.stringify(s)],
  );
  return s;
}

/** Which required fields are still blank. Empty array = ready to issue. */
export function missingSellerFields(s: SellerSettings): string[] {
  const need: [keyof SellerSettings, string][] = [
    ["legalName", "Registered business name"],
    ["gstin", "GSTIN"],
    ["address", "Registered address"],
    ["state", "State"],
    ["stateCode", "State code"],
  ];
  return need.filter(([k]) => !String(s[k] || "").trim()).map(([, label]) => label);
}

export function canIssue(s: SellerSettings): boolean {
  return s.enabled && missingSellerFields(s).length === 0;
}

// ---------------------------------------------------------------------------
// The money
// ---------------------------------------------------------------------------

/**
 * Split an amount into taxable value and GST.
 *
 * `inclusive` — the customer pays `amountRupees` and that figure already
 * contains the tax, so it is carved out. Wallet credit equals the amount paid.
 *
 * `exclusive` — `amountRupees` is the credit; tax is added on top, so the
 * customer is charged more than they receive as credit.
 *
 * Rounding: CGST and SGST are halves of one tax figure, so the second is the
 * remainder rather than a second rounding — otherwise a 1-paise gap appears on
 * odd amounts and the invoice does not foot.
 */
export function computeTotals(
  amountRupees: number,
  gstRate: number,
  taxMode: TaxMode,
  interState: boolean,
): InvoiceTotals {
  const amountP = Math.round(amountRupees * 100);
  let taxableP: number;
  let taxP: number;
  let totalP: number;

  if (taxMode === "inclusive") {
    totalP = amountP;
    taxableP = Math.round((totalP * 100) / (100 + gstRate));
    taxP = totalP - taxableP;
  } else {
    taxableP = amountP;
    taxP = Math.round((taxableP * gstRate) / 100);
    totalP = taxableP + taxP;
  }

  const cgstP = interState ? 0 : Math.floor(taxP / 2);
  const sgstP = interState ? 0 : taxP - cgstP;
  const igstP = interState ? taxP : 0;

  return { taxableP, cgstP, sgstP, igstP, totalP, gstRate, taxMode, interState };
}

/** Wallet credit for a payment: the amount, whichever way tax is applied. */
export function creditForAmount(amountRupees: number): number {
  return Math.round(amountRupees * 100);
}

/**
 * Indian financial year label for a date — April to March.
 * 22 Aug 2026 -> "26-27";  3 Feb 2027 -> "26-27".
 */
export function financialYear(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1; // 1-12
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, "0")}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Numbering
// ---------------------------------------------------------------------------

/**
 * Next number in a series, allocated atomically.
 *
 * A tax invoice series must have no gaps and no duplicates, so this is a single
 * UPSERT that increments and returns in one statement — two payments landing at
 * the same instant cannot receive the same number.
 */
export async function nextInvoiceNumber(prefix: string, fy: string): Promise<string> {
  const series = `${prefix}/${fy}`;
  const { rows } = await query<{ next_no: number }>(
    `INSERT INTO invoice_counter (series, next_no) VALUES ($1, 1)
     ON CONFLICT (series) DO UPDATE SET next_no = invoice_counter.next_no + 1
     RETURNING next_no`,
    [series],
  );
  return `${series}/${String(rows[0].next_no).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Issue + read
// ---------------------------------------------------------------------------

type Row = {
  id: string;
  invoice_no: string;
  order_id: string;
  client_id: string;
  issued_at: Date;
  totals: InvoiceTotals;
  seller: SellerSettings;
  buyer: BuyerDetails;
  credit_p: number;
};

function toInvoice(r: Row): Invoice {
  return {
    id: Number(r.id),
    invoiceNo: r.invoice_no,
    orderId: r.order_id,
    clientId: r.client_id,
    issuedAt: r.issued_at.toISOString(),
    totals: r.totals,
    seller: r.seller,
    buyer: r.buyer,
    creditP: Number(r.credit_p),
  };
}

async function loadBuyer(clientId: string): Promise<BuyerDetails> {
  const { rows } = await query<{
    name: string; email: string; legal_name: string | null; gstin: string | null;
    address: string | null; state: string | null; state_code: string | null;
  }>(
    `SELECT name, email, legal_name, gstin, address, state, state_code
     FROM app_client WHERE id = $1`,
    [clientId],
  );
  const r = rows[0];
  return {
    name: r?.name || "",
    email: r?.email || "",
    legalName: r?.legal_name || r?.name || "",
    gstin: (r?.gstin || "").toUpperCase(),
    address: r?.address || "",
    state: r?.state || "",
    stateCode: r?.state_code || "",
  };
}

/**
 * Issue the invoice for a paid order, once.
 *
 * Returns null (never throws) when invoicing is off, unconfigured, the order is
 * unknown, or one already exists — all of which are normal, and none of which
 * should disturb the payment that triggered this.
 */
export async function issueInvoiceForOrder(orderId: string): Promise<Invoice | null> {
  try {
    const existing = await getInvoiceByOrder(orderId);
    if (existing) return existing;

    const seller = await getSellerSettings();
    if (!canIssue(seller)) return null;

    const { rows: orders } = await query<{ client_id: string; amount: number; paid_at: Date | null }>(
      `SELECT client_id, amount, paid_at FROM wallet_order WHERE order_id = $1`,
      [orderId],
    );
    if (!orders.length) return null;
    const order = orders[0];

    const buyer = await loadBuyer(order.client_id);
    // Place of supply for a buyer whose state we do not know is the supplier's
    // own location, so an unknown state is treated as intra-state, not inter.
    const interState = !!buyer.stateCode && buyer.stateCode !== seller.stateCode;

    const totals = computeTotals(order.amount, seller.gstRate, seller.taxMode, interState);
    const issuedAt = order.paid_at || new Date();
    const invoiceNo = await nextInvoiceNumber(seller.seriesPrefix, financialYear(issuedAt));

    // The seller and buyer details are SNAPSHOT onto the invoice. A tax document
    // must keep saying what it said when issued, even after an address changes.
    const { rows } = await query<Row>(
      `INSERT INTO invoice (invoice_no, order_id, client_id, issued_at, totals, seller, buyer, credit_p)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8)
       ON CONFLICT (order_id) DO NOTHING
       RETURNING *`,
      [
        invoiceNo, orderId, order.client_id, issuedAt,
        JSON.stringify(totals), JSON.stringify(seller), JSON.stringify(buyer),
        creditForAmount(order.amount),
      ],
    );
    // Lost a race — the other writer's invoice is the real one.
    if (!rows.length) return await getInvoiceByOrder(orderId);
    return toInvoice(rows[0]);
  } catch (e) {
    console.error(`[invoice] could not issue for order ${orderId}:`, e);
    return null;
  }
}

export async function getInvoiceByOrder(orderId: string): Promise<Invoice | null> {
  const { rows } = await query<Row>(`SELECT * FROM invoice WHERE order_id = $1`, [orderId]);
  return rows.length ? toInvoice(rows[0]) : null;
}

export async function getInvoice(id: number): Promise<Invoice | null> {
  const { rows } = await query<Row>(`SELECT * FROM invoice WHERE id = $1`, [id]);
  return rows.length ? toInvoice(rows[0]) : null;
}

export async function listInvoices(opts: { clientId?: string; limit?: number } = {}): Promise<Invoice[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 200), 1000);
  const params: unknown[] = [];
  let where = "";
  if (opts.clientId) {
    params.push(opts.clientId);
    where = `WHERE client_id = $1`;
  }
  params.push(limit);
  const { rows } = await query<Row>(
    `SELECT * FROM invoice ${where} ORDER BY id DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(toInvoice);
}

/**
 * Issue invoices for payments that were taken while invoicing was off or
 * unconfigured. Ordered oldest first so the numbering follows payment order.
 */
export async function backfillInvoices(limit = 200): Promise<{ issued: number; skipped: number }> {
  const { rows } = await query<{ order_id: string }>(
    `SELECT o.order_id FROM wallet_order o
     LEFT JOIN invoice i ON i.order_id = o.order_id
     WHERE o.status = 'paid' AND i.id IS NULL
     ORDER BY o.paid_at ASC NULLS LAST
     LIMIT $1`,
    [Math.min(Math.max(1, limit), 1000)],
  );
  let issued = 0;
  for (const r of rows) {
    if (await issueInvoiceForOrder(r.order_id)) issued++;
  }
  return { issued, skipped: rows.length - issued };
}

// ---------------------------------------------------------------------------
// Client billing details
// ---------------------------------------------------------------------------

export interface BillingDetailsInput {
  legalName?: string;
  gstin?: string;
  address?: string;
  state?: string;
  stateCode?: string;
}

export async function setClientBillingDetails(clientId: string, input: BillingDetailsInput) {
  await query(
    `UPDATE app_client SET legal_name=$2, gstin=$3, address=$4, state=$5, state_code=$6 WHERE id=$1`,
    [
      clientId,
      str(input.legalName) || null,
      str(input.gstin).toUpperCase() || null,
      str(input.address) || null,
      str(input.state) || null,
      str(input.stateCode).slice(0, 2) || null,
    ],
  );
  return loadBuyer(clientId);
}

export const getClientBillingDetails = loadBuyer;

/** Paise -> "1,234.56" (grouped Indian-style), for the PDF and the UI. */
export function money(p: number): string {
  const neg = p < 0;
  const s = (Math.abs(p) / 100).toFixed(2);
  const [whole, frac] = s.split(".");
  // Indian grouping: last three digits, then pairs.
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return (neg ? "-" : "") + grouped + "." + frac;
}
