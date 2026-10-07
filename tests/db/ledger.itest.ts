// Database tests: the payment scenarios, duplicate protection, reversal, history
// locking and who-can-do-what, against a local Supabase stack.

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { rupees } from "../../src/lib/finance/money";
import { addCustomer, admin, anon, codeOf, giveLoan, makeUser, pay, readLoan, shift, today, type TestUser } from "./helpers";

let owner: TestUser;
let staff: TestUser;
let collector: TestUser;
let otherCollector: TestUser;
let TODAY: string;

/** Given 10 days ago unless a start is passed: one collection, still running. */
const monthly = (customerId: string, amount = rupees(100000), start = shift(TODAY, -10)) => ({
  customerId,
  type: "monthly" as const,
  amount,
  startDate: start,
  interest: { style: "percent" as const, value: 3, method: "reducing" as const },
  frequency: "monthly" as const,
  principalPerDue: 0,
});

async function newLoan(amount = rupees(100000), collectorId?: string, start?: string) {
  const customerId = await addCustomer(owner.db, `Customer ${randomUUID().slice(0, 6)}`, collectorId);
  const res = await giveLoan(owner.db, monthly(customerId, amount, start));
  expect(res.error).toBeNull();
  return { customerId, loanId: res.data.loan_id as string };
}

const paymentsOf = async (loanId: string) => (await admin.from("payments").select("*").eq("loan_id", loanId).order("recorded_at")).data ?? [];

beforeAll(async () => {
  owner = await makeUser("owner", "Test Owner");
  staff = await makeUser("staff", "Test Staff");
  collector = await makeUser("collector", "Test Collector");
  otherCollector = await makeUser("collector", "Other Collector");
  TODAY = await today(owner.db);
}, 60_000);

describe("customers and loans", () => {
  it("gives customers and loans readable ids", async () => {
    const { customerId, loanId } = await newLoan();
    expect(customerId).toMatch(/^C\d{3,}$/);
    expect(loanId).toMatch(/^LP-\d{4,}$/);
  });

  it("creates the loan with its first collection, principal left = amount given", async () => {
    const { loanId } = await newLoan();
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan).toMatchObject({ amount: rupees(100000), principalLeft: rupees(100000), status: "active", version: 1 });
    expect(dues).toHaveLength(1);
    expect(dues[0]).toMatchObject({ interestAmount: rupees(3000), principalAmount: 0, paid: 0 });
  });

  it("creates a loan once when Create is pressed twice", async () => {
    const customerId = await addCustomer(owner.db, "Double Press");
    const key = randomUUID();
    const [a, b] = await Promise.all([giveLoan(owner.db, monthly(customerId), key), giveLoan(owner.db, monthly(customerId), key)]);
    const ok = [a, b].filter((r) => !r.error);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const again = await giveLoan(owner.db, monthly(customerId), key);
    expect(again.data).toMatchObject({ duplicate: true });
    const { data } = await admin.from("loans").select("id").eq("customer_id", customerId);
    expect(data).toHaveLength(1);
  });

  it("stores security with the loan and finds it by vehicle number", async () => {
    const customerId = await addCustomer(owner.db, "Vehicle Owner");
    const reg = `TN 33 ZZ ${Math.floor(1000 + Math.random() * 8999)}`;
    const res = await giveLoan(owner.db, {
      ...monthly(customerId),
      type: "vehicle",
      security: { kind: "vehicle", registration: reg, vehicleType: "car", make: "Tata", model: "Nexon", ownerName: "X", rcRef: "RC-1", documentHeld: "RC", storage: "Locker", status: "held" },
    });
    expect(res.error).toBeNull();
    const found = await owner.db.from("collateral").select("loan_id,status,details").ilike("search_text", `%${reg}%`);
    expect(found.data).toHaveLength(1);
    expect(found.data![0]).toMatchObject({ loan_id: res.data.loan_id, status: "held" });
  });
});

describe("payment scenarios", () => {
  it("1. interest-only: principal unchanged, period cleared, next period opened", async () => {
    const { loanId } = await newLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
    expect(res.error).toBeNull();
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan.principalLeft).toBe(rupees(100000));
    expect(loan.status).toBe("active");
    expect(loan.version).toBe(2);
    expect(dues).toHaveLength(2);
    expect(dues[0]).toMatchObject({ paid: rupees(3000), interestPaid: rupees(3000) });
    expect(dues[1]).toMatchObject({ paid: 0, interestAmount: rupees(3000) });
  });

  it("2. partial interest: the rest stays pending, no new period", async () => {
    const { loanId } = await newLoan();
    expect((await pay(owner.db, loanId, { date: TODAY, interest: rupees(2000), principal: 0, other: 0 })).error).toBeNull();
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan.principalLeft).toBe(rupees(100000));
    expect(dues).toHaveLength(1);
    expect(dues[0].interestAmount - dues[0].interestPaid!).toBe(rupees(1000));
  });

  it("3. full settlement: principal 0, loan closed, closed date recorded", async () => {
    const { loanId } = await newLoan();
    const day = shift(TODAY, -2);
    expect((await pay(owner.db, loanId, { date: day, interest: rupees(3000), principal: rupees(100000), other: 0 })).error).toBeNull();
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan).toMatchObject({ principalLeft: 0, status: "closed", closedDate: day });
    expect(dues).toHaveLength(1);
  });

  it("4. partial principal: principal reduced, loan stays active", async () => {
    const { loanId } = await newLoan();
    expect((await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(40000), other: 0 })).error).toBeNull();
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan).toMatchObject({ principalLeft: rupees(60000), status: "active" });
    expect(dues[0].interestPaid).toBe(0);
  });

  it("5. principal + interest: both parts recorded, next interest on the new balance", async () => {
    const { loanId } = await newLoan(rupees(200000));
    expect((await pay(owner.db, loanId, { date: TODAY, interest: rupees(6000), principal: rupees(40000), other: 0 })).error).toBeNull();
    const [p] = await paymentsOf(loanId);
    expect(p).toMatchObject({ interest: rupees(6000), principal: rupees(40000), other: 0, principal_before: rupees(200000) });
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan.principalLeft).toBe(rupees(160000));
    expect(dues[1].interestAmount).toBe(rupees(4800));
  });

  it("6. backdated: counted on the payment date, not the day it was entered", async () => {
    const { loanId } = await newLoan(rupees(100000), undefined, shift(TODAY, -95));
    const paidOn = shift(TODAY, -42);
    expect((await pay(owner.db, loanId, { date: paidOn, interest: rupees(3000), principal: 0, other: 0 })).error).toBeNull();
    const [p] = await paymentsOf(loanId);
    expect(p.payment_date).toBe(paidOn);
    expect(p.recorded_on).toBe(TODAY);
    const thisWeek = await owner.db.from("payments").select("id").eq("loan_id", loanId).gte("payment_date", shift(TODAY, -7));
    expect(thisWeek.data).toHaveLength(0);
    const thatWeek = await owner.db.from("payments").select("id").eq("loan_id", loanId).gte("payment_date", shift(paidOn, -3)).lte("payment_date", shift(paidOn, 3));
    expect(thatWeek.data).toHaveLength(1);
  });

  it("6b. refuses a payment dated in the future or before the loan", async () => {
    const { loanId } = await newLoan();
    const future = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 }, { tamper: (a) => (a.p_payment.date = shift(TODAY, 1)) });
    expect(codeOf(future)).toBe("FUTURE_DATE");
    const early = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 }, { tamper: (a) => (a.p_payment.date = shift(TODAY, -400)) });
    // (the date is checked before anything else, so the rest of the request does not matter)
    expect(codeOf(early)).toBe("BEFORE_LOAN_START");
    expect(await paymentsOf(loanId)).toHaveLength(0);
  });

  it("7. a payment on one loan never changes the customer's other loan", async () => {
    const customerId = await addCustomer(owner.db, "Two Loans");
    const a = (await giveLoan(owner.db, monthly(customerId))).data.loan_id;
    const b = (await giveLoan(owner.db, monthly(customerId, rupees(50000)))).data.loan_id;
    const before = await readLoan(owner.db, b);
    expect((await pay(owner.db, a, { date: TODAY, interest: rupees(3000), principal: rupees(10000), other: 0 })).error).toBeNull();
    expect(await readLoan(owner.db, b)).toEqual(before);

    // and a payment cannot be pointed at the other loan's collection
    const cross = await pay(owner.db, a, { date: TODAY, interest: 0, principal: rupees(1000), other: 0 }, {
      tamper: (args) => (args.p_dues = [{ ...args.p_dues[0], id: before.dues[0].id, interest_paid: 0, paid: 0, waived: 0, cancelled: false, last_paid_date: null }]),
    });
    expect(codeOf(cross)).toBe("DUE_MISMATCH");
    expect(await readLoan(owner.db, b)).toEqual(before);
  });

  it("8. a closed loan takes no more payments and gets no new collections", async () => {
    const { loanId } = await newLoan();
    const open = await readLoan(owner.db, loanId);
    await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: rupees(100000), other: 0 });
    // a second screen that still shows the loan as open
    const late = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 }, { from: { ...open, loan: { ...open.loan, version: 2 } } });
    expect(codeOf(late)).toBe("LOAN_CLOSED");
    const { dues } = await readLoan(owner.db, loanId);
    expect(dues).toHaveLength(1);
    expect(await paymentsOf(loanId)).toHaveLength(1);
  });

  it("keeps paise exact (6,000.50 fixed interest)", async () => {
    const customerId = await addCustomer(owner.db, "Paise");
    const loanId = (await giveLoan(owner.db, { ...monthly(customerId), interest: { style: "fixed", value: 600050, method: "fixed" } })).data.loan_id;
    expect((await pay(owner.db, loanId, { date: TODAY, interest: 600050, principal: 0, other: 0 })).error).toBeNull();
    const [p] = await paymentsOf(loanId);
    expect(p.interest).toBe(600050);
  });
});

describe("9. duplicate and conflicting saves", () => {
  it("a double tap (same key, at the same time) records one payment", async () => {
    const { loanId } = await newLoan();
    const from = await readLoan(owner.db, loanId);
    const key = randomUUID();
    const input = { date: TODAY, interest: rupees(3000), principal: 0, other: 0 };
    const results = await Promise.all([1, 2, 3, 4].map(() => pay(owner.db, loanId, input, { key, from })));
    expect(results.every((r) => !r.error)).toBe(true);
    expect(results.filter((r) => r.data.duplicate === false)).toHaveLength(1);
    expect(await paymentsOf(loanId)).toHaveLength(1);
    expect((await readLoan(owner.db, loanId)).dues).toHaveLength(2);
  });

  it("a retry after a lost reply (same key, later) records nothing new", async () => {
    const { loanId } = await newLoan();
    const from = await readLoan(owner.db, loanId);
    const key = randomUUID();
    const input = { date: TODAY, interest: rupees(3000), principal: rupees(5000), other: 0 };
    await pay(owner.db, loanId, input, { key, from });
    const retry = await pay(owner.db, loanId, input, { key, from });
    expect(retry.data).toMatchObject({ duplicate: true });
    expect(await paymentsOf(loanId)).toHaveLength(1);
    expect((await readLoan(owner.db, loanId)).loan.principalLeft).toBe(rupees(95000));
  });

  it("two people paying the same loan from stale screens: the second is refused, nothing is lost", async () => {
    const { loanId } = await newLoan();
    const from = await readLoan(owner.db, loanId);
    const input = { date: TODAY, interest: 0, principal: rupees(10000), other: 0 };
    const [a, b] = await Promise.all([pay(owner.db, loanId, input, { from }), pay(owner.db, loanId, input, { from })]);
    expect([codeOf(a), codeOf(b)].sort()).toEqual(["CONFLICT", "ok"]);
    expect((await readLoan(owner.db, loanId)).loan.principalLeft).toBe(rupees(90000));
    expect(await paymentsOf(loanId)).toHaveLength(1);
  });
});

describe("the database re-checks what it is sent", () => {
  it("refuses a principal balance that does not add up", async () => {
    const { loanId } = await newLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(10000), other: 0 }, { tamper: (a) => (a.p_loan.principal_left = rupees(50000)) });
    expect(codeOf(res)).toBe("MISMATCH");
    expect((await readLoan(owner.db, loanId)).loan.principalLeft).toBe(rupees(100000));
  });

  it("refuses interest marked as paid without the money", async () => {
    const { loanId } = await newLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(1000), principal: 0, other: 0 }, {
      tamper: (a) => {
        a.p_dues[0].interest_paid = rupees(3000);
        a.p_dues[0].paid = rupees(3000);
      },
    });
    expect(codeOf(res)).toBe("MISMATCH");
    expect(await paymentsOf(loanId)).toHaveLength(0);
  });

  it("refuses interest written off without a reason, or by anyone but the owner", async () => {
    const { loanId } = await newLoan(rupees(100000), collector.id);
    const sneak = (a: Record<string, any>) => (a.p_dues[0].waived = rupees(2000)); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(codeOf(await pay(owner.db, loanId, { date: TODAY, interest: rupees(1000), principal: 0, other: 0 }, { tamper: sneak }))).toBe("REASON_NEEDED");
    expect(codeOf(await pay(collector.db, loanId, { date: TODAY, interest: rupees(1000), principal: 0, other: 0 }, { tamper: (a) => { sneak(a); a.p_waive_reason = "because"; } }))).toBe("NOT_ALLOWED");
    expect(await paymentsOf(loanId)).toHaveLength(0);
  });

  it("refuses zero, negative and too-large amounts", async () => {
    const { loanId } = await newLoan();
    const base = { date: TODAY, interest: rupees(3000), principal: 0, other: 0 };
    expect(codeOf(await pay(owner.db, loanId, base, { tamper: (a) => Object.assign(a.p_payment, { interest: 0 }) }))).toBe("ZERO_AMOUNT");
    expect(codeOf(await pay(owner.db, loanId, base, { tamper: (a) => Object.assign(a.p_payment, { interest: -100 }) }))).toBe("INVALID_AMOUNT");
    expect(codeOf(await pay(owner.db, loanId, base, { tamper: (a) => Object.assign(a.p_payment, { principal: rupees(100001) }) }))).toBe("PRINCIPAL_TOO_LARGE");
    expect(await paymentsOf(loanId)).toHaveLength(0);
  });
});

describe("10. corrections keep the history", () => {
  it("reversing a payment restores the loan exactly and keeps the payment on record", async () => {
    const { loanId } = await newLoan();
    const before = await readLoan(owner.db, loanId);
    const paid = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: rupees(20000), other: 0 });
    const res = await owner.db.rpc("reverse_payment", { p_payment_id: paid.paymentId, p_reason: "Entered on the wrong loan" });
    expect(res.error).toBeNull();
    const after = await readLoan(owner.db, loanId);
    expect({ ...after.loan, version: 0 }).toEqual({ ...before.loan, version: 0 });
    expect(after.dues).toEqual(before.dues);
    const [p] = await paymentsOf(loanId);
    expect(p.reversed_at).not.toBeNull();
    expect(p.reverse_reason).toBe("Entered on the wrong loan");
    expect(p.interest).toBe(rupees(3000));
  });

  it("reversing a settlement reopens the loan", async () => {
    const { loanId } = await newLoan();
    const paid = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: rupees(100000), other: 0 });
    expect((await readLoan(owner.db, loanId)).loan.status).toBe("closed");
    expect((await owner.db.rpc("reverse_payment", { p_payment_id: paid.paymentId, p_reason: "Cheque bounced" })).error).toBeNull();
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan).toMatchObject({ status: "active", principalLeft: rupees(100000) });
    expect(loan.closedDate).toBeUndefined();
    expect(dues[0]).toMatchObject({ waived: 0, cancelled: false, paid: 0 });
    expect(dues).toHaveLength(1);
  });

  it("only the latest payment can be reversed, once, with a reason, by the owner", async () => {
    const { loanId } = await newLoan(rupees(100000), collector.id);
    const first = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
    const second = await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(1000), other: 0 });
    expect(codeOf(await owner.db.rpc("reverse_payment", { p_payment_id: first.paymentId, p_reason: "x" }))).toBe("NOT_LATEST");
    expect(codeOf(await collector.db.rpc("reverse_payment", { p_payment_id: second.paymentId, p_reason: "x" }))).toBe("NOT_ALLOWED");
    expect((await owner.db.rpc("reverse_payment", { p_payment_id: second.paymentId, p_reason: "typo" })).error).toBeNull();
    expect(codeOf(await owner.db.rpc("reverse_payment", { p_payment_id: second.paymentId, p_reason: "again" }))).toBe("ALREADY_REVERSED");
  });

  it("Delete Payment: no reason needed, the money leaves every total, and the record is kept", async () => {
    const { loanId } = await newLoan();
    const before = await readLoan(owner.db, loanId);
    const paid = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: rupees(20000), other: 0 });
    // what the screens and reports read: payments that were not deleted
    const live = async () => (await owner.db.from("payments").select("id,interest,principal").eq("loan_id", loanId).is("reversed_at", null)).data!;
    const lastPaid = async () => (await owner.db.from("loan_last_paid").select("last_interest_paid_on").eq("loan_id", loanId)).data!;
    expect(await live()).toHaveLength(1);
    expect(await lastPaid()).toEqual([{ last_interest_paid_on: TODAY }]);

    expect((await owner.db.rpc("reverse_payment", { p_payment_id: paid.paymentId, p_reason: "  " })).error).toBeNull();

    // nothing left to count; principal and the pending interest are back
    expect(await live()).toHaveLength(0);
    expect(await lastPaid()).toEqual([]);
    const after = await readLoan(owner.db, loanId);
    expect(after.loan.principalLeft).toBe(rupees(100000));
    expect(after.dues).toEqual(before.dues);
    // the record is kept, with the default reason, and the owner's log says it in plain words
    const [p] = await paymentsOf(loanId);
    expect(p).toMatchObject({ interest: rupees(3000), principal: rupees(20000), reverse_reason: "Entered by mistake", reversed_by: owner.id });
    expect(p.reversed_at).not.toBeNull();
    const log = (await owner.db.from("activity").select("text,by_name").eq("loan_id", loanId).order("id", { ascending: false }).limit(1)).data!;
    expect(log[0].text).toBe(`Deleted payment of ₹23,000 on ${loanId} · Entered by mistake`);
    expect(log[0].text).not.toMatch(/revers/i);
    expect(log[0].by_name).toBe("Test Owner");
  });

  it("Delete Payment, one after another: the latest, then the one before it, back to the start", async () => {
    const { loanId } = await newLoan();
    const start = await readLoan(owner.db, loanId);
    // the coming collection's interest is paid, so the database opens the next collection ...
    const first = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
    expect(first.error).toBeNull();
    const afterFirst = await readLoan(owner.db, loanId);
    expect(afterFirst.dues).toHaveLength(2);
    // ... and a principal-only payment is then recorded against that next collection
    const second = await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(10000), other: 0 });
    expect(second.error).toBeNull();
    expect((await paymentsOf(loanId))[1].due_id).toBe(afterFirst.dues[1].id);

    expect((await owner.db.rpc("reverse_payment", { p_payment_id: second.paymentId, p_reason: "" })).error).toBeNull();
    const mid = await readLoan(owner.db, loanId);
    expect(mid.loan.principalLeft).toBe(rupees(100000));
    expect(mid.dues).toEqual(afterFirst.dues);

    // the first payment is now the latest: deleting it removes the collection it had opened
    expect((await owner.db.rpc("reverse_payment", { p_payment_id: first.paymentId, p_reason: "" })).error).toBeNull();
    const end = await readLoan(owner.db, loanId);
    expect({ ...end.loan, version: 0 }).toEqual({ ...start.loan, version: 0 });
    expect(end.dues).toEqual(start.dues);

    // both payments are still on record, deleted; the second no longer points at a collection that is gone
    const kept = await paymentsOf(loanId);
    expect(kept.map((p) => p.reversed_at !== null)).toEqual([true, true]);
    expect(kept.map((p) => [p.interest, p.principal])).toEqual([[rupees(3000), 0], [0, rupees(10000)]]);
    expect(kept[1].due_id).toBeNull();
    // and the loan works normally afterwards
    expect((await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 })).error).toBeNull();
  });

  it("a deleted payment stays locked: only its link to a removed collection may be cleared", async () => {
    const { loanId } = await newLoan();
    const paid = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
    expect((await owner.db.rpc("reverse_payment", { p_payment_id: paid.paymentId, p_reason: "" })).error).toBeNull();
    expect((await admin.from("payments").update({ interest: 1 }).eq("id", paid.paymentId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("payments").update({ reverse_reason: "changed later" }).eq("id", paid.paymentId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("payments").update({ reversed_at: null }).eq("id", paid.paymentId)).error?.message).toMatch(/HISTORY_LOCKED/);
    const other = (await readLoan(owner.db, (await newLoan()).loanId)).dues[0].id;
    expect((await admin.from("payments").update({ due_id: other }).eq("id", paid.paymentId)).error?.message).toMatch(/HISTORY_LOCKED/);
    // a payment that was NOT deleted cannot lose its link either
    const live = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
    expect((await admin.from("payments").update({ due_id: null }).eq("id", live.paymentId)).error?.message).toMatch(/HISTORY_LOCKED/);
  });

  it("recorded payments and the activity log cannot be edited or deleted, even by an administrator", async () => {
    const { loanId } = await newLoan();
    const paid = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
    expect((await admin.from("payments").update({ interest: 1 }).eq("id", paid.paymentId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("payments").delete().eq("id", paid.paymentId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("activity").delete().eq("loan_id", loanId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("activity").update({ text: "x" }).eq("loan_id", loanId)).error?.message).toMatch(/HISTORY_LOCKED/);
    const [p] = await paymentsOf(loanId);
    expect(p.interest).toBe(rupees(3000));
  });

  it("editing loan terms keeps the old and new values", async () => {
    const { loanId } = await newLoan();
    const res = await owner.db.rpc("update_loan", { p_loan_id: loanId, p_version: 1, p_patch: { interest_value: 2.5, reference: "Shop" } });
    expect(res.error).toBeNull();
    const { loan } = await readLoan(owner.db, loanId);
    expect(loan).toMatchObject({ interest: { value: 2.5 }, reference: "Shop", version: 2 });
    const log = await owner.db.from("activity").select("text,data").eq("loan_id", loanId).eq("kind", "loan").order("id", { ascending: false }).limit(1);
    expect(log.data![0].data).toMatchObject({ before: { interest_value: 3 }, after: { interest_value: 2.5 } });
    expect(codeOf(await owner.db.rpc("update_loan", { p_loan_id: loanId, p_version: 1, p_patch: { interest_value: 9 } }))).toBe("CONFLICT");
  });

  it("every payment, loan and moved date leaves an activity entry", async () => {
    const { loanId } = await newLoan();
    await pay(owner.db, loanId, { date: TODAY, interest: rupees(1000), principal: 0, other: 0 });
    const { dues } = await readLoan(owner.db, loanId);
    expect((await owner.db.rpc("reschedule_due", { p_due_id: dues[0].id, p_new_date: shift(TODAY, 5), p_reason: "Travelling" })).error).toBeNull();
    const moved = (await readLoan(owner.db, loanId)).dues[0];
    expect(moved).toMatchObject({ dueDate: shift(TODAY, 5), rescheduled: { originalDate: dues[0].dueDate, reason: "Travelling" } });
    const log = await owner.db.from("activity").select("kind,by_name").eq("loan_id", loanId).order("id");
    expect(log.data!.map((a) => a.kind)).toEqual(["loan", "payment", "reschedule"]);
    expect(log.data![0].by_name).toBe("Test Owner");
  });
});

describe("who can do what", () => {
  const TABLES = ["profiles", "customers", "loans", "dues", "payments", "collateral", "activity"];

  it("nothing is readable or writable without signing in", async () => {
    await newLoan();
    for (const t of TABLES) {
      const res = await anon.from(t).select("*").limit(1);
      expect(res.data ?? [], t).toHaveLength(0);
    }
    expect((await anon.from("customers").insert({ name: "Hacker" })).error).not.toBeNull();
    expect((await anon.rpc("record_payment", { p_key: randomUUID(), p_loan_id: "LP-1001", p_version: 1, p_payment: {}, p_loan: {}, p_dues: [] })).error).not.toBeNull();
    expect((await anon.rpc("app_role")).error).not.toBeNull();
  });

  it("a signed-in user without an active profile sees nothing", async () => {
    const off = await makeUser("owner", "Switched Off", false);
    await newLoan();
    for (const t of TABLES) expect((await off.db.from(t).select("id").limit(1)).data ?? [], t).toHaveLength(0);
    const customerId = await addCustomer(owner.db, "X");
    expect(codeOf(await giveLoan(off.db, monthly(customerId)))).toBe("NOT_ALLOWED");
  });

  it("even the owner cannot write money tables directly", async () => {
    const { loanId, customerId } = await newLoan();
    const { dues } = await readLoan(owner.db, loanId);
    expect((await owner.db.from("loans").update({ principal_left: 0 }).eq("id", loanId).select()).error).not.toBeNull();
    expect((await owner.db.from("dues").update({ paid: 100 }).eq("id", dues[0].id).select()).error).not.toBeNull();
    expect((await owner.db.from("dues").delete().eq("id", dues[0].id).select()).error).not.toBeNull();
    expect((await owner.db.from("payments").insert({ id: randomUUID(), loan_id: loanId, customer_id: customerId, payment_date: TODAY, principal_before: 0, interest: 1, principal: 0, other: 0, method: "cash", idempotency_key: randomUUID(), before_state: {} })).error).not.toBeNull();
    expect((await owner.db.from("activity").insert({ kind: "system", text: "fake" })).error).not.toBeNull();
    expect((await owner.db.from("customers").delete().eq("id", customerId).select()).error).not.toBeNull();
    expect((await readLoan(owner.db, loanId)).loan.principalLeft).toBe(rupees(100000));
  });

  it("the internal reversal snapshot is not readable from the app", async () => {
    const { loanId } = await newLoan();
    await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
    expect((await owner.db.from("payments").select("before_state").eq("loan_id", loanId)).error).not.toBeNull();
    expect((await owner.db.from("payments").select("id,interest").eq("loan_id", loanId)).data).toHaveLength(1);
  });

  it("staff can add and edit customers but cannot give loans, take payments or see the activity log", async () => {
    const customerId = await addCustomer(staff.db, "Added By Staff");
    expect((await staff.db.from("customers").update({ area: "Erode" }).eq("id", customerId).select()).data).toHaveLength(1);
    expect(codeOf(await giveLoan(staff.db, monthly(customerId)))).toBe("NOT_ALLOWED");
    const { loanId } = await newLoan();
    expect(codeOf(await pay(staff.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 }))).toBe("NOT_ALLOWED");
    expect((await staff.db.from("activity").select("id").limit(5)).data).toHaveLength(0);
    expect(codeOf(await staff.db.rpc("release_collateral", { p_loan_id: loanId }))).toBe("NOT_ALLOWED");
  });

  it("a collector sees and collects only for their own customers", async () => {
    const mine = await newLoan(rupees(100000), collector.id);
    const theirs = await newLoan(rupees(100000), otherCollector.id);

    const customers = (await collector.db.from("customers").select("id")).data!.map((c) => c.id);
    expect(customers).toContain(mine.customerId);
    expect(customers).not.toContain(theirs.customerId);
    for (const t of ["loans", "dues", "payments"] as const) {
      const col = t === "loans" ? "id" : "loan_id";
      expect((await collector.db.from(t).select("id").eq(col, theirs.loanId)).data, t).toHaveLength(0);
    }

    expect((await pay(collector.db, mine.loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 })).error).toBeNull();

    const sneaky = await pay(collector.db, theirs.loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 }, { from: await readLoan(owner.db, theirs.loanId) });
    expect(codeOf(sneaky)).toBe("NOT_FOUND");
    expect(await paymentsOf(theirs.loanId)).toHaveLength(0);

    expect(codeOf(await giveLoan(collector.db, monthly(mine.customerId)))).toBe("NOT_ALLOWED");
    expect((await collector.db.from("customers").insert({ name: "By Collector" }).select()).error).not.toBeNull();
    expect((await collector.db.from("customers").update({ collector_id: collector.id }).eq("id", theirs.customerId).select()).data ?? []).toHaveLength(0);
  });

  it("only the owner can change roles or switch a login off", async () => {
    expect((await staff.db.from("profiles").update({ role: "owner" }).eq("id", staff.id).select()).data ?? []).toHaveLength(0);
    expect((await collector.db.from("profiles").update({ active: false }).eq("id", owner.id).select()).data ?? []).toHaveLength(0);
    const temp = await makeUser("staff", "Temp");
    expect((await owner.db.from("profiles").update({ active: false }).eq("id", temp.id).select()).data).toHaveLength(1);
    expect((await temp.db.from("customers").select("id").limit(1)).data).toHaveLength(0);
  });
});

describe("amounts in the activity list", () => {
  it("are written the Indian way: ₹1,00,000, not ₹100,000", async () => {
    const text = async (p: number) => (await admin.rpc("rupee_text", { p })).data;
    expect(await text(rupees(500))).toBe("₹500");
    expect(await text(rupees(3000))).toBe("₹3,000");
    expect(await text(rupees(23000))).toBe("₹23,000");
    expect(await text(rupees(100000))).toBe("₹1,00,000");
    expect(await text(rupees(1250000))).toBe("₹12,50,000");
    expect(await text(rupees(12345678))).toBe("₹1,23,45,678");
    expect(await text(rupees(1000) + 50)).toBe("₹1,000.50");
    expect(await text(0)).toBe("₹0");

    const { loanId } = await newLoan(rupees(250000));
    const log = (await owner.db.from("activity").select("text").eq("loan_id", loanId).eq("kind", "loan").single()).data!;
    expect(log.text).toContain("₹2,50,000 given to");
  });
});

describe("deleting a customer", () => {
  it("the owner can delete a customer who has no loans; the log keeps what was deleted", async () => {
    const id = await addCustomer(owner.db, "Wrong Entry");
    expect((await owner.db.from("customers").update({ area: "Somewhere" }).eq("id", id).select()).data).toHaveLength(1);
    const res = await owner.db.rpc("delete_customer", { p_customer_id: id });
    expect(res.error).toBeNull();
    expect((await admin.from("customers").select("id").eq("id", id)).data).toEqual([]);
    // the newest entry says who was deleted, and carries the details
    const last = (await owner.db.from("activity").select("text,by_name,data,customer_id").order("id", { ascending: false }).limit(1).single()).data!;
    expect(last.text).toBe(`Deleted customer Wrong Entry (${id})`);
    expect(last.by_name).toBe("Test Owner");
    expect(last.customer_id).toBeNull();
    expect(last.data.customer).toMatchObject({ id, name: "Wrong Entry", phone: "9000000000", area: "Somewhere" });
    // earlier entries about that customer are still there, no longer pointing at a customer
    const earlier = (await admin.from("activity").select("text,customer_id").in("text", ["Added customer Wrong Entry", "Edited customer Wrong Entry"])).data!;
    expect(earlier.length).toBeGreaterThanOrEqual(2);
    expect(earlier.every((a) => a.customer_id !== id)).toBe(true);
    // a second try says it is gone
    expect(codeOf(await owner.db.rpc("delete_customer", { p_customer_id: id }))).toBe("NOT_FOUND");
  });

  it("a customer with a loan cannot be deleted, not even a closed one", async () => {
    const { customerId, loanId } = await newLoan();
    expect(codeOf(await owner.db.rpc("delete_customer", { p_customer_id: customerId }))).toBe("HAS_LOANS");
    const paid = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: rupees(100000), other: 0 });
    expect(paid.error).toBeNull();
    expect((await readLoan(owner.db, loanId)).loan.status).toBe("closed");
    expect(codeOf(await owner.db.rpc("delete_customer", { p_customer_id: customerId }))).toBe("HAS_LOANS");
    expect((await admin.from("customers").select("id").eq("id", customerId)).data).toHaveLength(1);
  });

  it("only the owner can delete, and never by writing to the table", async () => {
    const id = await addCustomer(owner.db, "Keep Me", collector.id);
    expect(codeOf(await staff.db.rpc("delete_customer", { p_customer_id: id }))).toBe("NOT_ALLOWED");
    expect(codeOf(await collector.db.rpc("delete_customer", { p_customer_id: id }))).toBe("NOT_ALLOWED");
    expect((await anon.rpc("delete_customer", { p_customer_id: id })).error).not.toBeNull();
    await owner.db.from("customers").delete().eq("id", id);
    await staff.db.from("customers").delete().eq("id", id);
    expect((await admin.from("customers").select("id").eq("id", id)).data).toHaveLength(1);
  });

  it("the activity log stays locked: only its link to a deleted customer may be cleared", async () => {
    const id = await addCustomer(owner.db, "Log Check");
    const other = await addCustomer(owner.db, "Other Person");
    const row = (await admin.from("activity").select("id").eq("customer_id", id).limit(1).single()).data!;
    expect((await admin.from("activity").update({ text: "changed" }).eq("id", row.id)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("activity").update({ customer_id: other }).eq("id", row.id)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("activity").update({ customer_id: null, by_name: "Someone" }).eq("id", row.id)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("activity").delete().eq("id", row.id)).error?.message).toMatch(/HISTORY_LOCKED/);
  });
});

describe("private documents", () => {
  const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: "image/png" });

  it("are stored privately: owner can add and open, others cannot", async () => {
    const mine = await newLoan(rupees(100000), collector.id);
    const path = `${mine.loanId}/photo-${Date.now()}.png`;
    expect((await owner.db.storage.from("documents").upload(path, png)).error).toBeNull();

    // no public URL
    const pub = await fetch(`${admin.storage.from("documents").getPublicUrl(path).data.publicUrl}`);
    expect(pub.ok).toBe(false);
    expect((await anon.storage.from("documents").download(path)).error).not.toBeNull();

    // the loan's collector can open it through a short-lived link; another collector cannot
    const signed = await collector.db.storage.from("documents").createSignedUrl(path, 60);
    expect(signed.error).toBeNull();
    expect((await fetch(signed.data!.signedUrl)).ok).toBe(true);
    expect((await otherCollector.db.storage.from("documents").createSignedUrl(path, 60)).error).not.toBeNull();

    // collectors cannot add files; only the owner can remove them
    expect((await collector.db.storage.from("documents").upload(`${mine.loanId}/c-1.png`, png)).error).not.toBeNull();
    await staff.db.storage.from("documents").remove([path]);
    expect((await owner.db.storage.from("documents").download(path)).error).toBeNull();

    // staff can add; the loan's people can list its files, another collector sees none
    expect((await staff.db.storage.from("documents").upload(`${mine.loanId}/side-2.png`, png)).error).toBeNull();
    expect((await collector.db.storage.from("documents").list(mine.loanId)).data!.map((f) => f.name).sort()).toEqual([path.split("/")[1], "side-2.png"].sort());
    expect((await otherCollector.db.storage.from("documents").list(mine.loanId)).data).toEqual([]);

    // the owner removes a file: it is gone
    expect((await owner.db.storage.from("documents").remove([path])).data).toHaveLength(1);
    expect((await owner.db.storage.from("documents").download(path)).error).not.toBeNull();
  });

  it("refuse files that are too large or of the wrong kind", async () => {
    const { loanId } = await newLoan();
    const big = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: "image/png" });
    expect((await owner.db.storage.from("documents").upload(`${loanId}/big-1.png`, big)).error).not.toBeNull();
    const exe = new Blob(["MZ"], { type: "application/x-msdownload" });
    expect((await owner.db.storage.from("documents").upload(`${loanId}/a.exe`, exe)).error).not.toBeNull();
    // a program dressed up as a picture is refused too
    expect((await owner.db.storage.from("documents").upload(`${loanId}/a-1.png`, exe)).error).not.toBeNull();
  });

  it("files go only under a real loan, with the names the app uses", async () => {
    const { loanId } = await newLoan();
    const up = (who: TestUser, path: string) => who.db.storage.from("documents").upload(path, png);
    for (const who of [owner, staff]) {
      expect((await up(who, `junk/front-1.png`)).error, "not a loan").not.toBeNull();
      expect((await up(who, `LP-99999999/front-1.png`)).error, "no such loan").not.toBeNull();
      expect((await up(who, `front-1.png`)).error, "no folder").not.toBeNull();
      expect((await up(who, `${loanId}/deep/front-1.png`)).error, "nested").not.toBeNull();
      expect((await up(who, `${loanId}/Front 1.png`)).error, "odd name").not.toBeNull();
      expect((await up(who, `${loanId}/front-1.svg`)).error, "wrong ending").not.toBeNull();
    }
    expect((await up(staff, `${loanId}/front-1.png`)).error).toBeNull();
    expect((await admin.storage.from("documents").list(loanId)).data!.map((f) => f.name)).toEqual(["front-1.png"]);
  });

  it("a customer's photo and ID photos are kept under the customer, with the same rules", async () => {
    const mine = await addCustomer(owner.db, "Photo Customer", collector.id);
    const up = (who: TestUser, path: string) => who.db.storage.from("documents").upload(path, png);
    // owner and staff add; a collector does not
    expect((await up(staff, `${mine}/photo-100.png`)).error).toBeNull();
    expect((await up(owner, `${mine}/idfront-100.png`)).error).toBeNull();
    expect((await up(collector, `${mine}/idback-100.png`)).error).not.toBeNull();
    // not under a customer that does not exist
    expect((await up(owner, `C99999999/photo-1.png`)).error).not.toBeNull();
    // staff cannot put a newer photo over the first; the owner can
    expect((await up(staff, `${mine}/photo-999.png`)).error).not.toBeNull();
    expect((await up(owner, `${mine}/photo-200.png`)).error).toBeNull();

    // the customer's own collector sees them through a signed link; another collector sees nothing
    const signed = await collector.db.storage.from("documents").createSignedUrl(`${mine}/photo-100.png`, 60);
    expect(signed.error).toBeNull();
    expect((await fetch(signed.data!.signedUrl)).ok).toBe(true);
    expect((await otherCollector.db.storage.from("documents").createSignedUrl(`${mine}/photo-100.png`, 60)).error).not.toBeNull();
    expect((await otherCollector.db.storage.from("documents").list(mine)).data).toEqual([]);
    // no public address, nothing without signing in
    expect((await fetch(admin.storage.from("documents").getPublicUrl(`${mine}/photo-100.png`).data.publicUrl)).ok).toBe(false);
    expect((await anon.storage.from("documents").download(`${mine}/photo-100.png`)).error).not.toBeNull();
    // only the owner removes
    await staff.db.storage.from("documents").remove([`${mine}/photo-100.png`]);
    expect((await owner.db.storage.from("documents").download(`${mine}/photo-100.png`)).error).toBeNull();
    expect((await owner.db.storage.from("documents").remove([`${mine}/photo-100.png`])).data).toHaveLength(1);
  });

  it("staff can fill an empty tile but cannot put a newer photo over an existing one; the owner can", async () => {
    const { loanId } = await newLoan();
    const up = (who: TestUser, name: string) => who.db.storage.from("documents").upload(`${loanId}/${name}`, png);
    expect((await up(staff, "front-100.png")).error).toBeNull();
    // same tile, later time: this would become the photo everyone sees
    expect((await up(staff, "front-999.png")).error).not.toBeNull();
    // another tile is fine, also one whose name merely starts the same way
    expect((await up(staff, "side-100.png")).error).toBeNull();
    expect((await up(staff, "front2-100.png")).error).toBeNull();
    // the owner replaces: the new one is added (the app then removes the old one)
    expect((await up(owner, "front-200.png")).error).toBeNull();
    expect((await admin.storage.from("documents").list(loanId)).data!.map((f) => f.name).sort()).toEqual(["front-100.png", "front-200.png", "front2-100.png", "side-100.png"]);
  });
});

describe("the next collection is worked out by the database itself", () => {
  it("opens the next collection itself, exactly as the engine expects", async () => {
    const { loanId } = await newLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: rupees(40000), other: 0 });
    expect(res.error).toBeNull();
    const { dues } = await readLoan(owner.db, loanId);
    expect(dues).toHaveLength(2);
    expect(dues[1]).toMatchObject({ dueDate: res.result.nextDue!.dueDate, interestAmount: res.result.nextDue!.interestAmount, principalAmount: 0, paid: 0 });
    expect(dues[1].interestAmount).toBe(rupees(1800));
  });

  it("refuses a collection it did not create", async () => {
    for (const made of [
      { due_date: "2099-01-01", interest_amount: 0 },
      { due_date: shift(TODAY, 30), interest_amount: rupees(3000) },
    ]) {
      const { loanId } = await newLoan();
      const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 }, {
        tamper: (a) => a.p_dues.push({ id: randomUUID(), principal_amount: 0, paid: 0, interest_paid: 0, waived: 0, last_paid_date: null, cancelled: false, ...made }),
      });
      expect(codeOf(res)).toBe("MISMATCH");
      expect(await paymentsOf(loanId)).toHaveLength(0);
      expect((await readLoan(owner.db, loanId)).dues).toHaveLength(1);
    }
  });

  it("refuses a first collection that does not match the loan terms", async () => {
    const customerId = await addCustomer(owner.db, "Odd Terms");
    const draft = monthly(customerId);
    const res = await owner.db.rpc("create_loan", {
      p_key: randomUUID(),
      p_loan: { customer_id: customerId, type: "monthly", amount: draft.amount, start_date: draft.startDate, interest_style: "percent", interest_value: 3, interest_method: "reducing", frequency: "monthly", principal_per_due: 0 },
      p_first_due: { id: randomUUID(), due_date: "2099-01-01", interest_amount: 0, principal_amount: 0 },
    });
    expect(codeOf(res)).toBe("MISMATCH");
  });

  it("works interest out exactly as the engine in the app does", async () => {
    const { periodInterest } = await import("../../src/lib/finance/engine");
    const cases: [string, number, string, number, number][] = [
      ["percent", 3, "reducing", rupees(100000), rupees(60000)],
      ["percent", 3, "fixed", rupees(100000), rupees(60000)],
      ["percent", 2.5, "reducing", rupees(33333), rupees(33333)],
      ["percent", 1.5, "reducing", rupees(100033), rupees(100033)],
      ["percent", 1.5, "reducing", rupees(100034), rupees(100034)],
      ["percent", 1, "reducing", rupees(50), rupees(50)],
      ["percent", 3, "reducing", rupees(100000), rupees(10)],
      ["percent", 1.15, "fixed", rupees(5_000_000_000), rupees(1)],
      ["percent", 3, "manual", rupees(100000), rupees(80000)],
      ["percent", 0, "reducing", rupees(100000), rupees(100000)],
      ["fixed", 600050, "fixed", rupees(100000), rupees(100000)],
      ["custom", rupees(750), "manual", rupees(100000), rupees(100000)],
    ];
    for (const [style, value, method, amount, left] of cases) {
      const db = await admin.rpc("period_interest", { p_style: style, p_value: value, p_method: method, p_amount: amount, p_left: left });
      expect(db.error).toBeNull();
      const app = periodInterest({ interest: { style, value, method } as never, amount, principalLeft: left });
      expect(db.data, `${style} ${value} ${method} on ${left}`).toBe(app);
    }
  });

  it("works collection dates out exactly as the engine in the app does", async () => {
    const { nextDueDate } = await import("../../src/lib/finance/engine");
    const cases: [string, string, string][] = [
      ["2026-01-31", "monthly", "2026-01-31"],
      ["2026-02-28", "monthly", "2026-01-31"],
      ["2026-03-31", "monthly", "2026-01-31"],
      ["2028-02-29", "monthly", "2027-12-31"],
      ["2026-09-10", "monthly", "2026-06-10"],
      ["2026-09-15", "monthly", "2026-06-10"],
      ["2026-12-30", "monthly", "2026-08-30"],
      ["2026-09-01", "weekly", "2026-08-01"],
      ["2026-09-01", "15days", "2026-08-01"],
      ["2026-09-01", "30days", "2026-08-01"],
      ["2026-09-01", "custom", "2026-08-01"],
    ];
    for (const [from, freq, anchor] of cases) {
      const db = await admin.rpc("next_due_date", { p_from: from, p_frequency: freq, p_anchor: anchor });
      expect(db.error).toBeNull();
      expect(db.data, `${from} ${freq} anchor ${anchor}`).toBe(nextDueDate(from, freq as never, 1, anchor));
    }
  });
});

describe("more points from the security review", () => {
  it("interest written off at settlement is shown in the activity log", async () => {
    const { loanId } = await newLoan();
    const { dues } = await readLoan(owner.db, loanId);
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(1000), principal: rupees(100000), other: 0, waive: [{ dueId: dues[0].id, amount: rupees(2000) }], waiveReason: "Agreed settlement" });
    expect(res.error).toBeNull();
    expect((await readLoan(owner.db, loanId)).loan.status).toBe("closed");
    const log = await owner.db.from("activity").select("text,data").eq("loan_id", loanId).eq("kind", "payment").single();
    expect(log.data!.text).toContain("₹2,000 interest waived: Agreed settlement");
    expect(log.data!.data.waived).toBe(rupees(2000));
  });

  it("refuses to close a loan on a date before its latest payment", async () => {
    const { loanId } = await newLoan();
    await pay(owner.db, loanId, { date: TODAY, interest: rupees(1000), principal: 0, other: 0 });
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(2000), principal: rupees(100000), other: 0 }, {
      tamper: (a) => {
        a.p_payment.date = shift(TODAY, -5);
        for (const d of a.p_dues) d.last_paid_date = shift(TODAY, -5);
      },
    });
    expect(codeOf(res)).toBe("BEFORE_LAST_PAYMENT");
  });

  it("customer edits are logged, and only the owner can move a customer to another collector", async () => {
    const customerId = await addCustomer(owner.db, "Audit Me", collector.id);
    expect((await staff.db.from("customers").update({ phone: "9111111111" }).eq("id", customerId).select()).data).toHaveLength(1);
    const log = await owner.db.from("activity").select("text,data").eq("customer_id", customerId).order("id", { ascending: false }).limit(1).single();
    expect(log.data!.text).toBe("Edited customer Audit Me");
    expect(log.data!.data).toMatchObject({ before: { phone: "9000000000" }, after: { phone: "9111111111" } });

    expect((await staff.db.from("customers").update({ collector_id: otherCollector.id }).eq("id", customerId).select()).error?.message).toMatch(/NOT_ALLOWED/);
    expect((await owner.db.from("customers").update({ collector_id: otherCollector.id }).eq("id", customerId).select()).data).toHaveLength(1);
  });

  it("a collection date cannot be moved into the past or years ahead", async () => {
    const { loanId } = await newLoan();
    const { dues } = await readLoan(owner.db, loanId);
    expect(codeOf(await owner.db.rpc("reschedule_due", { p_due_id: dues[0].id, p_new_date: shift(TODAY, -1), p_reason: "x" }))).toBe("PAST_DATE");
    expect(codeOf(await owner.db.rpc("reschedule_due", { p_due_id: dues[0].id, p_new_date: "2099-01-01", p_reason: "x" }))).toBe("TOO_FAR");
    expect(codeOf(await owner.db.rpc("reschedule_due", { p_due_id: dues[0].id, p_new_date: "infinity", p_reason: "x" }))).toBe("PAST_DATE");
  });

  it("helper functions cannot be called from the app", async () => {
    for (const [fn, args] of [
      ["log_activity", { p_kind: "system", p_text: "fake", p_loan_id: null, p_customer_id: null }],
      ["set_id_counters", { p_customer: 1, p_loan: 1 }],
      ["period_interest", { p_style: "fixed", p_value: 1, p_method: "fixed", p_amount: 1, p_left: 1 }],
    ] as const) {
      expect((await owner.db.rpc(fn, args)).error, fn).not.toBeNull();
      expect((await anon.rpc(fn, args)).error, fn).not.toBeNull();
    }
  });
});
