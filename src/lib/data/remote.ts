// Every call the app makes to the database. Reads return the types the screens use;
// writes call the database functions (one transaction each). Errors come back as
// AppError with a message that is safe to show.

import type { PaymentResult } from "../finance/engine";
import type { Activity, AppUser, Customer, Due, ISODate, Loan, Payment, Security } from "../types";
import {
  activityFromRow,
  AppError,
  collateralToRow,
  customerFromRow,
  customerToRow,
  dueFromRow,
  dueToRow,
  loanFromRow,
  loanToRow,
  paymentFromRow,
  toAppError,
  userFromRow,
} from "./mappers";
import { loginEmail, supabase } from "./supabase";

const PAGE = 1000;
const PAYMENT_COLS = "id,loan_id,customer_id,due_id,payment_date,recorded_on,principal_before,interest,principal,other,method,note";
const DUE_COLS = "id,loan_id,due_date,interest_amount,principal_amount,paid,interest_paid,waived,last_paid_date,original_date,reschedule_reason,cancelled";

/* eslint-disable @typescript-eslint/no-explicit-any -- supabase query builders are loosely typed */

/** Reads every row of a query, a page at a time (the API returns at most 1000 rows per call). */
async function all(build: () => any): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw toAppError(error);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let res;
  try {
    res = await supabase().rpc(name, args);
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error) throw toAppError(res.error);
  return res.data as T;
}

// ---------------------------------------------------------------------------
// Sign in
// ---------------------------------------------------------------------------

export interface SignedIn {
  userId: string;
  profile: AppUser;
}

async function profileOf(userId: string): Promise<SignedIn> {
  const { data, error } = await supabase().from("profiles").select("*").eq("id", userId).maybeSingle();
  if (error) throw toAppError(error);
  if (!data || !data.active) {
    await supabase().auth.signOut();
    throw new AppError("NOT_ALLOWED", "This login is not active. Ask the owner to switch it on.");
  }
  return { userId, profile: userFromRow(data) };
}

export async function signIn(user: string, password: string): Promise<SignedIn> {
  let res;
  try {
    res = await supabase().auth.signInWithPassword({ email: loginEmail(user), password });
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error || !res.data.user) {
    if (res.error && /fetch|network/i.test(res.error.message)) throw toAppError(res.error);
    throw new AppError("BAD_LOGIN", "Wrong mobile number or password.");
  }
  return profileOf(res.data.user.id);
}

/** The person already signed in on this device, if any. */
export async function currentUser(): Promise<SignedIn | null> {
  const { data } = await supabase().auth.getSession();
  return data.session ? profileOf(data.session.user.id) : null;
}

export async function signOut() {
  await supabase().auth.signOut({ scope: "local" });
}

/** Ends this person's sign-in on every other device. */
export async function signOutOthers() {
  const { error } = await supabase().auth.signOut({ scope: "others" });
  if (error) throw toAppError(error);
}

/** Calls back when the sign-in ends (signed out elsewhere, or it expired and could not be renewed). */
export function onSignedOut(cb: () => void) {
  const { data } = supabase().auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") cb();
  });
  return () => data.subscription.unsubscribe();
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface Book {
  customers: Customer[];
  loans: Loan[];
  dues: Due[];
  payments: Payment[];
  activity: Activity[];
  users: AppUser[];
}

async function recentActivity(): Promise<Activity[]> {
  const { data, error } = await supabase().from("activity").select("id,at,by_name,kind,text").order("at", { ascending: false }).limit(300);
  if (error) throw toAppError(error);
  return (data ?? []).map(activityFromRow);
}

const loansFrom = (rows: any[], collateral: any[], lastPaid: any[]) => {
  const byLoan = new Map(collateral.map((c) => [c.loan_id, c]));
  const paidOn = new Map(lastPaid.map((p) => [p.loan_id, p.last_interest_paid_on]));
  return rows.map((r) => loanFromRow(r, byLoan.get(r.id), paidOn.get(r.id)));
};

/**
 * What the app needs to start: all customers and loans, every collection still open,
 * and the collections and payments dated on or after `from`. Older history is read
 * only when a screen asks for it (a loan's page, a customer's page, an older report).
 */
export async function loadBook(from: ISODate, withActivity: boolean): Promise<Book> {
  const db = supabase();
  const [customers, loans, collateral, lastPaid, dues, payments, users, activity] = await Promise.all([
    all(() => db.from("customers").select("*").order("id")),
    all(() => db.from("loans").select("*").order("id")),
    all(() => db.from("collateral").select("*").order("loan_id")),
    all(() => db.from("loan_last_paid").select("*").order("loan_id")),
    all(() => db.from("dues").select(DUE_COLS).or(`due_date.gte.${from},and(cancelled.is.false,remaining.gt.0)`).order("id")),
    all(() => db.from("payments").select(PAYMENT_COLS).is("reversed_at", null).gte("payment_date", from).order("id")),
    all(() => db.from("profiles").select("*").order("created_at")),
    withActivity ? recentActivity() : Promise.resolve([]),
  ]);
  return {
    customers: customers.map(customerFromRow),
    loans: loansFrom(loans, collateral, lastPaid),
    dues: dues.map(dueFromRow),
    payments: payments.map(paymentFromRow),
    activity,
    users: users.map(userFromRow),
  };
}

/** Collections and payments dated from `from` up to (not including) `before`. */
export async function loadHistory(from: ISODate, before: ISODate): Promise<Pick<Book, "dues" | "payments">> {
  const db = supabase();
  const [dues, payments] = await Promise.all([
    all(() => db.from("dues").select(DUE_COLS).gte("due_date", from).lt("due_date", before).order("id")),
    all(() => db.from("payments").select(PAYMENT_COLS).is("reversed_at", null).gte("payment_date", from).lt("payment_date", before).order("id")),
  ]);
  return { dues: dues.map(dueFromRow), payments: payments.map(paymentFromRow) };
}

/** Everything ever recorded on these loans, plus the loans themselves as they are now. */
export async function loadLoans(loanIds: string[]): Promise<Pick<Book, "loans" | "dues" | "payments">> {
  if (!loanIds.length) return { loans: [], dues: [], payments: [] };
  const db = supabase();
  const [loans, collateral, lastPaid, dues, payments] = await Promise.all([
    all(() => db.from("loans").select("*").in("id", loanIds).order("id")),
    all(() => db.from("collateral").select("*").in("loan_id", loanIds).order("loan_id")),
    all(() => db.from("loan_last_paid").select("*").in("loan_id", loanIds).order("loan_id")),
    all(() => db.from("dues").select(DUE_COLS).in("loan_id", loanIds).order("id")),
    all(() => db.from("payments").select(PAYMENT_COLS).is("reversed_at", null).in("loan_id", loanIds).order("id")),
  ]);
  return { loans: loansFrom(loans, collateral, lastPaid), dues: dues.map(dueFromRow), payments: payments.map(paymentFromRow) };
}

export const loadActivity = recentActivity;

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export async function addCustomer(data: Omit<Customer, "id" | "createdAt">): Promise<Customer> {
  const { data: row, error } = await supabase().from("customers").insert(customerToRow(data)).select("*").single();
  if (error) throw toAppError(error);
  return customerFromRow(row);
}

export async function updateCustomer(id: string, patch: Partial<Omit<Customer, "id">>): Promise<Customer> {
  const { data: row, error } = await supabase().from("customers").update(customerToRow(patch)).eq("id", id).select("*").single();
  if (error) throw toAppError(error);
  return customerFromRow(row);
}

export async function createLoan(
  key: string,
  loan: Pick<Loan, "customerId" | "type" | "amount" | "startDate" | "reference" | "interest" | "frequency" | "principalPerDue">,
  firstDue: Due,
  security: Security | null,
): Promise<string> {
  const res = await rpc<{ loan_id: string }>("create_loan", {
    p_key: key,
    p_loan: loanToRow(loan),
    p_first_due: dueToRow(firstDue),
    p_collateral: security ? collateralToRow(security) : null,
  });
  return res.loan_id;
}

export interface SavedPayment {
  recordedOn: ISODate;
  version: number;
  /** true when this exact request had already been saved (double tap / retry). */
  duplicate: boolean;
}

/**
 * Saves a payment the engine has worked out. `changedDues` are the dues that differ
 * from before the payment (including a newly opened next collection).
 */
export async function recordPayment(key: string, version: number, result: PaymentResult, changedDues: Due[]): Promise<SavedPayment> {
  const p = result.payment;
  const res = await rpc<{ recorded_on: ISODate; version: number; duplicate: boolean }>("record_payment", {
    p_key: key,
    p_loan_id: result.loan.id,
    p_version: version,
    p_payment: { id: p.id, due_id: p.dueId ?? null, date: p.date, interest: p.interest, principal: p.principal, other: p.other, method: p.method, note: p.note ?? null },
    p_loan: { principal_left: result.loan.principalLeft, status: result.loan.status, closed_date: result.loan.closedDate ?? null },
    p_dues: changedDues.map(dueToRow),
  });
  return { recordedOn: res.recorded_on, version: res.version, duplicate: res.duplicate };
}

export const reversePayment = (paymentId: string, reason: string) => rpc<{ loan_id: string }>("reverse_payment", { p_payment_id: paymentId, p_reason: reason });

export const rescheduleDue = (dueId: string, newDate: ISODate, reason: string) =>
  rpc<null>("reschedule_due", { p_due_id: dueId, p_new_date: newDate, p_reason: reason });

export const updateLoan = (loanId: string, version: number, patch: Partial<Pick<Loan, "interest" | "reference" | "frequency">>) =>
  rpc<null>("update_loan", {
    p_loan_id: loanId,
    p_version: version,
    p_patch: {
      ...(patch.interest ? { interest_style: patch.interest.style, interest_value: patch.interest.value, interest_method: patch.interest.method } : {}),
      ...(patch.frequency ? { frequency: patch.frequency } : {}),
      ...("reference" in patch ? { reference: patch.reference ?? "" } : {}),
    },
  });

export const releaseCollateral = (loanId: string) => rpc<null>("release_collateral", { p_loan_id: loanId });

export async function updateUser(id: string, patch: Partial<Pick<AppUser, "name" | "phone" | "role" | "area" | "active">>): Promise<AppUser> {
  const { data: row, error } = await supabase().from("profiles").update(patch).eq("id", id).select("*").single();
  if (error) throw toAppError(error);
  return userFromRow(row);
}
