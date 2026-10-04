// Missed interest, against the real database: every missed period stays pending on
// its own, the owner decides what a payment covers, waivers need the owner and a
// reason, and neither a double tap nor two people at once can count the same
// pending interest twice.

import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { accrueDues, dueInterestLeft, pendingInterest } from "../../src/lib/finance/engine";
import { rupees } from "../../src/lib/finance/money";
import type { Due } from "../../src/lib/types";
import { accrue, addCustomer, admin, codeOf, giveLoan, makeUser, pay, readLoan, shift, today, type TestUser } from "./helpers";

let owner: TestUser;
let collector: TestUser;
let TODAY: string;

/** 1,00,000 at 3% a month, given 95 days ago and never paid: three months missed, a fourth running. */
async function missedLoan(collectorId?: string) {
  const customerId = await addCustomer(owner.db, `Missed ${randomUUID().slice(0, 6)}`, collectorId);
  const res = await giveLoan(owner.db, {
    customerId,
    type: "monthly",
    amount: rupees(100000),
    startDate: shift(TODAY, -95),
    interest: { style: "percent", value: 3, method: "reducing" },
    frequency: "monthly",
    principalPerDue: 0,
  });
  if (res.error) throw new Error(res.error.message);
  const loanId = res.data.loan_id as string;
  return { loanId, customerId, ...(await readLoan(owner.db, loanId)) };
}

const left = (dues: Due[]) => dues.map((d) => dueInterestLeft(d) / 100);
const payments = async (loanId: string) => (await admin.from("payments").select("*").eq("loan_id", loanId).order("recorded_at")).data ?? [];
const allocations = async (loanId: string) => (await admin.from("payment_allocations").select("*").eq("loan_id", loanId)).data ?? [];

beforeAll(async () => {
  owner = await makeUser("owner", "Missed Owner");
  collector = await makeUser("collector", "Missed Collector");
  TODAY = await today(owner.db);
}, 60_000);

describe("1. three missed months all stay pending", () => {
  it("a loan given 95 days ago has three missed collections and one running", async () => {
    const { dues } = await missedLoan();
    expect(dues).toHaveLength(4);
    expect(left(dues)).toEqual([3000, 3000, 3000, 3000]);
    expect(dues.filter((d) => d.dueDate < TODAY)).toHaveLength(3);
    expect(pendingInterest(dues, TODAY)).toBe(rupees(9000));
  });

  it("the database and the engine work out the same collections", async () => {
    const { loan, dues } = await missedLoan();
    const mine = accrueDues({ ...loan, security: null }, [], TODAY, (n) => `E${n}`);
    expect(mine.map((d) => [d.dueDate, d.interestAmount, d.principalAmount])).toEqual(dues.map((d) => [d.dueDate, d.interestAmount, d.principalAmount]));
  });

  it("the same holds for an instalment loan that has fallen behind", async () => {
    const customerId = await addCustomer(owner.db, "Weekly Behind");
    const terms = { customerId, type: "weekly" as const, amount: rupees(9000), startDate: shift(TODAY, -40), interest: { style: "fixed" as const, value: rupees(300), method: "fixed" as const }, frequency: "weekly" as const, principalPerDue: rupees(3000) };
    const loanId = (await giveLoan(owner.db, terms)).data.loan_id;
    const { loan, dues } = await readLoan(owner.db, loanId);
    const mine = accrueDues({ ...loan, security: null }, [], TODAY, (n) => `E${n}`);
    expect(dues.map((d) => [d.dueDate, d.interestAmount, d.principalAmount])).toEqual(mine.map((d) => [d.dueDate, d.interestAmount, d.principalAmount]));
    expect(dues.reduce((a, d) => a + d.principalAmount, 0)).toBe(rupees(9000));
  });

  it("working it out again, or opening the app again, adds nothing", async () => {
    const { loanId } = await missedLoan();
    await accrue(loanId);
    expect((await owner.db.rpc("accrue_all")).error).toBeNull();
    expect((await readLoan(owner.db, loanId)).dues).toHaveLength(4);
  });
});

describe("2-6. the owner chooses what a payment covers", () => {
  it("2. only the latest missed month: the older two stay pending", async () => {
    const { loanId, dues } = await missedLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0, allocations: [{ dueId: dues[2].id, amount: rupees(3000) }] });
    expect(res.error).toBeNull();
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([3000, 3000, 0, 3000]);
    expect(await allocations(loanId)).toMatchObject([{ due_id: dues[2].id, interest: rupees(3000), principal: 0, waived: 0 }]);
  });

  it("3. the oldest month only (an amount with no choice goes to the oldest)", async () => {
    const { loanId } = await missedLoan();
    expect((await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 })).error).toBeNull();
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([0, 3000, 3000, 3000]);
  });

  it("4. two of the three", async () => {
    const { loanId, dues } = await missedLoan();
    const picks = [{ dueId: dues[0].id, amount: rupees(3000) }, { dueId: dues[2].id, amount: rupees(3000) }];
    expect((await pay(owner.db, loanId, { date: TODAY, interest: rupees(6000), principal: 0, other: 0, allocations: picks })).error).toBeNull();
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([0, 3000, 0, 3000]);
    expect(await allocations(loanId)).toHaveLength(2);
  });

  it("5. part of one month: the rest of it stays pending", async () => {
    const { loanId, dues } = await missedLoan();
    expect((await pay(owner.db, loanId, { date: TODAY, interest: rupees(1500), principal: 0, other: 0, allocations: [{ dueId: dues[1].id, amount: rupees(1500) }] })).error).toBeNull();
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([3000, 1500, 3000, 3000]);
  });

  it("6. one payment across several months", async () => {
    const { loanId } = await missedLoan();
    expect((await pay(owner.db, loanId, { date: TODAY, interest: rupees(7500), principal: 0, other: 0 })).error).toBeNull();
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([0, 0, 1500, 3000]);
    expect((await payments(loanId))[0].interest).toBe(rupees(7500));
    expect((await allocations(loanId)).map((a) => a.interest).sort()).toEqual([rupees(1500), rupees(3000), rupees(3000)].sort());
  });

  it("refuses interest counted against a month beyond what that month has pending", async () => {
    const { loanId, dues } = await missedLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 }, {
      tamper: (a) => {
        a.p_payment.interest = rupees(4000);
        a.p_dues[0].interest_paid = rupees(4000);
        a.p_dues[0].paid = rupees(4000);
      },
    });
    expect(res.error).not.toBeNull();
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([3000, 3000, 3000, 3000]);
    expect(dues).toHaveLength(4);
  });
});

describe("7-8. principal while interest is pending", () => {
  it("7. principal only: interest untouched, later months use the new balance", async () => {
    const { loanId } = await missedLoan();
    expect((await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(40000), other: 0 })).error).toBeNull();
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan).toMatchObject({ principalLeft: rupees(60000), status: "active" });
    expect(left(dues)).toEqual([3000, 3000, 3000, 3000]);
  });

  it("8. principal with one chosen month of interest", async () => {
    const { loanId, dues } = await missedLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: rupees(40000), other: 0, allocations: [{ dueId: dues[1].id, amount: rupees(3000) }] });
    expect(res.error).toBeNull();
    const after = await readLoan(owner.db, loanId);
    expect(after.loan.principalLeft).toBe(rupees(60000));
    expect(left(after.dues)).toEqual([3000, 0, 3000, 3000]);
    expect((await payments(loanId))[0]).toMatchObject({ interest: rupees(3000), principal: rupees(40000) });
  });
});

describe("9. all principal back with interest pending: the owner decides", () => {
  it("the loan stays open and no interest is cleared by itself", async () => {
    const { loanId } = await missedLoan();
    expect((await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(100000), other: 0 })).error).toBeNull();
    const { loan, dues } = await readLoan(owner.db, loanId);
    expect(loan).toMatchObject({ principalLeft: 0, status: "active" });
    expect(loan.closedDate).toBeUndefined();
    expect(left(dues)).toEqual([3000, 3000, 3000, 3000]);
    expect(dues.some((d) => d.cancelled || d.waived)).toBe(false);
    // and no further interest is added once the principal is back
    await accrue(loanId);
    expect((await readLoan(owner.db, loanId)).dues).toHaveLength(4);
  });

  it("the database refuses a request that quietly drops the pending interest", async () => {
    const { loanId } = await missedLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(100000), other: 0 }, {
      tamper: (a) => {
        a.p_loan.status = "closed";
      },
    });
    expect(codeOf(res)).toBe("MISMATCH");
    expect((await readLoan(owner.db, loanId)).loan).toMatchObject({ principalLeft: rupees(100000), status: "active" });
  });

  it("cancelling a missed month by hand is refused", async () => {
    const { loanId, dues } = await missedLoan();
    const res = await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(100000), other: 0 }, {
      tamper: (a) => a.p_dues.push({ id: dues[0].id, paid: 0, interest_paid: 0, waived: 0, last_paid_date: null, cancelled: true }),
    });
    expect(codeOf(res)).toBe("MISMATCH");
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([3000, 3000, 3000, 3000]);
  });

  it("collecting the interest afterwards closes the loan", async () => {
    const { loanId } = await missedLoan();
    await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(100000), other: 0 });
    expect((await pay(owner.db, loanId, { date: TODAY, interest: rupees(12000), principal: 0, other: 0 })).error).toBeNull();
    expect((await readLoan(owner.db, loanId)).loan).toMatchObject({ status: "closed", closedDate: TODAY, principalLeft: 0 });
  });

  it("a full settlement: collect some interest, waive the rest with a reason, loan closes", async () => {
    const { loanId, dues } = await missedLoan();
    const waive = [dues[2], dues[3]].map((d) => ({ dueId: d.id, amount: rupees(3000) }));
    const res = await pay(owner.db, loanId, { date: TODAY, interest: rupees(6000), principal: rupees(100000), other: 0, waive, waiveReason: "Agreed settlement" });
    expect(res.error).toBeNull();
    const after = await readLoan(owner.db, loanId);
    expect(after.loan).toMatchObject({ status: "closed", principalLeft: 0, closedDate: TODAY });
    expect(after.dues.map((d) => [d.interestPaid! / 100, d.waived! / 100])).toEqual([[3000, 0], [3000, 0], [0, 3000], [0, 3000]]);
    const [p] = await payments(loanId);
    expect(p.interest).toBe(rupees(6000));
  });
});

describe("10. the owner waives interest, with a reason and a record", () => {
  it("waives one month: marked as waived, never as received, other months untouched", async () => {
    const { loanId, loan, dues } = await missedLoan();
    const res = await owner.db.rpc("waive_interest", { p_loan_id: loanId, p_version: loan.version, p_waive: [{ due_id: dues[1].id, amount: rupees(3000) }], p_reason: "Shop was closed for a month" });
    expect(res.error).toBeNull();
    const after = await readLoan(owner.db, loanId);
    expect(after.dues[1]).toMatchObject({ waived: rupees(3000), interestPaid: 0, paid: 0 });
    expect(left(after.dues)).toEqual([3000, 0, 3000, 3000]);
    expect(await payments(loanId)).toHaveLength(0);

    const record = (await owner.db.from("waivers").select("*").eq("loan_id", loanId)).data!;
    expect(record).toHaveLength(1);
    expect(record[0]).toMatchObject({ due_id: dues[1].id, amount: rupees(3000), reason: "Shop was closed for a month", by: owner.id, by_name: "Missed Owner", payment_id: null });
    const log = (await owner.db.from("activity").select("text,data").eq("loan_id", loanId).order("id", { ascending: false }).limit(1)).data![0];
    expect(log.text).toContain("Waived ₹3,000 interest");
    expect(log.text).toContain("Shop was closed for a month");
  });

  it("needs a reason, the owner, and an amount that is really pending", async () => {
    const { loanId, loan, dues } = await missedLoan(collector.id);
    const args = { p_loan_id: loanId, p_version: loan.version, p_waive: [{ due_id: dues[1].id, amount: rupees(3000) }] };
    expect(codeOf(await owner.db.rpc("waive_interest", { ...args, p_reason: "  " }))).toBe("REASON_NEEDED");
    expect(codeOf(await collector.db.rpc("waive_interest", { ...args, p_reason: "please" }))).toBe("NOT_ALLOWED");
    expect(codeOf(await owner.db.rpc("waive_interest", { ...args, p_waive: [{ due_id: dues[1].id, amount: rupees(3001) }], p_reason: "x" }))).toBe("WAIVE_TOO_LARGE");
    expect(codeOf(await owner.db.rpc("waive_interest", { ...args, p_version: loan.version + 5, p_reason: "x" }))).toBe("CONFLICT");
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([3000, 3000, 3000, 3000]);
    expect((await admin.from("waivers").select("id").eq("loan_id", loanId)).data).toHaveLength(0);
  });

  it("a waiver record cannot be edited or deleted", async () => {
    const { loanId, loan, dues } = await missedLoan();
    await owner.db.rpc("waive_interest", { p_loan_id: loanId, p_version: loan.version, p_waive: [{ due_id: dues[0].id, amount: rupees(1000) }], p_reason: "Goodwill" });
    expect((await admin.from("waivers").update({ amount: 1 }).eq("loan_id", loanId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await admin.from("waivers").delete().eq("loan_id", loanId)).error?.message).toMatch(/HISTORY_LOCKED/);
    expect((await owner.db.from("waivers").insert({ loan_id: loanId, due_id: dues[0].id, amount: 5, reason: "fake" })).error).not.toBeNull();
  });

  it("waiving everything on a loan whose principal is back closes it", async () => {
    const { loanId } = await missedLoan();
    await pay(owner.db, loanId, { date: TODAY, interest: 0, principal: rupees(100000), other: 0 });
    const { loan, dues } = await readLoan(owner.db, loanId);
    const res = await owner.db.rpc("waive_interest", { p_loan_id: loanId, p_version: loan.version, p_waive: dues.map((d) => ({ due_id: d.id, amount: rupees(3000) })), p_reason: "Old customer" });
    expect(res.data).toMatchObject({ closed: true, waived: rupees(12000) });
    expect((await readLoan(owner.db, loanId)).loan).toMatchObject({ status: "closed", closedDate: TODAY });
  });

  it("reversing a payment that carried a waiver puts the interest back as pending", async () => {
    const { loanId, dues } = await missedLoan();
    const paid = await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0, waive: [{ dueId: dues[1].id, amount: rupees(3000) }], waiveReason: "Mistake" });
    expect(paid.error).toBeNull();
    expect((await owner.db.rpc("reverse_payment", { p_payment_id: paid.paymentId, p_reason: "Wrong loan" })).error).toBeNull();
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([3000, 3000, 3000, 3000]);
    const record = (await admin.from("waivers").select("reversed_at").eq("loan_id", loanId)).data!;
    expect(record[0].reversed_at).not.toBeNull();
  });
});

describe("11. a backdated payment against an old missed month", () => {
  it("clears that month and is dated when it was paid", async () => {
    const { loanId, dues } = await missedLoan();
    const paidOn = shift(dues[0].dueDate, 3);
    const res = await pay(owner.db, loanId, { date: paidOn, interest: rupees(3000), principal: 0, other: 0, allocations: [{ dueId: dues[0].id, amount: rupees(3000) }] });
    expect(res.error).toBeNull();
    const after = await readLoan(owner.db, loanId);
    expect(left(after.dues)).toEqual([0, 3000, 3000, 3000]);
    expect(after.dues[0].lastPaidDate).toBe(paidOn);
    expect((await payments(loanId))[0]).toMatchObject({ payment_date: paidOn, recorded_on: TODAY });
  });
});

describe("12-13. the same pending interest is never counted twice", () => {
  it("12. a double submission records one payment and one set of allocations", async () => {
    const { loanId } = await missedLoan();
    await accrue(loanId);
    const from = await readLoan(owner.db, loanId);
    const key = randomUUID();
    const input = { date: TODAY, interest: rupees(6000), principal: 0, other: 0 };
    const results = await Promise.all([1, 2, 3, 4].map(() => pay(owner.db, loanId, input, { key, from })));
    expect(results.every((r) => !r.error)).toBe(true);
    expect(results.filter((r) => r.data.duplicate === false)).toHaveLength(1);
    expect(await payments(loanId)).toHaveLength(1);
    expect(await allocations(loanId)).toHaveLength(2);
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([0, 0, 3000, 3000]);
  });

  it("13. two people collecting the same month at once: one is saved, the month is paid once", async () => {
    const { loanId, dues } = await missedLoan();
    const from = await readLoan(owner.db, loanId);
    const input = { date: TODAY, interest: rupees(3000), principal: 0, other: 0, allocations: [{ dueId: dues[0].id, amount: rupees(3000) }] };
    const results = await Promise.all([1, 2, 3].map(() => pay(owner.db, loanId, input, { from })));
    expect(results.map(codeOf).sort()).toEqual(["CONFLICT", "CONFLICT", "ok"]);
    const after = await readLoan(owner.db, loanId);
    expect(after.dues[0]).toMatchObject({ interestPaid: rupees(3000), paid: rupees(3000) });
    expect(left(after.dues)).toEqual([0, 3000, 3000, 3000]);
    expect(await payments(loanId)).toHaveLength(1);
  });

  it("13b. a payment and a waiver racing for the same month cannot both take it", async () => {
    const { loanId, loan, dues } = await missedLoan();
    const from = await readLoan(owner.db, loanId);
    const [p, w] = await Promise.all([
      pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0, allocations: [{ dueId: dues[0].id, amount: rupees(3000) }] }, { from }),
      owner.db.rpc("waive_interest", { p_loan_id: loanId, p_version: loan.version, p_waive: [{ due_id: dues[0].id, amount: rupees(3000) }], p_reason: "race" }),
    ]);
    expect([codeOf(p), codeOf(w)].sort()).toEqual(["CONFLICT", "ok"]);
    const d = (await readLoan(owner.db, loanId)).dues[0];
    expect((d.interestPaid ?? 0) + (d.waived ?? 0)).toBe(rupees(3000));
  });
});

describe("who can do it", () => {
  it("a collector can choose months for their own customer, but cannot waive", async () => {
    const { loanId, dues } = await missedLoan(collector.id);
    expect((await pay(collector.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0, allocations: [{ dueId: dues[2].id, amount: rupees(3000) }] })).error).toBeNull();
    const res = await pay(collector.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0, waive: [{ dueId: dues[1].id, amount: rupees(3000) }], waiveReason: "ok?" });
    expect(codeOf(res)).toBe("NOT_ALLOWED");
    expect(left((await readLoan(owner.db, loanId)).dues)).toEqual([3000, 3000, 0, 3000]);
  });

  it("allocations and waivers are readable only by people who can see the loan", async () => {
    const { loanId } = await missedLoan();
    await pay(owner.db, loanId, { date: TODAY, interest: rupees(3000), principal: 0, other: 0 });
    expect((await collector.db.from("payment_allocations").select("payment_id").eq("loan_id", loanId)).data).toHaveLength(0);
    expect((await owner.db.from("payment_allocations").select("payment_id").eq("loan_id", loanId)).data).toHaveLength(1);
    expect((await owner.db.from("payment_allocations").update({ interest: 1 }).eq("loan_id", loanId).select()).error).not.toBeNull();
  });
});
