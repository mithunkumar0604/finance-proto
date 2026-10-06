// Critical flows in a real browser against a real (local) database.
// The tests run in order and share one database, like a working day.

import { expect, test, type Page } from "@playwright/test";
import { admin, ANON, URL as API } from "../db/helpers";

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

test("Delete Payment: the owner deletes a wrong payment; balances, pending interest and reports go back, and the record is kept", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1163");
  const before = await loanRow("LP-1163");
  const openDues = async () => (await admin.from("dues").select("id,remaining,interest_paid").eq("loan_id", "LP-1163").eq("cancelled", false).gt("remaining", 0).order("due_date")).data!;
  const duesBefore = await openDues();

  // two payments: the coming collection's interest, then some principal
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await confirmAndFinish(page);
  const afterInterest = await openDues();
  expect(afterInterest).not.toEqual(duesBefore);
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.getByRole("button", { name: /More options/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Pay Principal/ }).click();
  await page.locator("#pay-principal").fill("5000");
  await confirmAndFinish(page);
  expect((await loanRow("LP-1163")).principal_left).toBe(before.principal_left - 500000);
  const [interestPaid, paid] = (await paymentsOf("LP-1163")).sort((x, y) => x.recorded_at.localeCompare(y.recorded_at));
  expect(interestPaid.interest).toBeGreaterThan(0);
  expect(paid).toMatchObject({ interest: 0, principal: 500000 });
  const total = "₹" + new Intl.NumberFormat("en-IN").format((paid.interest + paid.principal + paid.other) / 100);

  // today's report: this loan's line shows the principal now left
  const rupee = (paise: number) => "₹" + new Intl.NumberFormat("en-IN").format(paise / 100);
  const report = async () => {
    await page.goto("/reports/?range=today&show=paid");
    await expect(page.locator("#report-results h2")).toBeVisible();
    const text = (await page.locator("#report-results").innerText()).replace(/\s+/g, " ");
    // the part of the report about this loan
    return text.split("LP-1163")[1]?.split(" Loan · ")[0] ?? "";
  };
  expect(await report()).toContain(`Principal Left ${rupee(before.principal_left - 500000)}`);

  // only the owner's word "Delete" is used; nothing is asked that needs accounting knowledge
  await openLoan(page, "LP-1163");
  await page.getByRole("button", { name: "Delete Payment" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Delete this payment?" })).toBeVisible();
  await expect(sheet).toContainText(total);
  await expect(sheet.getByPlaceholder("Entered by mistake")).toBeVisible();
  await expect(sheet).not.toContainText(/revers/i);
  await page.screenshot({ path: "test-results/delete-payment-sheet.png" });
  // Cancel changes nothing
  await sheet.getByRole("button", { name: "Cancel" }).click();
  expect((await paymentsOf("LP-1163")).every((p) => p.reversed_at === null)).toBe(true);

  // no reason typed: it is deleted with the default reason
  await page.getByRole("button", { name: "Delete Payment" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete Payment" }).click();
  await expect(page.getByText("Payment deleted")).toBeVisible();

  // principal is exactly as before; the interest payment before it is untouched
  const after = await loanRow("LP-1163");
  expect(after).toMatchObject({ principal_left: before.principal_left, status: before.status });
  expect(await openDues()).toEqual(afterInterest);
  // the record is kept underneath
  const kept = (await paymentsOf("LP-1163")).find((p) => p.id === paid.id)!;
  expect(kept.reversed_at).not.toBeNull();
  expect(kept.reverse_reason).toBe("Entered by mistake");

  // on screen it is gone at once, and still gone after a reload: not in the loan's timeline, not in today's report
  await expect(page.locator("main")).not.toContainText(total);
  await expect(page.locator("main")).toContainText(rupee(before.principal_left));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Loan LP-1163" })).toBeVisible();
  await expect(page.locator("main")).toContainText("Interest Received");
  await expect(page.locator("main")).not.toContainText(total);
  await expectClean(page, "loan after delete");
  const line = await report();
  expect(line).toContain(`Principal Left ${rupee(before.principal_left)}`);
  expect(line).toContain(`Paid ${rupee(interestPaid.interest)}`);

  // the payment before it is now the latest, so it can be deleted too: its interest is pending again
  await openLoan(page, "LP-1163");
  await page.getByRole("button", { name: "Delete Payment" }).click();
  await page.getByRole("dialog").getByPlaceholder("Entered by mistake").fill("Paid on another loan");
  await page.getByRole("dialog").getByRole("button", { name: "Delete Payment" }).click();
  await expect(page.getByText("Payment deleted")).toBeVisible();
  expect(await openDues()).toEqual(duesBefore);
  expect((await paymentsOf("LP-1163")).find((p) => p.id === interestPaid.id)!.reverse_reason).toBe("Paid on another loan");
  // nothing was paid on this loan today any more, so it has left today's "paid" report
  expect(await report()).toBe("");

  // the owner's activity list says what happened, in plain words
  await page.goto("/activity/");
  await expect(page.locator("main")).toContainText(`Deleted payment of ${total} on LP-1163 · Entered by mistake`);
  await expect(page.locator("main")).not.toContainText(/Reversed/);
});

test("a collector is not offered Delete Payment", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1088"); // Murugan, a customer of the collector Mani
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await confirmAndFinish(page);
  await expect(page.getByRole("button", { name: "Delete Payment" })).toHaveCount(1);
  await page.goto("/more/");
  await page.getByText("Logout").click();

  await signIn(page, COLLECTOR);
  await page.waitForURL(/home/);
  await openLoan(page, "LP-1088");
  await expect(page.locator("main")).toContainText("Interest Received");
  await expect(page.getByRole("button", { name: "Delete Payment" })).toHaveCount(0);
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const filesOf = async (loanId: string) => ((await admin.storage.from("documents").list(loanId)).data ?? []).map((x) => x.name).sort();

async function chooseFile(page: Page, click: () => Promise<void>, file: { name: string; mimeType: string; buffer: Buffer }) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), click()]);
  await chooser.setFiles(file);
}

test("security photos: saved privately, shown through a signed link, replaced and removed by the owner", async ({ page }) => {
  await admin.storage.from("documents").remove((await filesOf("LP-1088")).map((n) => `LP-1088/${n}`));
  await signInOwner(page);
  await openLoan(page, "LP-1088"); // vehicle security: Front, Side, RC Book

  // a file of the wrong kind is refused with a clear message, and nothing is stored
  await chooseFile(page, () => page.getByRole("button", { name: "Add Front" }).click(), { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByRole("alert").filter({ hasText: "Use a photo (JPG, PNG or WebP) or a PDF" })).toBeVisible();
  expect(await filesOf("LP-1088")).toEqual([]);

  // a photo
  await chooseFile(page, () => page.getByRole("button", { name: "Add Front" }).click(), { name: "front.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Front saved")).toBeVisible();
  const tile = page.getByRole("button", { name: "Open Front" });
  await expect(tile).toBeVisible();
  const src = await tile.locator("img").getAttribute("src");
  expect(src).toContain("/storage/v1/object/sign/documents/LP-1088/front-");
  expect(src).toContain("token=");
  await expect.poll(() => tile.locator("img").evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const [stored] = await filesOf("LP-1088");
  expect(stored).toMatch(/^front-\d+\.png$/);

  // it has no public address, and the signed link does not work without its token
  expect((await fetch(admin.storage.from("documents").getPublicUrl(`LP-1088/${stored}`).data.publicUrl)).ok).toBe(false);
  expect((await fetch(src!.split("?")[0])).ok).toBe(false);
  expect((await fetch(src!)).ok).toBe(true);

  // a PDF scan in another tile
  await chooseFile(page, () => page.getByRole("button", { name: "Add RC Book" }).click(), { name: "rc.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") });
  await expect(page.getByText("RC Book saved")).toBeVisible();
  expect(await filesOf("LP-1088")).toHaveLength(2);

  // still there after a reload; opening shows it with Open / Replace / Remove
  await page.reload();
  await page.getByRole("button", { name: "Open Front" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("link", { name: "Open" })).toHaveAttribute("href", /object\/sign\/documents\/LP-1088\/front-/);
  await expect(sheet.getByRole("link", { name: "Open" })).toHaveAttribute("target", "_blank");
  await page.screenshot({ path: "test-results/security-photo-sheet.png" });

  // replace: the new one is kept, the old one is gone
  await chooseFile(page, () => sheet.getByRole("button", { name: "Replace" }).click(), { name: "front2.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Front replaced")).toBeVisible();
  const afterReplace = await filesOf("LP-1088");
  expect(afterReplace.filter((n) => n.startsWith("front-"))).toHaveLength(1);
  expect(afterReplace).not.toContain(stored);
  await expectClean(page, "loan with photos");
  await page.screenshot({ path: "test-results/security-photo-tiles.png", fullPage: true });

  // remove asks first
  await page.getByRole("button", { name: "Open Front" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("dialog")).toContainText("Remove this file?");
  await page.getByRole("dialog").getByRole("button", { name: "Yes, Remove" }).click();
  await expect(page.getByText("Front removed")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Front" })).toBeVisible();
  expect((await filesOf("LP-1088")).filter((n) => n.startsWith("front-"))).toHaveLength(0);

  // the loan's collector can look at what is there, but cannot add or remove
  await page.goto("/more/");
  await page.getByText("Logout").click();
  await signIn(page, COLLECTOR);
  await page.waitForURL(/home/);
  await openLoan(page, "LP-1088");
  await expect(page.getByRole("button", { name: "Open RC Book" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Add / })).toHaveCount(0);
  await page.getByRole("button", { name: "Open RC Book" }).click();
  await expect(page.getByRole("dialog").getByRole("link", { name: "Open" })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("button", { name: /Remove|Replace/ })).toHaveCount(0);
});

test("a photo chosen while giving a loan is saved with the new loan", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/loans/new/?customer=C001");
  await page.locator("input[inputmode=numeric]").first().fill("20000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("Interest every month").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  // security step: gold jewellery with a photo
  await page.getByRole("button", { name: /Jewel/ }).first().click();
  await page.getByPlaceholder("e.g. Chain + Ring").fill("Test chain");
  await chooseFile(page, () => page.getByText("Add jewel photo").click(), { name: "chain.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("chain.png")).toBeVisible();
  await page.screenshot({ path: "test-results/new-loan-photo.png", fullPage: true });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Create Loan" }).click();
  await page.getByRole("link", { name: "View Loan" }).click();
  await page.waitForURL(/loan\/\?id=LP-/);
  const id = new URL(page.url()).searchParams.get("id")!;
  await expect(page.getByRole("button", { name: "Open Item photo" })).toBeVisible();
  expect(await filesOf(id)).toHaveLength(1);
  expect((await filesOf(id))[0]).toMatch(/^item-\d+\.png$/);
});

test("a customer's photo is saved with the new customer, and ID photos are added on the customer's page", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/customers/new/");
  const name = `Photo Person ${Date.now() % 100000}`;
  // the photo box is a small round button beside its hint, not a wide strip
  const box = await page.locator("label[aria-label='Add customer photo']").boundingBox();
  expect(Math.abs(box!.width - box!.height)).toBeLessThan(2);
  expect(box!.width).toBeLessThan(120);
  await expect(page.getByText("Add a photo so collectors can recognise the customer")).toBeVisible();

  await chooseFile(page, () => page.locator("label[aria-label='Add customer photo']").click(), { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(page.getByRole("alert").filter({ hasText: "Use a photo" })).toBeVisible();
  await chooseFile(page, () => page.locator("label[aria-label='Add customer photo']").click(), { name: "face.png", mimeType: "image/png", buffer: PNG });
  await expect(page.locator("label[aria-label='Change customer photo']").locator("img")).toBeVisible();
  await page.screenshot({ path: "test-results/new-customer-photo.png" });

  await page.getByPlaceholder("e.g. Ravi Kumar").fill(name);
  await page.locator("input[inputmode=tel]").first().fill("9123456781");
  await page.getByRole("button", { name: /Save/i }).click();
  await expect(page.getByRole("heading", { name: "Customer Saved" })).toBeVisible();
  const { data: customer } = await admin.from("customers").select("id").eq("name", name).single();
  expect(await filesOf(customer!.id)).toHaveLength(1);
  expect((await filesOf(customer!.id))[0]).toMatch(/^photo-\d+\.png$/);

  // the customer's page: the photo is there, and ID photos can be added
  await page.getByRole("link", { name: /View Profile/ }).click();
  await page.waitForURL(/customer/);
  await page.getByRole("tab", { name: "Docs" }).click();
  await expect(page.getByRole("button", { name: "Open Customer photo" })).toBeVisible();
  await chooseFile(page, () => page.getByRole("button", { name: "Add ID front" }).click(), { name: "id.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("ID front saved")).toBeVisible();
  expect((await filesOf(customer!.id)).some((n) => /^idfront-\d+\.png$/.test(n))).toBe(true);
  await expectClean(page, "customer documents");
  await page.screenshot({ path: "test-results/customer-documents.png", fullPage: true });

  // the photo is the round picture beside the customer's name, also after a reload
  const face = page.getByRole("img", { name: `Photo of ${name}` });
  await expect(face).toBeVisible();
  await expect.poll(() => face.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("img", { name: `Photo of ${name}` })).toBeVisible();

  // it can be changed from there: one photo is kept, the old one is gone
  const before = (await filesOf(customer!.id)).filter((n) => n.startsWith("photo-"));
  await chooseFile(page, () => page.getByRole("button", { name: "Change photo" }).click(), { name: "face2.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByText("Photo changed")).toBeVisible();
  const after = (await filesOf(customer!.id)).filter((n) => n.startsWith("photo-"));
  expect(after).toHaveLength(1);
  expect(after).not.toEqual(before);
  await page.screenshot({ path: "test-results/customer-photo-header.png" });
});

test("a customer's details can be edited after saving", async ({ page }) => {
  const name = `Edit Person ${Date.now() % 100000}`;
  const { data: made } = await admin.from("customers").insert({ name, phone: "9000011111", area: "Old Area" }).select("id").single();
  await signInOwner(page);
  await page.goto(`/customer/?id=${made!.id}`);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  // no photo yet: the initials, with a button to add one
  await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();

  await page.getByRole("button", { name: "Edit" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "Edit Customer" })).toBeVisible();
  await expect(sheet.getByLabel("Full Name")).toHaveValue(name);
  await expect(sheet.getByLabel("Mobile Number")).toHaveValue("90000 11111");

  // a wrong number is refused and nothing is saved
  await sheet.getByLabel("Mobile Number").fill("12345");
  await sheet.getByRole("button", { name: "Save Changes" }).click();
  await expect(sheet.getByRole("alert")).toContainText("10-digit");
  expect((await admin.from("customers").select("phone").eq("id", made!.id).single()).data!.phone).toBe("9000011111");

  await sheet.getByLabel("Full Name").fill(name + " Jr");
  await sheet.getByLabel("Mobile Number").fill("90000 22222");
  await sheet.getByLabel("Alternate Number").fill("9000033333");
  await sheet.getByLabel("Area / Location").fill("New Area");
  await sheet.getByLabel("Address").fill("12 Test Street");
  await sheet.getByLabel("ID Reference").fill("Aadhaar 1234");
  await page.screenshot({ path: "test-results/edit-customer-sheet.png" });
  await sheet.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByText("Customer updated")).toBeVisible();
  await expect(sheet).toHaveCount(0);

  await expect(page.getByRole("heading", { name: name + " Jr" })).toBeVisible();
  await expect(page.locator("main")).toContainText("90000 22222");
  await expect(page.locator("main")).toContainText("New Area");
  const { data: row } = await admin.from("customers").select("*").eq("id", made!.id).single();
  expect(row).toMatchObject({ name: name + " Jr", phone: "9000022222", alt_phone: "9000033333", area: "New Area", address: "12 Test Street", id_ref: "Aadhaar 1234" });
  // the change is in the owner's activity list
  const log = (await admin.from("activity").select("text").eq("customer_id", made!.id).order("id", { ascending: false }).limit(1)).data!;
  expect(log[0].text).toContain("Edited customer");
  await expectClean(page, "customer after edit");
});

test("a collector cannot edit a customer or change the photo", async ({ page }) => {
  await signIn(page, COLLECTOR);
  await page.waitForURL(/home/);
  await page.goto("/customer/?id=C001");
  await expect(page.getByRole("heading", { name: "Ravi Kumar" })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Add|Change) photo$/ })).toHaveCount(0);
});

test("Change Password: the current one is checked, the new one works, the old one stops working", async ({ page }) => {
  const STAFF = "98000 45678";
  const NEW = "new-password-2026";
  const { data: who } = await admin.from("profiles").select("id").eq("phone", "9800045678").single();
  // start from the known password (a rerun on the same database may have changed it)
  await admin.auth.admin.updateUserById(who!.id, { password: PASSWORD });

  try {
  await signIn(page, STAFF);
  await page.waitForURL(/home/);
  await page.goto("/more/");
  await page.getByRole("link", { name: /Settings/ }).click();
  await page.getByRole("button", { name: /Change Password/ }).click();
  const sheet = page.getByRole("dialog");
  const boxes = sheet.locator("input[type=password]");
  await expect(boxes).toHaveCount(3);
  const submit = sheet.getByRole("button", { name: "Change Password" });

  // clear validation before anything is sent
  await boxes.nth(0).fill(PASSWORD);
  await boxes.nth(1).fill("short");
  await boxes.nth(2).fill("short");
  await submit.click();
  await expect(sheet.getByRole("alert")).toContainText("at least 8 characters");
  await boxes.nth(1).fill(NEW);
  await boxes.nth(2).fill(NEW + "x");
  await submit.click();
  await expect(sheet.getByRole("alert")).toContainText("do not match");
  await page.screenshot({ path: "test-results/change-password-sheet.png" });

  // a wrong current password fails clearly and changes nothing
  await boxes.nth(0).fill("not-my-password");
  await boxes.nth(2).fill(NEW);
  await submit.click();
  await expect(page.getByRole("alert").filter({ hasText: "The current password is wrong" })).toBeVisible();
  await expect(sheet).toBeVisible();

  // the right one: changed, and still signed in on this device
  await boxes.nth(0).fill(PASSWORD);
  await submit.click();
  await expect(page.getByText("Password changed")).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  // sign out: the old password is refused, the new one works
  await page.goto("/more/");
  await page.getByText("Logout").click();
  await signIn(page, STAFF, PASSWORD);
  await expect(page.getByRole("alert").filter({ hasText: "Wrong mobile number or password" })).toBeVisible();
  await signIn(page, STAFF, NEW);
  await page.waitForURL(/home/);
  } finally {
    await admin.auth.admin.updateUserById(who!.id, { password: PASSWORD });
  }
});

test("typing more principal than is owed is refused, not trimmed", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1175");
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.getByRole("button", { name: /More options/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Pay Principal/ }).click();
  await page.locator("#pay-principal").fill("50000");
  await page.getByRole("dialog").getByRole("button", { name: /Confirm Payment/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "more than the principal left" })).toBeVisible();
  expect(await paymentsOf("LP-1175")).toHaveLength(0);
});

test("missed months: each stays pending, the owner ticks what a payment covers, and can waive with a reason", async ({ page }) => {
  await signInOwner(page);
  await openLoan(page, "LP-1057"); // 3,00,000 at 3% a month, 65 days overdue
  const open = async () => (await admin.from("dues").select("id,due_date,interest_amount,interest_paid,waived,remaining").eq("loan_id", "LP-1057").eq("cancelled", false).gt("remaining", 0).order("due_date")).data!;
  const before = await open();
  expect(before.length).toBeGreaterThanOrEqual(4); // three missed and the one running
  expect(before.every((d) => d.interest_amount === 900000)).toBe(true);

  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  const dialog = page.getByRole("dialog");
  const rows = dialog.locator("label:has(input[type=checkbox])");
  await expect(rows).toHaveCount(before.length);
  await expect(dialog).toContainText("Total Pending");
  // every missed month is ticked to start with; the running one is not
  await expect(rows.nth(0).locator("input")).toBeChecked();
  await expect(rows.last().locator("input")).not.toBeChecked();

  // pay the later two missed months only: untick the oldest
  await rows.nth(0).locator("input").uncheck();
  await expect(dialog.getByRole("button", { name: /Confirm Payment/ })).toContainText("₹18,000");
  await confirmAndFinish(page);

  const after = await open();
  expect(after[0]).toMatchObject({ id: before[0].id, interest_paid: 0, remaining: 900000 }); // the oldest is still pending
  expect(after.map((d) => d.id)).not.toContain(before[1].id);
  expect(after.map((d) => d.id)).not.toContain(before[2].id);
  const [pay] = await paymentsOf("LP-1057");
  expect(pay).toMatchObject({ interest: 1800000, principal: 0 });
  const allocs = (await admin.from("payment_allocations").select("due_id,interest").eq("payment_id", pay.id)).data!;
  expect(allocs.map((a) => a.due_id).sort()).toEqual([before[1].id, before[2].id].sort());
  expect((await loanRow("LP-1057")).principal_left).toBe(30000000);

  // the owner waives the oldest month: a reason is required, and it is recorded
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.getByRole("button", { name: /More options/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Adjustment/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "− Waive interest" }).click();
  await page.getByRole("dialog").locator("input[inputmode=numeric]").first().fill("9000");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm Waiver" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "reason" })).toBeVisible();
  await page.getByPlaceholder("e.g. paid at shop").fill("Shop was shut in July");
  await page.getByRole("dialog").getByRole("button", { name: "Confirm Waiver" }).click();
  await expect(page.getByText("Interest waived")).toBeVisible();

  const waivers = (await admin.from("waivers").select("due_id,amount,reason,payment_id").eq("loan_id", "LP-1057")).data!;
  expect(waivers).toEqual([{ due_id: before[0].id, amount: 900000, reason: "Shop was shut in July", payment_id: null }]);
  expect((await open()).map((d) => d.id)).not.toContain(before[0].id);
  expect(await paymentsOf("LP-1057")).toHaveLength(1); // a waiver is never recorded as money received
});

test("a collector cannot waive interest", async ({ page }) => {
  await signIn(page, COLLECTOR);
  await page.waitForURL(/home/);
  await openLoan(page, "LP-1088"); // Murugan, a customer of this collector, interest overdue
  await page.getByRole("button", { name: "Receive Payment" }).first().click();
  await page.getByRole("button", { name: /More options/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /^Adjustment/ }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "− Waive interest" })).toHaveCount(0);
});

test("new customer and new loan are saved to the database", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/customers/new/");
  const name = `Test Person ${Date.now() % 100000}`;
  await page.getByPlaceholder("e.g. Ravi Kumar").fill(name);
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

for (const mode of ["never answers", "fails"] as const) {
  test(`Logout works at once even when the server ${mode} (weak signal)`, async ({ page }) => {
    await signInOwner(page);
    await page.goto("/more/");
    await page.route("**/auth/v1/logout**", (r) => (mode === "fails" ? r.abort("internetdisconnected") : new Promise(() => {})));
    await page.getByText("Logout", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 4000 });
    // and it is a real sign-out: nothing is left on the device to come back with
    await page.unroute("**/auth/v1/logout**");
    await page.goto("/home/");
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page).not.toHaveURL(/home/);
  });
}

test("Sign out from the lock screen works when the server never answers", async ({ page }) => {
  await signInOwner(page);
  await page.goto("/more/");
  await page.getByText("Lock Application").click();
  await page.route("**/auth/v1/logout**", () => new Promise(() => {}));
  await page.getByText("Sign out instead").click();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible({ timeout: 4000 });
  await page.reload();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  await expect(page.getByText("Application Locked")).toHaveCount(0);
});

test("after Logout the server no longer accepts that sign-in", async ({ page }) => {
  await signInOwner(page);
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"))!;
    return JSON.parse(localStorage.getItem(key)!).refresh_token as string;
  });
  await page.goto("/more/");
  await page.getByText("Logout", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  // the saved sign-in cannot be renewed any more
  await expect
    .poll(async () => (await fetch(`${API}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ refresh_token: token }) })).status, { timeout: 10000 })
    .toBeGreaterThanOrEqual(400);
});

for (const [name, width, height] of [["mobile", 390, 844], ["tablet", 768, 1024], ["desktop", 1440, 900]] as const) {
  test(`22. layout holds at ${name} width (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await signInOwner(page);
    for (const path of ["/home/", "/collections/", "/customers/", "/customer/?id=C001", "/loans/", "/loan/?id=LP-1024", "/reports/", "/reports/?person=C001&range=year", "/loan/?id=LP-1088", "/security/", "/more/", "/settings/", "/users/", "/activity/"]) {
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
