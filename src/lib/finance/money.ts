// Money is always a whole number of paise (1 rupee = 100 paise). Nothing in the app
// stores or adds rupees as decimals, so amounts like 6,000.50 stay exact.

/** A whole, non-negative number of paise. */
export type Paise = number;

export function isPaise(n: unknown): n is Paise {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
}

export function assertPaise(n: unknown, what: string): asserts n is Paise {
  if (!isPaise(n)) throw new RangeError(`${what} must be a whole, non-negative number of paise (got ${String(n)})`);
}

/** Whole rupees to paise. For amounts typed by a person use parseRupees. */
export function rupees(whole: number): Paise {
  const p = whole * 100;
  assertPaise(p, "amount");
  return p;
}

/** "6,000.50" -> 600050. Returns null when the text is not a valid amount. */
export function parseRupees(text: string): Paise | null {
  const t = text.trim();
  if (!/^\d[\d,]*(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.replace(/,/g, "").split(".");
  const p = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return isPaise(p) ? p : null;
}

/** 600050 -> "6000.50", 600000 -> "6000". For input boxes and exports, not for display. */
export function toRupeesString(p: Paise): string {
  const whole = Math.trunc(p / 100);
  const frac = p % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, "0")}`;
}

/**
 * ASSUMPTION (not yet confirmed by the client): percentage interest is rounded to the
 * nearest whole rupee, half a rupee rounding up. Rates may have up to 4 decimal places.
 */
export function percentOf(base: Paise, percent: number): Paise {
  assertPaise(base, "base amount");
  const rate = Math.round(percent * 10_000); // 3% -> 30000
  if (!Number.isSafeInteger(rate) || rate < 0) throw new RangeError(`invalid interest rate ${percent}`);
  const wholeRupees = (BigInt(base) * BigInt(rate) + BigInt(50_000_000)) / BigInt(100_000_000);
  const p = Number(wholeRupees) * 100;
  assertPaise(p, "interest");
  return p;
}
