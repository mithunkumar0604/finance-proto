// Final review before the first real import: who a row is about (never "the phone
// number"), the one date rule, what the app will show as pending, and the warnings
// that must be read before importing.

import { describe, expect, it } from "vitest";
import { COLUMNS, parseDate, validateImport } from "./validate";

const TODAY = "2026-10-04";
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** A good row; override cells by column name. */
const row = (over: Record<string, string> = {}, order: readonly string[] = COLUMNS) => {
  const base: Record<string, string> = {
    customer_name: "Ravi Kumar",
    phone: "9876543210",
    area: "Perundurai",
    loan_type: "monthly",
    loan_amount: "2,00,000",
    principal_left: "1,00,000",
    start_date: "01/02/2026",
    interest_style: "percent",
    interest_value: "3",
    interest_method: "reducing",
    frequency: "monthly",
    next_due_date: "01/11/2026",
    security_type: "none",
    status: "active",
  };
  const cells = { ...base, ...over };
  return order.map((c) => cell(cells[c] ?? "")).join(",");
};
const check = (...rows: string[]) => validateImport([COLUMNS.join(","), ...rows].join("\n"), TODAY);
const errs = (r: ReturnType<typeof check>) => r.errors.map((e) => `${e.row}:${e.column}`);
const warns = (r: ReturnType<typeof check>) => r.warnings.map((w) => `${w.row}:${w.column ?? ""}`);

describe("who a row is about: never just the phone number", () => {
  it("two family members sharing one phone are two customers", () => {
    const r = check(row({ customer_name: "Ravi Kumar" }), row({ customer_name: "Lakshmi Kumar" }));
    expect(r.errors).toEqual([]);
    expect(r.customers.map((c) => c.name)).toEqual(["Ravi Kumar", "Lakshmi Kumar"]);
    expect(r.loans[0].customerKey).not.toBe(r.loans[1].customerKey);
    expect(r.warnings.some((w) => w.row === 3 && /share a phone/.test(w.message) && !w.affectsBalance)).toBe(true);
  });

  it("the same name and phone on two rows is one customer with two loans", () => {
    const r = check(row(), row({ loan_type: "weekly", frequency: "weekly", interest_style: "fixed", interest_value: "500", interest_method: "fixed" }));
    expect(r.errors).toEqual([]);
    expect(r.customers).toHaveLength(1);
    expect(r.loans).toHaveLength(2);
    expect(r.loans[0].customerKey).toBe(r.loans[1].customerKey);
  });

  it("a customer with no phone is accepted, with a note", () => {
    const r = check(row({ phone: "" }));
    expect(r.errors).toEqual([]);
    expect(r.customers[0]).toMatchObject({ name: "Ravi Kumar", phone: "" });
    expect(warns(r)).toContain("2:phone");
  });

  it("two rows with the same name and no phone must say whether they are the same person", () => {
    const r = check(row({ phone: "" }), row({ phone: "" }));
    expect(errs(r)).toEqual(["3:customer_ref"]);
    // same ref = same person
    expect(check(row({ phone: "", customer_ref: "A1" }), row({ phone: "", customer_ref: "A1" })).customers).toHaveLength(1);
    // different refs = two people who happen to share a name
    expect(check(row({ phone: "", customer_ref: "A1" }), row({ phone: "", customer_ref: "A2" })).customers).toHaveLength(2);
  });

  it("the client's own customer number decides, when it is given", () => {
    const same = check(row({ customer_ref: "K-17" }), row({ customer_ref: "K-17" }));
    expect(same.customers).toHaveLength(1);
    expect(same.customers[0]).toMatchObject({ ref: "K-17", key: "ref:k-17" });
    // one number used for two different people is a mistake in the sheet
    expect(errs(check(row({ customer_ref: "K-17" }), row({ customer_ref: "K-17", customer_name: "Someone Else" })))).toEqual(["3:customer_ref"]);
    // a changed phone number under the same ref is also flagged, not silently merged
    expect(errs(check(row({ customer_ref: "K-17" }), row({ customer_ref: "K-17", phone: "9000000009" })))).toEqual(["3:customer_ref"]);
  });

  it("a phone, when given, must still be a real 10-digit mobile", () => {
    expect(errs(check(row({ phone: "12345" })))).toEqual(["2:phone"]);
  });
});

describe("each loan can carry the client's own loan number", () => {
  it("keeps it, and refuses the same number twice in one file", () => {
    expect(check(row({ loan_ref: "L-204" })).loans[0].ref).toBe("L-204");
    expect(errs(check(row({ loan_ref: "L-204" }), row({ loan_ref: "l-204", loan_type: "weekly", frequency: "weekly" })))).toEqual(["3:loan_ref"]);
  });
  it("notes, once, how many loans have none", () => {
    const r = check(row(), row({ customer_name: "Other" }), row({ customer_name: "Third", loan_ref: "L-1" }));
    const note = r.warnings.filter((w) => w.column === "loan_ref");
    expect(note).toHaveLength(1);
    expect(note[0].message).toMatch(/^2 loan\(s\) have no loan_ref/);
    expect(note[0].affectsBalance).toBe(false);
  });
});

describe("the one date rule: day first, four-digit year", () => {
  it("reads DD/MM/YYYY, DD-MM-YYYY and DD.MM.YYYY day first", () => {
    expect(parseDate("04/05/2026")).toBe("2026-05-04"); // 4 May, never 5 April
    expect(parseDate("04-05-2026")).toBe("2026-05-04");
    expect(parseDate("4.5.2026")).toBe("2026-05-04");
    expect(parseDate("31/01/2026")).toBe("2026-01-31");
  });
  it("also reads YYYY-MM-DD", () => {
    expect(parseDate("2026-05-04")).toBe("2026-05-04");
  });
  it("refuses anything it would have to guess at", () => {
    for (const bad of ["5/13/2026", "04/05/26", "4 May 2026", "May 4, 2026", "2026/05/04", "04052026", "31/02/2026", "00/01/2026", ""]) expect(parseDate(bad), bad).toBeNull();
  });
  it("a month-first date is caught when the 'month' is over 12", () => {
    expect(errs(check(row({ start_date: "02/13/2026" })))).toEqual(["2:start_date"]);
  });
  it("shows how the first dates were read, so a wrong format is noticed", () => {
    const r = check(row({ start_date: "04/05/2026", next_due_date: "04/11/2026" }));
    expect(r.datesReadAs).toEqual([
      { row: 2, column: "start_date", written: "04/05/2026", readAs: "4 May 2026" },
      { row: 2, column: "next_due_date", written: "04/11/2026", readAs: "4 November 2026" },
    ]);
  });
});

describe("opening position: what the app will show for each loan", () => {
  it("up to date: nothing pending", () => {
    expect(check(row()).loans[0]).toMatchObject({ pendingToday: 0, periodsPending: 0 });
  });
  it("three missed months: three periods on the principal left today", () => {
    // 1,00,000 left at 3% = 3,000 a month; unpaid since 1 July -> Jul, Aug, Sep, Oct are due by 4 Oct
    const l = check(row({ next_due_date: "01/08/2026" })).loans[0];
    expect(l).toMatchObject({ periodsPending: 3, pendingToday: 900000 });
  });
  it("a part-paid month counts only what is left", () => {
    const l = check(row({ next_due_date: "01/10/2026", interest_already_paid: "1,000" })).loans[0];
    expect(l).toMatchObject({ periodsPending: 1, pendingToday: 200000 });
  });
  it("a closed loan has nothing pending", () => {
    expect(check(row({ status: "closed", principal_left: "0", closed_date: "01/09/2026", next_due_date: "" })).loans[0]).toMatchObject({ pendingToday: 0, periodsPending: 0, status: "closed" });
  });

  it("the client's own pending figure, when it agrees, raises nothing", () => {
    const r = check(row({ next_due_date: "01/08/2026", interest_pending_today: "9,000", loan_ref: "L1" }));
    expect(r.warnings).toEqual([]);
  });
  it("when it does not agree, that is flagged as changing a balance", () => {
    const r = check(row({ next_due_date: "01/08/2026", interest_pending_today: "12,000", loan_ref: "L1" }));
    expect(r.ok).toBe(true); // the file is well formed...
    expect(r.warnings).toHaveLength(1); // ...but must not be imported until this is settled
    expect(r.warnings[0]).toMatchObject({ row: 2, column: "interest_pending_today", affectsBalance: true });
    expect(r.warnings[0].message).toMatch(/Rs\. 12,000.*Rs\. 9,000.*3 unpaid periods from 1 August 2026/);
  });
  it("a very long unpaid stretch is pointed out", () => {
    const r = check(row({ start_date: "01/01/2025", next_due_date: "01/02/2026", loan_ref: "L1" }));
    expect(r.loans[0].periodsPending).toBe(9);
    expect(r.warnings.some((w) => w.column === "next_due_date" && /9 unpaid periods/.test(w.message))).toBe(true);
  });
  it("a last payment on or after the oldest unpaid collection is pointed out", () => {
    const r = check(row({ next_due_date: "01/09/2026", last_paid_date: "15/09/2026", loan_ref: "L1" }));
    expect(r.warnings.some((w) => w.column === "last_paid_date" && !w.affectsBalance)).toBe(true);
  });
});

describe("the sheet itself", () => {
  it("accepts the template's columns in any order", () => {
    const order = [...COLUMNS].reverse();
    const r = validateImport([order.join(","), row({ loan_ref: "L1" }, order)].join("\n"), TODAY);
    expect(r.errors).toEqual([]);
    expect(r.loans[0]).toMatchObject({ amount: 20000000, ref: "L1" });
  });
  it("says exactly which columns are missing, unknown or repeated", () => {
    const head = COLUMNS.filter((c) => c !== "loan_ref").concat(["loan_number" as never, "phone" as never]);
    const r = validateImport(head.join(",") + "\n", TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors[0].message).toMatch(/missing: loan_ref/);
    expect(r.errors[0].message).toMatch(/not in the template: loan_number/);
    expect(r.errors[0].message).toMatch(/repeated: phone/);
  });
});
