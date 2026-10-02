// Turns the report currently on screen into a clean, printable A4 PDF.
// The screen builds a ReportDoc (plain strings); this file only lays it out.
// jsPDF is loaded on demand so it doesn't weigh down the app.

import { APP } from "./config";

export interface ReportDoc {
  title: string;
  period: string;
  person?: { name: string; phone: string; area: string; loans: string };
  summary: { label: string; value: string }[];
  head: string[];
  body: string[][];
  /** Columns (by index) to right-align, e.g. money. */
  rightCols?: number[];
  /** Column (by index) holding PAID / PENDING / ... labels, tinted softly. */
  statusCol?: number;
  footerTotal?: { label: string; value: string };
  /** Wide tables (the All People register) print in landscape. */
  landscape?: boolean;
  fileName: string;
}

/** Standard PDF fonts have no ₹ glyph, so PDFs use "Rs." */
export const pdfMoney = (n: number) => `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(Math.round(n))}`;

const INK: [number, number, number] = [16, 32, 27];
const MUTED: [number, number, number] = [107, 119, 114];
const BRAND: [number, number, number] = [11, 90, 71];
const LINE: [number, number, number] = [231, 232, 226];
const STATUS_TINT: Record<string, [number, number, number]> = {
  PAID: [4, 120, 87],
  PARTIAL: [146, 64, 14],
  PENDING: [71, 85, 105],
  OVERDUE: [190, 18, 60],
  UPCOMING: [67, 56, 202],
  CLOSED: [71, 85, 105],
  LOAN: [11, 90, 71],
};

export async function downloadReportPdf(doc: ReportDoc) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: doc.landscape ? "landscape" : "portrait" });
  const W = pdf.internal.pageSize.getWidth();
  const M = 16;
  let y = 18;

  // Header
  pdf.setFont("helvetica", "bold").setFontSize(16).setTextColor(...BRAND).text(APP.name, M, y);
  pdf.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED).text("Finance & Collection Report", M, y + 5);
  const generated = new Date().toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  pdf.text(`Generated ${generated}`, W - M, y, { align: "right" });
  pdf.text(APP.owner.business, W - M, y + 5, { align: "right" });
  y += 10;
  pdf.setDrawColor(...LINE).setLineWidth(0.4).line(M, y, W - M, y);

  y += 10;
  pdf.setFont("helvetica", "bold").setFontSize(15).setTextColor(...INK).text(doc.title, M, y);
  y += 6;
  pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED).text(`Period: ${doc.period}`, M, y);

  if (doc.person) {
    y += 8;
    pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(...INK).text(doc.person.name, M, y);
    pdf.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED);
    pdf.text(`Phone ${doc.person.phone}  ·  ${doc.person.area}  ·  Loan ${doc.person.loans}`, M, y + 5);
    y += 5;
  }

  // Summary boxes
  y += 8;
  const gap = 4;
  const boxW = (W - 2 * M - gap * (doc.summary.length - 1)) / doc.summary.length;
  doc.summary.forEach((f, i) => {
    const x = M + i * (boxW + gap);
    pdf.setDrawColor(...LINE).setFillColor(250, 250, 247).roundedRect(x, y, boxW, 17, 2, 2, "FD");
    pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text(f.label, x + 3.5, y + 6);
    pdf.setFont("helvetica", "bold").setFontSize(11.5).setTextColor(...INK).text(f.value, x + 3.5, y + 13);
  });
  y += 25;

  // Table
  autoTable(pdf, {
    startY: y,
    head: [doc.head],
    body: doc.body,
    margin: { left: M, right: M, bottom: 18 },
    theme: "plain",
    styles: { font: "helvetica", fontSize: 9, cellPadding: { top: 2.6, bottom: 2.6, left: 2, right: 2 }, textColor: INK, lineColor: LINE },
    headStyles: { fontStyle: "bold", fontSize: 8, textColor: MUTED, fillColor: [245, 245, 240] },
    bodyStyles: { lineWidth: { bottom: 0.2 } },
    columnStyles: Object.fromEntries((doc.rightCols ?? []).map((i) => [i, { halign: "right" }])),
    didParseCell: (d) => {
      if (d.section === "head" && doc.rightCols?.includes(d.column.index)) d.cell.styles.halign = "right";
      if (d.section === "body" && d.column.index === doc.statusCol) {
        d.cell.styles.fontStyle = "bold";
        d.cell.styles.fontSize = 8;
        d.cell.styles.textColor = STATUS_TINT[String(d.cell.raw)] ?? MUTED;
      }
    },
  });

  // Bottom line (e.g. Principal Left)
  if (doc.footerTotal) {
    const end = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
    const yy = end > pdf.internal.pageSize.getHeight() - 26 ? (pdf.addPage(), 24) : end;
    pdf.setFillColor(234, 244, 240).roundedRect(M, yy - 6, W - 2 * M, 11, 2, 2, "F");
    pdf.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...BRAND).text(doc.footerTotal.label, M + 4, yy + 1);
    pdf.text(doc.footerTotal.value, W - M - 4, yy + 1, { align: "right" });
  }

  // Footer on every page
  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    const H = pdf.internal.pageSize.getHeight();
    pdf.setDrawColor(...LINE).line(M, H - 12, W - M, H - 12);
    pdf.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED);
    pdf.text(`Generated by ${APP.name}`, M, H - 7);
    pdf.text(`Page ${i} of ${pages}`, W - M, H - 7, { align: "right" });
  }

  pdf.save(doc.fileName);
}
