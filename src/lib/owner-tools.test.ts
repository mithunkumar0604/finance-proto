import { describe, expect, it } from "vitest";
import { deletablePayment, deleteReason } from "./delete-payment";
import { fileProblem, filePath, fileType, latestPerSlot, MAX_FILE_BYTES, slotsFor } from "./files";
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

  it("has three tiles for each kind of security", () => {
    expect(slotsFor("vehicle").map((s) => s.label)).toEqual(["Front", "Side", "RC Book"]);
    expect(slotsFor("jewel").map((s) => s.label)).toEqual(["Item photo", "Weighing", "Packet"]);
    expect(slotsFor("document").map((s) => s.label)).toEqual(["Page 1", "Page 2", "Receipt"]);
    expect(slotsFor("other").map((s) => s.label)).toEqual(["Page 1", "Page 2", "Receipt"]);
    // tile ids are used in file names: letters and digits only
    for (const kind of ["vehicle", "jewel", "document", "other"] as const) for (const s of slotsFor(kind)) expect(s.id).toMatch(/^[a-z0-9]+$/);
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
