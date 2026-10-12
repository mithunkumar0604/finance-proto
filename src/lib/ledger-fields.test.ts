import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { latestNotes, loanNoProblem, nextLoanNo, referrers } from "./loan-form";
import { dmy, EXPORT_HEAD, exportSheet } from "./report-export";
import { buildXlsx, cellRef, sheetXml } from "./report-xlsx";
import type { RegisterLine } from "./reports";
import type { Customer, Loan, LoanNote } from "./types";

const loan = (id: string, extra: Partial<Loan> = {}): Loan => ({
  id,
  customerId: "C1",
  type: "monthly",
  amount: 10000000,
  startDate: "2026-01-20",
  interest: { style: "percent", value: 3, method: "reducing" },
  frequency: "monthly",
  principalPerDue: 0,
  principalLeft: 10000000,
  status: "active",
  security: null,
  ...extra,
});

describe("the business's own loan number", () => {
  it("suggests the next number after the highest one used", () => {
    expect(nextLoanNo([loan("a", { loanNo: "6845" }), loan("b", { loanNo: "6873" }), loan("c", { loanNo: "5225" })])).toBe("6874");
  });
  it("ignores numbers that are not plain numbers, and loans without one", () => {
    expect(nextLoanNo([loan("a", { loanNo: "A-12" }), loan("b"), loan("c", { loanNo: "0412" })])).toBe("413");
  });
  it("suggests nothing when no number has been used yet", () => {
    expect(nextLoanNo([])).toBe("");
    expect(nextLoanNo([loan("a"), loan("b", { loanNo: "KVR" })])).toBe("");
  });

  const book = [loan("LP-1", { loanNo: "6845" }), loan("LP-2", { loanNo: "ab12" }), loan("LP-3")];
  it("is optional", () => {
    expect(loanNoProblem("", book)).toBeNull();
    expect(loanNoProblem("   ", book)).toBeNull();
  });
  it("cannot be one another loan already has, however it is typed", () => {
    expect(loanNoProblem("6845", book)).toBe("Loan number 6845 is already used by loan LP-1.");
    expect(loanNoProblem(" 6845 ", book)).toMatch(/already used by loan LP-1/);
    expect(loanNoProblem("AB12", book)).toMatch(/already used by loan LP-2/);
    expect(loanNoProblem("6846", book)).toBeNull();
  });
  it("a loan may keep its own number when it is edited", () => {
    expect(loanNoProblem("6845", book, "LP-1")).toBeNull();
    expect(loanNoProblem("6845", book, "LP-3")).toMatch(/already used/);
  });
  it("is kept short", () => {
    expect(loanNoProblem("1".repeat(31), book)).toMatch(/30/);
  });
});

describe("referred by", () => {
  it("offers the names already used, each once, most used first", () => {
    const list = referrers([
      loan("a", { referredBy: "Suresh" }),
      loan("b", { referredBy: "suresh " }),
      loan("c", { referredBy: "AK" }),
      loan("d"),
      loan("e", { referredBy: "Suresh" }),
      loan("f", { referredBy: "Kumar" }),
      loan("g", { referredBy: "AK" }),
    ]);
    expect(list).toEqual(["Suresh", "AK", "Kumar"]);
  });
});

const note = (id: string, loanId: string, at: string, text: string, promisedOn?: string): LoanNote => ({ id, loanId, at, by: "Owner", text, ...(promisedOn ? { promisedOn } : {}) });

describe("notes", () => {
  it("the newest note of each loan is the one shown in lists", () => {
    const m = latestNotes([note("1", "L1", "2026-10-01T10:00:00Z", "old"), note("3", "L1", "2026-10-05T10:00:00Z", "new"), note("2", "L2", "2026-10-03T10:00:00Z", "only")]);
    expect(m.get("L1")?.text).toBe("new");
    expect(m.get("L2")?.text).toBe("only");
    expect(m.size).toBe(2);
  });
});

const customer = (name: string, phone: string): Customer => ({ id: "C1", name, phone, area: "Erode", createdAt: "2026-01-01" });
const line = (l: Loan, c: Customer, extra: Partial<RegisterLine> = {}): RegisterLine => ({ loan: l, customer: c, interest: 0, paid: 0, pending: 0, upcoming: 0, upcomingCount: 0, status: "paid", daysLate: 0, ...extra });

describe("the Excel sheet of a report", () => {
  const lines = [
    line(loan("LP-1002", { loanNo: "6863", referredBy: "Suresh", startDate: "2026-01-26", amount: 5000000, principalLeft: 3000000 }), customer("Kumar", "8838039399"), { lastPaid: "2026-12-01", nextDue: "2026-12-26", pending: 150000, status: "overdue" }),
    line(loan("LP-1001", { loanNo: "6845", referredBy: "Suresh", security: { kind: "vehicle", registration: "TN 33 AB 1234", vehicleType: "bike", make: "Hero", model: "Splendor", ownerName: "x", rcRef: "x", documentHeld: "RC", storage: "x", status: "held" } }), customer("Ganesh", "8610401368"), { lastPaid: "2026-12-02" }),
    line(loan("LP-1003", { startDate: "2025-05-20", interest: { style: "custom", value: 0, method: "manual" } }), customer("=SUM(A1)", "7339580455")),
  ];
  const notes = new Map([["LP-1001", note("1", "LP-1001", "2026-10-05T10:00:00Z", "Will pay next week", "2026-10-12")]]);
  const sheet = exportSheet(lines, notes, "October 2026 Report", "All People · October 2026");

  it("has the client's nine columns first, in their order", () => {
    expect(EXPORT_HEAD.slice(0, 9)).toEqual(["Given Date", "Loan No.", "Name", "Referred By", "Phone", "Date", "Note", "Payment", "Amount"]);
    expect(sheet.head).toEqual(EXPORT_HEAD);
  });

  it("writes one row per loan, in loan-number order, loans without a number last", () => {
    expect(sheet.rows.map((r) => r[1])).toEqual(["6845", "6863", ""]);
    expect(sheet.rows).toHaveLength(3);
  });

  it("fills a row as their ledger does", () => {
    expect(sheet.rows[0].slice(0, 9)).toEqual(["20/01/2026", "6845", "Ganesh", "Suresh", "8610401368", "02/12/2026", "Will pay next week (promised 12/10/2026)", 3000, 100000]);
    // then where the loan stands
    expect(sheet.rows[0].slice(9)).toEqual([100000, 0, "", "Paid", "TN 33 AB 1234 · Hero Splendor", "Erode", "LP-1001"]);
    expect(sheet.rows[1].slice(7, 13)).toEqual([900, 50000, 30000, 1500, "26/12/2026", "Overdue"]);
  });

  it("leaves Payment blank where interest is entered by hand each time", () => {
    expect(sheet.rows[2][7]).toBeNull();
  });

  it("writes dates day first", () => {
    expect(dmy("2026-10-05")).toBe("05/10/2026");
    expect(dmy(undefined)).toBe("");
  });

  it("is a real .xlsx: a zip with the workbook parts, amounts as numbers, text as text", async () => {
    const bytes = await buildXlsx(sheet);
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml"]);
    const xml = strFromU8(files["xl/worksheets/sheet1.xml"]);
    // title lines, a blank line, then the header on row 4 and data from row 5
    expect(xml).toContain(`<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">October 2026 Report</t></is></c>`);
    expect(xml).toContain(`<c r="A4" s="1" t="inlineStr"><is><t xml:space="preserve">Given Date</t></is></c>`);
    expect(xml).toContain(`<c r="B5" s="0" t="inlineStr"><is><t xml:space="preserve">6845</t></is></c>`);
    expect(xml).toContain(`<c r="I5" s="2"><v>100000</v></c>`);
    expect(xml).toContain(`<c r="H5" s="2"><v>3000</v></c>`);
    // the phone number stays text, so Excel does not turn it into 8.61E+09
    expect(xml).toContain(`<c r="E5" s="0" t="inlineStr"><is><t xml:space="preserve">8610401368</t></is></c>`);
    // the header row stays in view
    expect(xml).toContain(`<pane ySplit="4" topLeftCell="A5"`);
    expect(strFromU8(files["xl/workbook.xml"])).toContain(`<sheet name="Loans"`);
  });

  it("a name that looks like a formula is written as plain text, and odd characters are made safe", () => {
    const xml = sheetXml({ name: "x", head: ["A"], rows: [["=SUM(A1)"], ["Tom & <Jerry> \"q\""], ["bad\u0001char"]] });
    expect(xml).toContain(`t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t>`);
    expect(xml).not.toContain("<f>");
    expect(xml).toContain("Tom &amp; &lt;Jerry&gt; &quot;q&quot;");
    expect(xml).toContain("badchar");
  });

  it("names columns past Z correctly", () => {
    expect(cellRef(0, 1)).toBe("A1");
    expect(cellRef(25, 3)).toBe("Z3");
    expect(cellRef(26, 3)).toBe("AA3");
    expect(cellRef(27, 10)).toBe("AB10");
  });
});
