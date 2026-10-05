// Checks an import file (existing customers and their loans) before anything is saved.
// Pure: no database, no network. Every problem is reported with its row and column, and
// a file with any problem is not imported at all. See IMPORT.md.
//
// An imported loan is an OPENING POSITION: where the loan stands on the day it is
// brought in. Payments made before that day are not recreated.

import { accrueDues, buildDue, dueInterestLeft, FinanceError, periodInterest } from "../finance/engine";
import { parseRupees } from "../finance/money";
import type { Due, Frequency, InterestMethod, InterestStyle, ISODate, Loan, LoanType } from "../types";

/** The template's columns. One row = one loan (or one customer with no loan). Any order is accepted. */
export const COLUMNS = [
  "customer_ref",
  "customer_name",
  "phone",
  "alt_phone",
  "area",
  "address",
  "id_ref",
  "notes",
  "loan_ref",
  "loan_type",
  "loan_amount",
  "principal_left",
  "start_date",
  "interest_style",
  "interest_value",
  "interest_method",
  "frequency",
  "principal_per_collection",
  "status",
  "next_due_date",
  "interest_already_paid",
  "interest_pending_today",
  "last_paid_date",
  "closed_date",
  "security_type",
  "security_description",
  "vehicle_registration",
  "reference",
] as const;
export type Column = (typeof COLUMNS)[number];

const LOAN_TYPES: LoanType[] = ["weekly", "monthly", "15day", "30day", "vehicle", "jewel", "custom"];
const FREQUENCIES: Frequency[] = ["weekly", "15days", "30days", "monthly", "custom"];
const STYLES: InterestStyle[] = ["percent", "fixed"];
const METHODS: InterestMethod[] = ["reducing", "fixed", "manual"];
const SECURITY = ["none", "jewel", "vehicle", "document", "other"] as const;

export interface ImportError {
  /** Line in the file, counting the header as 1 (as a spreadsheet shows it). */
  row: number;
  column: Column | "(header)";
  message: string;
}

/** Something to read before importing. It only blocks the import when `affectsBalance` is true. */
export interface ImportWarning {
  /** 0 = about the whole file. */
  row: number;
  column?: Column;
  message: string;
  /** true = the figure the app would show differs from the client's own figure. Do not import until resolved. */
  affectsBalance: boolean;
}

export interface ImportCustomer {
  /**
   * Which rows are the same person. NOT the phone number: the client's own customer
   * number when given (`ref:…`), otherwise the name and phone together (`np:…`).
   * Inside LedgerPro a customer's identity is always its own id (C001, C002, …).
   */
  key: string;
  row: number;
  /** The client's own number/code for this customer, if the sheet has one. */
  ref?: string;
  name: string;
  /** Contact detail only. May be empty, and may be shared by two customers. */
  phone: string;
  altPhone?: string;
  area: string;
  address?: string;
  idRef?: string;
  notes?: string;
}

export interface ImportLoan {
  row: number;
  customerKey: string;
  /** The client's own number for this loan. Stops the same loan being imported twice from another file. */
  ref?: string;
  type: LoanType;
  amount: number;
  principalLeft: number;
  startDate: ISODate;
  interest: { style: InterestStyle; value: number; method: InterestMethod };
  frequency: Frequency;
  principalPerDue: number;
  /** The oldest collection still unpaid. Later periods are worked out from it. */
  nextDueDate?: ISODate;
  status: "active" | "closed";
  closedDate?: ISODate;
  reference?: string;
  /** Interest already received towards the collection on `nextDueDate` (a part-paid period). */
  interestAlreadyPaid?: number;
  /** The day the customer last paid, for the "Last Paid" column. Payment history itself is not imported. */
  lastPaidDate?: ISODate;
  /** What the app will show as interest pending today for this loan (already due, unpaid). */
  pendingToday: number;
  /** How many collections are already due and unpaid today. */
  periodsPending: number;
  security: { kind: Exclude<(typeof SECURITY)[number], "none">; description?: string; registration?: string } | null;
}

export interface ImportResult {
  ok: boolean;
  customers: ImportCustomer[];
  loans: ImportLoan[];
  errors: ImportError[];
  warnings: ImportWarning[];
  /** How the first dates in the file were read, so a wrong date format is noticed before importing. */
  datesReadAs: { row: number; column: Column; written: string; readAs: string }[];
}

/** Minimal CSV reader: quoted cells, commas and line breaks inside quotes, "" for a quote. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let line: string[] = [];
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      line.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      line.push(cell);
      rows.push(line);
      cell = "";
      line = [];
    } else cell += ch;
  }
  if (cell !== "" || line.length) {
    line.push(cell);
    rows.push(line);
  }
  return rows;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The ONE date rule: day first, as written in India.
 *   DD/MM/YYYY   DD-MM-YYYY   DD.MM.YYYY     e.g. 04/05/2026 is 4 May 2026, never 5 April
 *   YYYY-MM-DD                               also accepted (unambiguous)
 * The year must have four digits. Anything else (04/05/26, 4 May 2026, May 4) is refused,
 * not guessed. Returns null if it is not a real date in one of these forms.
 */
export function parseDate(text: string): ISODate | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const inWords = (iso: ISODate) => `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const opt = (s: string) => (s.trim() ? s.trim() : undefined);
const rs = (paise: number) => `Rs. ${new Intl.NumberFormat("en-IN").format(paise / 100)}`;

/** What the app will show as pending today for a loan opened from these values. Uses the app's own rules. */
function openingPosition(l: Omit<ImportLoan, "pendingToday" | "periodsPending">, today: ISODate): { pendingToday: number; periodsPending: number } {
  if (l.status !== "active" || !l.nextDueDate) return { pendingToday: 0, periodsPending: 0 };
  const loan: Loan = {
    id: "import",
    customerId: "import",
    type: l.type,
    amount: l.amount,
    startDate: l.startDate,
    interest: l.interest,
    frequency: l.frequency,
    principalPerDue: l.principalPerDue,
    principalLeft: l.principalLeft,
    status: "active",
    security: null,
  };
  const paid = l.interestAlreadyPaid ?? 0;
  const first: Due = { ...buildDue(loan, l.nextDueDate, "first"), paid, interestPaid: paid };
  const due = accrueDues(loan, [first], today, (n) => `d${n}`).filter((d) => d.dueDate <= today && dueInterestLeft(d) > 0);
  return { pendingToday: due.reduce((a, d) => a + dueInterestLeft(d), 0), periodsPending: due.length };
}

export function validateImport(text: string, today: ISODate): ImportResult {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const datesReadAs: ImportResult["datesReadAs"] = [];
  const done = (customers: ImportCustomer[] = [], loans: ImportLoan[] = []): ImportResult => ({ ok: errors.length === 0, customers, loans, errors, warnings, datesReadAs });

  const rows = parseCsv(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const missing = COLUMNS.filter((c) => !head.includes(c));
  const unknown = head.filter((h) => h && !(COLUMNS as readonly string[]).includes(h));
  const repeated = head.filter((h, i) => h && head.indexOf(h) !== i);
  if (missing.length || unknown.length || repeated.length) {
    const parts = [
      missing.length ? `missing: ${missing.join(", ")}` : "",
      unknown.length ? `not in the template: ${[...new Set(unknown)].join(", ")}` : "",
      repeated.length ? `repeated: ${[...new Set(repeated)].join(", ")}` : "",
    ].filter(Boolean);
    errors.push({ row: 1, column: "(header)", message: `The first row must have exactly the template's column names (in any order). ${parts.join("; ")}.` });
    return done();
  }
  const at = Object.fromEntries(COLUMNS.map((c) => [c, head.indexOf(c)])) as Record<Column, number>;

  const customers = new Map<string, ImportCustomer>();
  const loans: ImportLoan[] = [];
  const loanRefs = new Map<string, number>();
  const phones = new Map<string, { row: number; name: string }>();
  let noLoanRef = 0;

  rows.slice(1).forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((c) => !c.trim())) return;
    const get = (c: Column) => (cells[at[c]] ?? "").trim();
    const before = errors.length;
    const bad = (column: Column, message: string) => void errors.push({ row, column, message });
    const warn = (message: string, column?: Column, affectsBalance = false) => void warnings.push({ row, column, message, affectsBalance });

    // ---- customer: who this row is about
    const name = get("customer_name");
    const ref = get("customer_ref");
    const phone = get("phone").replace(/[\s-]/g, "");
    if (!name) bad("customer_name", "Customer name is missing.");
    if (phone && !/^[6-9]\d{9}$/.test(phone)) bad("phone", "Phone must be a 10-digit mobile number, or left empty.");
    const altPhone = get("alt_phone").replace(/[\s-]/g, "");
    if (altPhone && !/^\d{10}$/.test(altPhone)) bad("alt_phone", "Alternate phone must be 10 digits, or empty.");

    // Same person on two rows = same customer_ref, or (when no ref is given) same name AND same phone.
    const key = ref ? `ref:${ref.toLowerCase()}` : `np:${name.toLowerCase().replace(/\s+/g, " ")}|${phone}`;
    const known = customers.get(key);
    if (known && ref && (known.name.toLowerCase() !== name.toLowerCase() || known.phone !== phone))
      bad("customer_ref", `customer_ref "${ref}" is also on row ${known.row} with a different name or phone ("${known.name}", ${known.phone || "no phone"}). One ref = one person.`);
    if (!ref && !phone) {
      if (known) bad("customer_ref", `"${name}" has no phone and is also on row ${known.row}. Give both rows the same customer_ref if they are the same person, or different ones if not.`);
      else warn(`"${name}" has no phone number. That is allowed; the customer can still be found by name.`, "phone");
    }
    if (phone && !known) {
      const other = phones.get(phone);
      if (other && other.name.toLowerCase() !== name.toLowerCase())
        warn(`Phone ${phone} is also used by "${other.name}" on row ${other.row}. They will be two separate customers who share a phone.`, "phone");
      if (!other) phones.set(phone, { row, name });
    }

    // ---- loan (a row with no loan amount adds the customer only)
    let loan: ImportLoan | null = null;
    if (get("loan_amount") || get("loan_type")) {
      const money = (c: Column, required: boolean): number | null => {
        const raw = get(c);
        if (!raw) {
          if (required) bad(c, "This amount is missing.");
          return required ? null : 0;
        }
        const p = parseRupees(raw);
        if (p === null) bad(c, `"${raw}" is not a valid amount. Use rupees, e.g. 1,00,000 or 2500.50.`);
        return p;
      };
      const oneOf = <T extends string>(c: Column, list: readonly T[]): T | null => {
        const v = get(c).toLowerCase() as T;
        if (!list.includes(v)) bad(c, `Must be one of: ${list.join(", ")}.`);
        return list.includes(v) ? v : null;
      };
      const date = (c: Column, required: boolean): ISODate | null => {
        const raw = get(c);
        if (!raw) {
          if (required) bad(c, "This date is missing.");
          return null;
        }
        const d = parseDate(raw);
        if (!d) bad(c, `"${raw}" is not a date we can read. Write day/month/year with a 4-digit year, e.g. 04/05/2026 for 4 May 2026.`);
        else if (datesReadAs.length < 6) datesReadAs.push({ row, column: c, written: raw, readAs: inWords(d) });
        return d;
      };

      const loanRef = get("loan_ref");
      if (loanRef) {
        const seen = loanRefs.get(loanRef.toLowerCase());
        if (seen) bad("loan_ref", `loan_ref "${loanRef}" is also on row ${seen}. Each loan needs its own.`);
        else loanRefs.set(loanRef.toLowerCase(), row);
      } else noLoanRef++;

      const type = oneOf("loan_type", LOAN_TYPES);
      const amount = money("loan_amount", true);
      if (amount === 0) bad("loan_amount", "The loan amount must be more than zero.");
      const principalLeft = money("principal_left", true);
      if (amount && principalLeft !== null && principalLeft > amount) bad("principal_left", "Principal left cannot be more than the loan amount.");
      const startDate = date("start_date", true);
      if (startDate && startDate > today) bad("start_date", "The loan date cannot be in the future.");
      const style = oneOf("interest_style", STYLES);
      const method = oneOf("interest_method", METHODS);
      const frequency = oneOf("frequency", FREQUENCIES);
      let interestValue: number | null = null;
      const rawInterest = get("interest_value");
      if (!rawInterest) bad("interest_value", "The interest is missing.");
      else if (style === "percent") {
        interestValue = Number(rawInterest);
        if (!/^\d+(\.\d{1,4})?$/.test(rawInterest) || interestValue > 100) {
          bad("interest_value", "A percentage must be a number from 0 to 100, e.g. 3 or 2.5.");
          interestValue = null;
        }
      } else if (style === "fixed") interestValue = money("interest_value", true);
      const principalPerDue = money("principal_per_collection", false);
      const status = oneOf("status", ["active", "closed"] as const);
      const closedDate = date("closed_date", status === "closed");
      const nextDueDate = date("next_due_date", status === "active");
      if (nextDueDate && startDate && nextDueDate <= startDate) bad("next_due_date", "The next collection must be after the loan date.");
      if (status === "closed" && principalLeft) bad("principal_left", "A closed loan must have 0 principal left.");
      if (status === "active" && principalLeft === 0) bad("status", "A loan with 0 principal left should be marked closed (with a closed date).");
      if (closedDate && startDate && closedDate < startDate) bad("closed_date", "The closed date is before the loan date.");
      if (closedDate && closedDate > today) bad("closed_date", "The closed date cannot be in the future.");
      const kind = oneOf("security_type", SECURITY);
      const registration = get("vehicle_registration").toUpperCase().replace(/\s+/g, " ");
      if (kind === "vehicle" && !registration) bad("vehicle_registration", "A vehicle loan needs the vehicle number.");

      // A period that is already part-paid: must be less than that period's interest.
      const alreadyPaid = money("interest_already_paid", false);
      if (alreadyPaid) {
        if (status === "closed") bad("interest_already_paid", "A closed loan has nothing pending, so leave this empty.");
        else if (amount && principalLeft !== null && style && method && interestValue !== null) {
          try {
            const period = periodInterest({ interest: { style, value: interestValue, method }, amount, principalLeft });
            if (alreadyPaid >= period)
              bad("interest_already_paid", `Must be less than one period's interest (${rs(period)}). If that period is fully paid, leave this empty and put the following collection in next_due_date.`);
          } catch (e) {
            if (!(e instanceof FinanceError)) throw e;
          }
        }
      }
      const lastPaidDate = date("last_paid_date", false);
      if (lastPaidDate && lastPaidDate > today) bad("last_paid_date", "The last payment date cannot be in the future.");
      else if (lastPaidDate && startDate && lastPaidDate < startDate) bad("last_paid_date", "The last payment date is before the loan was given.");
      else if (lastPaidDate && closedDate && lastPaidDate > closedDate) bad("last_paid_date", "The last payment date is after the loan was closed.");
      const pendingGiven = get("interest_pending_today") ? money("interest_pending_today", false) : null;
      if (pendingGiven && status === "closed") bad("interest_pending_today", "A closed loan has nothing pending, so leave this empty or 0.");

      if (errors.length === before) {
        const base = {
          row,
          customerKey: key,
          ...(loanRef ? { ref: loanRef } : {}),
          type: type!,
          amount: amount!,
          principalLeft: principalLeft!,
          startDate: startDate!,
          interest: { style: style!, value: interestValue!, method: method! },
          frequency: frequency!,
          principalPerDue: principalPerDue ?? 0,
          ...(status === "active" ? { nextDueDate: nextDueDate! } : {}),
          status: status!,
          ...(status === "closed" ? { closedDate: closedDate! } : {}),
          ...(opt(get("reference")) ? { reference: opt(get("reference")) } : {}),
          ...(alreadyPaid ? { interestAlreadyPaid: alreadyPaid } : {}),
          ...(lastPaidDate ? { lastPaidDate } : {}),
          security: kind && kind !== "none" ? { kind, ...(opt(get("security_description")) ? { description: opt(get("security_description")) } : {}), ...(registration ? { registration } : {}) } : null,
        };
        try {
          loan = { ...base, ...openingPosition(base, today) };
        } catch (e) {
          if (!(e instanceof FinanceError)) throw e;
          bad("interest_value", e.message);
        }
        if (loan) {
          // The client's own figure for interest pending today, if given, must agree with what the app will show.
          if (pendingGiven !== null && pendingGiven !== loan.pendingToday)
            warn(
              `You wrote ${rs(pendingGiven)} interest pending today, but from the other columns the app will show ${rs(loan.pendingToday)} (${loan.periodsPending} unpaid period${loan.periodsPending === 1 ? "" : "s"} from ${inWords(loan.nextDueDate ?? today)}). One of them needs correcting before import.`,
              "interest_pending_today",
              true,
            );
          if (loan.periodsPending >= 6) warn(`${loan.periodsPending} unpaid periods (${rs(loan.pendingToday)}) will show as pending. Check next_due_date is right.`, "next_due_date");
          if (lastPaidDate && nextDueDate && status === "active" && lastPaidDate >= nextDueDate && !alreadyPaid)
            warn(
              `The last payment (${inWords(lastPaidDate)}) is on or after the oldest unpaid collection (${inWords(nextDueDate)}). If that payment was for this collection, fill interest_already_paid or move next_due_date.`,
              "last_paid_date",
            );
        }
      }
    }

    if (errors.length > before) return;
    if (!known) {
      const c: ImportCustomer = { key, row, ...(ref ? { ref } : {}), name, phone, area: get("area") };
      if (altPhone) c.altPhone = altPhone;
      for (const [field, col] of [["address", "address"], ["idRef", "id_ref"], ["notes", "notes"]] as const) if (opt(get(col))) c[field] = opt(get(col));
      customers.set(key, c);
    }
    if (loan) loans.push(loan);
  });

  if (noLoanRef > 0)
    warnings.push({
      row: 0,
      column: "loan_ref",
      message: `${noLoanRef} loan(s) have no loan_ref. Without it, the same loan could be imported twice if it is also in a later file. This exact file is still protected against being imported twice.`,
      affectsBalance: false,
    });

  return done([...customers.values()], loans);
}
