// Sanity test: build an xlsx with native pie + bar charts via injectCharts,
// write to disk, validate the resulting zip structure.
import ExcelJS from "exceljs";
import JSZip from "jszip";
import fs from "fs";

// Inline copy of injectCharts so we can test without TS compile.
const charts_xml = await import(new URL("./_inline-charts.mjs", import.meta.url));
const { injectCharts } = charts_xml;

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Graphs");

ws.addRow(["Label", "Count"]); // row 1
ws.addRow(["Lifted", 7]);      // row 2
ws.addRow(["Not lifted", 3]);  // row 3
ws.addRow(["Other", 1]);       // row 4
ws.addRow([]);
ws.addRow(["Hour", "Calls"]);  // row 6
ws.addRow(["10:00", 4]);       // row 7
ws.addRow(["11:00", 8]);       // row 8
ws.addRow(["12:00", 2]);       // row 9

const baseBuf = await wb.xlsx.writeBuffer();
const finalBuf = await injectCharts(baseBuf, "Graphs", [
  {
    type: "pie",
    title: "Test pie",
    dataSheet: "Graphs",
    labelRange: "A2:A4",
    valueRange: "B2:B4",
    anchor: { fromCol: 4, fromRow: 0, toCol: 10, toRow: 14 },
    colors: ["22C55E", "F59E0B", "7A8597"],
  },
  {
    type: "bar",
    title: "Test bar",
    dataSheet: "Graphs",
    labelRange: "A7:A9",
    valueRange: "B7:B9",
    anchor: { fromCol: 4, fromRow: 16, toCol: 12, toRow: 32 },
    direction: "col",
    color: "5EEAD4",
  },
]);

fs.writeFileSync("scripts/_test-charts.xlsx", finalBuf);
console.log("✅ Wrote scripts/_test-charts.xlsx (" + finalBuf.length + " bytes)");

// Sanity check: unzip and look at what's inside
const verify = await JSZip.loadAsync(finalBuf);
console.log("\n=== file list ===");
Object.keys(verify.files).sort().forEach((n) => console.log("  " + n));
console.log("\n=== [Content_Types].xml ===");
console.log(await verify.file("[Content_Types].xml").async("string"));
