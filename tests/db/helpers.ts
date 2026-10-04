// Helpers for the database tests. They run against the LOCAL Supabase stack
// (`npx supabase start`), never against production. The keys below are the fixed,
// public demo keys every local Supabase stack uses.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { dueFromRow, dueToRow, loanFromRow, loanToRow, collateralToRow } from "../../src/lib/data/mappers";
import { applyPayment, buildDue, nextDueDate, type PaymentInput, type PaymentResult } from "../../src/lib/finance/engine";
import type { Loan, Security } from "../../src/lib/types";

export const URL = process.env.SUPABASE_TEST_URL ?? "http://127.0.0.1:56321";
export const ANON = process.env.SUPABASE_TEST_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = process.env.SUPABASE_TEST_SERVICE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

if (!/127\.0\.0\.1|localhost/.test(URL)) throw new Error("Database tests must only run against a local Supabase stack");

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
export const admin = createClient(URL, SERVICE, opts);
export const anon = createClient(URL, ANON, opts);

const PASSWORD = "test-password-123";

export interface TestUser {
  id: string;
  db: SupabaseClient;
}

/** Creates a login with a role and returns a client signed in as that person. */
export async function makeUser(role: "owner" | "staff" | "collector", name: string, active = true): Promise<TestUser> {
  const email = `${role}-${randomUUID().slice(0, 8)}@test.local`;
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser: ${error?.message}`);
  const ins = await admin.from("profiles").insert({ id: data.user.id, name, role, active });
  if (ins.error) throw new Error(`profile: ${ins.error.message}`);
  const db = createClient(URL, ANON, opts);
  const signIn = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (signIn.error) throw new Error(`signIn: ${signIn.error.message}`);
  return { id: data.user.id, db };
}

export async function today(db: SupabaseClient): Promise<string> {
  const { data, error } = await db.rpc("today_ist");
  if (error) throw new Error(error.message);
  return data as string;
}

export const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function addCustomer(db: SupabaseClient, name: string, collectorId?: string): Promise<string> {
  const { data, error } = await db.from("customers").insert({ name, phone: "9000000000", area: "Test", collector_id: collectorId ?? null }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}

type Terms = Pick<Loan, "customerId" | "type" | "amount" | "startDate" | "interest" | "frequency" | "principalPerDue"> & { reference?: string; security?: Security | null };

/** Creates a loan the way the app does: the engine builds the first collection, the database saves both. */
export async function giveLoan(db: SupabaseClient, terms: Terms, key = randomUUID()) {
  const draft: Loan = { ...terms, id: "", principalLeft: terms.amount, status: "active", security: terms.security ?? null };
  const first = buildDue(draft, nextDueDate(draft.startDate, draft.frequency), randomUUID());
  return db.rpc("create_loan", {
    p_key: key,
    p_loan: loanToRow(draft),
    p_first_due: dueToRow(first),
    p_collateral: draft.security ? collateralToRow(draft.security) : null,
  });
}

export async function readLoan(db: SupabaseClient, loanId: string) {
  const [loan, dues] = await Promise.all([
    db.from("loans").select("*").eq("id", loanId).single(),
    db.from("dues").select("*").eq("loan_id", loanId).order("due_date"),
  ]);
  if (loan.error) throw new Error(loan.error.message);
  if (dues.error) throw new Error(dues.error.message);
  return { loan: loanFromRow(loan.data, undefined), dues: dues.data.map(dueFromRow) };
}

export interface PayOptions {
  key?: string;
  /** Change what is sent to the database after the engine has worked it out (to test tampering). */
  tamper?: (args: Record<string, any>) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Use this loan state instead of reading the current one (to test stale screens). */
  from?: Awaited<ReturnType<typeof readLoan>>;
}

/** Records a payment the way the app does: engine first, then the database function. */
export async function pay(db: SupabaseClient, loanId: string, input: Omit<PaymentInput, "loanId" | "method"> & { method?: PaymentInput["method"] }, o: PayOptions = {}) {
  const { loan, dues } = o.from ?? (await readLoan(db, loanId));
  const now = await today(db);
  const result: PaymentResult = applyPayment(loan, dues, { method: "cash", ...input, loanId }, { paymentId: randomUUID(), nextDueId: randomUUID() }, now);
  const before = new Map(dues.map((d) => [d.id, JSON.stringify(d)]));
  const p = result.payment;
  const args = {
    p_key: o.key ?? randomUUID(),
    p_loan_id: loanId,
    p_version: loan.version,
    p_payment: { id: p.id, due_id: p.dueId ?? null, date: p.date, interest: p.interest, principal: p.principal, other: p.other, method: p.method, note: p.note ?? null },
    p_loan: { principal_left: result.loan.principalLeft, status: result.loan.status, closed_date: result.loan.closedDate ?? null },
    p_dues: result.dues.filter((d) => before.get(d.id) !== JSON.stringify(d)).map(dueToRow),
  };
  o.tamper?.(args);
  const res = await db.rpc("record_payment", args);
  return { ...res, result, paymentId: p.id };
}

/** The 'CODE' at the start of an error raised by a database function. */
export const codeOf = (res: { error: { message: string } | null }) => res.error?.message.split(":")[0] ?? "ok";
