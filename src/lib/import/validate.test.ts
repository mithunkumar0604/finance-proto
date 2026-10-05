import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { COLUMNS, parseCsv, validateImport } from "./validate";

const TODAY = "2026-10-04";
const header = COLUMNS.join(",");
/** A good row; override cells by column name. */
const row = (over: Record<string, string> = {}) => {
  const base: Record<string, string> = {
    customer_name: "Ravi Kumar",
    phone: "9876543210",
    area: "Perundurai",
    loan_type: "monthly",
    loan_amount: "2,00,000",
    principal_left: "1,20,000",
    start_date: "01-02-2026",
    interest_style: "percent",
    interest_value: "3",
    interest_method: "reducing",
    frequency: "monthly",
    next_due_date: "01-11-2026",
    security_type: "none",
    status: "active",
  };
  const cells = { ...base, ...over };
  return COLUMNS.map((c) => (/[",\n]/.test(cells[c] ?? "") ? `"${(cells[c] ?? "").replace(/"/g, '""')}"` : (cells[c] ?? ""))).join(",");
};
const check = (...rows: string[]) => validateImport([header, ...rows].join("\n"), TODAY);
const messages = (r: ReturnType<typeof check>) => r.errors.map((e) => `${e.row}:${e.column}`);

describe("reading the file", () => {
  it("reads quoted cells, commas inside quotes, doubled quotes, Windows line ends and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"1,00,000","say ""hi"""\r\nx,\r\n')).toEqual([["a", "b"], ["1,00,000", 'say "hi"'], ["x", ""]]);
  });
  it("refuses a file whose columns are not the template's", () => {
    const r = validateImport("name,phone\nRavi,9876543210", TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatchObject({ row: 1, column: "(header)" });
  });
  it("ignores blank lines", () => {
    expect(check(row(), "", ",,,,").loans).toHaveLength(1);
  });
});

describe("a good row", () => {
  const r = check(row());
  it("is accepted", () => {
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("turns rupees into paise and dates into ISO dates", () => {
    expect(r.loans[0]).toMatchObject({
      row: 2,
      customerKey: "np:ravi kumar|9876543210",
      type: "monthly",
      amount: 20000000,
      principalLeft: 12000000,
      startDate: "2026-02-01",
      interest: { style: "percent", value: 3, method: "reducing" },
      frequency: "monthly",
      principalPerDue: 0,
      nextDueDate: "2026-11-01",
      status: "active",
      security: null,
    });
    expect(r.customers).toEqual([{ key: "np:ravi kumar|9876543210", row: 2, name: "Ravi Kumar", phone: "9876543210", area: "Perundurai" }]);
  });
  it("accepts ISO dates and a fixed interest in rupees", () => {
    const f = check(row({ start_date: "2026-02-01", interest_style: "fixed", interest_value: "2,500", interest_method: "fixed", frequency: "weekly", loan_type: "weekly" }));
    expect(f.errors).toEqual([]);
    expect(f.loans[0].interest).toEqual({ style: "fixed", value: 250000, method: "fixed" });
  });
});

describe("one customer with several loans", () => {
  it("is one customer when the name and phone are the same", () => {
    const r = check(row(), row({ loan_type: "vehicle", loan_amount: "100000", principal_left: "100000", security_type: "vehicle", vehicle_registration: "tn 56 ar 4521", security_description: "Royal Enfield Classic 350" }));
    expect(r.errors).toEqual([]);
    expect(r.customers).toHaveLength(1);
    expect(r.loans).toHaveLength(2);
    expect(r.loans[1].security).toEqual({ kind: "vehicle", description: "Royal Enfield Classic 350", registration: "TN 56 AR 4521" });
  });
  it("the same phone under two different names is two customers (see opening.test.ts)", () => {
    const r = check(row(), row({ customer_name: "Someone Else" }));
    expect(r.errors).toEqual([]);
    expect(r.customers).toHaveLength(2);
  });
  it("a row with no loan amount adds the customer only", () => {
    const r = check(row({ loan_type: "", loan_amount: "", principal_left: "", start_date: "", interest_style: "", interest_value: "", interest_method: "", frequency: "", next_due_date: "", security_type: "", status: "" }));
    expect(r.errors).toEqual([]);
    expect(r.customers).toHaveLength(1);
    expect(r.loans).toHaveLength(0);
  });
});

describe("bad rows are reported, each with its row and column", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["missing name", { customer_name: " " }, "customer_name"],
    ["phone not 10 digits", { phone: "98765" }, "phone"],
    ["amount not a number", { loan_amount: "two lakh" }, "loan_amount"],
    ["zero amount", { loan_amount: "0" }, "loan_amount"],
    ["principal left more than given", { principal_left: "2,50,000" }, "principal_left"],
    ["negative principal", { principal_left: "-5" }, "principal_left"],
    ["unknown loan type", { loan_type: "yearly" }, "loan_type"],
    ["unknown frequency", { frequency: "daily" }, "frequency"],
    ["percent over 100", { interest_value: "300" }, "interest_value"],
    ["interest missing", { interest_value: "" }, "interest_value"],
    ["unknown interest style", { interest_style: "compound" }, "interest_style"],
    ["bad start date", { start_date: "31-02-2026" }, "start_date"],
    ["start date in the future", { start_date: "01-01-2027" }, "start_date"],
    ["next due before the loan", { next_due_date: "01-01-2026" }, "next_due_date"],
    ["next due missing on a running loan", { next_due_date: "" }, "next_due_date"],
    ["unknown security", { security_type: "land" }, "security_type"],
    ["vehicle without a number", { security_type: "vehicle" }, "vehicle_registration"],
    ["unknown status", { status: "paused" }, "status"],
    ["closed but principal still owed", { status: "closed", closed_date: "01-09-2026" }, "principal_left"],
    ["closed without a date", { status: "closed", principal_left: "0" }, "closed_date"],
    ["running with nothing owed", { principal_left: "0" }, "status"],
  ];
  for (const [name, over, column] of cases)
    it(name, () => {
      const r = check(row(over));
      expect(r.ok).toBe(false);
      expect(messages(r)).toContain(`2:${column}`);
    });

  it("reports every bad row, not just the first, and still lists the good ones", () => {
    const r = check(row(), row({ phone: "12", customer_name: "A" }), row({ phone: "9000000001", customer_name: "B", loan_amount: "x" }), row({ phone: "9000000002", customer_name: "C" }));
    expect(r.ok).toBe(false);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(r.loans.map((l) => l.row)).toEqual([2, 5]);
  });
  it("never lets a number through that is not whole paise", () => {
    expect(messages(check(row({ loan_amount: "1000.555" })))).toContain("2:loan_amount");
    expect(check(row({ loan_amount: "1000.50", principal_left: "1000.50" })).loans[0].amount).toBe(100050);
  });
});

describe("the made-up sample that ships with the template", () => {
  const text = readFileSync("import/sample-22.csv", "utf8");
  const r = validateImport(text, TODAY);
  it("is valid, has 22 loans, and raises nothing that would change a balance", () => {
    expect(r.errors).toEqual([]);
    expect(r.loans).toHaveLength(22);
    expect(r.customers).toHaveLength(20); // two customers have two loans each
    expect(r.warnings.filter((w) => w.affectsBalance)).toEqual([]);
  });
  it("covers the kinds of record the business has", () => {
    expect(new Set(r.loans.map((l) => l.type))).toEqual(new Set(["weekly", "monthly", "15day", "30day", "vehicle", "jewel"]));
    expect(r.loans.some((l) => l.status === "closed")).toBe(true);
    expect(r.loans.some((l) => l.principalLeft < l.amount && l.status === "active")).toBe(true);
    expect(r.loans.some((l) => l.nextDueDate! < TODAY)).toBe(true);
    expect(r.loans.some((l) => l.principalPerDue > 0)).toBe(true);
  });
});

describe("a month that is already part-paid, and the last payment date", () => {
  it("accepts interest already paid towards the next collection", () => {
    // 1,20,000 left at 3% = 3,600 for the period; 1,500 of it is already paid
    const r = check(row({ interest_already_paid: "1,500", last_paid_date: "20-10-2026".replace("20-10", "01-10") }));
    expect(r.errors).toEqual([]);
    expect(r.loans[0]).toMatchObject({ interestAlreadyPaid: 150000, lastPaidDate: "2026-10-01" });
  });
  it("leaves both out when the columns are empty", () => {
    const l = check(row()).loans[0];
    expect(l).not.toHaveProperty("interestAlreadyPaid");
    expect(l).not.toHaveProperty("lastPaidDate");
  });
  it("refuses an amount that is the whole period's interest or more (move the next collection date instead)", () => {
    expect(messages(check(row({ interest_already_paid: "3,600" })))).toEqual(["2:interest_already_paid"]);
    expect(messages(check(row({ interest_already_paid: "5,000" })))).toEqual(["2:interest_already_paid"]);
    expect(check(row({ interest_already_paid: "3,599" })).errors).toEqual([]);
  });
  it("works the period's interest out the same way the app does (flat, fixed amount)", () => {
    // flat 3% of the 2,00,000 first given = 6,000 a period
    expect(check(row({ interest_method: "fixed", interest_already_paid: "5,999" })).errors).toEqual([]);
    expect(messages(check(row({ interest_method: "fixed", interest_already_paid: "6,000" })))).toEqual(["2:interest_already_paid"]);
    expect(messages(check(row({ interest_style: "fixed", interest_value: "2,500", interest_method: "fixed", interest_already_paid: "2,500" })))).toEqual(["2:interest_already_paid"]);
  });
  it("refuses it on a closed loan", () => {
    expect(messages(check(row({ status: "closed", principal_left: "0", closed_date: "01-09-2026", next_due_date: "", interest_already_paid: "500" })))).toContain("2:interest_already_paid");
  });
  it("checks the last payment date", () => {
    expect(messages(check(row({ last_paid_date: "32-01-2026" })))).toEqual(["2:last_paid_date"]);
    expect(messages(check(row({ last_paid_date: "01-01-2027" })))).toEqual(["2:last_paid_date"]); // in the future
    expect(messages(check(row({ last_paid_date: "01-01-2026" })))).toEqual(["2:last_paid_date"]); // before the loan was given
    expect(messages(check(row({ status: "closed", principal_left: "0", closed_date: "01-09-2026", next_due_date: "", last_paid_date: "15-09-2026" })))).toEqual(["2:last_paid_date"]); // after it closed
  });
});

describe("the sample covers what the client was asked to include", () => {
  const r = validateImport(readFileSync("import/sample-22.csv", "utf8"), TODAY);
  it("has a part-paid month and last payment dates", () => {
    expect(r.loans.some((l) => (l.interestAlreadyPaid ?? 0) > 0)).toBe(true);
    expect(r.loans.filter((l) => l.lastPaidDate).length).toBeGreaterThanOrEqual(5);
  });
  it("has a customer with more than one loan, a vehicle loan, a jewel loan and short-term loans", () => {
    const perCustomer = new Map<string, number>();
    for (const l of r.loans) perCustomer.set(l.customerKey, (perCustomer.get(l.customerKey) ?? 0) + 1);
    expect([...perCustomer.values()].some((n) => n > 1)).toBe(true);
    expect(r.loans.some((l) => l.security?.kind === "vehicle" && l.security.registration)).toBe(true);
    expect(r.loans.some((l) => l.security?.kind === "jewel")).toBe(true);
    expect(r.loans.some((l) => l.type === "15day" || l.type === "30day")).toBe(true);
  });
});
