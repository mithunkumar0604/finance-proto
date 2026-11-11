// A loan whose terms ask for nothing each time (interest ₹0, no principal per collection).
// Live loan LP-1020 got into this state through Edit Loan -> Custom -> ₹0 and its page
// stopped loading. Every screen must still load with such a loan, and nothing is projected.

import { describe, expect, it } from "vitest";
import { collectionSheet } from "./collection-sheet";
import { loanSchedule, projectDues, termsProblem } from "./finance/engine";
import { exportSheet } from "./report-export";
import { personReport, rangeFor, registerReport } from "./reports";
import type { AppState } from "./store";
import type { Customer, Due, Loan } from "./types";

const TODAY = "2026-11-11";
const bad: Loan = {
  id: "LP-1020",
  customerId: "C1",
  type: "15day",
  amount: 500000,
  startDate: "2026-11-01",
  interest: { style: "custom", value: 0, method: "manual" },
  frequency: "15days",
  principalPerDue: 0,
  principalLeft: 500000,
  status: "active",
  security: null,
};
const good: Loan = { ...bad, id: "LP-1", interest: { style: "custom", value: 10000, method: "manual" } };
// the collection made when the loan was given (₹100), before its interest was changed
const dues: Due[] = [
  { id: "D1", loanId: "LP-1020", dueDate: "2026-11-16", interestAmount: 10000, principalAmount: 0, paid: 0, interestPaid: 0 },
  { id: "D2", loanId: "LP-1", dueDate: "2026-11-16", interestAmount: 10000, principalAmount: 0, paid: 0, interestPaid: 0 },
];
const customer: Customer = { id: "C1", name: "Ravi", phone: "9000000000", area: "Town", createdAt: "2026-01-01" };
const state = {
  customers: [customer],
  loans: [bad, good],
  dues,
  payments: [],
  activity: [],
  users: [],
  notes: [],
  session: { loggedIn: true, locked: false, viewAs: "owner" },
} as unknown as AppState;

describe("a loan that asks for nothing each time never breaks a screen", () => {
  it("the engine says what is wrong", () => {
    expect(termsProblem(bad)).toBe("Interest per collection is ₹0.");
    expect(termsProblem(good)).toBeNull();
  });

  it("its schedule shows the collection it has and nothing projected", () => {
    const loanDues = dues.filter((d) => d.loanId === bad.id);
    expect(projectDues(bad, loanDues, "2027-12-31")).toEqual([]);
    const s = loanSchedule(bad, loanDues)!;
    expect(s.rows).toEqual([{ date: "2026-11-16", interest: 10000, principal: 0, balanceAfter: 500000 }]);
    // the loan with interest still has its coming collections
    expect(loanSchedule(good, dues.filter((d) => d.loanId === good.id))!.rows).toHaveLength(3);
  });

  it("reports, a person's statement and the Excel sheet still load, and skip its projections", () => {
    for (const key of ["nextMonth", "month", "year", "today"] as const) {
      const r = registerReport(state, TODAY, rangeFor(key, TODAY), "all");
      expect(() => exportSheet(r.lines, new Map(), "Report", "Period")).not.toThrow();
      expect(() => personReport(state, TODAY, rangeFor(key, TODAY), "all", "C1")).not.toThrow();
    }
    // December: the loan with interest has its coming collections, the other none at all
    const next = registerReport(state, TODAY, rangeFor("nextMonth", TODAY), "all");
    expect(next.lines.map((l) => l.loan.id)).toEqual(["LP-1"]);
    expect(next.lines[0].upcomingCount).toBe(3); // 1, 16 and 31 December
    // November: both are listed with the collection each already has
    const month = registerReport(state, TODAY, rangeFor("custom", TODAY, { from: "2026-11-01", to: "2026-11-30" }), "all");
    expect(month.lines.map((l) => l.loan.id).sort()).toEqual(["LP-1", "LP-1020"]);
  });

  it("the collection sheet still prints", () => {
    expect(collectionSheet(state, "2026-11-16").rows.map((r) => r.loanId).sort()).toEqual(["LP-1", "LP-1020"]);
  });
});
