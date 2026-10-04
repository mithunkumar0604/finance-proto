import { describe, expect, it } from "vitest";
import { assertPaise, parseRupees, percentOf, rupees, toRupeesString } from "./money";

describe("money (integer paise)", () => {
  it("turns whole rupees into paise", () => {
    expect(rupees(6000)).toBe(600000);
  });

  it("parses typed rupee amounts exactly, including paise", () => {
    expect(parseRupees("6,000.50")).toBe(600050);
    expect(parseRupees("0.10")).toBe(10);
    expect(parseRupees("0.1")).toBe(10);
    expect(parseRupees("1,00,000")).toBe(10000000);
    expect(parseRupees(" 250 ")).toBe(25000);
  });

  it("returns null for text that is not a valid amount", () => {
    for (const bad of ["", "abc", "-5", "1.234", "1e5", "NaN", "Infinity", "."]) expect(parseRupees(bad)).toBeNull();
  });

  it("adds 0.10 and 0.20 rupees without floating point error", () => {
    expect(parseRupees("0.10")! + parseRupees("0.20")!).toBe(parseRupees("0.30"));
  });

  it("prints paise back as a plain rupee string", () => {
    expect(toRupeesString(600050)).toBe("6000.50");
    expect(toRupeesString(600000)).toBe("6000");
    expect(toRupeesString(5)).toBe("0.05");
  });

  it("works out a percentage and rounds to the nearest whole rupee", () => {
    expect(percentOf(rupees(100000), 3)).toBe(rupees(3000));
    // 2.5% of 33,333 = 833.325 -> 833
    expect(percentOf(rupees(33333), 2.5)).toBe(rupees(833));
    // 1.5% of 1,00,033 = 1500.495 -> 1500 ; 1.5% of 1,00,034 = 1500.51 -> 1501
    expect(percentOf(rupees(100033), 1.5)).toBe(rupees(1500));
    expect(percentOf(rupees(100034), 1.5)).toBe(rupees(1501));
    // exactly half a rupee rounds up: 1% of 50 = 0.50 -> 1
    expect(percentOf(rupees(50), 1)).toBe(rupees(1));
  });

  it("keeps percentages exact for very large amounts", () => {
    // 1.15% of 500 crore
    expect(percentOf(rupees(5_000_000_000), 1.15)).toBe(rupees(57_500_000));
  });

  it("rejects amounts that are not whole, non-negative paise", () => {
    expect(() => assertPaise(10.5, "x")).toThrow();
    expect(() => assertPaise(-1, "x")).toThrow();
    expect(() => assertPaise(NaN, "x")).toThrow();
    expect(() => assertPaise(Infinity, "x")).toThrow();
    expect(() => assertPaise(0, "x")).not.toThrow();
  });
});
