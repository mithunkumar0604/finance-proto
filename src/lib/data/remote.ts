// Every call the app makes to the database. Reads return the types the screens use;
// writes call the database functions (one transaction each). Errors come back as
// AppError with a message that is safe to show.

import type { PaymentResult } from "../finance/engine";
import { fileProblem, filePath, fileType, isPdf, latestPerSlot, MAX_FILE_BYTES } from "../files";
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
import { forgetSignIn, loginEmail, supabase, throwawayClient } from "./supabase";

const PAGE = 1000;
const PAYMENT_COLS = "id,loan_id,customer_id,due_id,payment_date,recorded_on,recorded_at,principal_before,interest,principal,other,method,note";
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

/** Ends the sign-in on this device at once, with or without a connection. Reload the page afterwards. */
export const signOut = forgetSignIn;

/** Ends this person's sign-in on every other device. */
export async function signOutOthers() {
  const { error } = await supabase().auth.signOut({ scope: "others" });
  if (error) throw toAppError(error);
}

/**
 * Changes the signed-in person's password. The current password is checked first, on a
 * separate throwaway sign-in, so a wrong one changes nothing and this device stays signed
 * in. Afterwards every other device is signed out; resolves to false if that last step
 * could not be done (the password is changed all the same).
 */
export async function changePassword(current: string, next: string): Promise<boolean> {
  const { data } = await supabase().auth.getSession();
  const email = data.session?.user.email;
  if (!email) throw new AppError("SIGNED_OUT", "You have been signed out. Please sign in again.");

  const check = throwawayClient();
  let res;
  try {
    res = await check.auth.signInWithPassword({ email, password: current });
  } catch (e) {
    throw toAppError(e);
  }
  if (res.error || !res.data.user) {
    if (res.error && /fetch|network/i.test(res.error.message)) throw toAppError(res.error);
    if (res.error?.status === 429) throw new AppError("TOO_MANY", "Too many tries. Wait a minute and try again.");
    // only a refused password is called wrong; a server fault is not the user's mistake
    if (res.error?.code === "invalid_credentials" || res.error?.status === 400) throw new AppError("BAD_PASSWORD", "The current password is wrong. Nothing was changed.");
    throw new AppError("REJECTED", "The password could not be checked just now. Nothing was changed. Please try again.");
  }
  // end the throwaway sign-in only; this device's own sign-in is a different one
  await check.auth.signOut({ scope: "local" }).catch(() => {});

  // current_password is checked by the server too when the project is set to require it
  const { error } = await supabase().auth.updateUser({ password: next, current_password: current });
  if (error) {
    if (/fetch|network/i.test(error.message)) throw toAppError(error);
    if (error.code === "same_password" || /different from the old/i.test(error.message)) throw new AppError("SAME_PASSWORD", "The new password must be different from the current one.");
    if (error.code === "weak_password") throw new AppError("WEAK_PASSWORD", "This password is not accepted. Use at least 8 characters and try a different one.");
    throw new AppError("REJECTED", "The password could not be changed. Nothing was changed. Please try again.");
  }
  // anyone else who was signed in with the old password is signed out
  const others = await supabase().auth.signOut({ scope: "others" }).catch((e) => ({ error: e }));
  return !others.error;
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
 * Saves a payment the engine has worked out. `changedDues` are the collections the
 * database already has that the payment changed. New collections are never sent: the
 * database opens them itself, and the loan is read back afterwards.
 */
export async function recordPayment(key: string, version: number, result: PaymentResult, changedDues: Due[], waiveReason?: string): Promise<SavedPayment> {
  const p = result.payment;
  const res = await rpc<{ recorded_on: ISODate; version: number; duplicate: boolean }>("record_payment", {
    p_key: key,
    p_loan_id: result.loan.id,
    p_version: version,
    p_payment: { id: p.id, due_id: p.dueId ?? null, date: p.date, interest: p.interest, principal: p.principal, other: p.other, method: p.method, note: p.note ?? null },
    p_loan: { principal_left: result.loan.principalLeft, status: result.loan.status },
    p_dues: changedDues.map(dueToRow),
    p_waive_reason: waiveReason ?? null,
  });
  return { recordedOn: res.recorded_on, version: res.version, duplicate: res.duplicate };
}

/** The owner writes off pending interest without receiving money. */
export const waiveInterest = (loanId: string, version: number, waive: { dueId: string; amount: number }[], reason: string) =>
  rpc<{ closed: boolean }>("waive_interest", { p_loan_id: loanId, p_version: version, p_waive: waive.map((w) => ({ due_id: w.dueId, amount: w.amount })), p_reason: reason });

/** Brings every running loan up to today: one collection for each period that has started. */
export const accrueAll = () => rpc<number>("accrue_all", {});

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

// ---------------------------------------------------------------------------
// Photos and documents of what is held as security
// ---------------------------------------------------------------------------
// One private storage bucket. A file is "<loan id>/<tile>-<time>.<ext>". Who may read,
// add and remove is decided by the bucket's policies in the database (whoever can see
// the loan reads; owner and staff add; only the owner removes). Nothing has a public
// address: a file is shown through a signed link that stops working after an hour.

const BUCKET = "documents";
const LINK_SECONDS = 3600;

export interface LoanFile {
  /** Full path in the bucket. */
  path: string;
  /** Which tile it belongs to. */
  slot: string;
  pdf: boolean;
  /** Signed link, valid for an hour. */
  url: string;
}

const fileError = (e: { message?: string; statusCode?: string | number; status?: number } | null, fallback: string): AppError => {
  const msg = String(e?.message ?? "");
  if (/failed to fetch|fetch failed|networkerror|load failed/i.test(msg)) return new AppError("NETWORK", "No connection. Check the internet and try again.");
  if (/row-level security|not authorized|unauthorized/i.test(msg) || String(e?.statusCode ?? e?.status) === "403") return new AppError("NOT_ALLOWED", "You are not allowed to do this.");
  if (/exceeded the maximum allowed size|too large/i.test(msg)) return new AppError("TOO_LARGE", "This file is larger than 5 MB.");
  if (/mime type/i.test(msg)) return new AppError("WRONG_TYPE", "Use a photo (JPG, PNG or WebP) or a PDF.");
  return new AppError("REJECTED", fallback);
};

/** The newest file of each tile for a loan, each with a signed link. */
export async function listLoanFiles(loanId: string): Promise<LoanFile[]> {
  const bucket = supabase().storage.from(BUCKET);
  const { data, error } = await bucket.list(loanId, { limit: 200 });
  if (error) throw fileError(error, "The photos could not be read. Reload the page.");
  const latest = latestPerSlot((data ?? []).map((f) => f.name));
  const slots = Object.keys(latest);
  if (!slots.length) return [];
  const signed = await bucket.createSignedUrls(slots.map((s) => `${loanId}/${latest[s]}`), LINK_SECONDS);
  if (signed.error) throw fileError(signed.error, "The photos could not be read. Reload the page.");
  return slots.flatMap((slot, i) => {
    const url = signed.data?.[i]?.signedUrl;
    return url ? [{ path: `${loanId}/${latest[slot]}`, slot, pdf: isPdf(latest[slot]), url }] : [];
  });
}

/** Phone cameras make 5–10 MB photos. A photo is made smaller (longest side 1600 px) before it is sent. */
async function shrinkPhoto(file: File, type: string): Promise<Blob> {
  // a file whose type the picker left empty is sent with the type worked out from its name
  const asIs = file.type === type ? file : new Blob([file], { type });
  if (type === "application/pdf" || typeof createImageBitmap !== "function") return asIs;
  try {
    const img = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    if (scale === 1 && file.size <= 600 * 1024) {
      img.close();
      return asIs;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const pen = canvas.getContext("2d")!;
    // JPEG has no see-through: without this, clear parts of a PNG would come out black
    pen.fillStyle = "#fff";
    pen.fillRect(0, 0, canvas.width, canvas.height);
    pen.drawImage(img, 0, 0, canvas.width, canvas.height);
    img.close();
    const small = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.82));
    return small && small.size < file.size ? small : asIs;
  } catch {
    return asIs; // a picture this browser cannot draw is sent as it is
  }
}

/** Saves a photo or PDF for one tile of a loan. Throws AppError with words for the user. */
export async function uploadLoanFile(loanId: string, slot: string, file: File): Promise<void> {
  const problem = fileProblem(file);
  if (problem) throw new AppError("BAD_FILE", problem);
  const body = await shrinkPhoto(file, fileType(file));
  if (body.size > MAX_FILE_BYTES) throw new AppError("TOO_LARGE", "This photo is larger than 5 MB even after making it smaller. Take it again at a lower quality.");
  let res;
  try {
    res = await supabase().storage.from(BUCKET).upload(filePath(loanId, slot, body.type, Date.now()), body, { contentType: body.type, upsert: false });
  } catch (e) {
    throw fileError(e as Error, "The file could not be saved. Please try again.");
  }
  if (res.error) throw fileError(res.error, "The file could not be saved. Please try again.");
}

/** Owner: removes files for good. */
export async function removeLoanFiles(paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { data, error } = await supabase().storage.from(BUCKET).remove(paths);
  if (error) throw fileError(error, "The file could not be removed. Please try again.");
  // when the policies refuse, storage answers "nothing removed" rather than an error
  if (!data?.length) throw new AppError("NOT_ALLOWED", "Only the owner can remove a file.");
}

/** Every file kept for one tile of a loan (an older one stays until the tile is replaced or removed). */
export async function loanFilePaths(loanId: string, slot: string): Promise<string[]> {
  const { data, error } = await supabase().storage.from(BUCKET).list(loanId, { limit: 200 });
  if (error) throw fileError(error, "The photos could not be read. Reload the page.");
  return (data ?? []).filter((f) => f.name.startsWith(`${slot}-`)).map((f) => `${loanId}/${f.name}`);
}
