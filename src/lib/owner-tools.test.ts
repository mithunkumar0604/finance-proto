import { describe, expect, it } from "vitest";
import { deletablePayment, deleteReason } from "./delete-payment";
import { CUSTOMER_SLOTS, fileProblem, filePath, fileType, latestPerSlot, MAX_FILE_BYTES, slotsFor } from "./files";
import { customerProblem } from "./customer-form";
import { loanDefaults } from "./finance/engine";
import { collectedEvery, interestProblem, safePreview, switchInterestStyle, typeSetsFrequency } from "./loan-form";
import { passwordProblem } from "./password";
import type { Payment } from "./types";

const pay = (id: string, recordedAt?: string): Payment => ({
  id,
  loanId: "LP-1",
  customerId: "C001",
  date: "2026-10-01",
  recordedOn: "2026-10-01",
  recordedAt,
  principalBefore: 100,
  interest: 10,
  principal: 0,
  other: 0,
  method: "cash",
});

describe("delete payment", () => {
  it("only the payment entered last on the loan can be deleted", () => {
    const list = [pay("a", "2026-10-01T10:00:00Z"), pay("c", "2026-10-03T09:00:00Z"), pay("b", "2026-10-02T10:00:00Z")];
    expect(deletablePayment(list)?.id).toBe("c");
  });

  it("nothing can be deleted when there are no payments, or none with an entry time", () => {
    expect(deletablePayment([])).toBeUndefined();
    expect(deletablePayment([pay("a")])).toBeUndefined();
  });

  it("the reason is optional: an empty one becomes 'Entered by mistake'", () => {
    expect(deleteReason("")).toBe("Entered by mistake");
    expect(deleteReason("   ")).toBe("Entered by mistake");
    expect(deleteReason("  Wrong loan ")).toBe("Wrong loan");
  });
});

describe("photo and document files", () => {
  it("accepts photos and PDFs, refuses everything else", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "application/pdf"]) expect(fileProblem({ type, size: 1000 })).toBeNull();
    expect(fileProblem({ type: "video/mp4", size: 1000 })).toMatch(/photo .* or a PDF/);
    expect(fileProblem({ type: "", size: 1000 })).toMatch(/photo .* or a PDF/);
    expect(fileProblem({ type: "image/jpeg", size: 0 })).toMatch(/empty/);
  });

  it("goes by the file's name when a phone leaves its type empty", () => {
    expect(fileProblem({ type: "", size: 1000, name: "IMG_2041.JPG" })).toBeNull();
    expect(fileProblem({ type: "", size: 1000, name: "scan.pdf" })).toBeNull();
    expect(fileProblem({ type: "", size: 1000, name: "movie.mp4" })).toMatch(/photo .* or a PDF/);
    expect(fileType({ type: "", name: "IMG_2041.JPG" })).toBe("image/jpeg");
    expect(fileType({ type: "image/png", name: "x.jpg" })).toBe("image/png");
  });

  it("refuses a PDF over 5 MB and a photo too large to shrink", () => {
    expect(fileProblem({ type: "application/pdf", size: MAX_FILE_BYTES })).toBeNull();
    expect(fileProblem({ type: "application/pdf", size: MAX_FILE_BYTES + 1 })).toMatch(/5 MB/);
    // photos are made smaller before they are sent, so a large one from a phone camera is fine
    expect(fileProblem({ type: "image/jpeg", size: 12 * 1024 * 1024 })).toBeNull();
    expect(fileProblem({ type: "image/jpeg", size: 26 * 1024 * 1024 })).toMatch(/too large/);
  });

  it("stores a file under its loan, named by the tile it belongs to", () => {
    expect(filePath("LP-1024", "front", "image/jpeg", 1700000000000)).toBe("LP-1024/front-1700000000000.jpg");
    expect(filePath("LP-1024", "page1", "application/pdf", 5)).toBe("LP-1024/page1-5.pdf");
    expect(filePath("LP-1024", "item", "image/webp", 5)).toBe("LP-1024/item-5.webp");
  });

  it("shows the newest file of each tile", () => {
    const got = latestPerSlot(["front-100.jpg", "front-300.png", "rc-200.pdf", "front-200.jpg", "junk.txt"]);
    expect(got).toEqual({ front: "front-300.png", rc: "rc-200.pdf" });
  });

  it("has three tiles for a customer: photo, ID front, ID back", () => {
    expect(CUSTOMER_SLOTS.map((s) => s.label)).toEqual(["Customer photo", "ID front", "ID back"]);
    for (const s of CUSTOMER_SLOTS) expect(s.id).toMatch(/^[a-z0-9]+$/);
    expect(filePath("C014", CUSTOMER_SLOTS[0].id, "image/jpeg", 7)).toBe("C014/photo-7.jpg");
  });

  it("has three tiles for each kind of security", () => {
    expect(slotsFor("vehicle").map((s) => s.label)).toEqual(["Front", "Side", "RC Book"]);
    expect(slotsFor("jewel").map((s) => s.label)).toEqual(["Item photo", "Weighing", "Packet"]);
    expect(slotsFor("document").map((s) => s.label)).toEqual(["Page 1", "Page 2", "Receipt"]);
    expect(slotsFor("other").map((s) => s.label)).toEqual(["Page 1", "Page 2", "Receipt"]);
    // tile ids are used in file names: letters and digits only
    for (const kind of ["vehicle", "jewel", "document", "other"] as const) for (const s of slotsFor(kind)) expect(s.id).toMatch(/^[a-z0-9]+$/);
  });
});

describe("new loan: how often to collect", () => {
  it("Weekly, Monthly, 15 Days and 30 Days already say how often", () => {
    expect(typeSetsFrequency("weekly")).toBe(true);
    expect(typeSetsFrequency("monthly")).toBe(true);
    expect(typeSetsFrequency("15day")).toBe(true);
    expect(typeSetsFrequency("30day")).toBe(true);
  });
  it("Vehicle, Jewel and Custom say what is held, not how often: the question is asked", () => {
    expect(typeSetsFrequency("vehicle")).toBe(false);
    expect(typeSetsFrequency("jewel")).toBe(false);
    expect(typeSetsFrequency("custom")).toBe(false);
    expect(typeSetsFrequency(null)).toBe(false);
  });
  it("says it in words", () => {
    expect(collectedEvery("weekly")).toBe("Collected every week");
    expect(collectedEvery("monthly")).toBe("Collected every month");
    expect(collectedEvery("15days")).toBe("Collected every 15 days");
    expect(collectedEvery("30days")).toBe("Collected every 30 days");
    expect(collectedEvery("custom")).toBe("Collected on dates you set");
  });
});

describe("new loan: switching between a percentage and a fixed amount", () => {
  const weekly = loanDefaults("weekly", 10000000); // fixed ₹2,500
  const monthly = loanDefaults("monthly", 10000000); // 3 %

  it("the rupee figure is never carried over as a percentage (it crashed the screen)", () => {
    expect(weekly.interest).toMatchObject({ style: "fixed", value: 250000 });
    const next = switchInterestStyle(weekly.interest, "percent", weekly.interest);
    expect(next).toMatchObject({ style: "percent", value: 0 });
  });

  it("a percentage is never carried over as a rupee figure", () => {
    expect(switchInterestStyle(monthly.interest, "fixed", monthly.interest)).toMatchObject({ style: "fixed", value: 0, method: "fixed" });
  });

  it("going back to the kind of loan's own style brings its usual figure back", () => {
    const pct = switchInterestStyle(weekly.interest, "percent", weekly.interest);
    expect(switchInterestStyle(pct, "fixed", weekly.interest)).toMatchObject({ style: "fixed", value: 250000 });
    const fixed = switchInterestStyle(monthly.interest, "fixed", monthly.interest);
    expect(switchInterestStyle(fixed, "percent", monthly.interest)).toMatchObject({ style: "percent", value: 3 });
  });

  it("tapping the style already chosen changes nothing", () => {
    const typed = { ...monthly.interest, value: 2.5 };
    expect(switchInterestStyle(typed, "percent", monthly.interest)).toEqual(typed);
  });

  it("says what is wrong with an interest figure instead of breaking", () => {
    expect(interestProblem({ style: "percent", value: 3, method: "reducing" })).toBeNull();
    expect(interestProblem({ style: "percent", value: 100, method: "reducing" })).toBeNull();
    expect(interestProblem({ style: "percent", value: 150, method: "reducing" })).toMatch(/more than 100%/);
    expect(interestProblem({ style: "percent", value: 250000, method: "fixed" })).toMatch(/more than 100%/);
    expect(interestProblem({ style: "fixed", value: 250000, method: "fixed" })).toBeNull();
    expect(interestProblem({ style: "fixed", value: 0, method: "fixed" })).toBeNull();
  });

  it("the first-collection preview never throws, whatever is typed", () => {
    const base = { amount: 10000000, principalLeft: 10000000, principalPerDue: 0, frequency: "weekly" as const, startDate: "2026-10-12" };
    expect(safePreview({ ...base, interest: { style: "percent", value: 250000, method: "fixed" } })).toMatchObject({ interest: 0, principal: 0 });
    expect(safePreview({ ...base, interest: { style: "percent", value: 3, method: "fixed" } })).toMatchObject({ interest: 300000 });
    expect(safePreview({ ...base, interest: { style: "fixed", value: 2.5, method: "fixed" } })).toMatchObject({ interest: 0 });
  });
});

describe("edit customer", () => {
  const was = { phone: "9876543210" };
  it("needs a name", () => {
    expect(customerProblem({ name: "  ", phone: "9876543210" }, was)).toMatch(/name/i);
    expect(customerProblem({ name: "Ravi", phone: "9876543210" }, was)).toBeNull();
  });
  it("needs a 10-digit mobile number, however it is typed", () => {
    expect(customerProblem({ name: "Ravi", phone: "98765 4321" }, was)).toMatch(/10-digit/);
    expect(customerProblem({ name: "Ravi", phone: "98765 43210" }, was)).toBeNull();
    expect(customerProblem({ name: "Ravi", phone: "" }, was)).toMatch(/10-digit/);
  });
  it("a customer brought in without a phone may stay without one", () => {
    expect(customerProblem({ name: "Sita", phone: "" }, { phone: "" })).toBeNull();
    expect(customerProblem({ name: "Sita", phone: "123" }, { phone: "" })).toMatch(/10-digit/);
  });
  it("an alternate number, if given, is 10 digits too", () => {
    expect(customerProblem({ name: "Ravi", phone: "9876543210", altPhone: "12345" }, was)).toMatch(/alternate/i);
    expect(customerProblem({ name: "Ravi", phone: "9876543210", altPhone: "91234 56780" }, was)).toBeNull();
  });
});

describe("change password", () => {
  it("asks for every box", () => {
    expect(passwordProblem("", "new-password", "new-password")).toMatch(/current password/i);
    expect(passwordProblem("old-password", "", "")).toMatch(/new password/i);
  });

  it("needs at least 8 characters", () => {
    expect(passwordProblem("old-password", "1234567", "1234567")).toMatch(/at least 8/);
    expect(passwordProblem("old-password", "12345678", "12345678")).toBeNull();
  });

  it("the two new passwords must match", () => {
    expect(passwordProblem("old-password", "new-password", "new-passwore")).toMatch(/do not match/);
  });

  it("the new password must be different from the current one", () => {
    expect(passwordProblem("same-password", "same-password", "same-password")).toMatch(/different/);
  });
});
