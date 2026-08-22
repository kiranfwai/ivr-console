import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { money, type Invoice } from "./invoice";

/**
 * Renders a tax invoice to a one-page A4 PDF.
 *
 * Amounts are written as "INR 1,234.56" rather than with the rupee sign: the
 * built-in PDF fonts are WinAnsi-encoded and cannot represent U+20B9, and
 * embedding a Unicode font would put a licensed binary in the repository for one
 * glyph. "INR" is unambiguous and normal on Indian B2B invoices.
 */

const A4 = { w: 595.28, h: 841.89 };
const M = 44;                       // page margin
const INK = rgb(0.07, 0.09, 0.14);
const MUTED = rgb(0.42, 0.46, 0.53);
const LINE = rgb(0.85, 0.87, 0.9);
const BAND = rgb(0.96, 0.97, 0.98);
const BRAND = rgb(0.06, 0.46, 0.43);

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
}

function text(c: Ctx, s: string, x: number, y: number, o: { size?: number; bold?: boolean; color?: any } = {}) {
  c.page.drawText(s ?? "", {
    x, y,
    size: o.size ?? 9.5,
    font: o.bold ? c.bold : c.font,
    color: o.color ?? INK,
  });
}

function right(c: Ctx, s: string, xRight: number, y: number, o: { size?: number; bold?: boolean; color?: any } = {}) {
  const size = o.size ?? 9.5;
  const f = o.bold ? c.bold : c.font;
  text(c, s, xRight - f.widthOfTextAtSize(s ?? "", size), y, o);
}

function hline(c: Ctx, y: number, x1 = M, x2 = A4.w - M, color = LINE) {
  c.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.7, color });
}

/** Wrap a paragraph to a width, returning the lines. */
function wrap(f: PDFFont, s: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of String(s || "").split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const t = line ? line + " " + word : word;
      if (f.widthOfTextAtSize(t, size) > maxW && line) { out.push(line); line = word; }
      else line = t;
    }
    out.push(line);
  }
  return out.filter((l, i, a) => l !== "" || i < a.length - 1);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "")).trim();
}

/** Indian numbering: crore / lakh / thousand / hundred. */
function words(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const push = (v: number, label: string) => { if (v) parts.push(under100(v) + " " + label); };
  push(Math.floor(n / 10000000), "Crore"); n %= 10000000;
  push(Math.floor(n / 100000), "Lakh");    n %= 100000;
  push(Math.floor(n / 1000), "Thousand");  n %= 1000;
  push(Math.floor(n / 100), "Hundred");    n %= 100;
  if (n) { if (parts.length) parts.push("and"); parts.push(under100(n)); }
  return parts.join(" ");
}

/** "1234.56" -> "One Thousand Two Hundred and Thirty Four Rupees and Fifty Six Paise Only" */
export function amountInWords(paise: number): string {
  const r = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  let s = words(r) + " Rupee" + (r === 1 ? "" : "s");
  if (p) s += " and " + words(p) + " Paise";
  return s + " Only";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  // Stamped in IST — the business, its customers and its filings are all Indian.
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60000);
  return `${String(ist.getUTCDate()).padStart(2, "0")} ${MON[ist.getUTCMonth()]} ${ist.getUTCFullYear()}`;
}

export async function renderInvoicePdf(inv: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4.w, A4.h]);
  const c: Ctx = {
    page,
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const { seller, buyer, totals } = inv;
  const R = A4.w - M;
  let y = A4.h - M;

  doc.setTitle(`Tax Invoice ${inv.invoiceNo}`);
  doc.setProducer("IVR Console");

  // ---- header ------------------------------------------------------------
  text(c, "TAX INVOICE", M, y - 4, { size: 17, bold: true, color: BRAND });
  right(c, inv.invoiceNo, R, y + 3, { size: 11, bold: true });
  right(c, fmtDate(inv.issuedAt), R, y - 10, { size: 9, color: MUTED });
  y -= 26;
  hline(c, y);
  y -= 18;

  // ---- seller ------------------------------------------------------------
  text(c, seller.legalName, M, y, { size: 11.5, bold: true });
  y -= 13;
  for (const l of wrap(c.font, seller.address, 9, 250)) { text(c, l, M, y, { color: MUTED }); y -= 11; }
  text(c, `GSTIN  ${seller.gstin}`, M, y); y -= 11;
  text(c, `State  ${seller.state} (${seller.stateCode})`, M, y, { color: MUTED }); y -= 11;
  if (seller.email) { text(c, seller.email, M, y, { color: MUTED }); y -= 11; }
  if (seller.phone) { text(c, seller.phone, M, y, { color: MUTED }); y -= 11; }

  // ---- buyer (right column, aligned with the seller block) ----------------
  let by = A4.h - M - 44;
  const bx = M + 300;
  text(c, "BILL TO", bx, by, { size: 8, bold: true, color: MUTED });
  by -= 14;
  text(c, buyer.legalName || buyer.name || "—", bx, by, { size: 11, bold: true });
  by -= 13;
  if (buyer.address) {
    for (const l of wrap(c.font, buyer.address, 9, R - bx)) { text(c, l, bx, by, { color: MUTED }); by -= 11; }
  }
  if (buyer.email) { text(c, buyer.email, bx, by, { color: MUTED }); by -= 11; }
  text(c, buyer.gstin ? `GSTIN  ${buyer.gstin}` : "GSTIN  Unregistered", bx, by); by -= 11;
  if (buyer.state) { text(c, `State  ${buyer.state}${buyer.stateCode ? ` (${buyer.stateCode})` : ""}`, bx, by, { color: MUTED }); by -= 11; }

  y = Math.min(y, by) - 14;
  hline(c, y);
  y -= 26;

  // ---- line items --------------------------------------------------------
  // Columns are defined by their RIGHT edge, because every money column is
  // right-aligned. Spacing them by eye is what put two figures on top of each
  // other the first time; these are measured against the 507pt content width.
  const inter = totals.interState;
  const colDesc = M;
  const colSac = M + 210;
  const rTaxable = M + 336;
  const rTax = M + 424;
  const colAmt = R;

  page.drawRectangle({ x: M - 6, y: y - 6, width: R - M + 12, height: 22, color: BAND });
  text(c, "DESCRIPTION", colDesc, y, { size: 8, bold: true, color: MUTED });
  text(c, "SAC", colSac, y, { size: 8, bold: true, color: MUTED });
  right(c, "TAXABLE (INR)", rTaxable, y, { size: 8, bold: true, color: MUTED });
  right(c, inter ? `IGST ${totals.gstRate}%` : `GST ${totals.gstRate}%`, rTax, y, { size: 8, bold: true, color: MUTED });
  right(c, "AMOUNT (INR)", colAmt, y, { size: 8, bold: true, color: MUTED });
  y -= 24;

  const descLines = wrap(c.font, seller.description, 9.5, 195);
  descLines.forEach((l, i) => text(c, l, colDesc, y - i * 11));
  text(c, seller.sacCode, colSac, y, { color: MUTED });
  right(c, money(totals.taxableP), rTaxable, y);
  right(c, money(totals.cgstP + totals.sgstP + totals.igstP), rTax, y);
  right(c, money(totals.totalP), colAmt, y, { bold: true });
  y -= Math.max(descLines.length * 11, 11) + 12;
  hline(c, y);
  y -= 20;

  // ---- totals ------------------------------------------------------------
  const tl = M + 330;
  const rowsOut: [string, string, boolean?][] = [["Taxable value", money(totals.taxableP)]];
  if (inter) {
    rowsOut.push([`IGST @ ${totals.gstRate}%`, money(totals.igstP)]);
  } else {
    rowsOut.push([`CGST @ ${totals.gstRate / 2}%`, money(totals.cgstP)]);
    rowsOut.push([`SGST @ ${totals.gstRate / 2}%`, money(totals.sgstP)]);
  }
  for (const [k, v] of rowsOut) {
    text(c, k, tl, y, { color: MUTED });
    right(c, v, colAmt, y);
    y -= 15;
  }
  y -= 3;
  hline(c, y + 8, tl, R);
  text(c, "Total", tl, y - 6, { size: 11, bold: true });
  right(c, `INR ${money(totals.totalP)}`, colAmt, y - 6, { size: 11, bold: true });
  y -= 28;

  text(c, "Amount in words", M, y, { size: 8, bold: true, color: MUTED });
  y -= 12;
  for (const l of wrap(c.bold, amountInWords(totals.totalP), 9.5, R - M)) { text(c, l, M, y, { bold: true }); y -= 12; }
  y -= 10;

  // ---- what the customer actually received -------------------------------
  page.drawRectangle({ x: M - 6, y: y - 34, width: R - M + 12, height: 40, color: BAND });
  text(c, "Wallet credit applied", M, y - 10, { size: 9, bold: true });
  right(c, `INR ${money(inv.creditP)}`, colAmt, y - 10, { size: 9, bold: true });
  text(c,
    totals.taxMode === "inclusive"
      ? "The amount charged is inclusive of GST. Credit equals the amount paid."
      : "GST was charged in addition to the credit purchased.",
    M, y - 24, { size: 8, color: MUTED });
  y -= 54;

  text(c, `Payment reference  ${inv.orderId}`, M, y, { size: 8, color: MUTED });
  y -= 11;
  text(c, "Paid online via Cashfree.", M, y, { size: 8, color: MUTED });

  // ---- footer ------------------------------------------------------------
  const fy = M + 26;
  hline(c, fy + 26);
  text(c, "This is a computer-generated invoice and does not require a signature.", M, fy + 12, { size: 7.5, color: MUTED });
  right(c, seller.legalName, R, fy + 12, { size: 7.5, color: MUTED });

  return doc.save();
}

/** File name for the download, e.g. "tax-invoice-FWAI-26-27-0007.pdf". */
export function invoiceFileName(inv: Invoice): string {
  return "tax-invoice-" + inv.invoiceNo.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".pdf";
}
