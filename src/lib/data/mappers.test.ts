import { describe, expect, it } from "vitest";
import type { Due, Loan } from "../types";
import { collateralToRow, dueFromRow, dueToRow, loanFromRow, loanToRow, parseDbError, paymentFromRow } from "./mappers";

const loanRow = {
  id: "LP-1001",
  customer_id: "C001",
  type: "vehicle",
  amount: 15000000,
  start_date: "2026-06-01",
  reference: null,
  interest_style: "percent",
  interest_value: 2.5,
  interest_method: "reducing",
  frequency: "monthly",
  principal_per_due: 0,
  principal_left: 12000000,
  status: "active",
  closed_date: null,
  version: 4,
};

describe("loan rows", () => {
  it("become the loan the screens use, with security attached", () => {
    const loan = loanFromRow(loanRow, {
      loan_id: "LP-1001",
      kind: "vehicle",
      status: "held",
      details: { registration: "TN 33 AB 1234", vehicleType: "car", make: "Tata", model: "Nexon", ownerName: "Ravi", rcRef: "RC-1", documentHeld: "RC", storage: "Locker" },
    });
    expect(loan).toMatchObject({
      id: "LP-1001",
      customerId: "C001",
      amount: 15000000,
      principalLeft: 12000000,
      interest: { style: "percent", value: 2.5, method: "reducing" },
      version: 4,
      security: { kind: "vehicle", status: "held", registration: "TN 33 AB 1234" },
    });
    expect(loan.reference).toBeUndefined();
    expect(loan.closedDate).toBeUndefined();
  });

  it("carry the opening position of a loan brought in from the old book", () => {
    const loan = loanFromRow({ ...loanRow, opened_on: "2026-10-05", opening_principal: 12000000 }, undefined);
    expect(loan.opening).toEqual({ on: "2026-10-05", principalLeft: 12000000 });
    expect(loanFromRow(loanRow, undefined)).not.toHaveProperty("opening");
  });

  it("have no security when none is held", () => {
    expect(loanFromRow(loanRow, undefined).security).toBeNull();
  });

  it("go back to the database with the same values", () => {
    const loan: Loan = loanFromRow(loanRow, undefined);
    expect(loanToRow(loan)).toMatchObject({
      customer_id: "C001",
      type: "vehicle",
      amount: 15000000,
      start_date: "2026-06-01",
      interest_style: "percent",
      interest_value: 2.5,
      interest_method: "reducing",
      frequency: "monthly",
      principal_per_due: 0,
    });
  });
});

describe("due rows", () => {
  const row = {
    id: "d1",
    loan_id: "LP-1001",
    due_date: "2026-10-06",
    interest_amount: 300000,
    principal_amount: 0,
    paid: 200000,
    interest_paid: 200000,
    waived: 0,
    last_paid_date: "2026-09-30",
    original_date: "2026-10-01",
    reschedule_reason: "Travelling",
    cancelled: false,
  };

  it("carry the moved date and reason", () => {
    expect(dueFromRow(row)).toEqual({
      id: "d1",
      loanId: "LP-1001",
      dueDate: "2026-10-06",
      interestAmount: 300000,
      principalAmount: 0,
      paid: 200000,
      interestPaid: 200000,
      waived: 0,
      lastPaidDate: "2026-09-30",
      rescheduled: { originalDate: "2026-10-01", reason: "Travelling" },
      cancelled: false,
    });
  });

  it("survive a round trip unchanged", () => {
    const due: Due = dueFromRow(row);
    expect(dueFromRow({ ...dueToRow(due), loan_id: "LP-1001", original_date: row.original_date, reschedule_reason: row.reschedule_reason })).toEqual(due);
  });

  it("send zeros, never undefined, for amounts the engine left out", () => {
    const sent = dueToRow({ id: "d2", loanId: "LP-1001", dueDate: "2026-11-01", interestAmount: 300000, principalAmount: 0, paid: 0 });
    expect(sent).toMatchObject({ paid: 0, interest_paid: 0, waived: 0, cancelled: false, last_paid_date: null });
  });
});

describe("payment rows", () => {
  it("keep the payment date and the recorded date apart", () => {
    const p = paymentFromRow({
      id: "p1", loan_id: "LP-1001", customer_id: "C001", due_id: "d1", payment_date: "2026-08-18", recorded_on: "2026-09-29",
      principal_before: 12000000, interest: 300000, principal: 0, other: 0, method: "cash", note: null,
    });
    expect(p).toMatchObject({ date: "2026-08-18", recordedOn: "2026-09-29", interest: 300000, dueId: "d1" });
    expect(p.note).toBeUndefined();
  });
});

describe("security for search", () => {
  it("puts the searchable words in one line and keeps status out of the details", () => {
    const row = collateralToRow({ kind: "jewel", description: "Gold Chain", weightGrams: 16, purity: "22K", estimatedValue: 14500000, packetNo: "PKT-0412", storage: "Locker A", status: "held" });
    expect(row.kind).toBe("jewel");
    expect(row.search_text).toBe("Gold Chain PKT-0412");
    expect(row.details).not.toHaveProperty("status");
    expect(row.details).not.toHaveProperty("kind");
  });
});

describe("database errors", () => {
  it("split 'CODE: message' raised by the database functions", () => {
    expect(parseDbError({ message: "CONFLICT: this loan was changed by someone else. Check it and try again" })).toEqual({
      code: "CONFLICT",
      message: "This loan was changed by someone else. Check it and try again.",
    });
  });
  it("turn a lost connection into a plain message", () => {
    expect(parseDbError({ message: "TypeError: Failed to fetch" }).code).toBe("NETWORK");
    expect(parseDbError(new TypeError("fetch failed")).code).toBe("NETWORK");
  });
  it("treat an expired sign-in as such", () => {
    expect(parseDbError({ message: "JWT expired", code: "PGRST301" }).code).toBe("SIGNED_OUT");
  });
  it("never leak raw database text", () => {
    const e = parseDbError({ message: 'new row for relation "dues" violates check constraint "dues_check1"', code: "23514" });
    expect(e.code).toBe("REJECTED");
    expect(e.message).not.toMatch(/relation|constraint/);
  });
});
