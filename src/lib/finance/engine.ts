// =============================================================================
// Money rules. Every calculation the app makes lives in this folder; screens and
// the database layer call these functions and never do arithmetic themselves.
// All amounts are whole paise (see money.ts).
//
// The rules marked ASSUMPTION carry over from the approved prototype and are not
// yet confirmed by the client. docs/BUSINESS-RULES.md lists them. Change a rule
// here, with its test in engine.test.ts, and nowhere else.
// =============================================================================

import { addDays, addMonths, parseISO } from "date-fns";
import { toISO } from "../format";
import type { Due, DueStatus, Frequency, InterestSetting, ISODate, Loan, LoanType, Payment, PaymentMethod } from "../types";
import { isPaise, percentOf, type Paise } from "./money";

export type FinanceErrorCode =
  | "LOAN_MISMATCH"
  | "DUE_MISMATCH"
  | "LOAN_CLOSED"
  | "INVALID_AMOUNT"
  | "ZERO_AMOUNT"
  | "FUTURE_DATE"
  | "BEFORE_LOAN_START"
  | "PRINCIPAL_TOO_LARGE"
  | "INTEREST_TOO_LARGE"
  | "BEFORE_LAST_PAYMENT"
  | "INVALID_TERMS";

/** A payment that must not be recorded. `message` is safe to show to the user. */
export class FinanceError extends Error {
  constructor(
    public code: FinanceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FinanceError";
  }
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

const PERIOD_DAYS: Record<Exclude<Frequency, "monthly">, number> = { weekly: 7, "15days": 15, "30days": 30, custom: 30 };

/**
 * ASSUMPTION: next collection date = previous date + one period ("custom" = 30 days).
 *
 * Monthly loans keep to the day of the month the loan was given (`anchor`): a loan given
 * on the 31st falls due on 28 Feb, then 31 Mar, 30 Apr... Without the anchor the date
 * would slip to the 28th after February and stay there.
 */
export function nextDueDate(from: ISODate, freq: Frequency, periods = 1, anchor?: ISODate): ISODate {
  const d = parseISO(from);
  if (freq !== "monthly") return toISO(addDays(d, PERIOD_DAYS[freq] * periods));
  if (!anchor || anchor > from) return toISO(addMonths(d, periods));
  const start = parseISO(anchor);
  let n = 1;
  while (n < 2400 && toISO(addMonths(start, n)) <= from) n++;
  return toISO(addMonths(start, n + periods - 1));
}

/** Step a date back by `n` periods (used only to build demo history). */
export const previousDueDate = (from: ISODate, freq: Frequency, n = 1): ISODate => nextDueDate(from, freq, -n);

// ---------------------------------------------------------------------------
// Interest
// ---------------------------------------------------------------------------

/**
 * ASSUMPTION: interest for one collection period.
 * - percent, on balance -> % of principal left
 * - percent, flat       -> % of the original loan amount
 * - fixed amount        -> that amount
 * - custom / manual     -> the entered amount
 */
export function periodInterest(loan: Pick<Loan, "interest" | "amount" | "principalLeft">): Paise {
  const { style, value, method } = loan.interest;
  if (style !== "percent") {
    if (!isPaise(value)) throw new FinanceError("INVALID_TERMS", "The interest amount on this loan is not valid.");
    return value;
  }
  if (!Number.isFinite(value) || value < 0 || value > 100) throw new FinanceError("INVALID_TERMS", "The interest percentage on this loan is not valid.");
  // "manual" with a percentage is treated as "on balance": a starting figure the user can see.
  const base = method === "fixed" ? loan.amount : loan.principalLeft;
  const interest = percentOf(base, value);
  // ASSUMPTION: while principal is owed, interest never rounds down to nothing (at least 1 rupee).
  return interest === 0 && base > 0 && value > 0 ? 100 : interest;
}

/** The next expected collection for a loan. */
export function buildDue(loan: Loan, dueDate: ISODate, id: string): Due {
  const interestAmount = periodInterest(loan);
  if (!isPaise(loan.principalPerDue)) throw new FinanceError("INVALID_TERMS", "The principal per collection on this loan is not valid.");
  const principalAmount = Math.min(loan.principalPerDue, loan.principalLeft);
  // A collection of nothing would leave a running loan with nothing to collect, for ever.
  if (interestAmount + principalAmount === 0) throw new FinanceError("INVALID_TERMS", "Set an interest amount or a principal amount for each collection.");
  return { id, loanId: loan.id, dueDate, interestAmount, principalAmount, paid: 0, interestPaid: 0 };
}

// ---------------------------------------------------------------------------
// Due helpers
// ---------------------------------------------------------------------------

export const dueTotal = (d: Due) => d.interestAmount + d.principalAmount;
/** Still to pay on a collection. Amounts written off when a loan was settled do not count. */
export const dueRemaining = (d: Due) => Math.max(0, dueTotal(d) - d.paid - (d.waived ?? 0));
/** Interest already paid on a due. Older records without the split: interest counts first. */
export const dueInterestPaid = (d: Due) => d.interestPaid ?? Math.min(d.interestAmount, d.paid);
export const dueInterestLeft = (d: Due) => (dueRemaining(d) === 0 ? 0 : Math.max(0, d.interestAmount - dueInterestPaid(d)));
const duePrincipalPaid = (d: Due) => d.paid - dueInterestPaid(d);
/** Principal part of a due that has not been paid yet. */
const duePrincipalLeft = (d: Due) => (dueRemaining(d) === 0 ? 0 : Math.max(0, d.principalAmount - duePrincipalPaid(d)));

export function dueStatus(d: Due, today: ISODate): DueStatus {
  if (dueRemaining(d) <= 0) return "paid";
  if (d.paid > 0) return "partial";
  if (d.dueDate < today) return "overdue";
  if (d.rescheduled) return "rescheduled";
  return "pending";
}

/** The earliest due that still has money pending. */
export function openDue(loanDues: Due[]): Due | undefined {
  return loanDues
    .filter((d) => !d.cancelled && dueRemaining(d) > 0)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
}

// ---------------------------------------------------------------------------
// Receiving money
// ---------------------------------------------------------------------------

export interface Allocation {
  interest: Paise;
  principal: Paise;
  other: Paise;
}

/** ASSUMPTION: split a received amount -> interest due first, then principal, rest as other. */
export function suggestAllocation(amount: Paise, loan: Loan, due: Due | undefined): Allocation {
  const amt = isPaise(amount) ? amount : 0;
  const interest = Math.min(amt, due ? dueInterestLeft(due) : 0);
  const principal = Math.min(amt - interest, loan.principalLeft);
  return { interest, principal, other: amt - interest - principal };
}

/** ASSUMPTION: amount needed to close the loan today = interest due + all principal left. */
export function settlementAmount(loan: Loan, due: Due | undefined): Paise {
  return (due ? dueInterestLeft(due) : 0) + loan.principalLeft;
}

export interface PaymentInput {
  loanId: string;
  dueId?: string;
  /** When the customer actually paid. */
  date: ISODate;
  /** When it was entered. Defaults to today. */
  recordedOn?: ISODate;
  interest: Paise;
  principal: Paise;
  other: Paise;
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
 * Apply a received payment to a loan. Pure: returns new objects, changes nothing passed in.
 * Throws FinanceError when the payment must not be recorded.
 *
 * - interest pays the interest of the current collection
 * - principal reduces the principal left (and the collection's principal part, if it has one)
 * - a fully paid collection opens the next one (+1 period)
 * - principal reaching zero closes the loan; interest left unpaid at that point is written
 *   off against the collection (`waived`), never counted as received
 */
export function applyPayment(
  loan: Loan,
  loanDues: Due[],
  input: PaymentInput,
  ids: { paymentId: string; nextDueId: string },
  today: ISODate,
): PaymentResult {
  if (input.loanId !== loan.id) throw new FinanceError("LOAN_MISMATCH", "This payment is for a different loan.");
  if (loanDues.some((d) => d.loanId !== loan.id)) throw new FinanceError("DUE_MISMATCH", "This collection belongs to a different loan.");
  if (loan.status !== "active") throw new FinanceError("LOAN_CLOSED", "This loan is closed. No more payments can be added.");
  if (![input.interest, input.principal, input.other].every(isPaise)) throw new FinanceError("INVALID_AMOUNT", "Enter a valid amount.");
  if (input.interest + input.principal + input.other === 0) throw new FinanceError("ZERO_AMOUNT", "Enter the amount received.");
  if (input.date > today) throw new FinanceError("FUTURE_DATE", "The payment date cannot be in the future.");
  if (input.date < loan.startDate) throw new FinanceError("BEFORE_LOAN_START", "The payment date is before the loan was given.");
  if (input.principal > loan.principalLeft) throw new FinanceError("PRINCIPAL_TOO_LARGE", "This is more than the principal left on the loan.");

  const dues = loanDues.map((d) => ({ ...d }));
  // The collection asked for, if it still has money pending; otherwise the earliest open one.
  const due = dues.find((d) => d.id === input.dueId && !d.cancelled && dueRemaining(d) > 0) ?? openDue(dues);
  if (input.interest > (due ? dueInterestLeft(due) : 0))
    throw new FinanceError("INTEREST_TOO_LARGE", "This is more than the interest due. Put the extra under Other.");

  const principalLeft = loan.principalLeft - input.principal;
  const lastPaid = dues.reduce((a, d) => (d.lastPaidDate && d.lastPaidDate > a ? d.lastPaidDate : a), "");
  if (principalLeft === 0 && input.date < lastPaid)
    throw new FinanceError("BEFORE_LAST_PAYMENT", "The loan cannot be closed on a date before its latest payment.");
  const updatedLoan: Loan = { ...loan, principalLeft };

  if (due) {
    // Principal only counts towards the collection's own principal part. Extra principal
    // reduces the balance without "paying" interest that is still owed.
    const interestPaid = dueInterestPaid(due) + input.interest;
    const paidBefore = due.paid;
    const principalPaid = Math.min(due.principalAmount, duePrincipalPaid(due) + input.principal);
    due.interestPaid = interestPaid;
    due.paid = interestPaid + principalPaid;
    // only when this collection itself received money; a backdated entry never moves the date backwards
    if (due.paid > paidBefore && input.date > (due.lastPaidDate ?? "")) due.lastPaidDate = input.date;
  }

  const payment: Payment = {
    id: ids.paymentId,
    loanId: loan.id,
    customerId: loan.customerId,
    date: input.date,
    recordedOn: input.recordedOn ?? today,
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
    for (const d of dues) {
      if (dueRemaining(d) === 0) continue;
      if (d === due) d.waived = (d.waived ?? 0) + dueRemaining(d);
      else d.cancelled = true;
    }
    return { loan: updatedLoan, dues, payment, closed: true };
  }

  let nextDue: Due | undefined;
  if (due && dueRemaining(due) === 0 && !dues.some((d) => d !== due && !d.cancelled && dueRemaining(d) > 0)) {
    const base = due.rescheduled?.originalDate ?? due.dueDate;
    nextDue = buildDue(updatedLoan, nextDueDate(base, loan.frequency, 1, loan.startDate), ids.nextDueId);
    dues.push(nextDue);
  }
  return { loan: updatedLoan, dues, payment, closed: false, nextDue };
}

// ---------------------------------------------------------------------------
// What is still to come
// ---------------------------------------------------------------------------

/**
 * Expected future collections for a running loan, after its current open due.
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
  let date = nextDueDate(open.rescheduled?.originalDate ?? open.dueDate, loan.frequency, 1, loan.startDate);
  for (let i = 0; date <= until && i < limit && principal > 0; i++) {
    const due = buildDue({ ...loan, principalLeft: principal }, date, `expected-${loan.id}-${i}`);
    out.push(due);
    principal -= due.principalAmount;
    date = nextDueDate(date, loan.frequency, 1, loan.startDate);
  }
  return out;
}

export interface ScheduleRow {
  date: ISODate;
  interest: Paise;
  principal: Paise;
  /** Principal left once this collection is paid. */
  balanceAfter: Paise;
}

export interface LoanSchedule {
  rows: ScheduleRow[];
  /** true when the customer pays interest only, so the loan has no end date. */
  interestOnly: boolean;
  /** Date of the last collection, for loans that repay principal with each collection. */
  endsOn?: ISODate;
  totalToCollect: Paise;
  totalInterest: Paise;
}

/**
 * What is still to come on a loan. Instalment loans list every collection up to the
 * last one; interest-only loans list the next few interest dates.
 */
export function loanSchedule(loan: Loan, loanDues: Due[], interestOnlyRows = 3): LoanSchedule | null {
  const open = loan.status === "active" ? openDue(loanDues) : undefined;
  if (!open) return null;
  const interestOnly = loan.principalPerDue <= 0;
  const FAR = "9999-12-31";
  // An instalment loan is listed to its end, however many collections that is.
  const future = projectDues(loan, loanDues, FAR, interestOnly ? interestOnlyRows - 1 : Math.ceil(loan.principalLeft / loan.principalPerDue) + 1);
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
// Totals and defaults
// ---------------------------------------------------------------------------

export const paymentTotal = (p: Pick<Payment, "interest" | "principal" | "other">) => p.interest + p.principal + p.other;

/** Starting values when a loan type is picked in the New Loan wizard. The user can change them. */
export function loanDefaults(type: LoanType, amount: Paise): {
  frequency: Frequency;
  interest: InterestSetting;
  principalPerDue: Paise;
} {
  switch (type) {
    case "weekly":
      return { frequency: "weekly", interest: { style: "fixed", value: percentOf(amount, 2.5), method: "fixed" }, principalPerDue: 0 };
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

/** First collection preview shown in the New Loan review step. */
export function previewFirstCollection(
  loan: Pick<Loan, "interest" | "amount" | "principalLeft" | "principalPerDue" | "frequency" | "startDate">,
) {
  const interest = periodInterest(loan);
  const principal = Math.min(loan.principalPerDue, loan.principalLeft);
  return { date: nextDueDate(loan.startDate, loan.frequency, 1, loan.startDate), interest, principal, total: interest + principal };
}
