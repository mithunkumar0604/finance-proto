import { describe, expect, it } from "vitest";
import { collectionSheet, shortDate } from "./collection-sheet";
import type { AppState } from "./store";
import type { Customer, Due, Loan, LoanNote } from "./types";

const DATE = "2026-10-17";
const customer = (id: string, name: string, area: string, extra: Partial<Customer> = {}): Customer => ({ id, name, phone: `90000000${id.slice(1).padStart(2, "0")}`, area, createdAt: "2026-01-01", ...extra });
const loan = (id: string, customerId: string, loanNo: string | undefined, extra: Partial<Loan> = {}): Loan => ({
  id,
  customerId,
  type: "monthly",
  amount: 10000000,
  startDate: "2026-02-15",
  interest: { style: "percent", value: 3, method: "reducing" },
  frequency: "monthly",
  principalPerDue: 0,
  principalLeft: 10000000,
  status: "active",
  security: null,
  ...(loanNo ? { loanNo } : {}),
  ...extra,
});
const due = (id: string, loanId: string, dueDate: string, interest: number, paid = 0, extra: Partial<Due> = {}): Due => ({ id, loanId, dueDate, interestAmount: interest, principalAmount: 0, paid, interestPaid: paid, ...extra });

const state = (viewAs: "owner" | "collector" = "owner", userId?: string) =>
  ({
    customers: [
      customer("C1", "Karthi", "Perundurai", { collectorId: "U2" }),
      customer("C2", "Manikandan", "Chennimalai"),
      customer("C3", "Poongkuzhali", "Perundurai", { collectorId: "U2" }),
      customer("C4", "Settled Siva", "Perundurai"),
    ],
    loans: [
      loan("LP-1", "C1", "7967"),
      loan("LP-2", "C1", "4599", { security: { kind: "vehicle", registration: "TN 33 AB 1", vehicleType: "bike", make: "Honda", model: "Hornet", ownerName: "x", rcRef: "x", documentHeld: "RC", storage: "x", status: "held" } }),
      loan("LP-3", "C2", "4730"),
      loan("LP-4", "C3", "4791", { security: { kind: "jewel", description: "Chain", weightGrams: 10, purity: "22K", estimatedValue: 1, packetNo: "1", storage: "x", status: "held" } }),
      loan("LP-5", "C4", "5000", { status: "closed", principalLeft: 0 }),
      loan("LP-6", "C2", undefined),
    ],
    dues: [
      due("D1", "LP-1", DATE, 300000), // due on the day
      due("D2a", "LP-2", "2026-09-15", 300000), // overdue
      due("D2b", "LP-2", "2026-10-15", 300000, 100000), // overdue, part paid
      due("D3", "LP-3", "2026-10-20", 300000), // not yet due: not on the sheet
      due("D4", "LP-4", DATE, 300000, 300000), // paid already: not on the sheet
      due("D5", "LP-5", "2026-09-01", 300000), // closed loan: not on the sheet
      due("D6", "LP-6", "2026-10-10", 300000, 0, { principalAmount: 500000 }), // overdue with principal
      due("D7", "LP-4", "2026-10-01", 200000, 0, { cancelled: true }), // cancelled: not counted
    ],
    payments: [],
    activity: [],
    users: [],
    notes: [
      { id: "1", loanId: "LP-2", at: "2026-10-10T10:00:00", by: "Owner", text: "Will pay next week", promisedOn: "2026-10-18" },
      { id: "2", loanId: "LP-2", at: "2026-10-01T10:00:00", by: "Owner", text: "older note" },
    ] as LoanNote[],
    session: { loggedIn: true, locked: false, viewAs, userId },
  }) as unknown as AppState;

describe("the printed collection sheet", () => {
  const sheet = collectionSheet(state(), DATE);

  it("lists what is to be collected by that day: the day's collections and anything overdue, nothing else", () => {
    expect(sheet.rows.map((r) => r.loanId).sort()).toEqual(["LP-1", "LP-2", "LP-6"]);
  });

  it("the expected amount is everything still owed by that day, interest and principal", () => {
    const by = Object.fromEntries(sheet.rows.map((r) => [r.loanId, r.expected]));
    expect(by).toEqual({ "LP-1": 300000, "LP-2": 300000 + 200000, "LP-6": 800000 });
    expect(sheet.total).toBe(1600000);
  });

  it("orders by area, keeps a customer's loans together, by their loan number", () => {
    // Chennimalai before Perundurai; Karthi's two loans side by side, 4599 before 7967
    expect(sheet.rows.map((r) => r.loanNo)).toEqual(["LP-6", "4599", "7967"]);
  });

  it("shows the loan number, the item in a word, and the latest note, with how long it has been due", () => {
    const r = sheet.rows.find((x) => x.loanId === "LP-2")!;
    expect(r).toMatchObject({ loanNo: "4599", name: "Karthi", tag: "Honda Hornet", given: "2026-02-15", dueSince: "2026-09-15", phone: "9000000001" });
    expect(r.note).toBe("Due since 15/09/26 · Will pay next week (promised 18/10/26)");
    // due on the day itself: not "behind", no note
    expect(sheet.rows.find((x) => x.loanId === "LP-1")!.note).toBe("");
    // a loan without the business's number shows the app's id
    expect(sheet.rows.find((x) => x.loanId === "LP-6")!.loanNo).toBe("LP-6");
  });

  it("a collector's sheet has only their own customers", () => {
    const mine = collectionSheet(state("collector", "U2"), DATE);
    expect(mine.rows.map((r) => r.loanId).sort()).toEqual(["LP-1", "LP-2"]);
  });

  it("writes dates the way they do on paper", () => {
    expect(shortDate("2026-10-17")).toBe("17/10/26");
  });
});
