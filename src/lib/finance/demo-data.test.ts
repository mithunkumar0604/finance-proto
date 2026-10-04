import { describe, expect, it } from "vitest";
import { buildDemoDB } from "../demo-data";
import { money, moneyShort, rupeeDigits } from "../format";
import { dueRemaining, paymentTotal } from "./engine";
import { isPaise, rupees } from "./money";

const TODAY = "2026-09-29";
const db = buildDemoDB(TODAY);

describe("demo data built through the engine", () => {
  it("builds without the engine refusing any payment", () => {
    expect(db.loans.length).toBeGreaterThan(50);
    expect(db.payments.length).toBeGreaterThan(100);
  });

  it("holds every amount as whole paise", () => {
    for (const l of db.loans) expect([l.amount, l.principalLeft, l.principalPerDue].every(isPaise)).toBe(true);
    for (const d of db.dues) expect([d.interestAmount, d.principalAmount, d.paid, d.interestPaid ?? 0, d.waived ?? 0].every(isPaise)).toBe(true);
    for (const p of db.payments) expect([p.interest, p.principal, p.other, p.principalBefore].every(isPaise)).toBe(true);
  });

  it("principal left always equals amount given minus principal received", () => {
    for (const l of db.loans) {
      const principalPaid = db.payments.filter((p) => p.loanId === l.id).reduce((a, p) => a + p.principal, 0);
      expect(l.principalLeft, l.id).toBe(l.amount - principalPaid);
      expect(l.status === "closed", l.id).toBe(l.principalLeft === 0);
    }
  });

  it("what a collection shows as paid matches the payments recorded against it", () => {
    for (const d of db.dues) {
      const pays = db.payments.filter((p) => p.dueId === d.id);
      expect(d.interestPaid ?? 0, d.id).toBe(pays.reduce((a, p) => a + p.interest, 0));
    }
  });

  it("has no payment dated in the future and none on a closed loan after closing", () => {
    for (const p of db.payments) {
      expect(p.date <= TODAY).toBe(true);
      expect(paymentTotal(p)).toBeGreaterThan(0);
    }
    for (const l of db.loans.filter((x) => x.status === "closed"))
      expect(db.dues.filter((d) => d.loanId === l.id && !d.cancelled).every((d) => dueRemaining(d) === 0), l.id).toBe(true);
  });

  it("keeps the main demo loan as written (Ravi, 2,00,000 with 80,000 returned)", () => {
    const ravi = db.loans.find((l) => l.id === "LP-1024")!;
    expect(ravi.amount).toBe(rupees(200000));
    expect(ravi.principalLeft).toBe(rupees(120000));
  });
});

describe("showing money", () => {
  it("prints paise as rupees with Indian grouping", () => {
    expect(money(rupees(142500))).toBe("₹1,42,500");
    expect(money(600050)).toBe("₹6,000.50");
    expect(money(5)).toBe("₹0.05");
    expect(money(-rupees(300))).toBe("-₹300");
    expect(rupeeDigits(rupees(10000000))).toBe("1,00,00,000");
  });
  it("never prints NaN, undefined or Infinity", () => {
    for (const bad of [NaN, Infinity, -Infinity, undefined as unknown as number]) {
      expect(money(bad)).toBe("₹0");
      expect(moneyShort(bad)).toBe("₹0");
    }
  });
  it("shortens large amounts", () => {
    expect(moneyShort(rupees(17300000))).toBe("₹1.73 Cr");
    expect(moneyShort(rupees(380000))).toBe("₹3.8 L");
    expect(moneyShort(rupees(42500))).toBe("₹42.5K");
    expect(moneyShort(rupees(500))).toBe("₹500");
  });
});
