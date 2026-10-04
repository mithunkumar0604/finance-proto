// Checks an import file (existing customers and their loans) before anything is saved.
// Pure: no database, no network. Every problem is reported with its row and column, and
// a file with any problem is not imported at all. See IMPORT.md.

import { parseRupees } from "../finance/money";
import type { Frequency, InterestMethod, InterestStyle, ISODate, LoanType } from "../types";

/** The template's columns, in order. One row = one loan (or one customer with no loan). */
export const COLUMNS = [
  "customer_name",
  "phone",
  "alt_phone",
  "area",
  "address",
  "id_ref",
  "notes",
  "loan_type",
  "loan_amount",
  "principal_left",
  "start_date",
  "interest_style",
  "interest_value",
  "interest_method",
  "frequency",
  "principal_per_collection",
  "next_due_date",
  "security_type",
  "security_description",
  "vehicle_registration",
  "status",
  "closed_date",
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

export interface ImportCustomer {
  /** Customers are matched by phone number. */
  key: string;
  row: number;
  name: string;
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
  security: { kind: Exclude<(typeof SECURITY)[number], "none">; description?: string; registration?: string } | null;
}

export interface ImportResult {
  ok: boolean;
  customers: ImportCustomer[];
  loans: ImportLoan[];
  errors: ImportError[];
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

/** "01-02-2026", "1/2/2026" (day first) or "2026-02-01" -> "2026-02-01". null if it is not a real date. */
function parseDate(text: string): ISODate | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dmy ? [dmy[3], dmy[2], dmy[1]] : [];
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (date.getUTCFullYear() !== Number(y) || date.getUTCMonth() !== Number(m) - 1 || date.getUTCDate() !== Number(d)) return null;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const opt = (s: string) => (s.trim() ? s.trim() : undefined);

export function validateImport(text: string, today: ISODate): ImportResult {
  const errors: ImportError[] = [];
  const rows = parseCsv(text);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  if (head.length !== COLUMNS.length || COLUMNS.some((c, i) => head[i] !== c)) {
    errors.push({ row: 1, column: "(header)", message: `The first row must be exactly the template's columns: ${COLUMNS.join(", ")}` });
    return { ok: false, customers: [], loans: [], errors };
  }

  const customers = new Map<string, ImportCustomer>();
  const loans: ImportLoan[] = [];

  rows.slice(1).forEach((cells, i) => {
    const row = i + 2;
    if (cells.every((c) => !c.trim())) return;
    const get = (c: Column) => (cells[COLUMNS.indexOf(c)] ?? "").trim();
    const before = errors.length;
    const bad = (column: Column, message: string) => void errors.push({ row, column, message });

    // ---- customer
    const name = get("customer_name");
    const phone = get("phone").replace(/[\s-]/g, "");
    if (!name) bad("customer_name", "Customer name is missing.");
    if (!/^[6-9]\d{9}$/.test(phone)) bad("phone", "Phone must be a 10-digit mobile number.");
    const altPhone = get("alt_phone").replace(/[\s-]/g, "");
    if (altPhone && !/^\d{10}$/.test(altPhone)) bad("alt_phone", "Alternate phone must be 10 digits, or empty.");
    const known = customers.get(phone);
    if (known && name && known.name.toLowerCase() !== name.toLowerCase())
      bad("customer_name", `This phone number is already used for "${known.name}" on row ${known.row}. One phone = one customer.`);

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
        if (!d) bad(c, `"${raw}" is not a date. Use DD-MM-YYYY.`);
        return d;
      };

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
      const kind = oneOf("security_type", SECURITY);
      const registration = get("vehicle_registration").toUpperCase().replace(/\s+/g, " ");
      if (kind === "vehicle" && !registration) bad("vehicle_registration", "A vehicle loan needs the vehicle number.");

      if (errors.length === before)
        loan = {
          row,
          customerKey: phone,
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
          security: kind && kind !== "none" ? { kind, ...(opt(get("security_description")) ? { description: opt(get("security_description")) } : {}), ...(registration ? { registration } : {}) } : null,
        };
    }

    if (errors.length > before) return;
    if (!known) {
      const c: ImportCustomer = { key: phone, row, name, phone, area: get("area") };
      if (altPhone) c.altPhone = altPhone;
      for (const [field, col] of [["address", "address"], ["idRef", "id_ref"], ["notes", "notes"]] as const) if (opt(get(col))) c[field] = opt(get(col));
      customers.set(phone, c);
    }
    if (loan) loans.push(loan);
  });

  return { ok: errors.length === 0, customers: [...customers.values()], loans, errors };
}
