import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { money, type Invoice } from "./invoice";

/**
 * Renders a tax invoice to a one-page A4 PDF.
 *
 * The layout follows the invoice the business already issues from its books —
 * a bordered grid: letterhead, an invoice/place-of-supply block, Bill To beside
 * Ship To, an item table carrying HSN/SAC, quantity, rate and the tax split,
 * then totals, the amount in words and an authorised-signature block. Matching
 * it means a customer who receives both cannot tell one system from the other.
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
const BORDER = rgb(0.72, 0.75, 0.78);
const PAID = rgb(0.72, 0.25, 0.2);

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
}

interface TextOpts { size?: number; bold?: boolean; color?: any }

function text(c: Ctx, s: string, x: number, y: number, o: TextOpts = {}) {
  c.page.drawText(s ?? "", {
    x, y,
    size: o.size ?? 9.5,
    font: o.bold ? c.bold : c.font,
    color: o.color ?? INK,
  });
}

function right(c: Ctx, s: string, xRight: number, y: number, o: TextOpts = {}) {
  const size = o.size ?? 9.5;
  const f = o.bold ? c.bold : c.font;
  text(c, s, xRight - f.widthOfTextAtSize(s ?? "", size), y, o);
}

/** Centre a string inside a column of width `w` starting at `x`. */
function centre(c: Ctx, s: string, x: number, w: number, y: number, o: TextOpts = {}) {
  const size = o.size ?? 9.5;
  const f = o.bold ? c.bold : c.font;
  text(c, s, x + (w - f.widthOfTextAtSize(s ?? "", size)) / 2, y, o);
}

function hline(c: Ctx, y: number, x1 = M, x2 = A4.w - M, color = LINE) {
  c.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.7, color });
}

function vline(c: Ctx, x: number, yBottom: number, yTop: number) {
  c.page.drawLine({ start: { x, y: yBottom }, end: { x, y: yTop }, thickness: 0.7, color: BORDER });
}

/**
 * A bordered cell. The document is a grid of these, the way a printed tax
 * invoice has always been laid out.
 */
function box(c: Ctx, x: number, y: number, w: number, h: number, fill?: any) {
  c.page.drawRectangle({
    x, y, width: w, height: h,
    color: fill,
    borderColor: BORDER,
    borderWidth: 0.7,
  });
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
  // No "and" before the last part: the books print "Nine Hundred Thirty".
  if (n) parts.push(under100(n));
  return parts.join(" ");
}

/**
 * The currency-first phrasing a set of books prints:
 * "Indian Rupee Fifteen Thousand Nine Hundred and Thirty Only".
 */
export function amountInWords(paise: number): string {
  const r = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  let s = "Indian Rupee " + words(r);
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

/** dd/mm/yyyy in IST, the form the books already print. */
function fmtDMY(iso: string): string {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60000);
  return [
    String(ist.getUTCDate()).padStart(2, "0"),
    String(ist.getUTCMonth() + 1).padStart(2, "0"),
    ist.getUTCFullYear(),
  ].join("/");
}

/** An address block, one line per part that exists, ending in the country. */
function addressLines(
  a: { line1?: string; line2?: string; city?: string; pincode?: string; state?: string; address?: string },
): string[] {
  const out = [a.line1, a.line2, a.city].map((v) => String(v || "").trim()).filter(Boolean);
  const pinState = [a.pincode, a.state].map((v) => String(v || "").trim()).filter(Boolean).join(" ");
  if (pinState) out.push(pinState);
  // Nothing structured saved yet: fall back to the one line that always exists.
  if (!out.length && a.address) out.push(String(a.address));
  out.push("India");
  return out;
}

/**
 * Wrap a block of already-split lines to a column.
 *
 * A structured address arrives in short parts that fit anywhere, but a legacy
 * one-line address is a whole address on one line — printed raw it runs out of
 * its column, over the divider and off the frame. Every block that sits in a
 * box goes through this.
 */
function flow(f: PDFFont, lines: string[], size: number, maxW: number): string[] {
  return lines.flatMap((l) => wrap(f, l, size, maxW));
}

/**
 * Where the service was delivered.
 *
 * Once the invoice has a "Ship To" column there is no honest way to leave a
 * recorded delivery address out of it — printing the billing address there when
 * a different one was given would make the document say something untrue. The
 * place of supply, and therefore the tax, still comes from the BILLING state.
 */
function shipLines(buyer: Invoice["buyer"]): string[] {
  const sh = buyer.shipping;
  if (!sh || sh.same) return addressLines(buyer);
  return addressLines(sh);
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
  const W = R - M;
  const inter = totals.interState;
  const halfRate = totals.gstRate / 2;

  doc.setTitle(`Tax Invoice ${inv.invoiceNo}`);
  doc.setProducer("IVR Console");

  // The mark is optional: a missing or unreadable file must not cost anyone
  // their invoice, so a failure here is silent and the letterhead shifts left.
  let logo: Awaited<ReturnType<typeof doc.embedPng>> | null = null;
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    logo = await doc.embedPng(await fs.readFile(path.join(process.cwd(), "public", "fwai-logo.png")));
  } catch {
    logo = null;
  }

  const top = A4.h - M;

  // ---- letterhead --------------------------------------------------------
  // "TAX INVOICE" is set at 19pt against the right edge, so the name and
  // address get the width that is left over rather than the whole box.
  const tx = logo ? M + 92 : M + 12;
  const headW = R - 24 - tx - c.font.widthOfTextAtSize("TAX INVOICE", 19);
  const nameLines = flow(c.bold, [seller.legalName.toUpperCase()], 10.5, headW);
  const headBody: string[] = [];
  if (seller.pan) headBody.push(`Company PAN : ${seller.pan}`);
  headBody.push(...addressLines(seller));
  const headTail: string[] = [`GSTIN ${seller.gstin}`];
  if (seller.email) headTail.push(seller.email);
  if (seller.phone) headTail.push(seller.phone);
  const bodyLines = flow(c.font, headBody, 8.5, headW);
  const tailLines = flow(c.font, headTail, 8.5, headW);
  // Tall enough for the logo, and taller still if the address needs the room.
  const headH = Math.max(128, 30 + nameLines.length * 14 + (bodyLines.length + tailLines.length) * 11);
  box(c, M, top - headH, W, headH);
  if (logo) page.drawImage(logo, { x: M + 12, y: top - 86, width: 66, height: 66 });
  let hy = top - 22;
  for (const l of nameLines) { text(c, l, tx, hy, { size: 10.5, bold: true }); hy -= 14; }
  for (const l of bodyLines) { text(c, l, tx, hy, { size: 8.5, color: MUTED }); hy -= 11; }
  // The GSTIN is the one line here a reader looks for, so it is not muted.
  text(c, tailLines[0], tx, hy, { size: 8.5 }); hy -= 11;
  for (const l of tailLines.slice(1)) { text(c, l, tx, hy, { size: 8.5, color: MUTED }); hy -= 11; }
  right(c, "TAX INVOICE", R - 12, top - 32, { size: 19 });

  // ---- invoice / place of supply grid ------------------------------------
  const rowH = 20;
  const metaTop = top - headH;
  const mid = M + Math.round(W / 2);
  const meta: [string, string][] = [
    ["#", inv.invoiceNo],
    ["Invoice Date", fmtDMY(inv.issuedAt)],
    ["Terms", "Paid in advance"],
    ["Payment Ref", inv.orderId],
  ];
  meta.forEach(([k, v], i) => {
    const yTop = metaTop - i * rowH;
    box(c, M, yTop - rowH, mid - M, rowH);
    box(c, mid, yTop - rowH, R - mid, rowH);
    text(c, k, M + 8, yTop - 14, { size: 8.5, color: MUTED });
    text(c, `: ${v}`, M + 108, yTop - 14, { size: 8.5, bold: true });
  });
  const pos = buyer.state ? `${buyer.state}${buyer.stateCode ? ` (${buyer.stateCode})` : ""}` : "—";
  text(c, "Place Of Supply", mid + 8, metaTop - 14, { size: 8.5, color: MUTED });
  text(c, `: ${pos}`, mid + 104, metaTop - 14, { size: 8.5, bold: true });
  text(c, "Tax", mid + 8, metaTop - rowH - 14, { size: 8.5, color: MUTED });
  text(c, `: ${inter ? "IGST" : "CGST + SGST"} @ ${totals.gstRate}%`,
    mid + 104, metaTop - rowH - 14, { size: 8.5, bold: true });

  // ---- bill to / ship to -------------------------------------------------
  let y = metaTop - meta.length * rowH;
  box(c, M, y - 18, mid - M, 18, BAND);
  box(c, mid, y - 18, R - mid, 18, BAND);
  text(c, "Bill To", M + 8, y - 13, { size: 8.5, bold: true });
  text(c, "Ship To", mid + 8, y - 13, { size: 8.5, bold: true });
  y -= 18;

  const billW = mid - M - 16;
  const shipW = R - mid - 16;
  const nameLine = flow(c.bold, [buyer.legalName || buyer.name || "—"], 9.5, billW);
  const bill = flow(c.font, addressLines(buyer), 8.5, billW);
  const ship = flow(c.font, shipLines(buyer), 8.5, shipW);
  // The box is as tall as whichever column needs more room, never shorter than
  // the five-line block a filled-in address occupies.
  const addrH = Math.max(
    nameLine.length * 13 + (bill.length + 1) * 11,
    ship.length * 11,
    56,
  ) + 21;
  box(c, M, y - addrH, mid - M, addrH);
  box(c, mid, y - addrH, R - mid, addrH);
  let by = y - 15;
  for (const l of nameLine) { text(c, l, M + 8, by, { size: 9.5, bold: true }); by -= 13; }
  for (const l of bill) { text(c, l, M + 8, by, { size: 8.5, color: MUTED }); by -= 11; }
  text(c, buyer.gstin ? `GSTIN ${buyer.gstin}` : "GSTIN  Unregistered", M + 8, by, { size: 8.5 });
  let sy = y - 15;
  for (const l of ship) { text(c, l, mid + 8, sy, { size: 8.5, color: MUTED }); sy -= 11; }
  y -= addrH;

  // ---- item table --------------------------------------------------------
  // Column widths are measured against the 507pt content width, not eyeballed:
  // an inter-state invoice carries one tax group, an intra-state one carries
  // two, and the second group has to come out of the description.
  const cols = inter
    ? { no: 18, desc: 190, hsn: 60, qty: 45, rate: 55, groups: ["IGST"], groupW: 82, amt: 57.28 }
    : { no: 18, desc: 130, hsn: 55, qty: 40, rate: 50, groups: ["CGST", "SGST"], groupW: 76, amt: 62.28 };
  const xs: number[] = [M];
  for (const w of [cols.no, cols.desc, cols.hsn, cols.qty, cols.rate,
                   ...cols.groups.map(() => cols.groupW), cols.amt]) {
    xs.push(xs[xs.length - 1] + w);
  }
  const gStart = 5;                   // index of the first tax-group column
  const iAmt = xs.length - 2;         // index of the Amount column

  const hdrH = 30;
  box(c, M, y - hdrH, W, hdrH, BAND);
  for (let i = 1; i < xs.length - 1; i++) vline(c, xs[i], y - hdrH, y);
  const hTop = y - 12;
  const hBot = y - 24;
  text(c, "#", xs[0] + 6, hBot, { size: 8, bold: true });
  text(c, "Item & Description", xs[1] + 6, hBot, { size: 8, bold: true });
  text(c, "HSN/SAC", xs[2] + 6, hBot, { size: 8, bold: true });
  right(c, "Qty", xs[4] - 6, hBot, { size: 8, bold: true });
  right(c, "Rate", xs[5] - 6, hBot, { size: 8, bold: true });
  right(c, "Amount", xs[iAmt + 1] - 6, hBot, { size: 8, bold: true });
  cols.groups.forEach((g, gi) => {
    const x = xs[gStart + gi];
    centre(c, g, x, cols.groupW, hTop, { size: 8, bold: true });
    c.page.drawLine({
      start: { x: x + 4, y: hTop - 5 }, end: { x: x + cols.groupW - 4, y: hTop - 5 },
      thickness: 0.5, color: BORDER,
    });
    centre(c, "%", x, cols.groupW / 2, hBot, { size: 7.5, bold: true, color: MUTED });
    centre(c, "Amt", x + cols.groupW / 2, cols.groupW / 2, hBot, { size: 7.5, bold: true, color: MUTED });
    vline(c, x + cols.groupW / 2, y - hdrH, hTop - 7);
  });
  y -= hdrH;

  const descLines = wrap(c.font, seller.description, 8.5, cols.desc - 12);
  const rowBodyH = Math.max(descLines.length * 11 + 16, 30);
  box(c, M, y - rowBodyH, W, rowBodyH);
  for (let i = 1; i < xs.length - 1; i++) vline(c, xs[i], y - rowBodyH, y);
  cols.groups.forEach((_, gi) => vline(c, xs[gStart + gi] + cols.groupW / 2, y - rowBodyH, y));
  const ry = y - 15;
  text(c, "1", xs[0] + 6, ry, { size: 8.5 });
  descLines.forEach((l, i) => text(c, l, xs[1] + 6, ry - i * 11, { size: 8.5 }));
  text(c, seller.sacCode, xs[2] + 6, ry, { size: 8.5, color: MUTED });
  right(c, "1.00", xs[4] - 6, ry, { size: 8.5 });
  right(c, money(totals.taxableP), xs[5] - 6, ry, { size: 8.5 });
  const groupFigures: [string, number][] = inter
    ? [[`${totals.gstRate}%`, totals.igstP]]
    : [[`${halfRate}%`, totals.cgstP], [`${halfRate}%`, totals.sgstP]];
  groupFigures.forEach(([pct, amt], gi) => {
    const x = xs[gStart + gi];
    centre(c, pct, x, cols.groupW / 2, ry, { size: 8.5 });
    right(c, money(amt), x + cols.groupW - 6, ry, { size: 8.5 });
  });
  right(c, money(totals.taxableP), xs[iAmt + 1] - 6, ry, { size: 8.5 });
  y -= rowBodyH;

  // ---- totals ------------------------------------------------------------
  const tX = mid + 40;
  const totalRows: [string, string][] = [["Sub Total", money(totals.taxableP)]];
  if (inter) totalRows.push([`IGST${totals.gstRate} (${totals.gstRate}%)`, money(totals.igstP)]);
  else {
    totalRows.push([`CGST${halfRate} (${halfRate}%)`, money(totals.cgstP)]);
    totalRows.push([`SGST${halfRate} (${halfRate}%)`, money(totals.sgstP)]);
  }
  let ty = y;
  for (const [k, v] of totalRows) {
    box(c, tX, ty - 18, R - tX, 18);
    text(c, k, tX + 8, ty - 13, { size: 8.5, color: MUTED });
    right(c, v, R - 8, ty - 13, { size: 8.5 });
    ty -= 18;
  }
  box(c, tX, ty - 20, R - tX, 20, BAND);
  text(c, "Total", tX + 8, ty - 14, { size: 9.5, bold: true });
  right(c, `INR ${money(totals.totalP)}`, R - 8, ty - 14, { size: 9.5, bold: true });
  ty -= 20;
  // The invoice is raised only after the money is taken, so it is never due.
  box(c, tX, ty - 18, R - tX, 18);
  text(c, "Payment Made", tX + 8, ty - 13, { size: 8.5, color: PAID });
  right(c, `(-) ${money(totals.totalP)}`, R - 8, ty - 13, { size: 8.5, color: PAID });
  ty -= 18;
  box(c, tX, ty - 20, R - tX, 20, BAND);
  text(c, "Balance Due", tX + 8, ty - 14, { size: 9.5, bold: true });
  right(c, "INR 0.00", R - 8, ty - 14, { size: 9.5, bold: true });
  ty -= 20;

  // ---- words + notes (left of the totals) --------------------------------
  const leftW = tX - M - 24;
  let wy = y - 15;
  text(c, "Total In Words", M + 8, wy, { size: 8, color: MUTED });
  wy -= 13;
  for (const l of wrap(c.bold, amountInWords(totals.totalP), 9, leftW)) {
    text(c, l, M + 8, wy, { size: 9, bold: true });
    wy -= 12;
  }
  wy -= 8;
  text(c, "Notes", M + 8, wy, { size: 8, color: MUTED });
  wy -= 12;
  const note = totals.taxMode === "inclusive"
    ? `Wallet credit of INR ${money(inv.creditP)} applied. The amount charged is inclusive of GST.`
    : `Wallet credit of INR ${money(inv.creditP)} applied. GST was charged in addition to the credit purchased.`;
  for (const l of wrap(c.font, note, 8.5, leftW)) {
    text(c, l, M + 8, wy, { size: 8.5, color: MUTED });
    wy -= 11;
  }
  text(c, `Issued ${fmtDate(inv.issuedAt)} · paid online via Cashfree.`, M + 8, wy - 4, { size: 8, color: MUTED });

  // ---- signature ---------------------------------------------------------
  const sigTop = ty - 24;
  right(c, `For ${seller.legalName}`, R - 8, sigTop, { size: 8.5 });
  hline(c, sigTop - 44, tX + 10, R - 8, BORDER);
  right(c, "Authorized Signature", R - 8, sigTop - 56, { size: 8.5, color: MUTED });

  // ---- outer frame + footer ----------------------------------------------
  const bottom = Math.min(sigTop - 68, wy - 12);
  box(c, M, bottom, W, top - bottom);
  text(c, "This is a computer-generated invoice and does not require a signature.",
    M, bottom - 14, { size: 7.5, color: MUTED });
  right(c, seller.legalName, R, bottom - 14, { size: 7.5, color: MUTED });

  return doc.save();
}

/** File name for the download, e.g. "tax-invoice-FWAI-26-27-0007.pdf". */
export function invoiceFileName(inv: Invoice): string {
  return "tax-invoice-" + inv.invoiceNo.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".pdf";
}
