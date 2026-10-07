import { describe, expect, it } from "vitest";
import { registerReport, type DateRange } from "./reports";
import type { AppState } from "./store";
import type { Customer, Due, Loan, Payment } from "./types";

const TODAY = "2026-10-08";
const day = { key: "today", label: "Today", from: TODAY, to: TODAY } as DateRange;

const customer = (id: string, name: string): Customer => ({ id, name, phone: "9000000000", area: "Town", createdAt: "2026-01-01" });
const loan = (id: string, customerId: string, extra: Partial<Loan> = {}): Loan => ({
  id,
  customerId,
  type: "monthly",
  amount: 10000000,
  startDate: "2026-06-08",
  interest: { style: "percent", value: 3, method: "reducing" },
  frequency: "monthly",
  principalPerDue: 0,
  principalLeft: 10000000,
  status: "active",
  security: null,
  ...extra,
});
const due = (id: string, loanId: string, dueDate: string, paid: number): Due => ({ id, loanId, dueDate, interestAmount: 300000, principalAmount: 0, paid, interestPaid: paid });
const pay = (id: string, loanId: string, customerId: string, interest: number, principal = 0, date = TODAY): Payment => ({
  id,
  loanId,
  customerId,
  date,
  recordedOn: TODAY,
  principalBefore: 10000000,
  interest,
  principal,
  other: 0,
  method: "cash",
});

// Four people on one day:
//   Arun   settled in full today (interest ₹2,200 + all the principal): the loan is closed
//   Bala   is two months behind and paid one month (₹3,000) today: still overdue
//   Chitra paid today's collection (₹3,000) in full: up to date
//   Devi   has today's collection pending and paid nothing
const state = {
  customers: [customer("C1", "Arun"), customer("C2", "Bala"), customer("C3", "Chitra"), customer("C4", "Devi")],
  loans: [
    loan("L1", "C1", { status: "closed", closedDate: TODAY, principalLeft: 0 }),
    loan("L2", "C2"),
    loan("L3", "C3"),
    loan("L4", "C4"),
  ],
  dues: [
    due("D1", "L1", TODAY, 300000),
    due("D2a", "L2", "2026-08-08", 300000),
    due("D2b", "L2", "2026-09-08", 0),
    due("D2c", "L2", TODAY, 0),
    due("D3", "L3", TODAY, 300000),
    due("D4", "L4", TODAY, 0),
  ],
  payments: [pay("P1", "L1", "C1", 220000, 10000000), pay("P2", "L2", "C2", 300000), pay("P3", "L3", "C3", 300000)],
  activity: [],
  users: [],
  session: { loggedIn: true, locked: false, viewAs: "owner" },
} as unknown as AppState;

const names = (show: Parameters<typeof registerReport>[3]) => registerReport(state, TODAY, day, show).lines.map((l) => l.customer.name).sort();
const figure = (show: Parameters<typeof registerReport>[3], label: string) => registerReport(state, TODAY, day, show).figures.find((f) => f.label === label)?.value;

describe("the Paid report", () => {
  it("lists everyone who paid in the period: also a loan closed that day, and someone still behind", () => {
    expect(names("paid")).toEqual(["Arun", "Bala", "Chitra"]);
  });

  it("its Interest Received is all the interest received in the period, the same as under All", () => {
    expect(figure("paid", "Interest Received")).toBe(220000 + 300000 + 300000);
    expect(figure("paid", "Interest Received")).toBe(figure("all", "Interest Received"));
    expect(figure("paid", "People Paid")).toBe(3);
  });

  it("each line keeps its own status, so a closed or overdue loan is still marked as such", () => {
    const by = Object.fromEntries(registerReport(state, TODAY, day, "paid").lines.map((l) => [l.customer.name, l.status]));
    expect(by).toEqual({ Arun: "closed", Bala: "overdue", Chitra: "paid" });
  });

  it("someone who paid nothing is not in it", () => {
    expect(names("paid")).not.toContain("Devi");
  });
});

describe("the other report filters are unchanged", () => {
  it("Closed lists only the loan closed in the period", () => {
    expect(names("closed")).toEqual(["Arun"]);
  });
  it("Overdue lists only who is behind", () => {
    expect(names("overdue")).toEqual(["Bala"]);
  });
  it("Pending lists who still owes interest, never a closed loan", () => {
    expect(names("pending")).toEqual(["Bala", "Devi"]);
  });
  it("All lists everyone", () => {
    expect(names("all")).toEqual(["Arun", "Bala", "Chitra", "Devi"]);
  });
});
