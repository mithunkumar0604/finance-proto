// Delete Loan: only an ADMIN can delete a loan, and with it everything attached to it
// (collections, payments, what each payment did, waivers, security, notes). The customer
// stays. A full copy goes into one activity entry. The history locks stay in force for
// everyone and everything else.

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { dueInterestLeft } from "../../src/lib/finance/engine";
import { rupees } from "../../src/lib/finance/money";
import { addCustomer, admin, anon, codeOf, giveLoan, makeUser, pay, readLoan, shift, today, type TestUser } from "./helpers";

let adminUser: TestUser;
let owner: TestUser;
let staff: TestUser;
let collector: TestUser;
let TODAY: string;

const ATTACHED = ["dues", "payments", "payment_allocations", "waivers", "collateral", "loan_notes"] as const;

/** 1,00,000 at 3% a month, given 65 days ago, held against a jewel. */
async function bigLoan(customerId: string, loanNo?: string) {
  const res = await giveLoan(owner.db, {
    customerId,
    type: "jewel",
    amount: rupees(100000),
    startDate: shift(TODAY, -65),
    interest: { style: "percent", value: 3, method: "reducing" },
    frequency: "monthly",
    principalPerDue: 0,
    loanNo,
    security: { kind: "jewel", description: "Gold chain", weightGrams: 20, purity: "22K", estimatedValue: rupees(150000), packetNo: `P-${randomUUID().slice(0, 4)}`, storage: "Locker", status: "held" },
  });
  if (res.error) throw new Error(res.error.message);
  return res.data.loan_id as string;
}

/** A loan with two payments (one with a waiver), a note, and its collections. */
async function busyLoan(name = `Del ${randomUUID().slice(0, 6)}`) {
  const customerId = await addCustomer(owner.db, name);
  const loanNo = `D${randomUUID().slice(0, 6)}`;
  const loanId = await bigLoan(customerId, loanNo);
  const p1 = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
  if (p1.error) throw new Error(p1.error.message);
  const { loan, dues } = await readLoan(owner.db, loanId);
  const open = dues.find((d) => dueInterestLeft(d) > 0)!;
  const w = await owner.db.rpc("waive_interest", { p_loan_id: loanId, p_version: loan.version, p_waive: [{ due_id: open.id, amount: rupees(500) }], p_reason: "Goodwill" });
  if (w.error) throw new Error(w.error.message);
  const p2 = await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(10000), other: 0 });
  if (p2.error) throw new Error(p2.error.message);
  const n = await owner.db.rpc("add_loan_note", { p_loan_id: loanId, p_text: "Will pay next week", p_promised_on: null });
  if (n.error) throw new Error(n.error.message);
  return { customerId, loanId, loanNo, name };
}

const rowsOf = async (table: string, loanId: string) =>
  (await admin.from(table).select("*").eq(table === "loans" ? "id" : "loan_id", loanId)).data ?? [];

async function counts(loanId: string) {
  const out: Record<string, number> = {};
  for (const t of ["loans", ...ATTACHED]) out[t] = (await rowsOf(t, loanId)).length;
  return out;
}

beforeAll(async () => {
  adminUser = await makeUser("owner", "Delete Admin");
  expect((await admin.from("profiles").update({ is_admin: true }).eq("id", adminUser.id)).error).toBeNull();
  owner = await makeUser("owner", "Delete Client Owner");
  staff = await makeUser("staff", "Delete Staff");
  collector = await makeUser("collector", "Delete Collector");
  TODAY = await today(owner.db);
}, 60_000);

describe("an admin deletes a loan", () => {
  it("removes the loan and everything attached, keeps the customer and their other loans, and logs a full copy", async () => {
    const { customerId, loanId, loanNo, name } = await busyLoan();
    const other = await bigLoan(customerId);
    const before = await counts(loanId);
    // the loan really had something in every table
    for (const t of ATTACHED) expect(before[t], t).toBeGreaterThan(0);
    const otherBefore = await counts(other);
    const oldLog = (await admin.from("activity").select("id").eq("loan_id", loanId)).data!;
    expect(oldLog.length).toBeGreaterThan(0);
    const full = {
      loan: (await rowsOf("loans", loanId))[0],
      payments: await rowsOf("payments", loanId),
    };

    const res = await adminUser.db.rpc("delete_loan", { p_loan_id: loanId });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ deleted: loanId });

    for (const [t, n] of Object.entries(await counts(loanId))) expect(n, t).toBe(0);
    expect((await admin.from("customers").select("id").eq("id", customerId)).data).toHaveLength(1);
    expect(await counts(other)).toEqual(otherBefore);

    // the older entries stay, no longer pointing at the loan, still at the customer
    const kept = (await admin.from("activity").select("id,loan_id,customer_id").in("id", oldLog.map((a) => a.id))).data!;
    expect(kept).toHaveLength(oldLog.length);
    for (const a of kept) expect(a.loan_id).toBeNull();

    const log = (await admin.from("activity").select("*").eq("customer_id", customerId).order("id", { ascending: false }).limit(1).single()).data!;
    expect(log.text).toBe(`Deleted loan ${loanNo} of ${name}, ₹1,00,000, 2 payments`);
    expect(log).toMatchObject({ kind: "loan", loan_id: null, customer_id: customerId, by_name: "Delete Admin" });
    expect(log.data.loan).toMatchObject({ id: loanId, import_ref: loanNo, amount: full.loan.amount });
    expect(log.data.payments.map((p: { id: string }) => p.id).sort()).toEqual(full.payments.map((p) => p.id).sort());
    expect(log.data.dues.length).toBe(before.dues);
    expect(log.data.allocations.length).toBe(before.payment_allocations);
    expect(log.data.waivers.length).toBe(before.waivers);
    expect(log.data.collateral).toMatchObject({ loan_id: loanId, kind: "jewel" });
    expect(log.data.notes[0]).toMatchObject({ text: "Will pay next week" });
  });

  it("a loan without a number is named by its id, and a loan with no payment says 0 payments", async () => {
    const customerId = await addCustomer(owner.db, "Plain Del Person");
    const loanId = await bigLoan(customerId);
    expect((await adminUser.db.rpc("delete_loan", { p_loan_id: loanId })).error).toBeNull();
    const log = (await admin.from("activity").select("text").eq("customer_id", customerId).order("id", { ascending: false }).limit(1).single()).data!;
    expect(log.text).toBe(`Deleted loan ${loanId} of Plain Del Person, ₹1,00,000, 0 payments`);
  });

  it("returns the security photos to remove from storage", async () => {
    const customerId = await addCustomer(owner.db, `Photo Del ${randomUUID().slice(0, 4)}`);
    const loanId = await bigLoan(customerId);
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    expect((await owner.db.storage.from("documents").upload(`${loanId}/front-1.png`, png, { contentType: "image/png" })).error).toBeNull();
    const res = await adminUser.db.rpc("delete_loan", { p_loan_id: loanId });
    expect(res.error).toBeNull();
    expect(res.data.files).toEqual([`${loanId}/front-1.png`]);
    // the admin can still remove them after the loan is gone
    expect((await adminUser.db.storage.from("documents").remove(res.data.files)).data).toHaveLength(1);
    expect((await admin.storage.from("documents").list(loanId)).data).toEqual([]);
  });

  it("a missing loan is NOT_FOUND", async () => {
    expect(codeOf(await adminUser.db.rpc("delete_loan", { p_loan_id: "LP-NOPE" }))).toBe("NOT_FOUND");
  });
});

describe("several loans at once", () => {
  it("deletes all of them in one go", async () => {
    const a = await busyLoan();
    const b = await busyLoan();
    const res = await adminUser.db.rpc("delete_loans", { p_ids: [a.loanId, b.loanId] });
    expect(res.error).toBeNull();
    expect(res.data.deleted.sort()).toEqual([a.loanId, b.loanId].sort());
    expect((await counts(a.loanId)).loans).toBe(0);
    expect((await counts(b.loanId)).loans).toBe(0);
  });

  it("all or nothing: one id that is not there and none are deleted", async () => {
    const a = await busyLoan();
    const b = await busyLoan();
    const before = [await counts(a.loanId), await counts(b.loanId)];
    expect(codeOf(await adminUser.db.rpc("delete_loans", { p_ids: [a.loanId, "LP-NOPE", b.loanId] }))).toBe("NOT_FOUND");
    expect([await counts(a.loanId), await counts(b.loanId)]).toEqual(before);
  });
});

describe("nobody else can delete a loan", () => {
  it("the client (a plain owner), staff, a collector and someone not signed in are refused, and nothing is deleted", async () => {
    const { loanId } = await busyLoan();
    const before = await counts(loanId);
    for (const who of [owner, staff, collector]) {
      expect(codeOf(await who.db.rpc("delete_loan", { p_loan_id: loanId }))).toBe("NOT_ALLOWED");
      expect(codeOf(await who.db.rpc("delete_loans", { p_ids: [loanId] }))).toBe("NOT_ALLOWED");
    }
    expect((await anon.rpc("delete_loan", { p_loan_id: loanId })).error).not.toBeNull();
    expect((await anon.rpc("delete_loans", { p_ids: [loanId] })).error).not.toBeNull();
    expect(await counts(loanId)).toEqual(before);
  });

  it("the history locks still refuse a delete outside the function, even by the database's own key", async () => {
    const { loanId } = await busyLoan();
    const before = await counts(loanId);
    for (const db of [adminUser.db, owner.db]) {
      await db.from("payments").delete().eq("loan_id", loanId);
      await db.from("loans").delete().eq("id", loanId);
    }
    // the service key passes row security, so only the triggers stop it
    expect((await admin.from("payments").delete().eq("loan_id", loanId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("payment_allocations").delete().eq("loan_id", loanId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("waivers").delete().eq("loan_id", loanId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("loans").delete().eq("id", loanId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect(await counts(loanId)).toEqual(before);
    // and an activity entry still cannot be changed in any other way
    const [a] = (await admin.from("activity").select("id").eq("loan_id", loanId).limit(1)).data!;
    expect((await admin.from("activity").update({ loan_id: null, text: "changed" }).eq("id", a.id)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("activity").update({ loan_id: "LP-OTHER" }).eq("id", a.id)).error?.message).toMatch(/HISTORY_LOCKED/);
  });
});
