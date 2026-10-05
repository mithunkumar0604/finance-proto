// Importing existing customers and loans: the made-up 22-row sample, against the real database.

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
  const text = readFileSync("import/sample-22.csv", "utf8")
    .replace(/90000000(\d\d)/g, (_, n) => `9${tag}${n}`)
    .replace(/\bS([CL])(\d\d)\b/g, (_, k, n) => `S${k}${tag}${n}`);
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
    const res = await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) });
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ duplicate: false, customers: result.customers.length, loans: 22 });

    const loans = await loansOf(batch);
    expect(loans).toHaveLength(22);
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
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) });
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
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) });
    const loan = (await loansOf(batch)).find((l) => l.amount === rupees(500000) && l.type === "monthly")!;
    const res = await pay(owner.db, loan.id, { date: TODAY, interest: rupees(10000), principal: 0, other: 0 });
    expect(res.error).toBeNull();
    expect((await readLoan(owner.db, loan.id)).loan.principalLeft).toBe(rupees(500000));
  });

  it("importing the same file twice saves it once", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    const args = { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) };
    await admin.rpc("import_book", args);
    const again = await admin.rpc("import_book", args);
    expect(again.data).toEqual({ duplicate: true });
    expect(await loansOf(batch)).toHaveLength(22);
    expect(batchId(text + "\n")).toBe(batch); // a trailing blank line does not make it a "different" file
  });

  it("a customer already in the system (same name and phone) is reused, not duplicated", async () => {
    const t = tag();
    const { text, result } = sample(t);
    const phone = `9${t}01`;
    await admin.from("customers").insert({ name: "Sample Arun", phone, area: "Erode" });
    const batch = batchId(text);
    const res = await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) });
    expect(res.data.customers).toBe(result.customers.length - 1);
    // that phone now belongs to two customers: the one already there, and his brother from the file
    const sharing = (await admin.from("customers").select("name,import_ref").eq("phone", phone).order("name")).data!;
    expect(sharing.map((c) => c.name)).toEqual(["Sample Arun", "Sample Arun's Brother"]);
    expect(sharing[0].import_ref).toBe(`SC${t}01`); // the existing customer took the sheet's number
  });
});

describe("a bad file changes nothing", () => {
  it("the checker refuses it and names every bad row; it cannot be turned into an import", () => {
    const text = readFileSync("import/sample-22.csv", "utf8").replace("Sample Chitra,9000000003", "Sample Chitra,12345").replace('"3,00,000","3,00,000",30/04/2026', '"3,00,000","9,00,000",30/04/2026');
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
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) });
    const ids = (await loansOf(batch)).map((l) => l.id);
    const res = await admin.rpc("undo_import", { p_batch: batch });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ customers: result.customers.length, loans: 22 });
    expect(await loansOf(batch)).toHaveLength(0);
    expect((await admin.from("dues").select("id").in("loan_id", ids)).data).toHaveLength(0);
    expect((await admin.from("customers").select("id").eq("import_batch", batch)).data).toHaveLength(0);
    expect(codeOf(await admin.rpc("undo_import", { p_batch: batch }))).toBe("IMPORT");
  });

  it("but not after a payment has been recorded on it", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) });
    const loan = (await loansOf(batch)).find((l) => l.status === "active")!;
    const { dues } = await readLoan(owner.db, loan.id);
    expect((await pay(owner.db, loan.id, { date: TODAY, interest: dues[0].interestAmount, principal: 0, other: 0 })).error).toBeNull();
    expect(codeOf(await admin.rpc("undo_import", { p_batch: batch }))).toBe("IMPORT");
    expect(await loansOf(batch)).toHaveLength(22);
  });

  it("an ordinary loan still cannot be deleted", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) });
    const loan = (await loansOf(batch))[0];
    expect((await admin.from("loans").delete().eq("id", loan.id)).error?.message).toMatch(/HISTORY_LOCKED/);
  });
});

describe("a part-paid month and the last payment date come in with the import", () => {
  it("the part-paid month shows only what is left, and the rest can be collected", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    expect((await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) })).error).toBeNull();
    const c = (await admin.from("customers").select("id").eq("import_batch", batch).eq("name", "Sample Bala").single()).data!;
    const loan = (await loansOf(batch)).find((l) => l.customer_id === c.id)!;
    const before = await readLoan(owner.db, loan.id);
    // 1,00,000 left at 3% = 3,000 for the month; the file says 1,000 of it was already paid on 20 Sep
    expect(before.dues[0]).toMatchObject({ dueDate: "2026-10-15", interestAmount: rupees(3000), interestPaid: rupees(1000), paid: rupees(1000), lastPaidDate: "2026-09-20" });
    // what was paid before the import is not recorded as money received in the app
    expect((await admin.from("payments").select("id").eq("loan_id", loan.id)).data).toHaveLength(0);

    // only the 2,000 still pending can be collected for that month
    await expect(pay(owner.db, loan.id, { date: TODAY, interest: rupees(2001), principal: 0, other: 0, allocations: [{ dueId: before.dues[0].id, amount: rupees(2001) }] })).rejects.toThrow(/more than the interest pending/);
    expect((await pay(owner.db, loan.id, { date: TODAY, interest: rupees(2000), principal: 0, other: 0, allocations: [{ dueId: before.dues[0].id, amount: rupees(2000) }] })).error).toBeNull();
    const after = await readLoan(owner.db, loan.id);
    expect(after.dues[0]).toMatchObject({ interestPaid: rupees(3000), paid: rupees(3000) });
  });

  it("'Last Paid' is the imported date until a payment is recorded in the app, then the newer one", async () => {
    const { text, result } = sample(tag());
    const batch = batchId(text);
    await admin.rpc("import_book", { p_batch: batch, p_file: "sample-22.csv", ...importPayload(result) });
    const loans = await loansOf(batch);
    const lastPaid = async (id: string) => (await owner.db.from("loan_last_paid").select("last_interest_paid_on").eq("loan_id", id).maybeSingle()).data?.last_interest_paid_on ?? null;

    const ganesh = loans.find((l) => l.amount === rupees(300000) && l.type === "monthly")!;
    expect(ganesh.imported_last_paid_on).toBe("2026-06-30");
    expect(await lastPaid(ganesh.id)).toBe("2026-06-30");
    const { dues } = await readLoan(owner.db, ganesh.id);
    expect((await pay(owner.db, ganesh.id, { date: TODAY, interest: dues[0].interestAmount, principal: 0, other: 0 })).error).toBeNull();
    expect(await lastPaid(ganesh.id)).toBe(TODAY);

    // a loan the file gave no date for has no "Last Paid" yet
    const mani = loans.find((l) => l.amount === rupees(120000) && l.type === "monthly")!;
    expect(await lastPaid(mani.id)).toBeNull();
  });

  it("the database refuses 'already paid' that is a whole period or more", async () => {
    const { result } = sample(tag());
    const batch = randomUUID();
    const payload = importPayload(result);
    payload.p_loans[2] = { ...payload.p_loans[2], interest_already_paid: rupees(3000) };
    const res = await admin.rpc("import_book", { p_batch: batch, p_file: "bad.csv", ...payload });
    expect(codeOf(res)).toBe("IMPORT");
    expect(await loansOf(batch)).toHaveLength(0);
  });
});

describe("who is who, and opening positions", () => {
  const sheet = (t: string, rows: Record<string, string>[]) => {
    const base: Record<string, string> = { area: "Test", loan_type: "monthly", loan_amount: "1,00,000", principal_left: "1,00,000", start_date: "01/06/2026", interest_style: "percent", interest_value: "3", interest_method: "reducing", frequency: "monthly", status: "active", next_due_date: "01/12/2026", security_type: "none" };
    const lines = rows.map((r) => COLUMNS.map((c) => ({ ...base, ...r })[c] ?? "").map((v) => (/[",]/.test(v) ? `"${v}"` : v)).join(","));
    const text = [COLUMNS.join(","), ...lines].join("\n") + `\n`;
    return { text, result: validateImport(text, TODAY), t };
  };
  const run = async (s: ReturnType<typeof sheet>) => admin.rpc("import_book", { p_batch: batchId(s.text), p_file: "pilot.csv", ...importPayload(s.result) });

  it("two people sharing one phone, and a person with no phone, are each their own customer", async () => {
    const t = tag();
    const s = sheet(t, [
      { customer_name: `Father ${t}`, phone: `9${t}71`, loan_ref: `A${t}1` },
      { customer_name: `Son ${t}`, phone: `9${t}71`, loan_ref: `A${t}2` },
      { customer_name: `NoPhone ${t}`, phone: "", loan_ref: `A${t}3` },
    ]);
    expect(s.result.errors).toEqual([]);
    const res = await run(s);
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ customers: 3, loans: 3 });
    const made = (await admin.from("customers").select("id,name,phone").eq("import_batch", batchId(s.text)).order("name")).data!;
    expect(made.map((c) => [c.name, c.phone])).toEqual([[`Father ${t}`, `9${t}71`], [`NoPhone ${t}`, ""], [`Son ${t}`, `9${t}71`]]);
    expect(new Set(made.map((c) => c.id)).size).toBe(3);
    // each still found by phone or name through the app's own access rules
    expect((await owner.db.from("customers").select("id").eq("phone", `9${t}71`)).data).toHaveLength(2);
    expect((await owner.db.from("customers").select("id").ilike("name", `%NoPhone ${t}%`)).data).toHaveLength(1);
  });

  it("a later file with the same customer number adds a loan to the same customer, even if the phone has changed", async () => {
    const t = tag();
    expect((await run(sheet(t, [{ customer_ref: `K${t}`, customer_name: `Kumar ${t}`, phone: `9${t}81`, loan_ref: `B${t}1` }]))).error).toBeNull();
    const second = sheet(t, [{ customer_ref: `K${t}`, customer_name: `Kumar ${t}`, phone: `9${t}82`, loan_ref: `B${t}2`, loan_type: "weekly", frequency: "weekly", interest_style: "fixed", interest_value: "500", interest_method: "fixed", next_due_date: "08/06/2026" }]);
    const res = await run(second);
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ customers: 0, loans: 1 });
    const c = (await admin.from("customers").select("id,phone").ilike("import_ref", `K${t}`)).data!;
    expect(c).toHaveLength(1);
    expect(c[0].phone).toBe(`9${t}81`); // an existing customer's details are never overwritten by an import
    expect((await admin.from("loans").select("id").eq("customer_id", c[0].id)).data).toHaveLength(2);
  });

  it("the same loan number in a second file is refused, and nothing from that file is saved", async () => {
    const t = tag();
    expect((await run(sheet(t, [{ customer_name: `Once ${t}`, phone: `9${t}91`, loan_ref: `C${t}1` }]))).error).toBeNull();
    const again = sheet(t, [
      { customer_name: `New ${t}`, phone: `9${t}92`, loan_ref: `C${t}2` },
      { customer_name: `Once ${t}`, phone: `9${t}91`, loan_ref: `c${t}1` },
    ]);
    const res = await run(again);
    expect(codeOf(res)).toBe("IMPORT");
    expect(res.error!.message).toMatch(/already in LedgerPro/);
    expect((await admin.from("customers").select("id").eq("phone", `9${t}92`)).data).toHaveLength(0);
    expect((await admin.from("loans").select("id").ilike("import_ref", `C${t}1`)).data).toHaveLength(1);
  });

  it("an imported loan records the day it was brought in and the principal owed then", async () => {
    const t = tag();
    const s = sheet(t, [
      { customer_name: `Open ${t}`, phone: `9${t}61`, loan_ref: `D${t}1`, loan_amount: "2,00,000", principal_left: "1,20,000", next_due_date: "01/08/2026", last_paid_date: "30/06/2026" },
      { customer_name: `Shut ${t}`, phone: `9${t}62`, loan_ref: `D${t}2`, principal_left: "0", status: "closed", closed_date: "01/09/2026", next_due_date: "", security_type: "jewel", security_description: "Gold ring" },
    ]);
    expect(s.result.errors).toEqual([]);
    expect((await run(s)).error).toBeNull();
    const [open, shut] = (await admin.from("loans").select("*").eq("import_batch", batchId(s.text)).order("import_ref")).data!;
    expect(open).toMatchObject({ amount: rupees(200000), principal_left: rupees(120000), opening_principal: rupees(120000), opened_on: TODAY, status: "active", imported_last_paid_on: "2026-06-30" });
    // nothing is invented: no payments, no allocations
    expect((await admin.from("payments").select("id").in("loan_id", [open.id, shut.id])).data).toHaveLength(0);
    // what the sheet said would be pending is what the database now holds as pending
    const pending = (await readLoan(owner.db, open.id)).dues.filter((d) => d.dueDate <= TODAY).reduce((a, d) => a + d.interestAmount - (d.interestPaid ?? 0), 0);
    expect(pending).toBe(s.result.loans[0].pendingToday);
    expect(s.result.loans[0].periodsPending).toBeGreaterThanOrEqual(3);

    // the closed loan: a record, closed, dated, nothing to collect, security released
    expect(shut).toMatchObject({ status: "closed", principal_left: 0, closed_date: "2026-09-01", opening_principal: 0, opened_on: TODAY });
    expect((await readLoan(owner.db, shut.id)).dues).toHaveLength(0);
    expect((await admin.from("collateral").select("status").eq("loan_id", shut.id).single()).data!.status).toBe("released");
  });
});
