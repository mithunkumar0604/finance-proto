// Simple report ("digital register") views. Read-only, derived from the store.
//
// Rules:
// - Money received is always counted on the PAYMENT date (when the customer paid),
//   never the date it was entered, so backdated entries land in the right period.
// - Interest that fell due in the period, plus older interest still unpaid, is what
//   a person "owes" for that period.

import { endOfMonth, format, parseISO, startOfMonth, startOfWeek, startOfYear, subMonths } from "date-fns";
import { dueInterestLeft, openDue } from "./demo-calculations";
import { daysBetween, LOAN_TYPE_LABEL, toISO } from "./format";
import { permissions } from "./selectors";
import type { AppState } from "./store";
import type { Customer, Due, ISODate, Loan, Payment } from "./types";

// ---------------------------------------------------------------------------
// Choices on the Reports screen
// ---------------------------------------------------------------------------

export type RangeKey = "today" | "week" | "month" | "lastMonth" | "year" | "custom";
export type Show = "all" | "paid" | "pending" | "partial" | "overdue" | "closed";
export type Status = "paid" | "pending" | "partial" | "overdue" | "closed";

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Choose Dates" },
];

export const SHOW_OPTIONS: { value: Show; label: string }[] = [
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "partial", label: "Partial" },
  { value: "overdue", label: "Overdue" },
  { value: "closed", label: "Closed" },
];

export interface DateRange {
  key: RangeKey;
  from: ISODate;
  to: ISODate;
  /** "September 2026", "This Week", "2026", "1 Sep – 15 Sep 2026" */
  label: string;
}

/** Current periods run up to today; Last Month is the whole month. */
export function rangeFor(key: RangeKey, today: ISODate, custom?: { from?: string | null; to?: string | null }): DateRange {
  const t = parseISO(today);
  switch (key) {
    case "today":
      return { key, from: today, to: today, label: format(t, "d MMMM yyyy") };
    case "week":
      return { key, from: toISO(startOfWeek(t, { weekStartsOn: 1 })), to: today, label: "This Week" };
    case "lastMonth": {
      const m = subMonths(t, 1);
      return { key, from: toISO(startOfMonth(m)), to: toISO(endOfMonth(m)), label: format(m, "MMMM yyyy") };
    }
    case "year":
      return { key, from: toISO(startOfYear(t)), to: today, label: format(t, "yyyy") };
    case "custom": {
      const from = custom?.from || toISO(startOfMonth(t));
      const to = custom?.to && custom.to >= from ? custom.to : today;
      return { key, from, to, label: `${format(parseISO(from), "d MMM")} – ${format(parseISO(to), "d MMM yyyy")}` };
    }
    case "month":
    default:
      return { key: "month", from: toISO(startOfMonth(t)), to: today, label: format(t, "MMMM yyyy") };
  }
}

/** "September 2026 Pending Report", "Closed Loans This Year", "Ravi Kumar Yearly Statement". */
export function reportTitle(range: DateRange, show: Show, personName?: string): string {
  const showWord = SHOW_OPTIONS.find((o) => o.value === show)!.label;
  if (personName) {
    const base = range.key === "year" ? `${personName} Yearly Statement` : `${personName} Statement · ${range.label}`;
    return show === "all" ? base : `${base} · ${showWord}`;
  }
  const when = range.key === "year" ? "This Year" : range.label;
  if (show === "closed") return `Closed Loans ${when}`;
  return show === "all" ? `${when} Report` : `${when} ${showWord} Report`;
}

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

const inRange = (d: ISODate, r: DateRange) => d >= r.from && d <= r.to;
/** The day a due was first expected (moving the date doesn't move it to another period). */
const expectedOn = (d: Due) => d.rescheduled?.originalDate ?? d.dueDate;

function ctx(s: AppState) {
  const scope = permissions(s).customerScope;
  const customers = new Map(s.customers.map((c) => [c.id, c]));
  const loans = s.loans.filter((l) => {
    const c = customers.get(l.customerId);
    return !!c && scope(c);
  });
  const duesByLoan = new Map<string, Due[]>();
  for (const d of s.dues) if (!d.cancelled) duesByLoan.set(d.loanId, [...(duesByLoan.get(d.loanId) ?? []), d]);
  const paysByLoan = new Map<string, Payment[]>();
  for (const p of s.payments) paysByLoan.set(p.loanId, [...(paysByLoan.get(p.loanId) ?? []), p]);
  for (const list of paysByLoan.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return { customers, loans, duesByLoan, paysByLoan };
}

/** Dues that count for a period: fell due in it, or fell due earlier and are still unpaid. */
function periodDues(dues: Due[], range: DateRange, today: ISODate) {
  return dues.filter((d) => {
    const on = expectedOn(d);
    if (on > range.to) return false;
    return on >= range.from || (dueInterestLeft(d) > 0 && d.dueDate < today);
  });
}

/** Is this loan part of the period at all? */
const loanInPeriod = (l: Loan, range: DateRange) => l.startDate <= range.to && !(l.closedDate && l.closedDate < range.from);

// ---------------------------------------------------------------------------
// All People — one line per loan
// ---------------------------------------------------------------------------

export interface RegisterLine {
  loan: Loan;
  customer: Customer;
  interest: number;
  paid: number;
  pending: number;
  lastPaid?: ISODate;
  nextDue?: ISODate;
  status: Status;
  daysLate: number;
}

export interface Figure {
  label: string;
  value: number;
  money: boolean;
  tone?: "green" | "amber" | "red";
}

export function registerReport(s: AppState, today: ISODate, range: DateRange, show: Show) {
  const { customers, loans, duesByLoan, paysByLoan } = ctx(s);
  const all: RegisterLine[] = [];

  for (const loan of loans) {
    if (!loanInPeriod(loan, range)) continue;
    const dues = periodDues(duesByLoan.get(loan.id) ?? [], range, today);
    const pays = paysByLoan.get(loan.id) ?? [];
    const paidInPeriod = pays.filter((p) => inRange(p.date, range)).reduce((a, p) => a + p.interest, 0);
    const closedInPeriod = loan.status === "closed" && !!loan.closedDate && inRange(loan.closedDate, range);
    if (!dues.length && !paidInPeriod && !closedInPeriod) continue;

    const interest = dues.reduce((a, d) => a + d.interestAmount, 0);
    const pending = dues.reduce((a, d) => a + dueInterestLeft(d), 0);
    const late = dues.filter((d) => dueInterestLeft(d) > 0 && d.dueDate < today);
    const partPaid = dues.some((d) => dueInterestLeft(d) > 0 && d.paid > 0);
    const status: Status = closedInPeriod ? "closed" : pending === 0 ? "paid" : late.length ? "overdue" : partPaid ? "partial" : "pending";
    const lastPay = [...pays].reverse().find((p) => p.interest > 0 && p.date <= range.to);

    all.push({
      loan,
      customer: customers.get(loan.customerId)!,
      interest,
      paid: paidInPeriod,
      pending,
      lastPaid: lastPay?.date,
      nextDue: loan.status === "active" ? openDue(duesByLoan.get(loan.id) ?? [])?.dueDate : undefined,
      status,
      daysLate: late.length ? Math.max(...late.map((d) => daysBetween(d.dueDate, today))) : 0,
    });
  }

  const lines = all
    .filter((l) => show === "all" || (show === "pending" ? l.pending > 0 && l.status !== "closed" : l.status === show))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.pending - a.pending || a.customer.name.localeCompare(b.customer.name));

  const people = new Set(lines.map((l) => l.customer.id)).size;
  const sum = (f: (l: RegisterLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const principal = sum((l) => l.loan.principalLeft);

  let figures: Figure[];
  switch (show) {
    case "paid":
      figures = [
        { label: "People Paid", value: people, money: false, tone: "green" },
        { label: "Interest Received", value: sum((l) => l.paid), money: true, tone: "green" },
        { label: "Loans", value: lines.length, money: false },
        { label: "Principal Left", value: principal, money: true },
      ];
      break;
    case "pending":
      figures = [
        { label: "People Pending", value: people, money: false, tone: "amber" },
        { label: "Interest Pending", value: sum((l) => l.pending), money: true, tone: "amber" },
        { label: "Of which Overdue", value: sum((l) => (l.status === "overdue" ? l.pending : 0)), money: true, tone: "red" },
        { label: "Principal Left", value: principal, money: true },
      ];
      break;
    case "partial":
      figures = [
        { label: "People Part Paid", value: people, money: false, tone: "amber" },
        { label: "Paid So Far", value: sum((l) => l.paid), money: true, tone: "green" },
        { label: "Still Pending", value: sum((l) => l.pending), money: true, tone: "amber" },
        { label: "Principal Left", value: principal, money: true },
      ];
      break;
    case "overdue":
      figures = [
        { label: "People Overdue", value: people, money: false, tone: "red" },
        { label: "Overdue Interest", value: sum((l) => l.pending), money: true, tone: "red" },
        { label: "Longest Late (days)", value: Math.max(0, ...lines.map((l) => l.daysLate)), money: false },
        { label: "Principal Left", value: principal, money: true },
      ];
      break;
    case "closed":
      figures = [
        { label: "Loans Closed", value: lines.length, money: false },
        { label: "Loan Amount", value: sum((l) => l.loan.amount), money: true },
        { label: "Interest Earned", value: lines.reduce((a, l) => a + (paysByLoan.get(l.loan.id) ?? []).reduce((x, p) => x + p.interest, 0), 0), money: true, tone: "green" },
        { label: "Principal Outside", value: 0, money: true },
      ];
      break;
    default:
      figures = [
        { label: "Money Given", value: loans.filter((l) => inRange(l.startDate, range)).reduce((a, l) => a + l.amount, 0), money: true },
        { label: "Interest Received", value: sum((l) => l.paid), money: true, tone: "green" },
        { label: "Interest Pending", value: sum((l) => l.pending), money: true, tone: "amber" },
        { label: "Principal Outside", value: loans.filter((l) => l.status === "active").reduce((a, l) => a + l.principalLeft, 0), money: true },
      ];
  }
  return { lines, figures };
}

const ORDER: Record<Status, number> = { overdue: 0, partial: 1, pending: 2, paid: 3, closed: 4 };

// ---------------------------------------------------------------------------
// One person — a ledger, like the old paper register
// ---------------------------------------------------------------------------

export type EntryKind = "loan" | Status;

export interface LedgerEntry {
  date: ISODate;
  details: string;
  /** Small grey line: loan number, payment method, "entered 29 Sep" for backdated. */
  note?: string;
  amount: number;
  status: EntryKind;
}

export function personReport(s: AppState, today: ISODate, range: DateRange, show: Show, customerId: string) {
  const { customers, loans, duesByLoan, paysByLoan } = ctx(s);
  const customer = customers.get(customerId);
  if (!customer) return null;
  const own = loans.filter((l) => l.customerId === customerId);
  const inPeriod = own.filter((l) => loanInPeriod(l, range));
  const many = own.length > 1;
  const tag = (l: Loan) => (many ? `${l.id} · ` : "");
  const entries: LedgerEntry[] = [];

  for (const loan of inPeriod) {
    const pays = paysByLoan.get(loan.id) ?? [];
    const dues = duesByLoan.get(loan.id) ?? [];

    if (inRange(loan.startDate, range))
      entries.push({ date: loan.startDate, details: "Money Given", note: `${loan.id} · ${LOAN_TYPE_LABEL[loan.type]}`, amount: loan.amount, status: "loan" });
    else {
      // Loan given before this period: open the page with the principal carried in.
      const returnedBefore = pays.filter((p) => p.date < range.from).reduce((a, p) => a + p.principal, 0);
      entries.push({
        date: range.from,
        details: "Principal at Start",
        note: `${loan.id} · ${LOAN_TYPE_LABEL[loan.type]} · given ${format(parseISO(loan.startDate), "d MMM yyyy")}`,
        amount: loan.amount - returnedBefore,
        status: "loan",
      });
    }

    // Interest paid so far on each due, to tell "Paid" from "Partial" per payment.
    const paidOnDue = new Map<string, number>();
    for (const p of pays) {
      const due = dues.find((d) => d.id === p.dueId);
      const before = paidOnDue.get(p.dueId ?? "") ?? 0;
      paidOnDue.set(p.dueId ?? "", before + p.interest);
      if (!inRange(p.date, range)) continue;
      const late = p.recordedOn > p.date ? ` · entered ${format(parseISO(p.recordedOn), "d MMM")}` : "";
      const noteBase = `${tag(loan)}${cap(p.method)}${late}`;
      if (p.interest > 0) {
        const partial = !!due && before + p.interest < due.interestAmount;
        entries.push({ date: p.date, details: "Interest", note: noteBase, amount: p.interest, status: partial ? "partial" : "paid" });
      }
      if (p.principal > 0) {
        const full = p.principalBefore - p.principal <= 0;
        entries.push({ date: p.date, details: full ? "Full Settlement" : "Principal Returned", note: noteBase, amount: p.principal, status: full ? "closed" : "paid" });
      }
      if (p.other > 0) entries.push({ date: p.date, details: "Other Charges", note: noteBase, amount: p.other, status: "paid" });
    }

    for (const d of periodDues(dues, range, today)) {
      const left = dueInterestLeft(d);
      if (left > 0)
        entries.push({ date: d.dueDate, details: "Interest Pending", note: `${tag(loan)}due ${format(parseISO(d.dueDate), "d MMM")}`, amount: left, status: d.dueDate < today ? "overdue" : d.paid > 0 ? "partial" : "pending" });
    }

    if (loan.status === "closed" && loan.closedDate && inRange(loan.closedDate, range))
      entries.push({ date: loan.closedDate, details: "Loan Closed", note: loan.id, amount: loan.amount, status: "closed" });
  }

  const rank: Record<EntryKind, number> = { loan: 0, paid: 1, partial: 2, closed: 3, pending: 4, overdue: 5 };
  entries.sort((a, b) => a.date.localeCompare(b.date) || rank[a.status] - rank[b.status]);

  const shown = entries.filter((e) =>
    show === "all" ? true : show === "pending" ? ["pending", "partial", "overdue"].includes(e.status) && e.details === "Interest Pending" : e.status === show,
  );

  const received = entries.filter((e) => e.details === "Interest").reduce((a, e) => a + e.amount, 0);
  const pending = entries.filter((e) => e.details === "Interest Pending").reduce((a, e) => a + e.amount, 0);

  return {
    customer,
    loans: own,
    entries: shown,
    figures: [
      { label: "Loan Amount", value: inPeriod.reduce((a, l) => a + l.amount, 0), money: true },
      { label: "Principal Left", value: own.filter((l) => l.status === "active").reduce((a, l) => a + l.principalLeft, 0), money: true },
      { label: "Interest Received", value: received, money: true, tone: "green" },
      { label: "Interest Pending", value: pending, money: true, tone: pending ? "amber" : undefined },
    ] as Figure[],
    principalLeft: own.filter((l) => l.status === "active").reduce((a, l) => a + l.principalLeft, 0),
  };
}

const cap = (w: string) => (w === "upi" ? "UPI" : w[0].toUpperCase() + w.slice(1));
