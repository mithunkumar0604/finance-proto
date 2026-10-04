import { describe, expect, it } from "vitest";
import type { Due, Loan } from "../types";
import {
  applyPayment,
  buildDue,
  dueInterestLeft,
  dueRemaining,
  dueStatus,
  FinanceError,
  loanSchedule,
  nextDueDate,
  openDue,
  periodInterest,
  projectDues,
  settlementAmount,
  suggestAllocation,
  type PaymentInput,
} from "./engine";
import { rupees } from "./money";

const TODAY = "2026-09-29";
const IDS = { paymentId: "P1", nextDueId: "D2" };

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

function firstDue(l: Loan, date = "2026-09-01"): Due {
  return buildDue(l, date, "D1");
}

function pay(over: Partial<PaymentInput> = {}): PaymentInput {
  return { loanId: "LP-1", dueId: "D1", date: "2026-09-01", recordedOn: "2026-09-01", interest: 0, principal: 0, other: 0, method: "cash", ...over };
}

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    if (e instanceof FinanceError) return e.code;
    throw e;
  }
  return "no error";
};

describe("interest for one period", () => {
  it("percent on balance uses the principal left", () => {
    expect(periodInterest(loan({ principalLeft: rupees(60000) }))).toBe(rupees(1800));
  });
  it("flat percent uses the original loan amount", () => {
    expect(periodInterest(loan({ principalLeft: rupees(60000), interest: { style: "percent", value: 3, method: "fixed" } }))).toBe(rupees(3000));
  });
  it("a fixed amount is used exactly, paise included", () => {
    expect(periodInterest(loan({ interest: { style: "fixed", value: 600050, method: "fixed" } }))).toBe(600050);
  });
});

describe("collection dates", () => {
  it("steps by the loan's frequency", () => {
    expect(nextDueDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextDueDate("2026-09-01", "weekly")).toBe("2026-09-08");
    expect(nextDueDate("2026-09-01", "15days")).toBe("2026-09-16");
    expect(nextDueDate("2026-09-01", "30days")).toBe("2026-10-01");
  });
});

describe("1. interest-only payment", () => {
  const l = loan();
  const r = applyPayment(l, [firstDue(l)], pay({ interest: rupees(3000) }), IDS, TODAY);

  it("leaves the principal unchanged", () => {
    expect(r.loan.principalLeft).toBe(rupees(100000));
    expect(r.loan.status).toBe("active");
    expect(r.closed).toBe(false);
  });
  it("clears the interest for that period", () => {
    const due = r.dues.find((d) => d.id === "D1")!;
    expect(dueInterestLeft(due)).toBe(0);
    expect(dueStatus(due, TODAY)).toBe("paid");
  });
  it("creates the next period's collection", () => {
    expect(r.nextDue).toMatchObject({ id: "D2", dueDate: "2026-10-01", interestAmount: rupees(3000), principalAmount: 0, paid: 0 });
  });
  it("records the payment with its split", () => {
    expect(r.payment).toMatchObject({ id: "P1", loanId: "LP-1", customerId: "C1", interest: rupees(3000), principal: 0, other: 0, principalBefore: rupees(100000), dueId: "D1" });
  });
  it("does not change the objects it was given", () => {
    expect(l.principalLeft).toBe(rupees(100000));
  });
});

describe("2. partial interest payment", () => {
  const l = loan();
  const r = applyPayment(l, [firstDue(l)], pay({ interest: rupees(2000) }), IDS, TODAY);
  const due = r.dues[0];

  it("keeps the unpaid interest pending", () => {
    expect(due.interestPaid).toBe(rupees(2000));
    expect(dueInterestLeft(due)).toBe(rupees(1000));
    expect(dueStatus(due, TODAY)).toBe("partial");
  });
  it("leaves the principal unchanged and does not open a new period", () => {
    expect(r.loan.principalLeft).toBe(rupees(100000));
    expect(r.nextDue).toBeUndefined();
    expect(r.dues).toHaveLength(1);
  });
  it("a later payment of the rest clears the period", () => {
    const r2 = applyPayment(r.loan, r.dues, pay({ interest: rupees(1000), date: "2026-09-10", recordedOn: "2026-09-10" }), { paymentId: "P2", nextDueId: "D2" }, TODAY);
    expect(dueInterestLeft(r2.dues[0])).toBe(0);
    expect(r2.nextDue?.dueDate).toBe("2026-10-01");
  });
});

describe("3. full principal settlement", () => {
  const l = loan();
  const due = firstDue(l);
  const r = applyPayment(l, [due], pay({ interest: rupees(3000), principal: rupees(100000), date: "2026-09-20", recordedOn: "2026-09-20" }), IDS, TODAY);

  it("asks for interest due plus all principal left", () => {
    expect(settlementAmount(l, due)).toBe(rupees(103000));
  });
  it("closes the loan and records the closed date", () => {
    expect(r.loan.principalLeft).toBe(0);
    expect(r.loan.status).toBe("closed");
    expect(r.loan.closedDate).toBe("2026-09-20");
    expect(r.closed).toBe(true);
  });
  it("leaves nothing more to collect", () => {
    expect(r.nextDue).toBeUndefined();
    expect(openDue(r.dues)).toBeUndefined();
    expect(projectDues(r.loan, r.dues, "2027-12-31")).toEqual([]);
    expect(loanSchedule(r.loan, r.dues)).toBeNull();
  });
  it("closing without the interest records it as waived, not as received", () => {
    const r2 = applyPayment(l, [due], pay({ principal: rupees(100000) }), IDS, TODAY);
    const d = r2.dues[0];
    expect(d.interestPaid).toBe(0);
    expect(d.waived).toBe(rupees(3000));
    expect(dueRemaining(d)).toBe(0);
  });
});

describe("4. partial principal payment", () => {
  const l = loan();
  const r = applyPayment(l, [firstDue(l)], pay({ principal: rupees(40000) }), IDS, TODAY);

  it("reduces the principal and keeps the loan running", () => {
    expect(r.loan.principalLeft).toBe(rupees(60000));
    expect(r.loan.status).toBe("active");
  });
  it("does not count as paying the interest that is still due", () => {
    expect(dueInterestLeft(r.dues[0])).toBe(rupees(3000));
    expect(r.nextDue).toBeUndefined();
  });
  it("the next period's interest is worked out on the new balance", () => {
    const r2 = applyPayment(r.loan, r.dues, pay({ interest: rupees(3000) }), { paymentId: "P2", nextDueId: "D2" }, TODAY);
    expect(r2.nextDue?.interestAmount).toBe(rupees(1800));
  });
});

describe("5. principal + interest payment", () => {
  const l = loan({ amount: rupees(200000), principalLeft: rupees(200000) });
  const r = applyPayment(l, [firstDue(l)], pay({ interest: rupees(6000), principal: rupees(40000) }), IDS, TODAY);

  it("records both parts explicitly", () => {
    expect(r.payment.interest).toBe(rupees(6000));
    expect(r.payment.principal).toBe(rupees(40000));
    expect(r.payment.principalBefore).toBe(rupees(200000));
  });
  it("reduces principal by the principal part only", () => {
    expect(r.loan.principalLeft).toBe(rupees(160000));
    expect(dueInterestLeft(r.dues[0])).toBe(0);
    expect(r.nextDue?.interestAmount).toBe(rupees(4800));
  });
});

describe("6. backdated payment", () => {
  const l = loan();
  it("keeps the payment date and the recorded date separately", () => {
    const r = applyPayment(l, [firstDue(l, "2026-08-18")], pay({ interest: rupees(3000), date: "2026-08-18", recordedOn: "2026-09-29" }), IDS, TODAY);
    expect(r.payment.date).toBe("2026-08-18");
    expect(r.payment.recordedOn).toBe("2026-09-29");
    expect(r.dues[0].lastPaidDate).toBe("2026-08-18");
  });
  it("refuses a payment dated in the future", () => {
    expect(code(() => applyPayment(l, [firstDue(l)], pay({ interest: rupees(3000), date: "2026-09-30" }), IDS, TODAY))).toBe("FUTURE_DATE");
  });
  it("refuses a payment dated before the loan was given", () => {
    expect(code(() => applyPayment(l, [firstDue(l)], pay({ interest: rupees(3000), date: "2026-05-31" }), IDS, TODAY))).toBe("BEFORE_LOAN_START");
  });
});

describe("7. several loans for one customer", () => {
  it("refuses to apply a payment to another loan's collection", () => {
    const a = loan();
    const b = loan({ id: "LP-2" });
    expect(code(() => applyPayment(a, [buildDue(b, "2026-09-01", "D1")], pay({ interest: rupees(3000) }), IDS, TODAY))).toBe("DUE_MISMATCH");
    expect(code(() => applyPayment(a, [firstDue(a)], pay({ loanId: "LP-2", interest: rupees(3000) }), IDS, TODAY))).toBe("LOAN_MISMATCH");
  });
});

describe("8. closed loan", () => {
  const closed = loan({ status: "closed", principalLeft: 0, closedDate: "2026-08-01" });
  it("refuses any further payment", () => {
    expect(code(() => applyPayment(closed, [], pay({ interest: rupees(3000) }), IDS, TODAY))).toBe("LOAN_CLOSED");
  });
  it("has no future collections", () => {
    expect(projectDues(closed, [], "2027-12-31")).toEqual([]);
  });
});

describe("amount checks", () => {
  const l = loan();
  const dues = [firstDue(l)];
  it("refuses a payment of nothing", () => {
    expect(code(() => applyPayment(l, dues, pay(), IDS, TODAY))).toBe("ZERO_AMOUNT");
  });
  it("refuses negative or fractional-paise amounts", () => {
    expect(code(() => applyPayment(l, dues, pay({ interest: -100 }), IDS, TODAY))).toBe("INVALID_AMOUNT");
    expect(code(() => applyPayment(l, dues, pay({ interest: 100.5 }), IDS, TODAY))).toBe("INVALID_AMOUNT");
    expect(code(() => applyPayment(l, dues, pay({ principal: NaN }), IDS, TODAY))).toBe("INVALID_AMOUNT");
  });
  it("refuses more principal than is left", () => {
    expect(code(() => applyPayment(l, dues, pay({ principal: rupees(100001) }), IDS, TODAY))).toBe("PRINCIPAL_TOO_LARGE");
  });
  it("refuses more interest than is due for the period", () => {
    expect(code(() => applyPayment(l, dues, pay({ interest: rupees(3001) }), IDS, TODAY))).toBe("INTEREST_TOO_LARGE");
  });
  it("records an 'other' amount without touching interest or principal", () => {
    const r = applyPayment(l, dues, pay({ other: rupees(500) }), IDS, TODAY);
    expect(r.payment.other).toBe(rupees(500));
    expect(r.loan.principalLeft).toBe(rupees(100000));
    expect(dueInterestLeft(r.dues[0])).toBe(rupees(3000));
  });
});

describe("instalment loans (principal with each collection)", () => {
  const l = loan({ type: "weekly", frequency: "weekly", amount: rupees(15000), principalLeft: rupees(15000), principalPerDue: rupees(3000), interest: { style: "fixed", value: rupees(300), method: "fixed" }, startDate: "2026-08-25" });
  const due = firstDue(l);

  it("has an end date and a total to collect", () => {
    const s = loanSchedule(l, [due])!;
    expect(s.rows).toHaveLength(5);
    expect(s.endsOn).toBe("2026-09-29");
    expect(s.totalToCollect).toBe(rupees(16500));
    expect(s.totalInterest).toBe(rupees(1500));
    expect(s.rows.at(-1)!.balanceAfter).toBe(0);
  });
  it("a principal-only payment does not hide the interest still due", () => {
    const r = applyPayment(l, [due], pay({ principal: rupees(3000) }), IDS, TODAY);
    expect(dueInterestLeft(r.dues[0])).toBe(rupees(300));
    expect(dueRemaining(r.dues[0])).toBe(rupees(300));
  });
  it("paying the last instalment closes the loan", () => {
    const last = loan({ ...l, principalLeft: rupees(3000) });
    const r = applyPayment(last, [firstDue(last)], pay({ interest: rupees(300), principal: rupees(3000) }), IDS, TODAY);
    expect(r.closed).toBe(true);
    expect(r.dues[0].waived ?? 0).toBe(0);
  });
});

describe("interest-only loans", () => {
  it("have no end date", () => {
    const l = loan();
    const s = loanSchedule(l, [firstDue(l)])!;
    expect(s.interestOnly).toBe(true);
    expect(s.endsOn).toBeUndefined();
    expect(s.rows).toHaveLength(3);
  });
});

describe("suggested split of a received amount", () => {
  it("fills interest due first, then principal, rest as other", () => {
    const l = loan();
    const due = firstDue(l);
    expect(suggestAllocation(rupees(2000), l, due)).toEqual({ interest: rupees(2000), principal: 0, other: 0 });
    expect(suggestAllocation(rupees(46000), l, due)).toEqual({ interest: rupees(3000), principal: rupees(43000), other: 0 });
    expect(suggestAllocation(rupees(104000), l, due)).toEqual({ interest: rupees(3000), principal: rupees(100000), other: rupees(1000) });
  });
});
