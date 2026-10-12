// The Excel sheet of a report: one row per loan, laid out like the business's own
// ledger (given date, loan number, name, referred by, phone, date, note, payment,
// amount), followed by where each loan stands today.

import { periodInterest } from "./finance/engine";
import type { RegisterLine } from "./reports";
import type { Sheet } from "./report-xlsx";
import type { ISODate, LoanNote, Security } from "./types";

/** 2026-10-05 -> 05/10/2026 (day first, as the business writes dates). */
export const dmy = (iso?: ISODate) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");

const rupees = (paise: number) => Math.round(paise) / 100;

function securityText(sec: Security | null): string {
  if (!sec) return "";
  if (sec.kind === "vehicle") return [sec.registration, [sec.make, sec.model].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
  if (sec.kind === "jewel") return `${sec.description} · ${sec.weightGrams} g`;
  if (sec.kind === "document") return sec.documentType;
  return sec.description;
}

/** The interest of one collection as the loan stands now; blank where it is entered by hand each time. */
function perCollection(line: RegisterLine): number | null {
  try {
    const v = periodInterest(line.loan);
    return v > 0 ? rupees(v) : null;
  } catch {
    return null;
  }
}

const STATUS: Record<RegisterLine["status"], string> = { paid: "Paid", pending: "Pending", partial: "Part paid", overdue: "Overdue", upcoming: "Upcoming", closed: "Closed" };

export const EXPORT_HEAD = [
  "Given Date",
  "Loan No.",
  "Name",
  "Referred By",
  "Phone",
  "Date",
  "Note",
  "Payment",
  "Amount",
  "Principal Left",
  "Interest Pending",
  "Next Due",
  "Status",
  "Security",
  "Area",
  "App Loan ID",
];

/**
 * `notes`: the newest note of each loan. "Date" is the day interest was last paid,
 * "Payment" the interest of one collection, "Amount" the money given.
 */
export function exportSheet(lines: RegisterLine[], notes: Map<string, LoanNote>, title: string, period: string): Sheet {
  // in the order of the book: by loan number where there is one, then by date given
  const sorted = [...lines].sort((a, b) => {
    const [x, y] = [a.loan.loanNo, b.loan.loanNo];
    if (x && y) return x.localeCompare(y, "en", { numeric: true });
    if (x || y) return x ? -1 : 1;
    return a.loan.startDate.localeCompare(b.loan.startDate) || a.loan.id.localeCompare(b.loan.id);
  });
  return {
    name: "Loans",
    titleLines: [title, period],
    head: EXPORT_HEAD,
    rows: sorted.map((l) => {
      const note = notes.get(l.loan.id);
      return [
        dmy(l.loan.startDate),
        l.loan.loanNo ?? "",
        l.customer.name,
        l.loan.referredBy ?? "",
        l.customer.phone,
        dmy(l.lastPaid),
        note ? `${note.text}${note.promisedOn ? ` (promised ${dmy(note.promisedOn)})` : ""}` : "",
        perCollection(l),
        rupees(l.loan.amount),
        rupees(l.loan.principalLeft),
        rupees(l.pending),
        dmy(l.nextDue),
        STATUS[l.status],
        securityText(l.loan.security),
        l.customer.area === "—" ? "" : l.customer.area,
        l.loan.id,
      ];
    }),
  };
}
