// Read-only views derived from the store. Screens use these instead of
// filtering raw arrays themselves.

import { dueRemaining, dueStatus, dueTotal, openDue, paymentTotal } from "./finance/engine";
import { daysBetween, shiftISO } from "./format";
import type { AppState } from "./store";
import type { Customer, Due, DueStatus, ISODate, Loan, LoanType, Role } from "./types";

export interface RegisterRow {
  due: Due;
  loan: Loan;
  customer: Customer;
  status: DueStatus;
  total: number;
  remaining: number;
  daysLate: number;
}

// ---------------------------------------------------------------------------
// Permissions (concept only)
// ---------------------------------------------------------------------------

export interface Permissions {
  role: Role["id"];
  seeTotals: boolean;
  seeReports: boolean;
  receive: boolean;
  createLoan: boolean;
  addCustomer: boolean;
  /** Collector sees only their assigned customers. */
  customerScope: (c: Customer) => boolean;
}

export const COLLECTOR_ID = "U2";

export function permissions(s: AppState): Permissions {
  const role = s.session.viewAs;
  if (role === "collector")
    return { role, seeTotals: false, seeReports: false, receive: true, createLoan: false, addCustomer: false, customerScope: (c) => c.collectorId === COLLECTOR_ID };
  if (role === "staff")
    return { role, seeTotals: false, seeReports: false, receive: false, createLoan: false, addCustomer: true, customerScope: () => true };
  return { role, seeTotals: true, seeReports: true, receive: true, createLoan: true, addCustomer: true, customerScope: () => true };
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export function indexes(s: AppState) {
  return {
    customer: new Map(s.customers.map((c) => [c.id, c])),
    loan: new Map(s.loans.map((l) => [l.id, l])),
  };
}

function toRow(s: AppState, d: Due, today: ISODate, idx = indexes(s)): RegisterRow | null {
  const loan = idx.loan.get(d.loanId);
  const customer = loan && idx.customer.get(loan.customerId);
  if (!loan || !customer) return null;
  return {
    due: d,
    loan,
    customer,
    status: dueStatus(d, today),
    total: dueTotal(d),
    remaining: dueRemaining(d),
    daysLate: Math.max(0, daysBetween(d.dueDate, today)),
  };
}

function rows(s: AppState, today: ISODate, pred: (d: Due) => boolean): RegisterRow[] {
  const idx = indexes(s);
  const scope = permissions(s).customerScope;
  return s.dues
    .filter((d) => !d.cancelled && pred(d))
    .map((d) => toRow(s, d, today, idx))
    .filter((r): r is RegisterRow => !!r && scope(r.customer));
}

const STATUS_ORDER: Record<DueStatus, number> = { overdue: 0, partial: 1, pending: 2, rescheduled: 3, paid: 4 };
const byStatusThenAmount = (a: RegisterRow, b: RegisterRow) =>
  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.remaining - a.remaining;

// ---------------------------------------------------------------------------
// Collection register
// ---------------------------------------------------------------------------

/** Everything expected today, including ones already paid or moved away from today. */
export function todayRows(s: AppState, today: ISODate) {
  return rows(s, today, (d) => d.dueDate === today || d.rescheduled?.originalDate === today).sort(byStatusThenAmount);
}

export function overdueRows(s: AppState, today: ISODate) {
  return rows(s, today, (d) => d.dueDate < today && dueRemaining(d) > 0).sort((a, b) => b.daysLate - a.daysLate);
}

export function tomorrowRows(s: AppState, today: ISODate) {
  const t = shiftISO(today, 1);
  return rows(s, today, (d) => d.dueDate === t).sort(byStatusThenAmount);
}

export function upcomingRows(s: AppState, today: ISODate, days = 30) {
  const from = shiftISO(today, 1);
  const to = shiftISO(today, days);
  return rows(s, today, (d) => d.dueDate > from && d.dueDate <= to && dueRemaining(d) > 0).sort((a, b) =>
    a.due.dueDate.localeCompare(b.due.dueDate),
  );
}

/** Home screen "to collect" list: today's unpaid first, then overdue (least late first). */
export function toCollectRows(s: AppState, today: ISODate) {
  const t = todayRows(s, today).filter((r) => r.remaining > 0 && r.due.dueDate === today);
  const o = overdueRows(s, today).sort((a, b) => a.daysLate - b.daysLate);
  return [...t, ...o];
}

export function todaySummary(s: AppState, today: ISODate) {
  const list = todayRows(s, today).filter((r) => r.due.dueDate === today);
  const expected = list.reduce((a, r) => a + r.total, 0);
  const pending = list.reduce((a, r) => a + r.remaining, 0);
  const scope = permissions(s).customerScope;
  const idx = indexes(s);
  const paidToday = s.payments.filter((p) => {
    const c = idx.customer.get(p.customerId);
    return p.date === today && !!c && scope(c);
  });
  const collected = paidToday.reduce((a, p) => a + paymentTotal(p), 0);
  return {
    expected,
    pending,
    dueReceived: expected - pending,
    collected,
    /** cash received today on top of today's dues (overdue, advance or principal payments) */
    extra: Math.max(0, collected - (expected - pending)),
    paymentsCount: paidToday.length,
    dueCount: list.filter((r) => r.remaining > 0 && r.status !== "rescheduled").length,
  };
}

export function moneyOutside(s: AppState) {
  const scope = permissions(s).customerScope;
  const idx = indexes(s);
  return s.loans
    .filter((l) => {
      const c = idx.customer.get(l.customerId);
      return l.status === "active" && !!c && scope(c);
    })
    .reduce((a, l) => a + l.principalLeft, 0);
}

// ---------------------------------------------------------------------------
// Customers & loans
// ---------------------------------------------------------------------------

export type LoanHealth = "overdue" | "due" | "active" | "closed";

export function loanView(s: AppState, loan: Loan, today: ISODate) {
  const dues = s.dues.filter((d) => d.loanId === loan.id && !d.cancelled);
  const next = openDue(dues);
  const payments = s.payments.filter((p) => p.loanId === loan.id).sort((a, b) => a.date.localeCompare(b.date));
  const collected = payments.reduce((a, p) => a + paymentTotal(p), 0);
  const interestCollected = payments.reduce((a, p) => a + p.interest, 0);
  const principalCollected = payments.reduce((a, p) => a + p.principal, 0);
  const currentDue = dues.filter((d) => d.dueDate <= today).reduce((a, d) => a + dueRemaining(d), 0);
  let health: LoanHealth = "active";
  if (loan.status === "closed") health = "closed";
  else if (next && next.dueDate < today) health = "overdue";
  else if (next && next.dueDate === today) health = "due";
  return {
    next,
    nextStatus: next ? dueStatus(next, today) : undefined,
    payments,
    collected,
    interestCollected,
    principalCollected,
    currentDue,
    health,
    daysLate: next ? Math.max(0, daysBetween(next.dueDate, today)) : 0,
  };
}

export function customerView(s: AppState, c: Customer, today: ISODate) {
  const loans = s.loans.filter((l) => l.customerId === c.id);
  const views = loans.map((l) => ({ loan: l, ...loanView(s, l, today) }));
  const active = views.filter((v) => v.loan.status === "active");
  const nexts = active
    .filter((v) => v.next)
    .sort((a, b) => a.next!.dueDate.localeCompare(b.next!.dueDate));
  const worst: LoanHealth | "new" = loans.length === 0
    ? "new"
    : active.some((v) => v.health === "overdue")
      ? "overdue"
    : active.some((v) => v.health === "due")
      ? "due"
      : active.length
        ? "active"
        : "closed";
  return {
    loans: views,
    activeCount: active.length,
    totalGiven: loans.reduce((a, l) => a + l.amount, 0),
    principalLeft: active.reduce((a, v) => a + v.loan.principalLeft, 0),
    currentDue: active.reduce((a, v) => a + v.currentDue, 0),
    collected: views.reduce((a, v) => a + v.collected, 0),
    next: nexts[0],
    worst,
    maxDaysLate: Math.max(0, ...active.map((v) => v.daysLate)),
    securities: loans.filter((l) => l.security).map((l) => ({ loan: l, security: l.security! })),
  };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface SearchHit {
  kind: "customer" | "loan";
  customer: Customer;
  loan?: Loan;
  match: string;
}

const norm = (v: string) => v.toLowerCase().replace(/[\s-]/g, "");

export function search(s: AppState, q: string): SearchHit[] {
  const n = norm(q);
  if (n.length < 2) return [];
  const idx = indexes(s);
  const scope = permissions(s).customerScope;
  const hits: SearchHit[] = [];
  for (const c of s.customers) {
    if (!scope(c)) continue;
    if (norm(c.name).includes(n)) hits.push({ kind: "customer", customer: c, match: c.area });
    else if (norm(c.phone).includes(n) || (c.altPhone && norm(c.altPhone).includes(n)))
      hits.push({ kind: "customer", customer: c, match: "Phone" });
    else if (norm(c.area).includes(n)) hits.push({ kind: "customer", customer: c, match: c.area });
  }
  for (const l of s.loans) {
    const c = idx.customer.get(l.customerId);
    if (!c || !scope(c)) continue;
    const sec = l.security;
    if (norm(l.id).includes(n)) hits.push({ kind: "loan", customer: c, loan: l, match: l.id });
    else if (sec?.kind === "vehicle" && norm(sec.registration).includes(n))
      hits.push({ kind: "loan", customer: c, loan: l, match: sec.registration });
    else if (sec?.kind === "jewel" && (norm(sec.description).includes(n) || norm(sec.packetNo).includes(n)))
      hits.push({ kind: "loan", customer: c, loan: l, match: sec.description });
    else if (sec?.kind === "document" && norm(sec.referenceNo).includes(n))
      hits.push({ kind: "loan", customer: c, loan: l, match: sec.referenceNo });
  }
  return hits.slice(0, 20);
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const TYPE_GROUPS: { key: string; label: string; types: LoanType[] }[] = [
  { key: "weekly", label: "Weekly", types: ["weekly"] },
  { key: "monthly", label: "Monthly", types: ["monthly", "custom"] },
  { key: "short", label: "Short Term", types: ["15day", "30day"] },
  { key: "vehicle", label: "Vehicle", types: ["vehicle"] },
  { key: "jewel", label: "Jewel", types: ["jewel"] },
];
