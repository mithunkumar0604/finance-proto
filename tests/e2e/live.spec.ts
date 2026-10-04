// Critical flows in a real browser against a real (local) database.
// The tests run in order and share one database, like a working day.

import { expect, test, type Page } from "@playwright/test";
import { admin } from "../db/helpers";

const PASSWORD = "ledger-local-1";
const OWNER = "98000 12345";
const COLLECTOR = "98000 23456";

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const TODAY = istToday();

async function signIn(page: Page, user = OWNER, password = PASSWORD) {
  await page.goto("/");
  await page.locator("input").first().fill(user);
  await page.locator("input[autocomplete=current-password]").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();
}

async function signInOwner(page: Page) {
  await signIn(page);
  await page.waitForURL(/home/);
  await expect(page.getByText("Today", { exact: false }).first()).toBeVisible();
}

const loanRow = async (id: string) => (await admin.from("loans").select("*").eq("id", id).single()).data!;
const paymentsOf = async (id: string) => (await admin.from("payments").select("*").eq("loan_id", id).eq("recorded_on", TODAY).gte("recorded_at", START)).data ?? [];
const START = new Date().toISOString();

async function openLoan(page: Page, id: string) {
  await page.goto(`/loan/?id=${id}`);
  await expect(page.getByRole("heading", { name: `Loan ${id}` })).toBeVisible();
}

async function confirmAndFinish(page: Page, button = /Confirm Payment/) {
  await page.getByRole("dialog").getByRole("button", { name: button }).click();
  await page.getByRole("button", { name: "Done" }).click();
}

/** Nothing on the page may read NaN, undefined or Infinity, and nothing may stick out sideways. */
async function expectClean(page: Page, label: string) {
  const text = await page.locator("body").innerText();
  expect(text, label).not.toMatch(/\bNaN\b|\bundefined\b|\bInfinity\b/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
}


test("1. sign in: wrong password is refused, right one opens the dashboard", async ({ page }) => {
  await signIn(page, OWNER, "wrong-password");
  await expect(page.getByRole("alert").filter({ hasText: "Wrong mobile number or password" })).toBeVisible();
  await expect(page).not.toHaveURL(/home/);

  await signInOwner(page);
  await expect(page.locator("main")).toContainText("₹");
  await expectClean(page, "home");

  // still signed in after a reload (the session is real, not a demo flag)
  await page.reload();
  await expect(page.getByText("Today", { exact: false }).first()).toBeVisible();
});

test("2. nobody gets in without signing in", async ({ page }) => {
  await page.goto("/customers/");
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

test("3-7. search a customer, open the loan, take interest: principal stays the same", async ({ page }) => {
  await signInOwner(page);
  await page.getByText("Search name, phone, vehicle, loan...").first().click();
  await page.getByPlaceholder("Search name, phone, vehicle, loan...").fill("Ravi");
  await page.getByText("Ravi Kumar").first().click();
  await page.waitForURL(/customer/);
  await page.getByText("Loan LP-1024").first().click();
  await page.waitForURL(/loan/);
  await expect(page.locator("main")).toContainText("₹1,20,000");

  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await confirmAndFinish(page);

  await expect(page.locator("main")).toContainText("Current Principal");
  await expect(page.locator("main")).toContainText("₹1,20,000");
  const loan = await loanRow("LP-1024");
  expect(loan.principal_left).toBe(12000000);
  const pays = await paymentsOf("LP-1024");
  expect(pays).toHaveLength(1);
  expect(pays[0]).toMatchObject({ interest: 360000, principal: 0, other: 0, payment_date: TODAY });

  // the payment is in the database, so it is still there after a reload
  await page.reload();
  await expect(page.locator("main")).toContainText("Interest Received");
  await expectClean(page, "loan after interest");
});

test("8-9. part of the interest: the rest shows as pending", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1152");
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.locator("#pay-amount").fill("6000");
  await confirmAndFinish(page);

  await expect(page.locator("main")).toContainText("₹4,000");
  const [due] = (await admin.from("dues").select("*").eq("loan_id", "LP-1152").gt("remaining", 0)).data!;
  expect(due).toMatchObject({ interest_amount: 1000000, interest_paid: 600000, remaining: 400000 });
  expect((await loanRow("LP-1152")).principal_left).toBe(50000000);
});

test("10-11. part of the principal: principal goes down by exactly that much", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1147");
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.getByRole("button", { name: /More options/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Pay Principal/ }).click();
  await page.locator("#pay-principal").fill("40000");
  await confirmAndFinish(page);

  await expect(page.locator("main")).toContainText("₹60,000");
  const loan = await loanRow("LP-1147");
  expect(loan).toMatchObject({ principal_left: 6000000, status: "active" });
});

test("12-13. full settlement closes the loan", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1170");
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /^Full Settlement/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Confirm Settlement/ }).click();
  await expect(page.getByText("Loan Closed").first()).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();

  const loan = await loanRow("LP-1170");
  expect(loan).toMatchObject({ principal_left: 0, status: "closed", closed_date: TODAY });
  const open = (await admin.from("dues").select("id").eq("loan_id", "LP-1170").eq("cancelled", false).gt("remaining", 0)).data;
  expect(open).toHaveLength(0);
});

test("14-18. a backdated payment is reported on the day it was paid", async ({ page }) => {
  const paidOn = shift(TODAY, -40);
  await signInOwner(page);
  await openLoan(page, "LP-1044");
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.getByLabel("Pick payment date").fill(paidOn);
  await confirmAndFinish(page);

  const [pay] = await paymentsOf("LP-1044");
  expect(pay).toMatchObject({ payment_date: paidOn, recorded_on: TODAY, interest: 120000 });

  const paidCell = (range: string) => `/reports/?range=custom&${range}&show=all`;
  const figure = async () => (await page.locator("#report-results").innerText()).replace(/\s+/g, " ");

  // the week it was paid: Balamurugan appears with 1,200 paid
  await page.goto(paidCell(`from=${shift(paidOn, -3)}&to=${shift(paidOn, 3)}`));
  await expect(page.locator("#report-results")).toContainText("Balamurugan T");
  const then = await figure();
  expect(then).toContain("₹1,200");

  // today only: it was entered today but must not count as today's money
  await page.goto("/reports/?range=today&show=paid");
  await expect(page.locator("#report-results h2")).toBeVisible();
  expect(await figure()).not.toContain("Balamurugan T");
});

test("19-20. filter a report and download it as a real PDF", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/reports/?range=month&show=overdue");
  await expect(page.locator("#report-results")).toContainText("Overdue");
  await expect(page.locator("#report-results")).toContainText("Murugan S");
  await expectClean(page, "overdue report");

  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /Download PDF/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/Overdue.*\.pdf$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const pdf = Buffer.concat(chunks);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.length).toBeGreaterThan(5000);
});

test("21. find a loan by vehicle number", async ({ page }) => {
  await signInOwner(page);
  await page.getByText("Search name, phone, vehicle, loan...").first().click();
  await page.getByPlaceholder("Search name, phone, vehicle, loan...").fill("TN 33 AB 1234");
  await page.getByText("LP-1088").first().click();
  await page.waitForURL(/loan\/\?id=LP-1088/);
});

test("double tap on Confirm records one payment", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1102");
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /Confirm Payment/ }).dblclick();
  await page.getByRole("button", { name: "Done" }).click();
  expect(await paymentsOf("LP-1102")).toHaveLength(1);
});

test("lost connection: the user is told, nothing is saved, and trying again saves once", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1125");
  await page.getByRole("button", { name: "Receive Payment" }).first().click();

  await page.route("**/rest/v1/rpc/record_payment", (r) => r.abort("internetdisconnected"));
  await page.getByRole("dialog").getByRole("button", { name: /Confirm Payment/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "No connection" })).toBeVisible();
  expect(await paymentsOf("LP-1125")).toHaveLength(0);

  await page.unroute("**/rest/v1/rpc/record_payment");
  await confirmAndFinish(page);
  expect(await paymentsOf("LP-1125")).toHaveLength(1);
});

test("someone else changed the loan: the stale screen is refused, not saved over", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1131");
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  // meanwhile another person changes this loan (after this screen has finished reading it)
  await page.waitForLoadState("networkidle");
  const before = await loanRow("LP-1131");
  const bump = await admin.from("loans").update({ version: before.version + 1 }).eq("id", "LP-1131");
  expect(bump.error).toBeNull();

  await page.getByRole("dialog").getByRole("button", { name: /Confirm Payment/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "changed by someone else" })).toBeVisible();
  expect(await paymentsOf("LP-1131")).toHaveLength(0);
});

test("new customer and new loan are saved to the database", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/customers/new/");
  const name = `Test Person ${Date.now() % 100000}`;
  await page.locator("input").nth(0).fill(name);
  await page.locator("input[inputmode=tel]").first().fill("9123456780");
  await page.getByRole("button", { name: /Save/i }).click();
  await expect(page.getByRole("heading", { name: "Customer Saved" })).toBeVisible();
  const { data: customer } = await admin.from("customers").select("id").eq("name", name).single();
  expect(customer!.id).toMatch(/^C\d+$/);

  await page.goto(`/loans/new/?customer=${customer!.id}`);
  await page.locator("input[inputmode=numeric]").first().fill("15000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Collect every week").click();
  await page.getByRole("button", { name: "Continue" }).click();
  const money = page.locator("input[inputmode=numeric]");
  await money.nth(0).fill("300");
  await money.nth(1).fill("3000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Loan" }).click();
  await page.getByRole("link", { name: "View Loan" }).click();
  await page.waitForURL(/loan\/\?id=LP-/);
  await expect(page.locator("main")).toContainText("5 collections left");

  const { data: loans } = await admin.from("loans").select("*").eq("customer_id", customer!.id);
  expect(loans).toHaveLength(1);
  expect(loans![0]).toMatchObject({ amount: 1500000, principal_left: 1500000, principal_per_due: 300000, interest_value: 30000, frequency: "weekly" });
  const { data: dues } = await admin.from("dues").select("*").eq("loan_id", loans![0].id);
  expect(dues).toHaveLength(1);
  expect(dues![0]).toMatchObject({ interest_amount: 30000, principal_amount: 300000, paid: 0 });
});

test("a collector sees only their own customers and no reports", async ({ page }) => {
  await signIn(page, COLLECTOR);
  await page.waitForURL(/home/);
  await page.goto("/customers/");
  await expect(page.locator("main")).toContainText("Ravi Kumar");
  await expect(page.locator("main")).not.toContainText("Suresh Kumar");
  await page.goto("/reports/");
  await expect(page.locator("main")).toContainText("Owner only");
  // a loan that belongs to another collector's customer cannot be opened by its address
  await page.goto("/loan/?id=LP-1102");
  await expect(page.locator("main")).toContainText("Loan not found");
});

test("signing out ends the session", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/more/");
  await page.getByText("Logout").click();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await page.goto("/home/");
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
});

for (const [name, width, height] of [["mobile", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 900]] as const) {
  test(`22. layout holds at ${name} width (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signInOwner(page);
    for (const path of ["/home/", "/collections/", "/customers/", "/customer/?id=C001", "/loans/", "/loan/?id=LP-1024", "/reports/", "/reports/?person=C001&range=year", "/security/", "/more/", "/settings/", "/users/", "/activity/"]) {
      await page.goto(path);
      await page.locator("main").waitFor();
      await page.waitForTimeout(400);
      await expectClean(page, `${name} ${path}`);
    }
    // the payment sheet is usable: its Confirm button is on screen
    await page.goto("/loan/?id=LP-1088");
    await page.getByRole("button", { name: "Receive Payment" }).first().click();
    await expect(page.getByRole("dialog").getByRole("button", { name: /Confirm Payment/ })).toBeInViewport();
  });
}
