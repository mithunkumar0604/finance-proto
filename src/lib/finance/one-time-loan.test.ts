// A one-time loan ("Custom"): money given today, to be returned in full on a date the
// owner chooses. One collection only: the interest for the whole loan plus all of the
// principal. Nothing more is added by the app if the date passes.

import { describe, expect, it } from "vitest";
import type { Due, Loan } from "../types";
import { accrueDues, applyPayment, buildDue, FinanceError, firstDueDate, loanDefaults, loanSchedule, openDues, previewFirstCollection, projectDues } from "./engine";
import { rupees } from "./money";

const START = "2026-10-01";
const RETURN = "2026-10-19"; // 18 days

const once = (extra: Partial<Loan> = {}): Loan => ({
  id: "LP-1",
  customerId: "C1",
  type: "custom",
  amount: rupees(20000),
  startDate: START,
  interest: { style: "fixed", value: rupees(500), method: "fixed" },
  frequency: "once",
  returnDate: RETURN,
  principalPerDue: rupees(20000),
  principalLeft: rupees(20000),
  status: "active",
  security: null,
  ...extra,
});

const first = (loan: Loan): Due => buildDue(loan, firstDueDate(loan), "D1");
const ids = (n = 1) => ({ paymentId: `P${n}`, nextDueId: `N${n}` });

describe("a one-time loan has one collection, on the return date", () => {
  it("picking Custom gives a one-time loan whose single collection carries all the principal", () => {
    expect(loanDefaults("custom", rupees(20000))).toEqual({ frequency: "once", interest: { style: "fixed", value: 0, method: "fixed" }, principalPerDue: rupees(20000) });
  });

  it("the collection falls on the chosen date, not a month later: it can be 18 days, 5 days, or tomorrow", () => {
    expect(firstDueDate(once())).toBe(RETURN);
    expect(firstDueDate(once({ returnDate: "2026-10-06" }))).toBe("2026-10-06");
    expect(firstDueDate(once({ returnDate: "2026-10-02" }))).toBe("2026-10-02");
    // other loans are unchanged
    expect(firstDueDate(once({ frequency: "monthly", returnDate: undefined }))).toBe("2026-11-01");
    expect(firstDueDate(once({ frequency: "weekly", returnDate: undefined }))).toBe("2026-10-08");
  });

  it("it asks for the interest of the whole loan and all of the principal", () => {
    expect(first(once())).toMatchObject({ dueDate: RETURN, interestAmount: rupees(500), principalAmount: rupees(20000), paid: 0 });
    expect(previewFirstCollection(once())).toEqual({ date: RETURN, interest: rupees(500), principal: rupees(20000), total: rupees(20500) });
  });

  it("a percentage is taken once, on the amount given", () => {
    const loan = once({ interest: { style: "percent", value: 2.5, method: "fixed" } });
    expect(first(loan)).toMatchObject({ interestAmount: rupees(500), principalAmount: rupees(20000) });
  });

  it("a one-time loan may carry no interest at all", () => {
    expect(first(once({ interest: { style: "fixed", value: 0, method: "fixed" } }))).toMatchObject({ interestAmount: 0, principalAmount: rupees(20000) });
  });

  it("a return date is needed, and it must be after the day the money is given", () => {
    expect(() => firstDueDate(once({ returnDate: undefined }))).toThrow(FinanceError);
    expect(() => firstDueDate(once({ returnDate: START }))).toThrow(/after the day the loan is given/);
    expect(() => firstDueDate(once({ returnDate: "2026-09-30" }))).toThrow(FinanceError);
  });
});

describe("nothing is added when the return date passes", () => {
  const loan = once();
  const dues = [first(loan)];

  it("before the date, on the date, a day late, months late: still the one collection, same amount", () => {
    for (const today of ["2026-10-05", RETURN, "2026-10-20", "2026-12-25", "2027-10-01"]) {
      const now = accrueDues(loan, dues, today, (n) => `X${n}`);
      expect(now, today).toHaveLength(1);
      expect(now[0], today).toMatchObject({ interestAmount: rupees(500), principalAmount: rupees(20000) });
    }
  });

  it("nothing is expected after it", () => {
    expect(projectDues(loan, dues, "9999-12-31")).toEqual([]);
    const s = loanSchedule(loan, dues)!;
    expect(s.rows).toEqual([{ date: RETURN, interest: rupees(500), principal: rupees(20000), balanceAfter: 0 }]);
    expect(s).toMatchObject({ interestOnly: false, endsOn: RETURN, totalToCollect: rupees(20500), totalInterest: rupees(500) });
  });
});

describe("paying a one-time loan", () => {
  const loan = once();
  const dues = [first(loan)];
  const pay = (l: Loan, d: Due[], interest: number, principal: number, date: string, n = 1) => applyPayment(l, d, { loanId: l.id, date, interest, principal, other: 0, method: "cash" }, ids(n), date);

  it("paid in full on the day: the loan is closed", () => {
    const r = pay(loan, dues, rupees(500), rupees(20000), RETURN);
    expect(r.closed).toBe(true);
    expect(r.loan).toMatchObject({ principalLeft: 0, status: "closed", closedDate: RETURN });
    expect(openDues(r.dues)).toEqual([]);
  });

  it("paid early in full: closed the same way, for the same amount", () => {
    const r = pay(loan, dues, rupees(500), rupees(20000), "2026-10-05");
    expect(r.closed).toBe(true);
    expect(r.loan.closedDate).toBe("2026-10-05");
  });

  it("paid in parts: what is left stays on the same collection, and no new one appears", () => {
    const a = pay(loan, dues, rupees(500), rupees(5000), "2026-10-10");
    expect(a.closed).toBe(false);
    expect(a.loan.principalLeft).toBe(rupees(15000));
    expect(a.dues).toHaveLength(1);
    expect(openDues(a.dues)[0]).toMatchObject({ dueDate: RETURN, paid: rupees(5500) });

    // weeks after the date, the rest: still the same single collection, the same total
    const b = pay(a.loan, a.dues, 0, rupees(15000), "2026-11-30", 2);
    expect(b.dues).toHaveLength(1);
    expect(b.closed).toBe(true);
    expect(b.loan).toMatchObject({ principalLeft: 0, status: "closed" });
  });

  it("returned late in full: exactly the agreed amount, nothing extra", () => {
    const r = pay(loan, dues, rupees(500), rupees(20000), "2026-12-25");
    expect(r.closed).toBe(true);
    expect(r.dues).toHaveLength(1);
    expect(r.payment).toMatchObject({ interest: rupees(500), principal: rupees(20000) });
  });

  it("more interest than agreed is refused", () => {
    expect(() => pay(loan, dues, rupees(501), 0, "2026-12-25")).toThrow(/more than the interest pending/);
  });

  it("principal back but interest still owed: the loan stays open for the interest, with nothing added", () => {
    const a = pay(loan, dues, 0, rupees(20000), "2026-10-25");
    expect(a.closed).toBe(false);
    expect(a.loan).toMatchObject({ principalLeft: 0, status: "active" });
    expect(accrueDues(a.loan, a.dues, "2027-01-01", (n) => `X${n}`)).toHaveLength(1);
    const b = pay(a.loan, a.dues, rupees(500), 0, "2026-11-02", 2);
    expect(b.closed).toBe(true);
  });
});
