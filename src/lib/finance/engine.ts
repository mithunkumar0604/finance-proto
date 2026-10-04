// =============================================================================
// Money rules. Every calculation the app makes lives in this folder; screens and
// the database layer call these functions and never do arithmetic themselves.
// All amounts are whole paise (see money.ts).
//
// docs/BUSINESS-RULES.md lists which rules the client has confirmed and which are
// still ASSUMPTIONs carried over from the approved prototype. Change a rule here,
// with its test beside it. Three rules are mirrored in the database (see that file).
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
  | "INVALID_TERMS"
  | "ALLOCATION_MISMATCH"
  | "WAIVE_REASON_NEEDED"
  | "WAIVE_TOO_LARGE";

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
/** Interest already paid on a due. Older records without the split: interest counts first. */
export const dueInterestPaid = (d: Due) => d.interestPaid ?? Math.min(d.interestAmount, d.paid);
/** Interest still to pay on a collection. What the owner waived is not pending (and is never "paid"). */
export const dueInterestLeft = (d: Due) => Math.max(0, d.interestAmount - dueInterestPaid(d) - (d.waived ?? 0));
const duePrincipalPaid = (d: Due) => d.paid - dueInterestPaid(d);
/** Principal part of a due that has not been paid yet. */
const duePrincipalLeft = (d: Due) => Math.max(0, d.principalAmount - duePrincipalPaid(d));
/** Still to pay on a collection: its interest and its principal part. */
export const dueRemaining = (d: Due) => dueInterestLeft(d) + duePrincipalLeft(d);

export function dueStatus(d: Due, today: ISODate): DueStatus {
  if (dueRemaining(d) <= 0) return "paid";
  if (d.paid > 0) return "partial";
  if (d.dueDate < today) return "overdue";
  if (d.rescheduled) return "rescheduled";
  return "pending";
}

/** The day a collection belongs to in the loan's calendar (moving its date does not move this). */
const periodDate = (d: Due) => d.rescheduled?.originalDate ?? d.dueDate;
const oldestFirst = (a: Due, b: Due) => periodDate(a).localeCompare(periodDate(b)) || a.dueDate.localeCompare(b.dueDate);

/** The day a collection's period began: the period date of the one before it, or the day the loan was given. */
function periodStart(d: Due, loanDues: Due[], loan: Pick<Loan, "startDate">): ISODate {
  const me = periodDate(d);
  return loanDues.reduce((a, x) => (periodDate(x) < me && periodDate(x) > a ? periodDate(x) : a), loan.startDate);
}

/** Every collection that still has money pending, oldest first. */
export function openDues(loanDues: Due[]): Due[] {
  return loanDues.filter((d) => !d.cancelled && dueRemaining(d) > 0).sort(oldestFirst);
}

/** The earliest due that still has money pending. */
export function openDue(loanDues: Due[]): Due | undefined {
  return openDues(loanDues)[0];
}

/** Interest that has fallen due and is unpaid: every missed period, each still on its own. */
export function pendingInterest(loanDues: Due[], today: ISODate): Paise {
  return openDues(loanDues).reduce((a, d) => (d.dueDate <= today ? a + dueInterestLeft(d) : a), 0);
}

/** All interest on open collections, including the one that is coming. */
export const openInterest = (loanDues: Due[]): Paise => openDues(loanDues).reduce((a, d) => a + dueInterestLeft(d), 0);

// ---------------------------------------------------------------------------
// Collections fall due by the calendar
// ---------------------------------------------------------------------------

/**
 * CONFIRMED BY THE CLIENT: interest falls due every period, whether or not the last
 * period was paid. A customer who misses July, August and September owes all three,
 * each as its own collection.
 *
 * This brings a loan's collections up to date: one for every period that has passed
 * since the last one, plus the one now running. If everything is paid ahead, the
 * next one is opened. It only ever adds; it never changes or removes a collection.
 * Interest for a new period is worked out on the principal owed when it is added.
 * Once the principal is fully returned no more interest is added.
 *
 * The database does the same in `accrue_dues` (a test checks they agree).
 */
export function accrueDues(loan: Loan, loanDues: Due[], today: ISODate, newId: (n: number) => string): Due[] {
  const dues = [...loanDues];
  if (loan.status !== "active" || loan.principalLeft <= 0) return dues;
  for (let n = 0; n < 600; n++) {
    const last = dues.reduce((a, d) => (periodDate(d) > a ? periodDate(d) : a), "");
    const open = openDues(dues);
    // the collection for a period appears once that period has started (the day after the last one)
    if (last && last >= today && open.length > 0) break;
    const interestAmount = periodInterest(loan);
    // never schedule more principal than is owed and not already asked for
    const unscheduled = Math.max(0, loan.principalLeft - open.reduce((a, d) => a + duePrincipalLeft(d), 0));
    const principalAmount = Math.min(loan.principalPerDue, unscheduled);
    if (interestAmount + principalAmount === 0) break;
    dues.push({
      id: newId(dues.length + 1),
      loanId: loan.id,
      dueDate: nextDueDate(last || loan.startDate, loan.frequency, 1, loan.startDate),
      interestAmount,
      principalAmount,
      paid: 0,
      interestPaid: 0,
    });
  }
  return dues;
}

// ---------------------------------------------------------------------------
// Receiving money
// ---------------------------------------------------------------------------

export interface Allocation {
  interest: Paise;
  principal: Paise;
  other: Paise;
}

/** An amount of interest against one collection (to pay it, or to waive it). */
export interface InterestPick {
  dueId: string;
  amount: Paise;
}

/**
 * Spread an amount of interest over the pending collections, always the same way:
 * the chosen collections first (oldest first), then any others (oldest first).
 * Whatever does not fit is left out; the caller decides what to do with it.
 */
export function allocateInterest(loanDues: Due[], amount: Paise, chosen: string[] = []): InterestPick[] {
  const open = openDues(loanDues).filter((d) => dueInterestLeft(d) > 0);
  const order = [...open.filter((d) => chosen.includes(d.id)), ...open.filter((d) => !chosen.includes(d.id))];
  const picks: InterestPick[] = [];
  let rest = isPaise(amount) ? amount : 0;
  for (const d of order) {
    if (rest <= 0) break;
    const take = Math.min(rest, dueInterestLeft(d));
    picks.push({ dueId: d.id, amount: take });
    rest -= take;
  }
  return picks;
}

/**
 * Split a received amount: interest first (the chosen collections, or everything
 * pending when none are chosen), then principal, anything over as other.
 */
export function suggestAllocation(amount: Paise, loan: Loan, loanDues: Due[], chosen?: string[]): Allocation {
  const amt = isPaise(amount) ? amount : 0;
  const open = openDues(loanDues);
  const pool = chosen ? open.filter((d) => chosen.includes(d.id)) : open;
  const interest = Math.min(amt, pool.reduce((a, d) => a + dueInterestLeft(d), 0));
  const principal = Math.min(amt - interest, loan.principalLeft);
  return { interest, principal, other: amt - interest - principal };
}

/** Amount to settle a loan in full: all interest on open collections + all principal left. */
export function settlementAmount(loan: Loan, loanDues: Due[]): Paise {
  return openInterest(loanDues) + loan.principalLeft;
}

export interface PaymentInput {
  loanId: string;
  /** The collection the screen was opened for. Used only when `allocations` is not given. */
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
  /** Which collections the interest is for. Must add up to `interest`. Left out = oldest first. */
  allocations?: InterestPick[];
  /** Interest the owner writes off with this payment. Needs `waiveReason`. */
  waive?: InterestPick[];
  waiveReason?: string;
}

export interface PaymentResult {
  loan: Loan;
  dues: Due[]; // full replacement list of this loan's dues
  payment: Payment;
  closed: boolean;
  /** The collection now waiting to be paid (the oldest open one). */
  nextDue?: Due;
  /** Interest written off with this payment. */
  waived: Paise;
}

function applyWaive(dues: Due[], waive: InterestPick[] | undefined, reason: string | undefined): Map<string, Paise> {
  const done = new Map<string, Paise>();
  if (!waive?.length) return done;
  if (!reason?.trim()) throw new FinanceError("WAIVE_REASON_NEEDED", "Say why this interest is being waived.");
  for (const w of waive) {
    const d = dues.find((x) => x.id === w.dueId && !x.cancelled);
    if (!d) throw new FinanceError("DUE_MISMATCH", "This collection belongs to a different loan.");
    if (!isPaise(w.amount) || w.amount === 0) throw new FinanceError("INVALID_AMOUNT", "Enter a valid amount.");
    if (w.amount > dueInterestLeft(d)) throw new FinanceError("WAIVE_TOO_LARGE", "This is more than the interest pending for that period.");
    d.waived = (d.waived ?? 0) + w.amount;
    done.set(d.id, (done.get(d.id) ?? 0) + w.amount);
  }
  return done;
}

/** A loan is finished when the principal is back and no collection has anything pending. */
const settled = (principalLeft: Paise, dues: Due[]) => principalLeft === 0 && openDues(dues).length === 0;

/**
 * Apply a received payment to a loan. Pure: returns new objects, changes nothing passed in.
 * Throws FinanceError when the payment must not be recorded.
 *
 * - interest goes to the collections named in `allocations`, or oldest first
 * - principal reduces the principal left (and pays instalment parts, oldest first)
 * - nothing is ever cleared that was not paid or explicitly waived
 * - the loan closes only when the principal is back AND no interest is pending;
 *   returning all principal with interest pending leaves the loan open for the
 *   owner to collect or waive that interest
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

  let made = 0;
  const newId = () => (made++ === 0 ? ids.nextDueId : `${ids.nextDueId}-${made}`);
  const dues = accrueDues(loan, loanDues, today, newId).map((d) => ({ ...d }));
  const byId = new Map(dues.map((d) => [d.id, d]));
  const before = new Map(dues.map((d) => [d.id, { interest: dueInterestPaid(d), principal: duePrincipalPaid(d) }]));

  // Interest: to the collections the owner chose, or oldest first (the one asked for first).
  const picks = input.allocations ?? allocateInterest(dues, input.interest, input.dueId ? [input.dueId] : []);
  if (input.allocations) {
    for (const p of picks) {
      const d = byId.get(p.dueId);
      if (!d || d.cancelled) throw new FinanceError("DUE_MISMATCH", "This collection belongs to a different loan.");
      if (!isPaise(p.amount)) throw new FinanceError("INVALID_AMOUNT", "Enter a valid amount.");
    }
  }
  const perDue = new Map<string, Paise>();
  for (const p of picks) perDue.set(p.dueId, (perDue.get(p.dueId) ?? 0) + p.amount);
  for (const [id, amount] of perDue)
    if (amount > dueInterestLeft(byId.get(id)!)) throw new FinanceError("INTEREST_TOO_LARGE", "This is more than the interest pending for that period.");
  const picked = picks.reduce((a, p) => a + p.amount, 0);
  if (picked !== input.interest) {
    if (input.allocations) throw new FinanceError("ALLOCATION_MISMATCH", "The periods chosen do not add up to the interest received.");
    throw new FinanceError("INTEREST_TOO_LARGE", "This is more than the interest pending. Put the extra under Other.");
  }

  const principalLeft = loan.principalLeft - input.principal;
  const lastPaid = dues.reduce((a, d) => (d.lastPaidDate && d.lastPaidDate > a ? d.lastPaidDate : a), "");

  for (const [id, amount] of perDue) {
    const d = byId.get(id)!;
    d.interestPaid = dueInterestPaid(d) + amount;
    d.paid += amount;
  }
  // Principal pays instalment parts, oldest first. Anything beyond them just lowers the balance.
  let principal = input.principal;
  for (const d of openDues(dues)) {
    if (principal <= 0) break;
    const take = Math.min(principal, duePrincipalLeft(d));
    d.interestPaid = dueInterestPaid(d);
    d.paid += take;
    principal -= take;
  }
  // All principal is back: a collection for a period that had not begun by the payment
  // date was never owed, so it is dropped. A period that had begun stays pending.
  if (principalLeft === 0)
    for (const d of openDues(dues)) if (d.paid === 0 && !d.waived && periodStart(d, dues, loan) >= input.date) d.cancelled = true;
  const waivedBy = applyWaive(dues, input.waive, input.waiveReason);
  const waived = [...waivedBy.values()].reduce((a, v) => a + v, 0);

  const allocations = dues
    .map((d) => ({
      dueId: d.id,
      interest: dueInterestPaid(d) - before.get(d.id)!.interest,
      principal: duePrincipalPaid(d) - before.get(d.id)!.principal,
      waived: waivedBy.get(d.id) ?? 0,
    }))
    .filter((a) => a.interest + a.principal + a.waived > 0);
  for (const a of allocations) {
    const d = byId.get(a.dueId)!;
    // only a collection that received money; a backdated entry never moves the date backwards
    if (a.interest + a.principal > 0 && input.date > (d.lastPaidDate ?? "")) d.lastPaidDate = input.date;
  }

  const closed = settled(principalLeft, dues);
  if (closed && input.date < lastPaid) throw new FinanceError("BEFORE_LAST_PAYMENT", "The loan cannot be closed on a date before its latest payment.");
  // Security stays HELD ("pending release") until the owner hands it back.
  const updatedLoan: Loan = closed ? { ...loan, principalLeft, status: "closed", closedDate: input.date } : { ...loan, principalLeft };

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
    dueId: allocations[0]?.dueId ?? byId.get(input.dueId ?? "")?.id ?? openDue(dues)?.id,
    allocations,
  };

  const after = closed ? dues : accrueDues(updatedLoan, dues, today, newId);
  return { loan: updatedLoan, dues: after, payment, closed, nextDue: openDue(after), waived };
}

export interface WaiverInput {
  waive: InterestPick[];
  reason: string;
  /** The day the owner decided. Becomes the closing date if this finishes the loan. */
  date: ISODate;
}

/**
 * The owner writes off pending interest without receiving money. A reason is required.
 * The waived amount stays on the collection as "waived"; it is never counted as received.
 */
export function applyWaiver(loan: Loan, loanDues: Due[], input: WaiverInput, today: ISODate): { loan: Loan; dues: Due[]; closed: boolean; waived: Paise } {
  if (loan.status !== "active") throw new FinanceError("LOAN_CLOSED", "This loan is closed.");
  if (!input.waive.length) throw new FinanceError("ZERO_AMOUNT", "Choose the interest to waive.");
  if (input.date > today) throw new FinanceError("FUTURE_DATE", "The date cannot be in the future.");
  const dues = loanDues.map((d) => ({ ...d }));
  const waived = [...applyWaive(dues, input.waive, input.reason).values()].reduce((a, v) => a + v, 0);
  const closed = settled(loan.principalLeft, dues);
  return { loan: closed ? { ...loan, status: "closed", closedDate: input.date } : loan, dues, closed, waived };
}

// ---------------------------------------------------------------------------
// What is still to come
// ---------------------------------------------------------------------------

/**
 * Expected future collections for a running loan, after the ones that already exist.
 * Walks the schedule one period at a time: interest by the loan's setting on the balance
 * at that point, principal by "principal with each collection". It stops at `until`, after
 * `limit` rows, or when the principal reaches zero (an instalment loan ends; an
 * interest-only loan has no end). These are ESTIMATES that assume every collection is
 * paid on time: they change if the customer pays late, returns principal early or closes.
 */
export function projectDues(loan: Loan, loanDues: Due[], until: ISODate, limit = 400): Due[] {
  if (loan.status !== "active") return [];
  const open = openDues(loanDues);
  if (!open.length) return [];
  const out: Due[] = [];
  let principal = loan.principalLeft - open.reduce((a, d) => a + duePrincipalLeft(d), 0);
  const last = loanDues.reduce((a, d) => (periodDate(d) > a ? periodDate(d) : a), "");
  let date = nextDueDate(last, loan.frequency, 1, loan.startDate);
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
 * What is still to come on a loan: every collection still pending (missed ones first),
 * then the expected ones. Instalment loans are listed to their last collection;
 * interest-only loans show the next few interest dates.
 */
export function loanSchedule(loan: Loan, loanDues: Due[], interestOnlyRows = 3): LoanSchedule | null {
  const open = loan.status === "active" ? openDues(loanDues) : [];
  if (!open.length) return null;
  const interestOnly = loan.principalPerDue <= 0;
  const FAR = "9999-12-31";
  // An instalment loan is listed to its end, however many collections that is.
  const limit = interestOnly ? Math.max(0, interestOnlyRows - open.length) : Math.ceil(loan.principalLeft / loan.principalPerDue) + 1;
  const future = loan.principalLeft > 0 ? projectDues(loan, loanDues, FAR, limit) : [];
  let balance = loan.principalLeft;
  const rows: ScheduleRow[] = [
    ...open.map((d) => ({ date: d.dueDate, interest: dueInterestLeft(d), principal: duePrincipalLeft(d), balanceAfter: (balance -= duePrincipalLeft(d)) })),
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
