import { query } from "./db";
import {
  composeAddress, hasAnyAddress, isValidGstin, isValidPan, isValidPincode,
  stateByCode, stateByName, stateFromGstin,
} from "./gst-states";

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
  /** Optional on an invoice, but every accountant asks for it. */
  pan: string;
  /**
   * The printed address, composed from the parts below.
   *
   * Kept as its own field because the PDF, and every invoice already issued,
   * read one string. The structured parts are what gets edited; this is what
   * gets printed.
   */
  address: string;
  line1: string;
  line2: string;
  city: string;
  pincode: string;
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
  pan: "",
  address: "",
  line1: "",
  line2: "",
  city: "",
  pincode: "",
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

/** Where the service is delivered, when that differs from the billing address. */
export interface ShippingAddress {
  same: boolean;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
}

/**
 * The customer's billing identity.
 *
 * Also the shape SNAPSHOT onto every invoice — which is why everything added
 * after the first invoice was issued is optional. An invoice raised in August
 * genuinely has no PAN on it, and pretending otherwise would make old rows lie.
 */
export interface BuyerDetails {
  name: string;
  /** The login email. `billingEmail` is where the accounts team wants it sent. */
  email: string;
  legalName: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
  pan?: string;
  line1?: string;
  line2?: string;
  city?: string;
  pincode?: string;
  billingEmail?: string;
  phone?: string;
  shipping?: ShippingAddress;
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

/**
 * One address block, normalised.
 *
 * Two things happen here that are worth stating plainly:
 *
 * 1. **The GSTIN decides the state.** Its first two digits ARE the state code,
 *    so a hand-picked state that disagrees with the number is simply wrong and
 *    is overridden. Without a GSTIN we fall back to what was chosen.
 * 2. **A pre-existing one-line address becomes line 1.** These fields were once
 *    a single free-text box; anything saved back then is kept verbatim rather
 *    than guessed apart into city and PIN, which is the kind of parsing that
 *    puts "Bengaluru 560103" in the wrong half of a tax document.
 */
function normalizeAddress(o: Record<string, unknown>): {
  line1: string; line2: string; city: string; pincode: string;
  state: string; stateCode: string; address: string;
} {
  const legacy = str(o.address);
  const parts = {
    line1: str(o.line1),
    line2: str(o.line2),
    city: str(o.city),
    pincode: str(o.pincode),
  };
  if (!parts.line1 && legacy) parts.line1 = legacy;

  const fromGstin = stateFromGstin(str(o.gstin));
  const byCode = stateByCode(str(o.stateCode));
  const byName = stateByName(str(o.state));
  const resolved = fromGstin || byCode || byName;

  const state = resolved ? resolved.name : str(o.state);
  const stateCode = resolved ? resolved.code : str(o.stateCode).slice(0, 2);

  // A state on its own is not an address. Composing one anyway is how someone
  // who has given us nothing but a GSTIN ends up with "Karnataka" printed where
  // their address should be.
  const address = hasAnyAddress(parts) ? composeAddress({ ...parts, state }) : "";

  return { ...parts, state, stateCode, address };
}

function sanitizeSeller(input: unknown): SellerSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const rate = Number(o.gstRate);
  const addr = normalizeAddress(o);
  return {
    enabled: o.enabled === true,
    legalName: str(o.legalName),
    gstin: str(o.gstin).toUpperCase(),
    pan: str(o.pan).toUpperCase(),
    ...addr,
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

/** Which required fields are still blank or malformed. Empty array = ready to issue. */
export function missingSellerFields(s: SellerSettings): string[] {
  const need: [keyof SellerSettings, string][] = [
    ["legalName", "Legal name"],
    ["gstin", "GSTIN"],
    ["line1", "Address line 1"],
    ["city", "City"],
    ["state", "State"],
    ["stateCode", "State code"],
    ["pincode", "PIN code"],
  ];
  const missing = need.filter(([k]) => !String(s[k] || "").trim()).map(([, label]) => label);
  // A wrong number is not better than a blank one — an invoice carrying a
  // malformed GSTIN is a defective tax document, so it counts as not ready.
  if (s.gstin && !isValidGstin(s.gstin)) missing.push("a valid GSTIN");
  if (s.pan && !isValidPan(s.pan)) missing.push("a valid PAN");
  if (s.pincode && !isValidPincode(s.pincode)) missing.push("a valid PIN code");
  return missing;
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
    pan: string | null; billing_email: string | null; billing_phone: string | null;
    addr_line1: string | null; addr_line2: string | null; city: string | null; pincode: string | null;
    ship_same: boolean | null; ship_line1: string | null; ship_line2: string | null;
    ship_city: string | null; ship_state: string | null; ship_pincode: string | null;
  }>(
    `SELECT name, email, legal_name, gstin, address, state, state_code,
            pan, billing_email, billing_phone,
            addr_line1, addr_line2, city, pincode,
            ship_same, ship_line1, ship_line2, ship_city, ship_state, ship_pincode
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
    pan: (r?.pan || "").toUpperCase(),
    line1: r?.addr_line1 || "",
    line2: r?.addr_line2 || "",
    city: r?.city || "",
    pincode: r?.pincode || "",
    billingEmail: r?.billing_email || "",
    phone: r?.billing_phone || "",
    shipping: {
      same: r?.ship_same !== false,
      line1: r?.ship_line1 || "",
      line2: r?.ship_line2 || "",
      city: r?.ship_city || "",
      state: r?.ship_state || "",
      pincode: r?.ship_pincode || "",
    },
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
  pan?: string;
  /** Legacy single-line address. Still accepted; becomes line 1. */
  address?: string;
  line1?: string;
  line2?: string;
  city?: string;
  pincode?: string;
  state?: string;
  stateCode?: string;
  billingEmail?: string;
  phone?: string;
  shipSame?: boolean;
  shipLine1?: string;
  shipLine2?: string;
  shipCity?: string;
  shipState?: string;
  shipPincode?: string;
}

/** A rejected save the customer can fix themselves — answered 400, not 503. */
export class BillingDetailsError extends Error {
  readonly field: string;
  constructor(field: string, message: string) {
    super(message);
    this.name = "BillingDetailsError";
    this.field = field;
  }
}

/**
 * Save the customer's billing identity.
 *
 * The whole block stays OPTIONAL — clearing every field is a valid save, and
 * blank details never block a payment; they only mean the invoice is issued to
 * an unregistered buyer. What is rejected is a HALF-filled one: an address
 * missing its city or PIN cannot be printed on a tax document, and a malformed
 * GSTIN on an invoice makes the invoice defective rather than merely incomplete.
 */
export async function setClientBillingDetails(clientId: string, input: BillingDetailsInput) {
  const gstin = str(input.gstin).toUpperCase();
  const pan = str(input.pan).toUpperCase();
  if (gstin && !isValidGstin(gstin)) {
    throw new BillingDetailsError("gstin", "That does not look like a GSTIN — 15 characters, e.g. 29AABCF1234M1Z7.");
  }
  if (pan && !isValidPan(pan)) {
    throw new BillingDetailsError("pan", "That does not look like a PAN — 10 characters, e.g. AABCF1234M.");
  }
  const billingEmail = str(input.billingEmail);
  if (billingEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(billingEmail)) {
    throw new BillingDetailsError("billingEmail", "That billing email address is not valid.");
  }

  const addr = normalizeAddress({
    gstin,
    address: str(input.address),
    line1: str(input.line1),
    line2: str(input.line2),
    city: str(input.city),
    pincode: str(input.pincode),
    state: str(input.state),
    stateCode: str(input.stateCode),
  });
  // Deliberately NOT `hasAnyAddress(addr)`: `addr.state` is derived from the
  // GSTIN, so a customer who gave us only their GST number would otherwise be
  // told their address is half-filled when they never started one.
  const startedAddress = hasAnyAddress({
    line1: addr.line1, line2: addr.line2, city: addr.city, pincode: addr.pincode,
  });
  if (startedAddress) {
    for (const [v, field, label] of [
      [addr.line1, "line1", "Address line 1"],
      [addr.city, "city", "City"],
      [addr.state, "state", "State"],
      [addr.pincode, "pincode", "PIN code"],
    ] as [string, string, string][]) {
      if (!v) throw new BillingDetailsError(field, `${label} is needed before an address can go on an invoice.`);
    }
    if (!isValidPincode(addr.pincode)) {
      throw new BillingDetailsError("pincode", "A PIN code is six digits.");
    }
  }

  const ship = {
    line1: str(input.shipLine1),
    line2: str(input.shipLine2),
    city: str(input.shipCity),
    state: str(input.shipState),
    pincode: str(input.shipPincode),
  };
  // "Not the same as billing" with nothing entered is just "the same as
  // billing" — store it that way instead of keeping an empty second address.
  let shipSame = input.shipSame !== false;
  if (!shipSame && !hasAnyAddress(ship)) shipSame = true;
  if (!shipSame) {
    for (const [v, field, label] of [
      [ship.line1, "shipLine1", "Shipping address line 1"],
      [ship.city, "shipCity", "Shipping city"],
      [ship.state, "shipState", "Shipping state"],
      [ship.pincode, "shipPincode", "Shipping PIN code"],
    ] as [string, string, string][]) {
      if (!v) throw new BillingDetailsError(field, `${label} is needed, or turn "same as billing" back on.`);
    }
    if (!isValidPincode(ship.pincode)) {
      throw new BillingDetailsError("shipPincode", "A PIN code is six digits.");
    }
  }

  await query(
    `UPDATE app_client SET
       legal_name=$2, gstin=$3, pan=$4,
       address=$5, addr_line1=$6, addr_line2=$7, city=$8, pincode=$9,
       state=$10, state_code=$11,
       billing_email=$12, billing_phone=$13,
       ship_same=$14, ship_line1=$15, ship_line2=$16, ship_city=$17, ship_state=$18, ship_pincode=$19
     WHERE id=$1`,
    [
      clientId,
      str(input.legalName) || null,
      gstin || null,
      pan || null,
      addr.address || null,
      addr.line1 || null,
      addr.line2 || null,
      addr.city || null,
      addr.pincode || null,
      addr.state || null,
      addr.stateCode || null,
      billingEmail || null,
      str(input.phone) || null,
      shipSame,
      shipSame ? null : ship.line1,
      shipSame ? null : ship.line2 || null,
      shipSame ? null : ship.city,
      shipSame ? null : ship.state,
      shipSame ? null : ship.pincode,
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
