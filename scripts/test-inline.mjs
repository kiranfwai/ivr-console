import ExcelJS from "exceljs";
import JSZip from "jszip";

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function findSheetNumber(wbXml, wbRelsXml, name) {
  const sheetMatch = wbXml.match(new RegExp(`<sheet[^/>]*name="${escapeRegex(name)}"[^/>]*r:id="(rId\\d+)"`, "i"));
  console.log("sheetMatch:", sheetMatch);
  if (!sheetMatch) return null;
  const rId = sheetMatch[1];
  const relMatch = wbRelsXml.match(new RegExp(`<Relationship[^/>]*Id="${rId}"[^/>]*Target="worksheets/sheet(\\d+)\\.xml"`, "i"));
  console.log("relMatch:", relMatch);
  if (!relMatch) return null;
  return parseInt(relMatch[1], 10);
}

const wb = new ExcelJS.Workbook();
wb.addWorksheet("Graphs");
const buf = await wb.xlsx.writeBuffer();
const zip = await JSZip.loadAsync(buf);
const wbXml = await zip.file("xl/workbook.xml").async("string");
const wbRelsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");

console.log("Result:", findSheetNumber(wbXml, wbRelsXml, "Graphs"));
