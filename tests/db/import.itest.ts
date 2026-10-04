// Importing existing customers and loans: the 20-row sample, against the real database.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { batchId, importPayload } from "../../src/lib/import/payload";
import { COLUMNS, validateImport } from "../../src/lib/import/validate";
import { admin, anon, codeOf, makeUser, pay, readLoan, today, type TestUser } from "./helpers";
import { rupees } from "../../src/lib/finance/money";

let owner: TestUser;
let TODAY: string;

/** The sample, with phone numbers made unique for this test run so runs do not collide. */
function sample(tag: string) {
  const text = readFileSync("import/sample-20.csv", "utf8").replace(/90000000(\d\d)/g, (_, n) => `9${tag}${n}`);
  return { text, result: validateImport(text, TODAY) };
}
const tag = () => String(Math.floor(1000000 + Math.random() * 8999999));
const loansOf = async (batch: string) => (await admin.from("loans").select("*").eq("import_batch", batch).order("id")).data ?? [];

beforeAll(async () => {
  owner = await makeUser("owner", "Import Owner");
  TODAY = await today(owner.db);
}, 60_000);

describe("importing the sample file", () => {
  it("saves every customer and loan, with balances exactly as in the file", async () => {
    const { text, result } = sample(tag());
    expect(result.errors).toEqual([]);
    const batch = batchId(text);
    const res = await admin.rpc("import_book", { p_batch: batch, p_file: "sample-20.csv", ...importPayload(result) });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ duplicate: false, customers: result.customers.length, loans: 20 });

    const loans = await loansOf(batch);
    expect(loans).toHaveLength(20);
    expect(loans.reduce((a, l) => a + l.principal_left, 0)).toBe(result.loans.reduce((a, l) => a + l.principalLeft, 0));
    expect(loans.reduce((a, l) => a + l.amount, 0)).toBe(result.loans.reduce((a, l) => a + l.amount, 0));
    expect(loans.filter((l) => l.status === "closed")).toHaveLength(2);
    expect((await admin.from("customers").select("id").eq("import_batch", batch)).data).toHaveLength(result.customers.length);

    // a customer with two loans is one customer
    const arun = (await admin.from("customers").select("id").eq("import_batch", batch).eq("name", "Sample Arun")).data!;
    expect(arun).toHaveLength(1);
    expect(loans.filter((l) => l.customer_id === arun[0].id)).toHaveLength(2);
  });

  it("starts each running loan from its next collection, and brings loans that are behind up to today", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-20.csv", ...importPayload(result) });
    const loans = await loansOf(batch);
    const byName = async (name: string) => {
      const c = (await admin.from("customers").select("id").eq("import_batch", batch).eq("name", name).single()).data!;
      return loans.filter((l) => l.customer_id === c.id);
    };

    // Ganesh: 3,00,000 at 3%, next collection was 30 July -> every month since is pending
    const [ganesh] = await byName("Sample Ganesh");
    const dues = (await readLoan(owner.db, ganesh.id)).dues;
    expect(dues[0]).toMatchObject({ dueDate: "2026-07-30", interestAmount: rupees(9000), paid: 0 });
    expect(dues.filter((d) => d.dueDate < TODAY).length).toBeGreaterThanOrEqual(3);
    expect(dues.every((d) => d.interestAmount === rupees(9000))).toBe(true);

    // Bala returned 50,000 before the import: interest is on what is left
    const [bala] = await byName("Sample Bala");
    expect((await readLoan(owner.db, bala.id)).dues[0].interestAmount).toBe(rupees(3000));

    // Dinesh: weekly with principal, 9,000 left -> never more than 9,000 scheduled
    const [dinesh] = await byName("Sample Dinesh");
    const parts = (await readLoan(owner.db, dinesh.id)).dues.reduce((a, d) => a + d.principalAmount, 0);
    expect(parts).toBeLessThanOrEqual(rupees(9000));

    // closed loans have nothing to collect; their security is marked released
    const [fathima] = await byName("Sample Fathima");
    expect((await readLoan(owner.db, fathima.id)).dues).toHaveLength(0);
    expect((await admin.from("collateral").select("status").eq("loan_id", fathima.id).single()).data!.status).toBe("released");

    // a vehicle can be found by its number
    const found = await owner.db.from("collateral").select("loan_id").ilike("search_text", "%TN 56 AR 4521%").in("loan_id", loans.map((l) => l.id));
    expect(found.data).toHaveLength(1);
  });

  it("an imported loan then works like any other: take a payment on it", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-20.csv", ...importPayload(result) });
    const loan = (await loansOf(batch)).find((l) => l.amount === rupees(500000) && l.type === "monthly")!;
    const res = await pay(owner.db, loan.id, { date: TODAY, interest: rupees(10000), principal: 0, other: 0 });
    expect(res.error).toBeNull();
    expect((await readLoan(owner.db, loan.id)).loan.principalLeft).toBe(rupees(500000));
  });

  it("importing the same file twice saves it once", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    const args = { p_batch: batch, p_file: "sample-20.csv", ...importPayload(result) };
    await admin.rpc("import_book", args);
    const again = await admin.rpc("import_book", args);
    expect(again.data).toEqual({ duplicate: true });
    expect(await loansOf(batch)).toHaveLength(20);
    expect(batchId(text + "\n")).toBe(batch); // a trailing blank line does not make it a "different" file
  });

  it("a customer already in the system (same phone) is reused, not duplicated", async () => {
    const t = tag();
    const { text, result } = sample(t);
    const phone = `9${t}01`;
    await admin.from("customers").insert({ name: "Sample Arun", phone, area: "Erode" });
    const batch = batchId(text);
    const res = await admin.rpc("import_book", { p_batch: batch, p_file: "sample-20.csv", ...importPayload(result) });
    expect(res.data.customers).toBe(result.customers.length - 1);
    expect((await admin.from("customers").select("id").eq("phone", phone)).data).toHaveLength(1);
  });
});

describe("a bad file changes nothing", () => {
  it("the checker refuses it and names every bad row; it cannot be turned into an import", () => {
    const text = readFileSync("import/sample-20.csv", "utf8").replace("Sample Chitra,9000000003", "Sample Chitra,12345").replace('"3,00,000","3,00,000",30-04-2026', '"3,00,000","9,00,000",30-04-2026');
    const result = validateImport(text, TODAY);
    expect(result.ok).toBe(false);
    expect(result.errors.map((e) => `${e.row}:${e.column}`)).toEqual(["5:phone", "9:principal_left"]);
    expect(() => importPayload(result)).toThrow();
  });

  it("if the database refuses one row, no row of the file is saved", async () => {
    const { text, result } = sample(tag());
    const batch = randomUUID();
    const payload = importPayload(result);
    payload.p_loans[15] = { ...payload.p_loans[15], principal_left: payload.p_loans[15].amount + 1 }; // breaks a database rule
    const res = await admin.rpc("import_book", { p_batch: batch, p_file: "broken.csv", ...payload });
    expect(res.error).not.toBeNull();
    expect(await loansOf(batch)).toHaveLength(0);
    expect((await admin.from("customers").select("id").eq("import_batch", batch)).data).toHaveLength(0);
    expect((await admin.from("import_batches").select("id").eq("id", batch)).data).toHaveLength(0);
    void text;
  });

  it("the template's columns are the ones the checker expects", () => {
    expect(readFileSync("import/template.csv", "utf8").trim().split(",")).toEqual([...COLUMNS]);
  });
});

describe("who can import, and taking an import back", () => {
  it("cannot be called from the app, even by the owner", async () => {
    const args = { p_batch: randomUUID(), p_file: "x", p_customers: [], p_loans: [] };
    expect((await owner.db.rpc("import_book", args)).error).not.toBeNull();
    expect((await anon.rpc("import_book", args)).error).not.toBeNull();
    expect((await owner.db.rpc("undo_import", { p_batch: args.p_batch })).error).not.toBeNull();
  });

  it("a wrong import can be taken back completely, before anything is collected", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-20.csv", ...importPayload(result) });
    const ids = (await loansOf(batch)).map((l) => l.id);
    const res = await admin.rpc("undo_import", { p_batch: batch });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ customers: result.customers.length, loans: 20 });
    expect(await loansOf(batch)).toHaveLength(0);
    expect((await admin.from("dues").select("id").in("loan_id", ids)).data).toHaveLength(0);
    expect((await admin.from("customers").select("id").eq("import_batch", batch)).data).toHaveLength(0);
    expect(codeOf(await admin.rpc("undo_import", { p_batch: batch }))).toBe("IMPORT");
  });

  it("but not after a payment has been recorded on it", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-20.csv", ...importPayload(result) });
    const loan = (await loansOf(batch)).find((l) => l.status === "active")!;
    const { dues } = await readLoan(owner.db, loan.id);
    expect((await pay(owner.db, loan.id, { date: TODAY, interest: dues[0].interestAmount, principal: 0, other: 0 })).error).toBeNull();
    expect(codeOf(await admin.rpc("undo_import", { p_batch: batch }))).toBe("IMPORT");
    expect(await loansOf(batch)).toHaveLength(20);
  });

  it("an ordinary loan still cannot be deleted", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-20.csv", ...importPayload(result) });
    const loan = (await loansOf(batch))[0];
    expect((await admin.from("loans").delete().eq("id", loan.id)).error?.message).toMatch(/HISTORY_LOCKED/);
  });
});
