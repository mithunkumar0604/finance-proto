// The printed collection sheet: the paper the collector takes out on a round, laid out
// like the business's own sheet (given date, loan number, name, notes, then two blank
// columns to write the date paid and the amount, and the phone).
//
// One row per loan with something to collect by the sheet's date: that day's collection
// and anything overdue. Ordered by area, the same customer's loans together, by loan number.

import { dueRemaining } from "./finance/engine";
import { latestNotes } from "./loan-form";
import { permissions } from "./selectors";
import type { AppState } from "./store";
import type { ISODate, Loan } from "./types";

export interface SheetRow {
  loanId: string;
  given: ISODate;
  loanNo: string;
  name: string;
  /** What is held, in a word or two: the bike model, "Gold", the document. */
  tag: string;
  customerId: string;
  area: string;
  phone: string;
  /** Interest and principal to collect by the sheet's date, in paise. */
  expected: number;
  /** The oldest unpaid collection: when it is before the sheet's date the loan is behind. */
  dueSince: ISODate;
  note: string;
}

export interface CollectionSheet {
  date: ISODate;
  rows: SheetRow[];
  total: number;
}

function tag(loan: Loan): string {
  const sec = loan.security;
  if (!sec) return "";
  if (sec.kind === "vehicle") return [sec.make, sec.model].filter(Boolean).join(" ") || sec.registration;
  if (sec.kind === "jewel") return "Gold";
  if (sec.kind === "document") return sec.documentType;
  return sec.description;
}

/** dd/mm/yy, as the business writes dates on paper. */
export const shortDate = (iso: ISODate) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

export function collectionSheet(s: AppState, date: ISODate): CollectionSheet {
  const scope = permissions(s).customerScope;
  const customers = new Map(s.customers.map((c) => [c.id, c]));
  const notes = latestNotes(s.notes ?? []);
  const byLoan = new Map<string, { expected: number; dueSince: ISODate }>();
  for (const d of s.dues) {
    if (d.cancelled || d.dueDate > date) continue;
    const left = dueRemaining(d);
    if (left <= 0) continue;
    const had = byLoan.get(d.loanId);
    byLoan.set(d.loanId, { expected: (had?.expected ?? 0) + left, dueSince: had && had.dueSince < d.dueDate ? had.dueSince : d.dueDate });
  }

  const rows: SheetRow[] = [];
  for (const loan of s.loans) {
    const owed = byLoan.get(loan.id);
    const c = customers.get(loan.customerId);
    if (!owed || loan.status !== "active" || !c || !scope(c)) continue;
    const note = notes.get(loan.id);
    const behind = owed.dueSince < date ? `Due since ${shortDate(owed.dueSince)}` : "";
    const said = note ? `${note.text}${note.promisedOn ? ` (promised ${shortDate(note.promisedOn)})` : ""}` : "";
    rows.push({
      loanId: loan.id,
      given: loan.startDate,
      loanNo: loan.loanNo ?? loan.id,
      name: c.name,
      tag: tag(loan),
      customerId: c.id,
      area: c.area === "—" ? "" : c.area,
      phone: c.phone,
      expected: owed.expected,
      dueSince: owed.dueSince,
      note: [behind, said].filter(Boolean).join(" · "),
    });
  }

  // by area (a round), then each customer's loans together, customers by their first loan number
  const firstNo = new Map<string, string>();
  for (const r of rows) {
    const had = firstNo.get(r.customerId);
    if (!had || r.loanNo.localeCompare(had, "en", { numeric: true }) < 0) firstNo.set(r.customerId, r.loanNo);
  }
  rows.sort(
    (a, b) =>
      a.area.localeCompare(b.area) ||
      firstNo.get(a.customerId)!.localeCompare(firstNo.get(b.customerId)!, "en", { numeric: true }) ||
      a.customerId.localeCompare(b.customerId) ||
      a.loanNo.localeCompare(b.loanNo, "en", { numeric: true }),
  );
  return { date, rows, total: rows.reduce((a, r) => a + r.expected, 0) };
}
