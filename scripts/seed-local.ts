// Fills an EMPTY LOCAL Supabase stack with the fictional demo book and four logins,
// for development and browser tests. It refuses to run against anything but localhost.
//
//   npx supabase db reset && npm run seed:local

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { collateralToRow } from "../src/lib/data/mappers";
import { loginEmail } from "../src/lib/data/supabase";
import { buildDemoDB, DEMO_USERS } from "../src/lib/demo-data";

const url = process.env.SUPABASE_TEST_URL ?? "http://127.0.0.1:15321";
// The fixed, public service key every local Supabase stack uses. Not a secret.
const serviceKey = process.env.SUPABASE_TEST_SECRET_KEY ?? process.env.SUPABASE_TEST_SERVICE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const LOCAL_PASSWORD = "ledger-local-1";

if (!/127\.0\.0\.1|localhost/.test(url) && process.env.SUPABASE_TEST_ALLOW_REMOTE !== "this-project-has-no-real-data")
  throw new Error("seed-local runs only against a local Supabase stack (or set SUPABASE_TEST_ALLOW_REMOTE, see DEPLOYMENT.md)");

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

async function insert(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

async function main() {
  const { count } = await db.from("customers").select("id", { count: "exact", head: true });
  if (count) throw new Error("The database is not empty. Run `npx supabase db reset` first.");

  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST
  const demo = buildDemoDB(today);

  // Logins: mobile number + password, as the sign-in screen expects.
  const userId = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const { data, error } = await db.auth.admin.createUser({ email: loginEmail(u.phone), password: LOCAL_PASSWORD, email_confirm: true });
    if (error || !data.user) throw new Error(`user ${u.name}: ${error?.message}`);
    userId.set(u.id, data.user.id);
  }
  await insert("profiles", DEMO_USERS.map((u) => ({ id: userId.get(u.id), name: u.name, phone: u.phone, role: u.role, area: u.area ?? null, active: u.active })));

  await insert("customers", demo.customers.map((c) => ({
    id: c.id, name: c.name, phone: c.phone, alt_phone: c.altPhone ?? null, area: c.area, address: c.address ?? null, id_ref: c.idRef ?? null,
    notes: c.notes ?? null, collector_id: c.collectorId ? userId.get(c.collectorId) ?? null : null, created_on: c.createdAt, created_by: userId.get("U1"),
  })));

  await insert("loans", demo.loans.map((l) => ({
    id: l.id, customer_id: l.customerId, type: l.type, amount: l.amount, start_date: l.startDate, reference: l.reference ?? null,
    interest_style: l.interest.style, interest_value: l.interest.value, interest_method: l.interest.method, frequency: l.frequency,
    principal_per_due: l.principalPerDue, principal_left: l.principalLeft, status: l.status, closed_date: l.closedDate ?? null,
    idempotency_key: randomUUID(), created_by: userId.get("U1"),
  })));

  await insert("collateral", demo.loans.filter((l) => l.security).map((l) => ({ loan_id: l.id, status: l.security!.status, ...collateralToRow(l.security!) })));

  const dueId = new Map(demo.dues.map((d) => [d.id, randomUUID()]));
  await insert("dues", demo.dues.map((d) => ({
    id: dueId.get(d.id), loan_id: d.loanId, due_date: d.dueDate, interest_amount: d.interestAmount, principal_amount: d.principalAmount,
    paid: d.paid, interest_paid: d.interestPaid ?? Math.min(d.interestAmount, d.paid), waived: d.waived ?? 0, last_paid_date: d.lastPaidDate ?? null,
    original_date: d.rescheduled?.originalDate ?? null, reschedule_reason: d.rescheduled?.reason ?? null, cancelled: !!d.cancelled,
  })));

  await insert("payments", demo.payments.map((p) => ({
    id: randomUUID(), loan_id: p.loanId, customer_id: p.customerId, due_id: p.dueId ? dueId.get(p.dueId) : null, payment_date: p.date,
    recorded_on: p.recordedOn, recorded_at: `${p.recordedOn}T12:00:00+05:30`, principal_before: p.principalBefore, interest: p.interest,
    principal: p.principal, other: p.other, method: p.method, note: p.note ?? null, idempotency_key: randomUUID(), created_by: userId.get("U1"),
    // seeded history has no snapshot, so these payments cannot be reversed
    before_state: { seeded: true, dues: [], created_due_ids: [] },
  })));

  // New customers and loans continue after the seeded numbers.
  const maxCustomer = Math.max(...demo.customers.map((c) => Number(c.id.replace(/\D/g, ""))));
  const maxLoan = Math.max(...demo.loans.map((l) => Number(l.id.replace(/\D/g, ""))));
  const { error } = await db.rpc("set_id_counters", { p_customer: maxCustomer, p_loan: maxLoan });
  if (error) throw new Error(`counters: ${error.message}`);

  console.log(`Seeded ${demo.customers.length} customers, ${demo.loans.length} loans, ${demo.dues.length} dues, ${demo.payments.length} payments.`);
  console.log(`Logins (password "${LOCAL_PASSWORD}"): ${DEMO_USERS.map((u) => `${u.phone} (${u.role})`).join(", ")}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
