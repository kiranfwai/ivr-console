/**
 * Generate native Excel chart objects (real, clickable, editable) by writing
 * the OOXML chart XML directly and splicing into a workbook that ExcelJS built.
 *
 * Why this exists: ExcelJS doesn't expose a public API for chart objects.
 * Other Node libraries either don't support charts (xlsx-populate, sheetjs
 * free tier) or are unmaintained / produce corrupted files (excel4node).
 *
 * Strategy: build the workbook with ExcelJS, then post-process the resulting
 * zip — inject xl/charts/chartN.xml, xl/drawings/drawingN.xml, wire up the
 * sheet rels, declare content types. Result is a regular .xlsx that Excel,
 * Sheets, and Numbers all open with real chart objects.
 */

import JSZip from "jszip";

export interface PieSpec {
  type: "pie";
  title: string;
  dataSheet: string;         // sheet name where the data table lives
  labelRange: string;        // e.g. "A2:A8" — categories
  valueRange: string;        // e.g. "B2:B8" — numeric values
  /** position on the target sheet (in cell coords) */
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number };
  colors?: string[];         // hex without # — one per slice
}

export interface BarSpec {
  type: "bar";
  title: string;
  dataSheet: string;
  labelRange: string;
  valueRange: string;
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number };
  direction?: "col" | "bar"; // "col" = vertical bars, "bar" = horizontal
  color?: string;            // hex without #, one color for all bars
}

export type ChartSpec = PieSpec | BarSpec;

interface ResolvedCell {
  row: number;        // 1-indexed
  col: number;        // 1-indexed
  ref: string;        // e.g. "A2"
  value: string;
}

/**
 * Splice native chart objects into a workbook that ExcelJS already wrote.
 *
 * @param workbookBuf  Output of `ExcelJS.workbook.xlsx.writeBuffer()`
 * @param targetSheet  Sheet name on which the charts will appear
 * @param charts       List of chart specs (data must already be in dataSheet at the specified ranges)
 * @returns            Modified workbook buffer with chart objects embedded
 */
export async function injectCharts(
  workbookBuf: ArrayBuffer | Buffer,
  targetSheet: string,
  charts: ChartSpec[]
): Promise<Buffer> {
  if (!charts.length) return Buffer.from(workbookBuf as any);

  const zip = await JSZip.loadAsync(workbookBuf);

  // ---------- Find the target sheet's internal path & relsId ----------
  // workbook.xml lists sheets in order and assigns sheetN.xml filenames.
  const wbXml = await readText(zip, "xl/workbook.xml");
  const wbRelsXml = await readText(zip, "xl/_rels/workbook.xml.rels");

  const sheetNumber = findSheetNumber(wbXml, wbRelsXml, targetSheet);
  if (!sheetNumber) throw new Error(`Sheet "${targetSheet}" not found in workbook`);
  const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;
  const sheetRelsPath = `xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`;

  // ---------- Find next available chart / drawing indexes ----------
  let nextChartIdx = 1;
  while (zip.file(`xl/charts/chart${nextChartIdx}.xml`)) nextChartIdx++;
  let nextDrawingIdx = 1;
  while (zip.file(`xl/drawings/drawing${nextDrawingIdx}.xml`)) nextDrawingIdx++;
  const drawingIdx = nextDrawingIdx;
  const drawingPath = `xl/drawings/drawing${drawingIdx}.xml`;
  const drawingRelsPath = `xl/drawings/_rels/drawing${drawingIdx}.xml.rels`;

  // ---------- Generate chart XML files + collect anchors for drawing ----------
  const anchors: string[] = [];
  const drawingRels: string[] = [];
  charts.forEach((c, i) => {
    const chartIdx = nextChartIdx + i;
    const chartPath = `xl/charts/chart${chartIdx}.xml`;
    zip.file(chartPath, buildChartXml(c));
    const rIdInDrawing = `rId${i + 1}`;
    drawingRels.push(
      `<Relationship Id="${rIdInDrawing}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartIdx}.xml"/>`
    );
    anchors.push(buildAnchorXml(c, rIdInDrawing, i + 1));
  });

  // ---------- Drawing file + its rels ----------
  zip.file(drawingPath, buildDrawingXml(anchors));
  zip.file(
    drawingRelsPath,
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${drawingRels.join("\n")}
</Relationships>`
  );

  // ---------- Sheet rels: add a relationship to the drawing ----------
  await ensureSheetRelsHasDrawing(zip, sheetRelsPath, drawingIdx);

  // ---------- Sheet XML: add <drawing r:id=".."/> reference ----------
  await ensureSheetHasDrawing(zip, sheetPath, sheetRelsPath);

  // ---------- [Content_Types].xml: declare chart + drawing content types ----------
  await ensureContentTypes(zip, charts.length, nextChartIdx, drawingIdx);

  // ---------- Write back to buffer ----------
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// ============================================================
// Chart XML builders
// ============================================================
function buildChartXml(c: ChartSpec): string {
  const parts = c.type === "pie" ? buildPieChartXml(c) : buildBarChartXml(c);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:roundedCorners val="0"/>
  <c:chart>
    <c:title>
      <c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1400" b="1"/><a:t>${escapeXml(c.title)}</a:t></a:r></a:p></c:rich></c:tx>
      <c:overlay val="0"/>
    </c:title>
    <c:autoTitleDeleted val="0"/>
    <c:plotArea>
      <c:layout/>
      ${parts.plotArea}
    </c:plotArea>
    ${parts.legend}
    <c:plotVisOnly val="1"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

interface ChartParts {
  plotArea: string;
  legend: string;
}

function buildPieChartXml(c: PieSpec): ChartParts {
  const dataRef = (range: string) => `${quoteSheet(c.dataSheet)}!${absoluteRange(range)}`;
  const colorPts = (c.colors || []).map((hex, i) =>
    `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${hex.toUpperCase()}"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`
  ).join("");

  // Data labels on each slice: value + percent, white bold text centered.
  const dataLabels = `<c:dLbls>
            <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>
            <c:dLblPos val="ctr"/>
            <c:showLegendKey val="0"/>
            <c:showVal val="1"/>
            <c:showCatName val="0"/>
            <c:showSerName val="0"/>
            <c:showPercent val="1"/>
            <c:showBubbleSize val="0"/>
            <c:separator>  ·  </c:separator>
          </c:dLbls>`;

  return {
    plotArea: `<c:pieChart>
        <c:varyColors val="1"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          ${colorPts}
          ${dataLabels}
          <c:cat>
            <c:strRef>
              <c:f>${dataRef(c.labelRange)}</c:f>
            </c:strRef>
          </c:cat>
          <c:val>
            <c:numRef>
              <c:f>${dataRef(c.valueRange)}</c:f>
            </c:numRef>
          </c:val>
        </c:ser>
        <c:firstSliceAng val="0"/>
      </c:pieChart>`,
    legend: `<c:legend>
      <c:legendPos val="r"/>
      <c:overlay val="0"/>
      <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1000"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>
    </c:legend>`,
  };
}

function buildBarChartXml(c: BarSpec): ChartParts {
  const dataRef = (range: string) => `${quoteSheet(c.dataSheet)}!${absoluteRange(range)}`;
  const direction = c.direction || "col";
  const color = c.color || "5EEAD4";
  const colorFill = `<c:spPr><a:solidFill><a:srgbClr val="${color.toUpperCase()}"/></a:solidFill></c:spPr>`;

  // Show value at the end of each bar
  const dataLabels = `<c:dLbls>
            <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="1"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>
            <c:dLblPos val="outEnd"/>
            <c:showLegendKey val="0"/>
            <c:showVal val="1"/>
            <c:showCatName val="0"/>
            <c:showSerName val="0"/>
            <c:showPercent val="0"/>
            <c:showBubbleSize val="0"/>
          </c:dLbls>`;

  return {
    plotArea: `<c:barChart>
        <c:barDir val="${direction}"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          ${colorFill}
          ${dataLabels}
          <c:cat>
            <c:strRef>
              <c:f>${dataRef(c.labelRange)}</c:f>
            </c:strRef>
          </c:cat>
          <c:val>
            <c:numRef>
              <c:f>${dataRef(c.valueRange)}</c:f>
            </c:numRef>
          </c:val>
        </c:ser>
        <c:gapWidth val="80"/>
        <c:axId val="111111111"/>
        <c:axId val="222222222"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="111111111"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="${direction === "col" ? "b" : "l"}"/>
        <c:crossAx val="222222222"/>
        <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>
      </c:catAx>
      <c:valAx>
        <c:axId val="222222222"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:delete val="0"/>
        <c:axPos val="${direction === "col" ? "l" : "b"}"/>
        <c:crossAx val="111111111"/>
        <c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>
      </c:valAx>`,
    // Bars usually don't need a legend (axis labels do the job), so omit it.
    legend: ``,
  };
}

// ============================================================
// Drawing (anchor) XML
// ============================================================
function buildDrawingXml(anchors: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${anchors.join("\n")}
</xdr:wsDr>`;
}

function buildAnchorXml(c: ChartSpec, rId: string, frameId: number): string {
  const { fromCol, fromRow, toCol, toRow } = c.anchor;
  return `  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>${fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>${toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr>
        <xdr:cNvPr id="${frameId + 1}" name="Chart ${frameId}"/>
        <xdr:cNvGraphicFramePr/>
      </xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic>
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">
          <c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="${rId}"/>
        </a:graphicData>
      </a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>`;
}

// ============================================================
// Workbook plumbing helpers
// ============================================================
async function readText(zip: JSZip, path: string): Promise<string> {
  const f = zip.file(path);
  if (!f) throw new Error(`Missing ${path} in workbook`);
  return f.async("string");
}

function findSheetNumber(wbXml: string, wbRelsXml: string, name: string): number | null {
  // Each <sheet name="..." r:id="rIdN" sheetId=".." /> in workbook.xml
  // points to a relationship; the relationship's Target is "worksheets/sheetN.xml".
  // Note: use [^>]* (NOT [^/>]*) because Type attribute contains "/" in its URL.
  const sheetMatch = wbXml.match(new RegExp(`<sheet[^>]*name="${escapeRegex(name)}"[^>]*r:id="(rId\\d+)"`, "i"));
  if (!sheetMatch) return null;
  const rId = sheetMatch[1];
  const relMatch = wbRelsXml.match(new RegExp(`<Relationship[^>]*Id="${rId}"[^>]*Target="worksheets/sheet(\\d+)\\.xml"`, "i"));
  if (!relMatch) return null;
  return parseInt(relMatch[1], 10);
}

async function ensureSheetRelsHasDrawing(zip: JSZip, sheetRelsPath: string, drawingIdx: number): Promise<string> {
  let xml = zip.file(sheetRelsPath)
    ? await readText(zip, sheetRelsPath)
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;

  // Pick an rId not yet used
  const usedIds = Array.from(xml.matchAll(/Id="rId(\d+)"/g)).map((m) => parseInt(m[1], 10));
  const nextRId = (usedIds.length ? Math.max(...usedIds) : 0) + 1;
  const drawingRId = `rId${nextRId}`;
  const newRel = `<Relationship Id="${drawingRId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingIdx}.xml"/>`;
  xml = xml.replace("</Relationships>", `${newRel}</Relationships>`);
  zip.file(sheetRelsPath, xml);
  return drawingRId;
}

async function ensureSheetHasDrawing(zip: JSZip, sheetPath: string, sheetRelsPath: string): Promise<void> {
  let sheetXml = await readText(zip, sheetPath);
  if (sheetXml.includes("<drawing ")) return; // already wired

  // Find the rId we just added (last drawing relationship in the rels file)
  const relsXml = await readText(zip, sheetRelsPath);
  const drawingMatch = relsXml.match(/<Relationship[^>]*Id="(rId\d+)"[^>]*relationships\/drawing/);
  if (!drawingMatch) throw new Error("Couldn't find drawing rels entry just written");
  const drawingRId = drawingMatch[1];

  // <drawing r:id="rIdN"/> must appear AFTER <mergeCells> / <pageMargins> etc.
  // Safest: insert just before </worksheet>.
  const drawingTag = `<drawing r:id="${drawingRId}"/>`;
  if (sheetXml.includes("</worksheet>")) {
    sheetXml = sheetXml.replace("</worksheet>", `${drawingTag}</worksheet>`);
  } else {
    sheetXml += drawingTag;
  }
  zip.file(sheetPath, sheetXml);
}

async function ensureContentTypes(zip: JSZip, chartCount: number, firstChartIdx: number, drawingIdx: number): Promise<void> {
  let ct = await readText(zip, "[Content_Types].xml");

  // Declare drawingml content type for the drawing file
  const drawingOverride = `<Override PartName="/xl/drawings/drawing${drawingIdx}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`;
  if (!ct.includes(`drawings/drawing${drawingIdx}.xml`)) {
    ct = ct.replace("</Types>", `${drawingOverride}</Types>`);
  }

  // Declare each chart
  for (let i = 0; i < chartCount; i++) {
    const idx = firstChartIdx + i;
    const partName = `/xl/charts/chart${idx}.xml`;
    if (ct.includes(partName)) continue;
    const chartOverride = `<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
    ct = ct.replace("</Types>", `${chartOverride}</Types>`);
  }

  zip.file("[Content_Types].xml", ct);
}

// ============================================================
// Tiny helpers
// ============================================================
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Quote a sheet name for use in a formula reference, per the OOXML rules. */
function quoteSheet(name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return `'${name.replace(/'/g, "''")}'`;
}

/** Convert "A2:A8" → "$A$2:$A$8" */
function absoluteRange(range: string): string {
  return range.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");
}
