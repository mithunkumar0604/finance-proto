// =============================================================================
// DEMO CALCULATION ONLY
// Replace with confirmed client business rules before production.
//
// Every money rule the prototype uses lives in this file. UI components never
// calculate interest, allocation or balances themselves; they call these
// functions. When the client's real rules are confirmed, this module (and only
// this module) is rewritten.
// =============================================================================

import { addDays, addMonths, parseISO } from "date-fns";
import { toISO } from "./format";
import type { Due, DueStatus, Frequency, InterestSetting, ISODate, Loan, LoanType, Payment, PaymentMethod } from "./types";

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/** DEMO: next collection date = previous date + one period. */
export function nextDueDate(from: ISODate, freq: Frequency): ISODate {
  const d = parseISO(from);
  switch (freq) {
    case "weekly":
      return toISO(addDays(d, 7));
    case "15days":
      return toISO(addDays(d, 15));
    case "30days":
    case "custom":
      return toISO(addDays(d, 30));
    case "monthly":
      return toISO(addMonths(d, 1));
  }
}

/** DEMO: step a date back by `n` periods (used only to build demo history). */
export function previousDueDate(from: ISODate, freq: Frequency, n = 1): ISODate {
  const d = parseISO(from);
  switch (freq) {
    case "weekly":
      return toISO(addDays(d, -7 * n));
    case "15days":
      return toISO(addDays(d, -15 * n));
    case "30days":
    case "custom":
      return toISO(addDays(d, -30 * n));
    case "monthly":
      return toISO(addMonths(d, -n));
  }
}

// ---------------------------------------------------------------------------
// Interest
// ---------------------------------------------------------------------------

/**
 * DEMO: interest for one collection period.
 * - percent + reducing  -> % of principal left
 * - percent + fixed     -> % of original amount
 * - fixed amount        -> the fixed rupee value
 * - custom / manual     -> the entered value, treated as rupees
 */
export function periodInterest(loan: Pick<Loan, "interest" | "amount" | "principalLeft">): number {
  const { style, value, method } = loan.interest;
  if (style === "percent" && method !== "manual") {
    const base = method === "fixed" ? loan.amount : loan.principalLeft;
    return Math.round((base * value) / 100);
  }
  return Math.round(value);
}

/** DEMO: build the next expected collection for a loan. */
export function buildDue(loan: Loan, dueDate: ISODate, id: string): Due {
  return {
    id,
    loanId: loan.id,
    dueDate,
    interestAmount: periodInterest(loan),
    principalAmount: Math.min(loan.principalPerDue, loan.principalLeft),
    paid: 0,
  };
}

// ---------------------------------------------------------------------------
// Due helpers
// ---------------------------------------------------------------------------

export const dueTotal = (d: Due) => d.interestAmount + d.principalAmount;
export const dueRemaining = (d: Due) => Math.max(0, dueTotal(d) - d.paid);
/** Interest already paid on a due. Older records without the split: interest counts first. */
export const dueInterestPaid = (d: Due) => d.interestPaid ?? Math.min(d.interestAmount, d.paid);
export const dueInterestLeft = (d: Due) => Math.max(0, d.interestAmount - dueInterestPaid(d));

export function dueStatus(d: Due, today: ISODate): DueStatus {
  if (dueRemaining(d) <= 0) return "paid";
  if (d.paid > 0) return "partial";
  if (d.dueDate < today) return "overdue";
  if (d.rescheduled) return "rescheduled";
  return "pending";
}

// ---------------------------------------------------------------------------
// Receiving money
// ---------------------------------------------------------------------------

export interface Allocation {
  interest: number;
  principal: number;
  other: number;
}

/** DEMO: split a received amount -> interest due first, then principal, rest as other. */
export function suggestAllocation(amount: number, loan: Loan, due: Due | undefined): Allocation {
  const amt = Math.max(0, Math.round(amount || 0));
  const interest = Math.min(amt, due ? dueInterestLeft(due) : 0);
  const principal = Math.min(amt - interest, loan.principalLeft);
  return { interest, principal, other: amt - interest - principal };
}

/** DEMO: amount needed to close the loan today = interest due + all principal left. */
export function settlementAmount(loan: Loan, due: Due | undefined): number {
  return (due ? dueInterestLeft(due) : 0) + loan.principalLeft;
}

export interface PaymentInput {
  loanId: string;
  dueId?: string;
  date: ISODate;
  /** Defaults to the payment date (i.e. entered on the day it was paid). */
  recordedOn?: ISODate;
  interest: number;
  principal: number;
  other: number;
  method: PaymentMethod;
  note?: string;
}

export interface PaymentResult {
  loan: Loan;
  dues: Due[]; // full replacement list of this loan's dues
  payment: Payment;
  closed: boolean;
  nextDue?: Due;
}

/**
 * DEMO: apply a received payment to a loan.
 * - interest + principal count towards the current due
 * - principal reduces principal left
 * - a fully paid due creates the next due (+1 period)
 * - principal reaching zero closes the loan
 */
export function applyPayment(
  loan: Loan,
  loanDues: Due[],
  input: PaymentInput,
  ids: { paymentId: string; nextDueId: string },
): PaymentResult {
  const dues = loanDues.map((d) => ({ ...d }));
  const due = dues.find((d) => d.id === input.dueId) ?? openDue(dues);

  const principalLeft = Math.max(0, loan.principalLeft - input.principal);
  const updatedLoan: Loan = { ...loan, principalLeft };

  if (due) {
    // DEMO: interest pays the due's interest; principal only counts towards the due's
    // scheduled principal part. Extra principal reduces the balance without "paying"
    // the interest that is still owed.
    const interestPaid = Math.min(due.interestAmount, dueInterestPaid(due) + input.interest);
    const principalPaid = Math.min(due.principalAmount, due.paid - dueInterestPaid(due) + input.principal);
    due.interestPaid = interestPaid;
    due.paid = interestPaid + principalPaid;
    if (input.interest + input.principal > 0) due.lastPaidDate = input.date;
  }

  const payment: Payment = {
    id: ids.paymentId,
    loanId: loan.id,
    customerId: loan.customerId,
    date: input.date,
    recordedOn: input.recordedOn ?? input.date,
    principalBefore: loan.principalLeft,
    interest: input.interest,
    principal: input.principal,
    other: input.other,
    method: input.method,
    note: input.note,
    dueId: due?.id,
  };

  if (principalLeft === 0) {
    updatedLoan.status = "closed";
    updatedLoan.closedDate = input.date;
    // Security stays HELD ("pending release") until the owner hands it back.
    for (const d of dues) if (dueRemaining(d) > 0 && d !== due) d.cancelled = true;
    if (due && dueRemaining(due) > 0) {
      due.interestPaid = due.interestAmount; // settled in full
      due.paid = dueTotal(due);
    }
    return { loan: updatedLoan, dues, payment, closed: true };
  }

  let nextDue: Due | undefined;
  if (due && dueRemaining(due) === 0 && !dues.some((d) => d !== due && !d.cancelled && dueRemaining(d) > 0)) {
    const base = due.rescheduled?.originalDate ?? due.dueDate;
    nextDue = buildDue(updatedLoan, nextDueDate(base, loan.frequency), ids.nextDueId);
    dues.push(nextDue);
  }
  return { loan: updatedLoan, dues, payment, closed: false, nextDue };
}

/** The earliest due that still has money pending. */
export function openDue(loanDues: Due[]): Due | undefined {
  return loanDues
    .filter((d) => !d.cancelled && dueRemaining(d) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
}

/** Principal part of a due that has not been paid yet. */
const duePrincipalLeft = (d: Due) => Math.max(0, d.principalAmount - (d.paid - dueInterestPaid(d)));

/**
 * DEMO: expected future collections for a running loan, after its current open due.
 * Walks the schedule one period at a time: interest by the loan's setting on the balance
 * at that point, principal by "principal with each collection". It stops at `until`, after
 * `limit` rows, or when the principal reaches zero (an instalment loan ends; an
 * interest-only loan has no end). These are ESTIMATES: they change if the customer
 * returns principal early or closes the loan.
 */
export function projectDues(loan: Loan, loanDues: Due[], until: ISODate, limit = 400): Due[] {
  if (loan.status !== "active") return [];
  const open = openDue(loanDues);
  if (!open) return [];
  const out: Due[] = [];
  let principal = loan.principalLeft - duePrincipalLeft(open);
  let date = nextDueDate(open.rescheduled?.originalDate ?? open.dueDate, loan.frequency);
  for (let i = 0; date <= until && i < limit && principal > 0; i++) {
    const due = buildDue({ ...loan, principalLeft: principal }, date, `expected-${loan.id}-${i}`);
    out.push(due);
    principal -= due.principalAmount;
    date = nextDueDate(date, loan.frequency);
  }
  return out;
}

export interface ScheduleRow {
  date: ISODate;
  interest: number;
  principal: number;
  /** Principal left once this collection is paid. */
  balanceAfter: number;
}

export interface LoanSchedule {
  rows: ScheduleRow[];
  /** true when the customer pays interest only, so the loan has no end date. */
  interestOnly: boolean;
  /** Date of the last collection, for loans that repay principal with each collection. */
  endsOn?: ISODate;
  totalToCollect: number;
  totalInterest: number;
}

/**
 * DEMO: what is still to come on a loan. Instalment loans list every collection up to the
 * last one; interest-only loans list the next few interest dates.
 */
export function loanSchedule(loan: Loan, loanDues: Due[], interestOnlyRows = 3): LoanSchedule | null {
  const open = loan.status === "active" ? openDue(loanDues) : undefined;
  if (!open) return null;
  const interestOnly = loan.principalPerDue <= 0;
  const FAR = "9999-12-31";
  const future = projectDues(loan, loanDues, FAR, interestOnly ? interestOnlyRows - 1 : 600);
  let balance = loan.principalLeft;
  const rows: ScheduleRow[] = [
    { date: open.dueDate, interest: dueInterestLeft(open), principal: duePrincipalLeft(open), balanceAfter: (balance -= duePrincipalLeft(open)) },
    ...future.map((d) => ({ date: d.dueDate, interest: d.interestAmount, principal: d.principalAmount, balanceAfter: (balance -= d.principalAmount) })),
  ];
  const finished = !interestOnly && rows[rows.length - 1].balanceAfter <= 0;
  return {
    rows,
    interestOnly,
    endsOn: finished ? rows[rows.length - 1].date : undefined,
    totalToCollect: rows.reduce((a, r) => a + r.interest + r.principal, 0),
    totalInterest: rows.reduce((a, r) => a + r.interest, 0),
  };
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

export const paymentTotal = (p: Pick<Payment, "interest" | "principal" | "other">) => p.interest + p.principal + p.other;

/** DEMO: sensible starting values when a loan type is picked in the New Loan wizard. */
export function demoLoanDefaults(type: LoanType, amount: number): {
  frequency: Frequency;
  interest: InterestSetting;
  principalPerDue: number;
} {
  switch (type) {
    case "weekly":
      return { frequency: "weekly", interest: { style: "fixed", value: Math.round(amount * 0.025), method: "fixed" }, principalPerDue: 0 };
    case "15day":
      return { frequency: "15days", interest: { style: "percent", value: 2, method: "fixed" }, principalPerDue: 0 };
    case "30day":
      return { frequency: "30days", interest: { style: "percent", value: 5, method: "fixed" }, principalPerDue: 0 };
    case "vehicle":
      return { frequency: "monthly", interest: { style: "percent", value: 2, method: "reducing" }, principalPerDue: 0 };
    case "jewel":
      return { frequency: "monthly", interest: { style: "percent", value: 2, method: "reducing" }, principalPerDue: 0 };
    case "custom":
      return { frequency: "custom", interest: { style: "custom", value: 0, method: "manual" }, principalPerDue: 0 };
    case "monthly":
      return { frequency: "monthly", interest: { style: "percent", value: 3, method: "reducing" }, principalPerDue: 0 };
  }
}

/** DEMO: first collection preview shown in the New Loan review step. */
export function previewFirstCollection(
  loan: Pick<Loan, "interest" | "amount" | "principalLeft" | "principalPerDue" | "frequency" | "startDate">,
) {
  const interest = periodInterest(loan);
  const principal = Math.min(loan.principalPerDue, loan.principalLeft);
  return { date: nextDueDate(loan.startDate, loan.frequency), interest, principal, total: interest + principal };
}
