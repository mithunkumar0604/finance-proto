// Lays the collection sheet out as an A4 page to print, like the business's own sheet:
// the date in large letters at the top, a full grid, rows tall enough to write in, the
// Date and Amount columns left blank for the collector, and a few empty rows at the end
// for customers added by hand. jsPDF is loaded on demand.

import { APP } from "./config";
import { shortDate, type CollectionSheet } from "./collection-sheet";
import { rupeeDigits } from "./format";

const INK: [number, number, number] = [16, 32, 27];
const MUTED: [number, number, number] = [107, 119, 114];
const GRID: [number, number, number] = [120, 128, 124];

export const SHEET_HEAD = ["Given", "Loan No.", "Name", "Notes", "Expected", "Date", "Amount", "Phone"];

/** The table as plain strings (exported for tests). */
export function sheetBody(sheet: CollectionSheet, blankRows = 3): string[][] {
  const rows = sheet.rows.map((r) => [shortDate(r.given), r.loanNo, r.tag ? `${r.name} · ${r.tag}` : r.name, r.note, rupeeDigits(r.expected), "", "", r.phone]);
  return [...rows, ...Array.from({ length: blankRows }, () => SHEET_HEAD.map(() => ""))];
}

export async function downloadCollectionSheet(sheet: CollectionSheet): Promise<void> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const W = pdf.internal.pageSize.getWidth();
  const M = 10;

  const header = () => {
    pdf.setFont("helvetica", "bold").setFontSize(16).setTextColor(...INK);
    pdf.text(`DATE - ${shortDate(sheet.date).replace(/\//g, ".")}`, W / 2, 14, { align: "center" });
    pdf.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED);
    pdf.text(APP.name, M, 14);
    pdf.text(`${sheet.rows.length} loan${sheet.rows.length === 1 ? "" : "s"} · Rs. ${rupeeDigits(sheet.total)} expected`, W - M, 14, { align: "right" });
  };

  autoTable(pdf, {
    startY: 19,
    head: [SHEET_HEAD],
    body: sheetBody(sheet),
    margin: { left: M, right: M, top: 19, bottom: 14 },
    theme: "grid",
    styles: { font: "helvetica", fontSize: 9, textColor: INK, lineColor: GRID, lineWidth: 0.2, cellPadding: { top: 2, bottom: 2, left: 1.6, right: 1.6 }, minCellHeight: 10, valign: "middle", overflow: "linebreak" },
    headStyles: { fontStyle: "bold", fontSize: 8.5, fillColor: [238, 240, 236], textColor: INK, minCellHeight: 8 },
    // 190 mm across: the Notes column is wide for handwriting; Date and Amount narrow, in the middle
    columnStyles: {
      0: { cellWidth: 17 },
      1: { cellWidth: 18 },
      2: { cellWidth: 41, fontStyle: "bold" },
      3: { cellWidth: 42, fontSize: 7.5, textColor: MUTED },
      4: { cellWidth: 17, halign: "right" },
      5: { cellWidth: 14 },
      6: { cellWidth: 16 },
      7: { cellWidth: 25 },
    },
    didParseCell: (d) => {
      if (d.section === "head" && d.column.index === 4) d.cell.styles.halign = "right";
    },
    didDrawPage: header,
  });

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    const H = pdf.internal.pageSize.getHeight();
    pdf.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(...MUTED);
    pdf.text(`Printed from ${APP.name}`, M, H - 6);
    pdf.text(`Page ${i} of ${pages}`, W - M, H - 6, { align: "right" });
  }
  pdf.save(`Collection sheet ${sheet.date}.pdf`);
}
