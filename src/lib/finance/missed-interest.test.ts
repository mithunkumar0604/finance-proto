// Confirmed by the client: every missed interest period stays pending on its own until
// it is paid, part-paid, or waived by the owner. Nothing older is ever cleared just
// because something newer is paid. The owner decides what each payment covers.

import { describe, expect, it } from "vitest";
import type { Due, Loan } from "../types";
import {
  accrueDues,
  allocateInterest,
  applyPayment,
  applyWaiver,
  dueInterestLeft,
  FinanceError,
  openDues,
  pendingInterest,
  settlementAmount,
  type PaymentInput,
} from "./engine";
import { rupees } from "./money";

const TODAY = "2026-09-29";
let seq = 0;
const ids = () => ({ paymentId: `P${++seq}`, nextDueId: `N${seq}` });
const newId = (n: number) => `A${n}`;

/** 1,00,000 at 3% a month on balance, given 1 June. Nothing has been paid. */
function loan(over: Partial<Loan> = {}): Loan {
  return {
    id: "LP-1",
    customerId: "C1",
    type: "monthly",
    amount: rupees(100000),
    startDate: "2026-06-01",
    interest: { style: "percent", value: 3, method: "reducing" },
    frequency: "monthly",
    principalPerDue: 0,
    principalLeft: rupees(100000),
    status: "active",
    security: null,
    ...over,
  };
}

/** The loan's collections as they stand today: July, August, September missed, October coming. */
function missed(l = loan()): Due[] {
  return accrueDues(l, [], TODAY, newId);
}

const pay = (over: Partial<PaymentInput>): PaymentInput => ({ loanId: "LP-1", date: TODAY, interest: 0, principal: 0, other: 0, method: "cash", ...over });
const on = (dues: Due[], date: string) => dues.find((d) => d.dueDate === date)!;
const left = (dues: Due[]) => Object.fromEntries(dues.map((d) => [d.dueDate.slice(5), dueInterestLeft(d) / 100]));
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof FinanceError) return e.code;
    throw e;
  }
  return "no error";
};

describe("1. three missed months all stay pending", () => {
  const dues = missed();

  it("has one collection for every period that has passed, and the one coming", () => {
    expect(dues.map((d) => d.dueDate)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"]);
    expect(dues.every((d) => d.interestAmount === rupees(3000) && d.paid === 0)).toBe(true);
  });
  it("totals 9,000 pending today (the October one is not due yet)", () => {
    expect(pendingInterest(dues, TODAY)).toBe(rupees(9000));
  });
  it("working it out again adds nothing", () => {
    expect(accrueDues(loan(), dues, TODAY, newId)).toEqual(dues);
  });
  it("the next period's collection appears once that period has started", () => {
    expect(accrueDues(loan(), dues, "2026-10-01", newId)).toHaveLength(4);
    expect(accrueDues(loan(), dues, "2026-10-02", newId).map((d) => d.dueDate).at(-1)).toBe("2026-11-01");
  });
});

describe("2. paying only the latest month leaves the older two pending", () => {
  const dues = missed();
  const r = applyPayment(loan(), dues, pay({ interest: rupees(3000), allocations: [{ dueId: on(dues, "2026-09-01").id, amount: rupees(3000) }] }), ids(), TODAY);

  it("clears September and nothing else", () => {
    expect(left(r.dues)).toEqual({ "07-01": 3000, "08-01": 3000, "09-01": 0, "10-01": 3000 });
    expect(pendingInterest(r.dues, TODAY)).toBe(rupees(6000));
  });
  it("still shows July and August after the collections are worked out again", () => {
    const again = accrueDues(r.loan, r.dues, "2026-12-15", newId);
    expect(dueInterestLeft(on(again, "2026-07-01"))).toBe(rupees(3000));
    expect(dueInterestLeft(on(again, "2026-08-01"))).toBe(rupees(3000));
  });
  it("records which collection the money went to", () => {
    expect(r.payment.allocations).toEqual([{ dueId: on(dues, "2026-09-01").id, interest: rupees(3000), principal: 0, waived: 0 }]);
  });
});

describe("3. paying the oldest month only", () => {
  it("an amount with no choice made goes to the oldest pending month", () => {
    const r = applyPayment(loan(), missed(), pay({ interest: rupees(3000) }), ids(), TODAY);
    expect(left(r.dues)).toEqual({ "07-01": 0, "08-01": 3000, "09-01": 3000, "10-01": 3000 });
  });
});

describe("4. paying two of the three", () => {
  it("clears exactly the two chosen", () => {
    const dues = missed();
    const r = applyPayment(
      loan(),
      dues,
      pay({ interest: rupees(6000), allocations: [{ dueId: on(dues, "2026-07-01").id, amount: rupees(3000) }, { dueId: on(dues, "2026-09-01").id, amount: rupees(3000) }] }),
      ids(),
      TODAY,
    );
    expect(left(r.dues)).toEqual({ "07-01": 0, "08-01": 3000, "09-01": 0, "10-01": 3000 });
    expect(r.loan.principalLeft).toBe(rupees(100000));
  });
});

describe("5. part payment against one period", () => {
  const dues = missed();
  const r = applyPayment(loan(), dues, pay({ interest: rupees(1500), allocations: [{ dueId: on(dues, "2026-08-01").id, amount: rupees(1500) }] }), ids(), TODAY);

  it("keeps the unpaid part of that period pending", () => {
    expect(left(r.dues)).toEqual({ "07-01": 3000, "08-01": 1500, "09-01": 3000, "10-01": 3000 });
  });
  it("the rest can be paid later", () => {
    const r2 = applyPayment(r.loan, r.dues, pay({ interest: rupees(1500), allocations: [{ dueId: on(dues, "2026-08-01").id, amount: rupees(1500) }] }), ids(), TODAY);
    expect(dueInterestLeft(on(r2.dues, "2026-08-01"))).toBe(0);
  });
});

describe("6. one payment across several periods", () => {
  it("4,500 clears July and half of August", () => {
    const r = applyPayment(loan(), missed(), pay({ interest: rupees(4500) }), ids(), TODAY);
    expect(left(r.dues)).toEqual({ "07-01": 0, "08-01": 1500, "09-01": 3000, "10-01": 3000 });
  });
  it("9,000 clears all three missed months and leaves October", () => {
    const r = applyPayment(loan(), missed(), pay({ interest: rupees(9000) }), ids(), TODAY);
    expect(left(r.dues)).toEqual({ "07-01": 0, "08-01": 0, "09-01": 0, "10-01": 3000 });
    expect(r.payment.allocations).toHaveLength(3);
  });
  it("spreads a typed amount over the chosen months first, oldest first", () => {
    const dues = missed();
    const picks = allocateInterest(dues, rupees(4000), [on(dues, "2026-09-01").id, on(dues, "2026-08-01").id]);
    expect(picks).toEqual([{ dueId: on(dues, "2026-08-01").id, amount: rupees(3000) }, { dueId: on(dues, "2026-09-01").id, amount: rupees(1000) }]);
  });
  it("refuses more interest than is pending in total", () => {
    expect(code(() => applyPayment(loan(), missed(), pay({ interest: rupees(12001) }), ids(), TODAY))).toBe("INTEREST_TOO_LARGE");
  });
  it("refuses choices that do not add up to the interest received", () => {
    const dues = missed();
    expect(code(() => applyPayment(loan(), dues, pay({ interest: rupees(3000), allocations: [{ dueId: dues[0].id, amount: rupees(2000) }] }), ids(), TODAY))).toBe("ALLOCATION_MISMATCH");
    expect(code(() => applyPayment(loan(), dues, pay({ interest: rupees(4000), allocations: [{ dueId: dues[0].id, amount: rupees(4000) }] }), ids(), TODAY))).toBe("INTEREST_TOO_LARGE");
    expect(code(() => applyPayment(loan(), dues, pay({ interest: rupees(3000), allocations: [{ dueId: "nope", amount: rupees(3000) }] }), ids(), TODAY))).toBe("DUE_MISMATCH");
  });
});

describe("7. principal only, while interest stays pending", () => {
  const r = applyPayment(loan(), missed(), pay({ principal: rupees(40000) }), ids(), TODAY);

  it("reduces the principal and touches no interest", () => {
    expect(r.loan.principalLeft).toBe(rupees(60000));
    expect(pendingInterest(r.dues, TODAY)).toBe(rupees(9000));
    expect(r.loan.status).toBe("active");
  });
  it("periods already missed keep their amounts; later periods use the new balance", () => {
    const later = accrueDues(r.loan, r.dues, "2026-11-05", newId);
    expect(on(later, "2026-10-01").interestAmount).toBe(rupees(3000));
    expect(on(later, "2026-11-01").interestAmount).toBe(rupees(1800));
  });
});

describe("8. principal with chosen interest", () => {
  it("records both, and only the chosen month is cleared", () => {
    const dues = missed();
    const r = applyPayment(loan(), dues, pay({ principal: rupees(40000), interest: rupees(3000), allocations: [{ dueId: on(dues, "2026-08-01").id, amount: rupees(3000) }] }), ids(), TODAY);
    expect(r.loan.principalLeft).toBe(rupees(60000));
    expect(left(r.dues)).toEqual({ "07-01": 3000, "08-01": 0, "09-01": 3000, "10-01": 3000 });
    expect(r.payment).toMatchObject({ interest: rupees(3000), principal: rupees(40000) });
  });
});

describe("9. all principal returned with interest still pending: the owner decides", () => {
  const all = missed();
  const r = applyPayment(loan(), all, pay({ principal: rupees(100000) }), ids(), TODAY);

  it("asks for all pending interest plus the principal to settle", () => {
    expect(settlementAmount(loan(), all)).toBe(rupees(112000));
  });
  it("does not close the loan and does not clear any interest by itself", () => {
    expect(r.loan.principalLeft).toBe(0);
    expect(r.loan.status).toBe("active");
    expect(r.closed).toBe(false);
    expect(left(r.dues)).toEqual({ "07-01": 3000, "08-01": 3000, "09-01": 3000, "10-01": 3000 });
    expect(r.dues.some((d) => d.cancelled || d.waived)).toBe(false);
  });
  it("adds no further interest once the principal is back", () => {
    expect(accrueDues(r.loan, r.dues, "2027-03-01", newId)).toHaveLength(4);
  });
  it("closes when the owner collects the interest", () => {
    const r2 = applyPayment(r.loan, r.dues, pay({ interest: rupees(12000) }), ids(), TODAY);
    expect(r2.closed).toBe(true);
    expect(r2.loan).toMatchObject({ status: "closed", closedDate: TODAY });
  });
  it("or closes when the owner waives it, with a reason", () => {
    const r2 = applyWaiver(r.loan, r.dues, { date: TODAY, reason: "Long-standing customer", waive: openDues(r.dues).map((d) => ({ dueId: d.id, amount: rupees(3000) })) }, TODAY);
    expect(r2.closed).toBe(true);
    expect(r2.dues.every((d) => d.waived === rupees(3000) && (d.interestPaid ?? 0) === 0)).toBe(true);
  });
  it("a full settlement in one go: collect some interest, waive the rest, loan closes", () => {
    const dues = missed();
    const waive = [{ dueId: on(dues, "2026-09-01").id, amount: rupees(3000) }, { dueId: on(dues, "2026-10-01").id, amount: rupees(3000) }];
    const r3 = applyPayment(loan(), dues, pay({ principal: rupees(100000), interest: rupees(6000), waive, waiveReason: "Agreed settlement" }), ids(), TODAY);
    expect(r3.closed).toBe(true);
    expect(r3.payment.interest).toBe(rupees(6000));
    expect(r3.waived).toBe(rupees(6000));
  });
});

describe("10. the owner waives interest, with a reason", () => {
  const dues = missed();
  const aug = on(dues, "2026-08-01").id;

  it("needs a reason", () => {
    expect(code(() => applyWaiver(loan(), dues, { date: TODAY, reason: "  ", waive: [{ dueId: aug, amount: rupees(3000) }] }, TODAY))).toBe("WAIVE_REASON_NEEDED");
    expect(code(() => applyPayment(loan(), dues, pay({ interest: rupees(3000), waive: [{ dueId: aug, amount: rupees(1000) }] }), ids(), TODAY))).toBe("WAIVE_REASON_NEEDED");
  });
  it("marks the amount as waived, never as received, and leaves other months alone", () => {
    const r = applyWaiver(loan(), dues, { date: TODAY, reason: "Shop was closed for a month", waive: [{ dueId: aug, amount: rupees(3000) }] }, TODAY);
    const d = on(r.dues, "2026-08-01");
    expect(d.waived).toBe(rupees(3000));
    expect(d.interestPaid ?? 0).toBe(0);
    expect(d.paid).toBe(0);
    expect(r.waived).toBe(rupees(3000));
    expect(left(r.dues)).toEqual({ "07-01": 3000, "08-01": 0, "09-01": 3000, "10-01": 3000 });
    expect(r.closed).toBe(false);
  });
  it("can waive part of a month", () => {
    const r = applyWaiver(loan(), dues, { date: TODAY, reason: "Goodwill", waive: [{ dueId: aug, amount: rupees(1000) }] }, TODAY);
    expect(dueInterestLeft(on(r.dues, "2026-08-01"))).toBe(rupees(2000));
  });
  it("refuses to waive more than is pending on that month", () => {
    expect(code(() => applyWaiver(loan(), dues, { date: TODAY, reason: "x", waive: [{ dueId: aug, amount: rupees(3001) }] }, TODAY))).toBe("WAIVE_TOO_LARGE");
  });
});

describe("11. a backdated payment against an old pending month", () => {
  const dues = missed();
  const r = applyPayment(loan(), dues, pay({ date: "2026-07-05", recordedOn: TODAY, interest: rupees(3000), allocations: [{ dueId: on(dues, "2026-07-01").id, amount: rupees(3000) }] }), ids(), TODAY);

  it("clears that month and is dated when it was paid", () => {
    expect(left(r.dues)).toEqual({ "07-01": 0, "08-01": 3000, "09-01": 3000, "10-01": 3000 });
    expect(r.payment).toMatchObject({ date: "2026-07-05", recordedOn: TODAY });
    expect(on(r.dues, "2026-07-01").lastPaidDate).toBe("2026-07-05");
  });
});

describe("settling does not charge for a period that has not begun", () => {
  it("interest and all principal paid on the collection day closes the loan, with nothing further", () => {
    const l = loan({ startDate: "2026-08-29" });
    const dues = accrueDues(l, [], TODAY, newId);
    expect(dues.map((d) => d.dueDate)).toEqual(["2026-09-29"]);
    const r = applyPayment(l, dues, pay({ interest: rupees(3000), principal: rupees(100000) }), ids(), TODAY);
    expect(r.closed).toBe(true);
    expect(r.dues).toHaveLength(1);
  });
  it("a month paid early, then all principal back before the next month starts: the loan closes", () => {
    const l = loan({ startDate: "2026-09-01" });
    const early = applyPayment(l, accrueDues(l, [], "2026-09-20", newId), pay({ date: "2026-09-20", interest: rupees(3000) }), ids(), "2026-09-20");
    expect(openDues(early.dues).map((d) => d.dueDate)).toEqual(["2026-11-01"]);
    const r = applyPayment(early.loan, early.dues, pay({ date: "2026-09-25", principal: rupees(100000) }), ids(), "2026-09-25");
    expect(r.closed).toBe(true);
    const november = on(r.dues, "2026-11-01");
    expect(november.cancelled).toBe(true);
    expect(november.waived ?? 0).toBe(0);
  });
  it("but a period that has begun stays pending for the owner to decide", () => {
    const l = loan({ startDate: "2026-09-01" });
    const dues = accrueDues(l, [], TODAY, newId);
    const r = applyPayment(l, dues, pay({ principal: rupees(100000) }), ids(), TODAY);
    expect(r.closed).toBe(false);
    expect(dueInterestLeft(on(r.dues, "2026-10-01"))).toBe(rupees(3000));
    expect(on(r.dues, "2026-10-01").cancelled).toBeFalsy();
  });
});

describe("how collections are worked out", () => {
  it("paying the coming month early opens the one after it", () => {
    const l = loan({ startDate: "2026-09-01" });
    const dues = accrueDues(l, [], TODAY, newId);
    expect(dues.map((d) => d.dueDate)).toEqual(["2026-10-01"]);
    const r = applyPayment(l, dues, pay({ interest: rupees(3000) }), ids(), TODAY);
    expect(openDues(r.dues).map((d) => d.dueDate)).toEqual(["2026-11-01"]);
    expect(r.nextDue?.dueDate).toBe("2026-11-01");
  });
  it("a moved date does not create a gap or a repeat", () => {
    const l = loan({ startDate: "2026-08-01" });
    const dues = accrueDues(l, [], "2026-08-20", newId).map((d) => ({ ...d, dueDate: "2026-09-10", rescheduled: { originalDate: "2026-09-01", reason: "x" } }));
    expect(accrueDues(l, dues, "2026-10-05", newId).map((d) => d.rescheduled?.originalDate ?? d.dueDate)).toEqual(["2026-09-01", "2026-10-01", "2026-11-01"]);
  });
  it("an instalment loan never schedules more principal than is owed", () => {
    const l = loan({ type: "weekly", frequency: "weekly", amount: rupees(9000), principalLeft: rupees(9000), principalPerDue: rupees(3000), interest: { style: "fixed", value: rupees(300), method: "fixed" }, startDate: "2026-08-25" });
    const dues = accrueDues(l, [], TODAY, newId);
    expect(dues.map((d) => d.principalAmount / 100)).toEqual([3000, 3000, 3000, 0, 0]);
    expect(dues.every((d) => d.interestAmount === rupees(300))).toBe(true);
  });
  it("a closed loan gets no more collections", () => {
    const l = loan({ status: "closed", principalLeft: 0, closedDate: "2026-07-01" });
    expect(accrueDues(l, [], TODAY, newId)).toEqual([]);
  });
});
