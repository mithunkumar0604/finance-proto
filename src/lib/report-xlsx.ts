// Turns a table into a real Excel workbook (.xlsx): one sheet, a bold header row that
// stays in view, sensible column widths. Amounts are written as numbers so Excel can add
// them up; everything else as text exactly as given (a date written 05/10/2026 stays so).
//
// An .xlsx file is a zip of a few small XML files. fflate does the zipping; it is loaded
// on demand so it does not weigh down the app.

export type Cell = string | number | null | undefined;

export interface Sheet {
  /** Sheet tab name (Excel allows 31 characters, none of : \ / ? * [ ]). */
  name: string;
  head: string[];
  rows: Cell[][];
  /** Lines above the header: a title, the period, and so on. */
  titleLines?: string[];
}

const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // characters XML does not allow at all
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");

/** A1, B1, ... AA1 */
export function cellRef(col: number, row: number): string {
  let name = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return `${name}${row}`;
}

function cellXml(v: Cell, col: number, row: number, style: number): string {
  const r = cellRef(col, row);
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${r}" s="${style}"><v>${v}</v></c>`;
  // A leading =, +, - or @ would make Excel treat typed text as a formula: inline strings are never formulas, so text stays text.
  return `<c r="${r}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
}

/** The sheet as XML (exported for tests). */
export function sheetXml(sheet: Sheet): string {
  const title = sheet.titleLines ?? [];
  const headRow = title.length + (title.length ? 2 : 1);
  const widths = sheet.head.map((h, c) => {
    const longest = Math.max(h.length, ...sheet.rows.map((r) => (r[c] === null || r[c] === undefined ? 0 : String(r[c]).length)));
    return Math.min(60, Math.max(8, longest + 2));
  });
  const rows: string[] = [];
  title.forEach((t, i) => rows.push(`<row r="${i + 1}">${cellXml(t, 0, i + 1, i === 0 ? 1 : 0)}</row>`));
  rows.push(`<row r="${headRow}">${sheet.head.map((h, c) => cellXml(h, c, headRow, 1)).join("")}</row>`);
  sheet.rows.forEach((row, i) => rows.push(`<row r="${headRow + 1 + i}">${row.map((v, c) => cellXml(v, c, headRow + 1 + i, typeof v === "number" ? 2 : 0)).join("")}</row>`));
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headRow}" topLeftCell="${cellRef(0, headRow + 1)}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${rows.join("")}</sheetData>` +
    `</worksheet>`
  );
}

const tabName = (name: string) => name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet1";

/** Every file inside the workbook, by path (exported for tests). */
export function workbookFiles(sheet: Sheet): Record<string, string> {
  const X = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
  return {
    "[Content_Types].xml":
      `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`,
    "_rels/.rels":
      `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`,
    "xl/workbook.xml":
      `${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets><sheet name="${esc(tabName(sheet.name))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels":
      `${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`,
    // style 0 = plain, 1 = bold (title and header), 2 = number with Indian-style thousands left to Excel (#,##0)
    "xl/styles.xml":
      `${X}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
      `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="3">` +
      `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
      `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
      `<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
      `</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    "xl/worksheets/sheet1.xml": sheetXml(sheet),
  };
}

export async function buildXlsx(sheet: Sheet): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  return zipSync(Object.fromEntries(Object.entries(workbookFiles(sheet)).map(([path, xml]) => [path, strToU8(xml)])));
}

/** Builds the workbook and hands it to the browser as a download. */
export async function downloadXlsx(sheet: Sheet, fileName: string): Promise<void> {
  const bytes = await buildXlsx(sheet);
  const blob = new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
