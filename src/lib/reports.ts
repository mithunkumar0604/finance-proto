// Report views. Everything here is read-only and derived from the store.
// Date filtering always uses the PAYMENT date (when the customer paid), never the
// date the entry was recorded, so backdated entries land in the right period.

import { endOfMonth, format, parseISO, startOfMonth, startOfWeek, startOfYear, subMonths } from "date-fns";
import { dueInterestLeft, dueRemaining, openDue } from "./demo-calculations";
import { daysBetween, toISO } from "./format";
import { permissions, type LoanHealth } from "./selectors";
import type { AppState } from "./store";
import type { Customer, Due, ISODate, Loan, Payment } from "./types";

// ---------------------------------------------------------------------------
// Date ranges
// ---------------------------------------------------------------------------

export type RangeKey = "today" | "week" | "month" | "lastMonth" | "year" | "custom";

export interface DateRange {
  key: RangeKey;
  from: ISODate;
  to: ISODate;
  label: string;
}

export const RANGE_OPTIONS: { value: RangeKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "lastMonth", label: "Last Month" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Custom" },
];

/** Current periods run up to today ("so far"); Last Month is the full month. */
export function rangeFor(key: RangeKey, today: ISODate, custom?: { from?: string | null; to?: string | null }): DateRange {
  const t = parseISO(today);
  switch (key) {
    case "today":
      return { key, from: today, to: today, label: format(t, "d MMMM yyyy") };
    case "week":
      return { key, from: toISO(startOfWeek(t, { weekStartsOn: 1 })), to: today, label: "This week" };
    case "lastMonth": {
      const m = subMonths(t, 1);
      return { key, from: toISO(startOfMonth(m)), to: toISO(endOfMonth(m)), label: format(m, "MMMM yyyy") };
    }
    case "year":
      return { key, from: toISO(startOfYear(t)), to: today, label: `${format(t, "yyyy")} so far` };
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

const inRange = (d: ISODate, r: DateRange) => d >= r.from && d <= r.to;
/** The day a due was originally expected (a reschedule doesn't move it to another period). */
const expectedOn = (d: Due) => d.rescheduled?.originalDate ?? d.dueDate;

// ---------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------

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

function lastPayment(pays: Payment[] | undefined, until: ISODate, pred: (p: Payment) => boolean = () => true) {
  return [...(pays ?? [])].reverse().find((p) => p.date <= until && pred(p));
}

// ---------------------------------------------------------------------------
// Interest report — the core day-to-day report
// ---------------------------------------------------------------------------

export type InterestStatus = "paid" | "partial" | "pending" | "overdue";

export interface InterestRow {
  loan: Loan;
  customer: Customer;
  expected: number;
  received: number;
  pending: number;
  lastPaid?: Payment;
  nextDate?: ISODate;
  status: InterestStatus;
}

export function interestReport(s: AppState, today: ISODate, range: DateRange) {
  const { customers, loans, duesByLoan, paysByLoan } = ctx(s);
  const rows: InterestRow[] = [];
  for (const loan of loans) {
    const dues = (duesByLoan.get(loan.id) ?? []).filter((d) => inRange(expectedOn(d), range));
    if (!dues.length) continue;
    const expected = dues.reduce((a, d) => a + d.interestAmount, 0);
    const pending = dues.reduce((a, d) => a + dueInterestLeft(d), 0);
    const received = expected - pending;
    const late = dues.some((d) => dueInterestLeft(d) > 0 && d.dueDate < today);
    const status: InterestStatus = pending === 0 ? "paid" : late ? "overdue" : received > 0 ? "partial" : "pending";
    rows.push({
      loan,
      customer: customers.get(loan.customerId)!,
      expected,
      received,
      pending,
      lastPaid: lastPayment(paysByLoan.get(loan.id), today, (p) => p.interest > 0),
      nextDate: loan.status === "active" ? openDue(duesByLoan.get(loan.id) ?? [])?.dueDate : undefined,
      status,
    });
  }
  const sum = (k: "expected" | "received" | "pending") => rows.reduce((a, r) => a + r[k], 0);
  const pendingCustomers = new Set(rows.filter((r) => r.pending > 0).map((r) => r.customer.id));
  const paidCustomers = new Set(rows.filter((r) => r.pending === 0 && !pendingCustomers.has(r.customer.id)).map((r) => r.customer.id));
  return {
    rows,
    expected: sum("expected"),
    received: sum("received"),
    pending: sum("pending"),
    customersPaid: paidCustomers.size,
    customersPending: pendingCustomers.size,
  };
}

// ---------------------------------------------------------------------------
// Loan position — who has the money right now
// ---------------------------------------------------------------------------

export interface PositionRow {
  loan: Loan;
  customer: Customer;
  interestDue: number;
  principalPaid: number;
  lastPaid?: Payment;
  nextDue?: Due;
  health: LoanHealth;
  overdueDays: number;
}

export function loanPosition(s: AppState, today: ISODate): PositionRow[] {
  const { customers, loans, duesByLoan, paysByLoan } = ctx(s);
  return loans
    .filter((l) => l.status === "active")
    .map((loan) => {
      const next = openDue(duesByLoan.get(loan.id) ?? []);
      const overdueDays = next && next.dueDate < today ? daysBetween(next.dueDate, today) : 0;
      const health: LoanHealth = overdueDays > 0 ? "overdue" : next?.dueDate === today ? "due" : "active";
      return {
        loan,
        customer: customers.get(loan.customerId)!,
        interestDue: next ? dueInterestLeft(next) : 0,
        principalPaid: loan.amount - loan.principalLeft,
        lastPaid: lastPayment(paysByLoan.get(loan.id), today),
        nextDue: next,
        health,
        overdueDays,
      };
    });
}

// ---------------------------------------------------------------------------
// Overdue — missed interest first
// ---------------------------------------------------------------------------

export interface OverdueRow {
  loan: Loan;
  customer: Customer;
  interestDue: number;
  amountDue: number;
  dueDate: ISODate;
  days: number;
  lastInterestPaid?: Payment;
  partPaid: boolean;
}

export const OVERDUE_BUCKETS = [
  { value: "1-7", label: "1–7 Days", min: 1, max: 7 },
  { value: "8-30", label: "8–30 Days", min: 8, max: 30 },
  { value: "31-60", label: "31–60 Days", min: 31, max: 60 },
  { value: "60+", label: "60+ Days", min: 61, max: Infinity },
  { value: "90+", label: "90+ Days", min: 91, max: Infinity },
] as const;

export function overdueReport(s: AppState, today: ISODate) {
  const { customers, loans, duesByLoan, paysByLoan } = ctx(s);
  const rows: OverdueRow[] = [];
  for (const loan of loans) {
    if (loan.status !== "active") continue;
    const late = (duesByLoan.get(loan.id) ?? []).filter((d) => d.dueDate < today && dueRemaining(d) > 0);
    if (!late.length) continue;
    const first = late.reduce((a, d) => (d.dueDate < a.dueDate ? d : a));
    rows.push({
      loan,
      customer: customers.get(loan.customerId)!,
      interestDue: late.reduce((a, d) => a + dueInterestLeft(d), 0),
      amountDue: late.reduce((a, d) => a + dueRemaining(d), 0),
      dueDate: first.dueDate,
      days: daysBetween(first.dueDate, today),
      lastInterestPaid: lastPayment(paysByLoan.get(loan.id), today, (p) => p.interest > 0),
      partPaid: late.some((d) => d.paid > 0),
    });
  }
  return {
    rows,
    interest: rows.reduce((a, r) => a + r.interestDue, 0),
    customers: new Set(rows.map((r) => r.customer.id)).size,
    principalAtRisk: rows.reduce((a, r) => a + r.loan.principalLeft, 0),
  };
}

// ---------------------------------------------------------------------------
// Settlements — principal coming back (less frequent)
// ---------------------------------------------------------------------------

export interface SettlementRow {
  payment: Payment;
  loan: Loan;
  customer: Customer;
  before: number;
  remaining: number;
  type: "partial" | "full";
}

export function settlementsReport(s: AppState, range: DateRange) {
  const { customers, loans } = ctx(s);
  const loanMap = new Map(loans.map((l) => [l.id, l]));
  const rows: SettlementRow[] = s.payments
    .filter((p) => p.principal > 0 && inRange(p.date, range) && loanMap.has(p.loanId))
    .map((p) => {
      const loan = loanMap.get(p.loanId)!;
      const remaining = Math.max(0, p.principalBefore - p.principal);
      return { payment: p, loan, customer: customers.get(loan.customerId)!, before: p.principalBefore, remaining, type: remaining === 0 ? "full" : "partial" };
    });
  const partial = rows.filter((r) => r.type === "partial");
  const full = rows.filter((r) => r.type === "full");
  return {
    rows,
    principalReceived: rows.reduce((a, r) => a + r.payment.principal, 0),
    partialPrincipal: partial.reduce((a, r) => a + r.payment.principal, 0),
    partialCount: partial.length,
    fullAmount: full.reduce((a, r) => a + r.payment.principal, 0),
    fullCount: full.length,
    loansClosed: loans.filter((l) => l.status === "closed" && l.closedDate && inRange(l.closedDate, range)).length,
  };
}

// ---------------------------------------------------------------------------
// Closed loans
// ---------------------------------------------------------------------------

export type SecurityState = "released" | "pending" | "na";

export interface ClosedRow {
  loan: Loan;
  customer: Customer;
  interestCollected: number;
  principalSettled: number;
  security: SecurityState;
}

export function closedReport(s: AppState, range: DateRange): ClosedRow[] {
  const { customers, loans, paysByLoan } = ctx(s);
  return loans
    .filter((l) => l.status === "closed" && l.closedDate && inRange(l.closedDate, range))
    .map((loan) => {
      const pays = paysByLoan.get(loan.id) ?? [];
      return {
        loan,
        customer: customers.get(loan.customerId)!,
        interestCollected: pays.reduce((a, p) => a + p.interest, 0),
        principalSettled: pays.reduce((a, p) => a + p.principal, 0),
        security: !loan.security ? "na" : loan.security.status === "released" ? "released" : "pending",
      };
    });
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function overviewReport(s: AppState, today: ISODate, range: DateRange) {
  const { loans } = ctx(s);
  const loanIds = new Set(loans.map((l) => l.id));
  const pays = s.payments.filter((p) => loanIds.has(p.loanId) && inRange(p.date, range));
  const interest = interestReport(s, today, range);
  const overdue = overdueReport(s, today);
  const active = loans.filter((l) => l.status === "active");
  const newLoans = loans.filter((l) => inRange(l.startDate, range));
  return {
    moneyOutside: active.reduce((a, l) => a + l.principalLeft, 0),
    interestExpected: interest.expected,
    interestCollected: pays.reduce((a, p) => a + p.interest, 0),
    interestPending: interest.pending,
    overdueCustomers: overdue.customers,
    activeLoans: active.length,
    principalReceived: pays.reduce((a, p) => a + p.principal, 0),
    loansClosed: loans.filter((l) => l.status === "closed" && l.closedDate && inRange(l.closedDate, range)).length,
    newLoansCount: newLoans.length,
    newLoansAmount: newLoans.reduce((a, l) => a + l.amount, 0),
    backdatedCount: pays.filter((p) => p.recordedOn > p.date).length,
  };
}

/** Last 6 months of interest and principal received, by payment date. */
export function receivedTrend(s: AppState, today: ISODate) {
  const monthStart = startOfMonth(parseISO(today));
  return Array.from({ length: 6 }, (_, i) => {
    const m = subMonths(monthStart, 5 - i);
    const key = format(m, "yyyy-MM");
    const ps = s.payments.filter((p) => p.date.startsWith(key));
    return { label: format(m, "MMM"), interest: ps.reduce((a, p) => a + p.interest, 0), principal: ps.reduce((a, p) => a + p.principal, 0) };
  });
}
