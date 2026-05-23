import ExcelJS from "exceljs";
import JSZip from "jszip";

const wb = new ExcelJS.Workbook();
wb.addWorksheet("Graphs");
const buf = await wb.xlsx.writeBuffer();
const zip = await JSZip.loadAsync(buf);
const wbXml = await zip.file("xl/workbook.xml").async("string");
const wbRelsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");

console.log("--- workbook.xml ---");
console.log(wbXml);
console.log("--- rels ---");
console.log(wbRelsXml);

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

const name = "Graphs";
const pat1 = `<sheet[^/>]*name="${escapeRegex(name)}"[^/>]*r:id="(rId\\d+)"`;
console.log("--- regex:", pat1);
const m1 = wbXml.match(new RegExp(pat1, "i"));
console.log("--- match1:", m1);

const pat2 = `<sheet[^>]*name="${escapeRegex(name)}"[^>]*r:id="(rId\\d+)"`;
const m2 = wbXml.match(new RegExp(pat2, "i"));
console.log("--- match2 (no slash in char class):", m2);
