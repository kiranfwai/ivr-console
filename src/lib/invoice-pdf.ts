import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { money, type Invoice } from "./invoice";

/**
 * Renders a tax invoice to a one-page A4 PDF.
 *
 * The layout is a transcription of the template the business already issues from
 * its books and has signed off on: a full-page bordered frame holding the
 * letterhead, an invoice / place-of-supply grid, Bill To beside Ship To, an item
 * table carrying HSN/SAC, quantity, rate and the tax split column by column,
 * then totals, the amount in words, the notes and a signature cell. Matching it
 * means a customer who receives one of each cannot tell two systems billed them.
 *
 * Every coordinate below is TOP-DOWN, in points, exactly as it was measured off
 * that approved invoice; `Y()` is the only place they are flipped into the
 * bottom-up space pdf-lib draws in. Keeping the measurements in the source form
 * is what makes them checkable against the original.
 */

const A4 = { w: 595.28, h: 841.89 };

// The frame, and the two halves the top of the document is split into.
const L = 40.3;                     // inner left edge
const R = 565.9;                    // inner right edge
const TOP = 50.4;                   // frame top
const BOT = 791.3;                  // frame bottom — fixed to the page, not to the content
const MID = 303.1;                  // the divider down the middle of the header blocks

const GRID = rgb(0.62, 0.62, 0.62);     // every rule and border
const BAND = rgb(0.949, 0.953, 0.957);  // the tint behind a header row
const INK = rgb(0, 0, 0);
const LABEL = rgb(0.2, 0.2, 0.2);       // the muted grey the field labels use
const RED = rgb(1, 0, 0);               // "Payment Made", the one coloured line

/**
 * Where a line of text sits inside its row.
 *
 * The measurements are the TOP of each line's box, because that is what can be
 * read off the original. Turning one into a baseline needs the font's ascent;
 * 0.8em matches the original closely enough that the two overlay.
 */
const ASC = 0.8;

interface Ctx {
  page: PDFPage;
  font: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

interface TextOpts { size?: number; bold?: boolean; italic?: boolean; color?: any }

/** Top-down y to the bottom-up y pdf-lib wants. */
function Y(v: number): number {
  return A4.h - v;
}

function fontFor(c: Ctx, o: TextOpts): PDFFont {
  if (o.italic) return c.italic;
  return o.bold ? c.bold : c.font;
}

/** Draw a string with its line-box top at `yTop`. */
function text(c: Ctx, s: string, x: number, yTop: number, o: TextOpts = {}) {
  const size = o.size ?? 8;
  c.page.drawText(s ?? "", {
    x,
    y: Y(yTop + size * ASC),
    size,
    font: fontFor(c, o),
    color: o.color ?? INK,
  });
}

function right(c: Ctx, s: string, xRight: number, yTop: number, o: TextOpts = {}) {
  const size = o.size ?? 8;
  text(c, s, xRight - fontFor(c, o).widthOfTextAtSize(s ?? "", size), yTop, o);
}

function centre(c: Ctx, s: string, x: number, w: number, yTop: number, o: TextOpts = {}) {
  const size = o.size ?? 8;
  text(c, s, x + (w - fontFor(c, o).widthOfTextAtSize(s ?? "", size)) / 2, yTop, o);
}

/** A horizontal rule at top-down y, from x1 to x2. */
function hline(c: Ctx, yTop: number, x1 = L, x2 = R, color = GRID) {
  c.page.drawRectangle({ x: x1, y: Y(yTop + 0.75), width: x2 - x1, height: 0.75, color });
}

/** A vertical rule at x, between two top-down y values. */
function vline(c: Ctx, x: number, yTop: number, yBottom: number, color = GRID) {
  c.page.drawRectangle({ x, y: Y(yBottom), width: 0.75, height: yBottom - yTop, color });
}

/** A filled band, given in top-down coordinates. */
function fill(c: Ctx, x: number, yTop: number, w: number, h: number, color: any) {
  c.page.drawRectangle({ x, y: Y(yTop + h), width: w, height: h, color });
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

/**
 * Wrap a block of already-split lines to a column.
 *
 * A structured address arrives in short parts that fit anywhere, but a legacy
 * one-line address is a whole address on one line — printed raw it runs out of
 * its column, over the divider and off the frame. Every block that sits in a
 * cell goes through this.
 */
function flow(f: PDFFont, lines: string[], size: number, maxW: number): string[] {
  return lines.flatMap((l) => wrap(f, l, size, maxW));
}

/**
 * The rupee sign, drawn rather than typed.
 *
 * The fourteen standard PDF fonts are WinAnsi-encoded and have no U+20B9, so a
 * document that wants one either embeds a font for the sake of a single glyph or
 * draws it. The books draw it too — their invoices carry a one-glyph Type 3 font
 * holding exactly this outline. The path is the sign's published construction:
 * two horizontal bars, a bowl closing onto the lower bar, and a leg to the
 * baseline, on a 1000-unit em so it scales with the point size.
 */
const RUPEE = [
  "M 268 0",
  "L 79 -330 L 79 -374 L 101 -374",
  "C 154 -374 195 -382 224 -397 C 252 -412 268 -440 273 -480",
  "L 79 -480 L 79 -544 L 272 -544",
  "C 265 -581 248 -608 220 -625 C 191 -642 152 -650 101 -650",
  "L 79 -650 L 79 -714 L 493 -714 L 493 -650 L 304 -650",
  "C 336 -624 355 -589 361 -544",
  "L 493 -544 L 493 -480 L 363 -480",
  "C 358 -431 340 -394 308 -366 C 275 -340 232 -322 179 -315",
  "L 370 0 Z",
].join(" ");
const RUPEE_EM = 0.572;             // advance width, as a fraction of the point size

/** Draw the rupee sign with its left edge at x, sitting on the given line. */
function rupee(c: Ctx, x: number, yTop: number, size: number, color: any) {
  c.page.drawSvgPath(RUPEE, { x, y: Y(yTop + size * ASC), scale: size / 1000, color });
}

/** An amount written the way the document writes money: "₹28,619.24". */
function withRupee(c: Ctx, paise: number, xRight: number, yTop: number, o: TextOpts) {
  const size = o.size ?? 8;
  const s = money(paise);
  const w = fontFor(c, o).widthOfTextAtSize(s, size);
  text(c, s, xRight - w, yTop, o);
  rupee(c, xRight - w - size * RUPEE_EM, yTop, size, o.color ?? INK);
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function under100(n: number): string {
  if (n < 20) return ONES[n];
  return (TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "")).trim();
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
  // No "and" before the last whole-rupee part: the books print "Six Hundred
  // Nineteen", and hyphenate the twenties — "Twenty-Four Paise".
  if (n) parts.push(under100(n));
  return parts.join(" ");
}

/**
 * The currency-first phrasing the books print:
 * "Indian Rupee Twenty-Eight Thousand Six Hundred Nineteen and Twenty-Four
 * Paise Only".
 */
export function amountInWords(paise: number): string {
  const r = Math.floor(Math.abs(paise) / 100);
  const p = Math.abs(paise) % 100;
  let s = "Indian Rupee " + words(r);
  if (p) s += " and " + words(p) + " Paise";
  return s + " Only";
}

/** dd/mm/yyyy in IST — the business, its customers and its filings are Indian. */
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
 * Where the service was delivered.
 *
 * Once the document has a "Ship To" column there is no honest way to leave a
 * recorded delivery address out of it — printing the billing address there when
 * a different one was given would make the document say something untrue. The
 * place of supply, and therefore the tax, still comes from the BILLING state.
 */
function shipLines(buyer: Invoice["buyer"]): string[] {
  const sh = buyer.shipping;
  if (!sh || sh.same) return addressLines(buyer);
  return addressLines(sh);
}

/** Read an optional image out of `public/`. A missing one is not an error. */
async function optionalPng(doc: PDFDocument, file: string) {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    return await doc.embedPng(await fs.readFile(path.join(process.cwd(), "public", file)));
  } catch {
    return null;
  }
}

export async function renderInvoicePdf(inv: Invoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([A4.w, A4.h]);
  const c: Ctx = {
    page,
    font: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const { seller, buyer, totals } = inv;
  const inter = totals.interState;
  const half = totals.gstRate / 2;

  doc.setTitle(`Tax Invoice ${inv.invoiceNo}`);
  doc.setProducer("IVR Console");

  // Both marks are optional: a missing or unreadable file must never cost anyone
  // their invoice, so the letterhead simply goes without.
  const logo = await optionalPng(doc, "fwai-logo.png");
  const sign = await optionalPng(doc, "invoice-signature.png");

  // ---- letterhead --------------------------------------------------------
  if (logo) page.drawImage(logo, { x: 47.8, y: Y(164.7), width: 112.6, height: 112.1 });
  const hx = logo ? 175.4 : L + 7.5;
  const nameLines = wrap(c.bold, seller.legalName.toUpperCase(), 12, 250);
  let hy = 59.8;
  for (const l of nameLines) { text(c, l, hx, hy, { size: 12, bold: true }); hy += 12; }
  hy += 4.6;
  const headLines: string[] = [];
  if (seller.pan) headLines.push(`Company PAN : ${seller.pan}`);
  headLines.push(...addressLines(seller));
  headLines.push(`GSTIN ${seller.gstin}`);
  if (seller.email) headLines.push(seller.email);
  if (seller.phone) headLines.push(seller.phone);
  for (const l of flow(c.font, headLines, 8, 250)) { text(c, l, hx, hy); hy += 9.23; }

  right(c, "TAX INVOICE", 562.1, 142.0, { size: 22 });

  // The block is as tall as the original unless the address needs more room.
  const headBottom = Math.max(169.2, hy + 4);
  hline(c, headBottom);

  // ---- invoice / place of supply -----------------------------------------
  // Four rows, no rules between them: one cell each side of the divider.
  const rowStep = 10.97;
  const meta: [string, string][] = [
    ["#", inv.invoiceNo],
    ["Invoice Date", fmtDMY(inv.issuedAt)],
    ["Terms", "Due on Receipt"],
    ["Due Date", fmtDMY(inv.issuedAt)],
  ];
  meta.forEach(([k, v], i) => {
    const y = headBottom + 2.7 + i * rowStep;
    text(c, k, 44.1, y, { color: LABEL });
    text(c, `: ${v}`, 171.6, y, { bold: true });
  });
  const pos = buyer.state ? `${buyer.state}${buyer.stateCode ? ` (${buyer.stateCode})` : ""}` : "—";
  text(c, "Place Of Supply", 307.2, headBottom + 2.7, { color: LABEL });
  text(c, `: ${pos}`, 434.7, headBottom + 2.7, { bold: true });
  const metaBottom = headBottom + 52;
  vline(c, MID, headBottom, metaBottom);
  hline(c, metaBottom);

  // ---- bill to / ship to -------------------------------------------------
  fill(c, L, metaBottom, MID - L, 11.8, BAND);
  fill(c, MID, metaBottom, R - MID, 11.8, BAND);
  text(c, "Bill To", 44.1, metaBottom + 2.4, { bold: true, color: LABEL });
  text(c, "Ship To", 307.2, metaBottom + 2.4, { bold: true, color: LABEL });
  const addrTop = metaBottom + 11.8;
  hline(c, addrTop);
  vline(c, MID, metaBottom, addrTop);

  const billW = MID - 44.1 - 6;
  const shipW = R - 307.2 - 6;
  const gstLine = buyer.gstin ? [`GSTIN ${buyer.gstin}`] : [];
  const billName = wrap(c.bold, buyer.legalName || buyer.name || "—", 9, billW);
  const billBody = [...flow(c.font, addressLines(buyer), 8, billW), ...gstLine];
  const shipBody = [...flow(c.font, shipLines(buyer), 8, shipW), ...gstLine];
  const addrH = Math.max(
    5.8 + billName.length * 11.6 + billBody.length * 11.25 + 5.3,
    5.8 + shipBody.length * 11.25 + 5.3,
    60,
  );
  let by = addrTop + 5.8;
  for (const l of billName) { text(c, l, 44.1, by, { size: 9, bold: true }); by += 11.6; }
  for (const l of billBody) { text(c, l, 44.1, by); by += 11.25; }
  let sy = addrTop + 6.3;
  for (const l of shipBody) { text(c, l, 307.2, sy); sy += 11.25; }
  const addrBottom = addrTop + addrH;
  vline(c, MID, addrTop, addrBottom);
  hline(c, addrBottom);

  // ---- item table --------------------------------------------------------
  // The column edges are the approved ones. An inter-state invoice carries a
  // single tax group, an intra-state one carries two in the same span, so the
  // second group has to be paid for out of the description and quantity.
  const xs = inter
    ? [L, 66.6, 213.9, 266.4, 324.2, 382.0, 497.6, R]
    : [L, 66.6, 180.0, 228.0, 268.0, 330.0, 413.8, 497.6, R];
  const gStart = 5;                             // first tax-group column edge
  const groups: [string, number, number][] = inter
    ? [["IGST", totals.gstRate, totals.igstP]]
    : [["CGST", half, totals.cgstP], ["SGST", half, totals.sgstP]];
  const groupW = (497.6 - xs[gStart]) / groups.length;

  const headTop = addrBottom;
  const groupH = 15.4;
  const subH = 11.7;
  const tableHeadH = groupH + subH;
  const headEnd = headTop + tableHeadH;
  fill(c, L, headTop, R - L, tableHeadH, BAND);

  centre(c, "#", xs[0], xs[1] - xs[0], headTop + 17.0, { bold: true });
  text(c, "Item & Description", xs[1] + 5.6, headTop + 17.0, { bold: true });
  text(c, "HSN/SAC", xs[2] + 5.6, headTop + 17.0, { bold: true });
  right(c, "Qty", xs[4] - 5.6, headTop + 17.0, { bold: true });
  right(c, "Rate", xs[5] - 5.6, headTop + 17.0, { bold: true });
  right(c, "Amount", R - 5.3, headTop + 17.0, { bold: true });
  groups.forEach(([label], gi) => {
    const gx = xs[gStart] + gi * groupW;
    centre(c, label, gx, groupW, headTop + 5.3, { bold: true });
    hline(c, headTop + groupH, gx, gx + groupW);
    right(c, "%", gx + groupW / 2 - 4.1, headTop + 17.8, { bold: true });
    right(c, "Amt", gx + groupW - 4.1, headTop + 17.8, { bold: true });
  });

  const descW = xs[2] - xs[1] - 10;
  const descLines = wrap(c.font, seller.description, 8, descW);
  const rowH = Math.max(20.7, descLines.length * 9.23 + 11.5);
  const rowEnd = headEnd + rowH;
  centre(c, "1", xs[0], xs[1] - xs[0], headEnd + 2.4);
  descLines.forEach((l, i) => text(c, l, xs[1] + 4.4, headEnd + 2.4 + i * 9.23));
  text(c, seller.sacCode, xs[2] + 4.1, headEnd + 2.4);
  right(c, "1.00", xs[4] - 4.1, headEnd + 2.4);
  right(c, money(totals.taxableP), xs[5] - 4.1, headEnd + 2.4);
  groups.forEach(([, pct, amt], gi) => {
    const gx = xs[gStart] + gi * groupW;
    right(c, `${pct}%`, gx + groupW / 2 - 4.1, headEnd + 2.4);
    right(c, money(amt), gx + groupW - 4.1, headEnd + 2.4);
  });
  right(c, money(totals.taxableP), R - 3.8, headEnd + 2.4);

  // The grid: every column edge down the header and the row, plus the split
  // between each tax group's % and Amt, which starts below the group's label.
  for (const x of xs.slice(1, -1)) vline(c, x, headTop, rowEnd);
  groups.forEach((_, gi) => vline(c, xs[gStart] + gi * groupW + groupW / 2, headTop + groupH, rowEnd));
  hline(c, headTop);
  hline(c, headEnd);
  hline(c, rowEnd);

  // ---- totals ------------------------------------------------------------
  const tX = 336.4;
  const tLabel = 467.6;
  const tValue = 560.6;
  // "IGST18 (18%)" — the rate is welded to the name, exactly as the books print it.
  const rows: [string, string][] = [
    ["Sub Total", money(totals.taxableP)],
    ...groups.map(([label, pct, amt]): [string, string] =>
      [`${label}${pct} (${pct}%)`, money(amt)]),
  ];
  let ty = rowEnd + 0.8;
  const totalsTop = ty;
  for (const [k, v] of rows) {
    right(c, k, tLabel, ty + 4.2);
    right(c, v, tValue, ty + 4.2);
    ty += 12.2;
  }
  right(c, "Total", tLabel, ty + 4.2, { bold: true });
  withRupee(c, totals.totalP, tValue, ty + 4.2, { bold: true });
  ty += 12.5;
  // The invoice is raised only after the money is taken, so it is never due.
  // Only the figure is red — the label stays black, as on the approved template.
  right(c, "Payment Made", tLabel, ty + 4.2);
  right(c, `(-) ${money(totals.totalP)}`, tValue, ty + 4.2, { color: RED });
  ty += 12.2;
  right(c, "Balance Due", tLabel, ty + 4.2, { size: 9, bold: true });
  withRupee(c, 0, tValue, ty + 4.2, { size: 9, bold: true });
  ty += 13.7;
  const totalsBottom = ty + 3.7;
  vline(c, tX, totalsTop, totalsBottom);
  hline(c, totalsBottom, tX, R);

  // ---- words and notes, in the space to the left of the totals -----------
  const noteW = tX - 45.6 - 10;
  let wy = rowEnd + 12.5;
  text(c, "Total In Words", 45.6, wy);
  wy += 9.2;
  for (const l of wrap(c.italic, amountInWords(totals.totalP), 8, noteW)) {
    text(c, l, 45.6, wy, { italic: true });
    wy += 9.5;
  }
  wy += 11.2;
  text(c, "Notes", 45.6, wy, { color: LABEL });
  wy += 9.2;
  // "INR" in the prose, not the sign: the sign is drawn, and a drawn glyph
  // cannot be measured into a wrapped paragraph.
  const note = totals.taxMode === "inclusive"
    ? `Wallet credit of INR ${money(inv.creditP)} applied. The amount charged is inclusive of GST.`
    : `Wallet credit of INR ${money(inv.creditP)} applied. GST was charged in addition to the credit purchased.`;
  for (const l of wrap(c.font, note, 8, noteW)) { text(c, l, 45.6, wy); wy += 9.2; }
  for (const l of wrap(c.font, `Paid online via Cashfree. Payment reference ${inv.orderId}.`, 8, noteW)) {
    text(c, l, 45.6, wy);
    wy += 9.2;
  }

  // ---- signature ---------------------------------------------------------
  const sigTop = totalsBottom;
  const sigH = 169;
  const sigBottom = sigTop + sigH;
  centre(c, `For ${seller.legalName}`, tX, R - tX, sigTop + 5.0);
  if (sign) {
    // Fit inside the cell, leaving the caption room, and keep the aspect ratio.
    const maxW = 180, maxH = 100;
    const s = Math.min(maxW / sign.width, maxH / sign.height);
    const w = sign.width * s, h = sign.height * s;
    page.drawImage(sign, { x: tX + (R - tX - w) / 2, y: Y(sigTop + 22 + h), width: w, height: h });
  }
  centre(c, "Authorized Signature", tX, R - tX, sigBottom - 8.0);
  vline(c, tX, sigTop, sigBottom);
  hline(c, sigBottom, tX, R);

  // ---- frame -------------------------------------------------------------
  hline(c, TOP);
  hline(c, Math.max(BOT, sigBottom + 20));
  vline(c, L, TOP, Math.max(BOT, sigBottom + 20) + 0.75);
  vline(c, R, TOP, Math.max(BOT, sigBottom + 20) + 0.75);

  return doc.save();
}

/** File name for the download, e.g. "tax-invoice-FWAI-26-27-0007.pdf". */
export function invoiceFileName(inv: Invoice): string {
  return "tax-invoice-" + inv.invoiceNo.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".pdf";
}
