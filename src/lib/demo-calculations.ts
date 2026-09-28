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
/** DEMO: part payments are applied to interest first. */
export const dueInterestLeft = (d: Due) => Math.max(0, d.interestAmount - d.paid);

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
    due.paid = Math.min(dueTotal(due), due.paid + input.interest + input.principal);
    due.lastPaidDate = input.date;
  }

  const payment: Payment = {
    id: ids.paymentId,
    loanId: loan.id,
    customerId: loan.customerId,
    date: input.date,
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
    if (updatedLoan.security) updatedLoan.security = { ...updatedLoan.security, status: "released" };
    for (const d of dues) if (dueRemaining(d) > 0 && d !== due) d.cancelled = true;
    if (due && dueRemaining(due) > 0) due.paid = dueTotal(due); // settled in full
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
      return { frequency: "weekly", interest: { style: "fixed", value: Math.round(amount * 0.02), method: "fixed" }, principalPerDue: Math.round(amount / 10) };
    case "15day":
      return { frequency: "15days", interest: { style: "percent", value: 2, method: "fixed" }, principalPerDue: 0 };
    case "30day":
      return { frequency: "30days", interest: { style: "percent", value: 5, method: "fixed" }, principalPerDue: 0 };
    case "vehicle":
      return { frequency: "monthly", interest: { style: "percent", value: 2, method: "reducing" }, principalPerDue: Math.round(amount / 20 / 500) * 500 };
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
