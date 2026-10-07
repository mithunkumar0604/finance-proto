// Small rules for the New Loan screens.

import type { Frequency, LoanType } from "./types";

/**
 * Weekly, Monthly, 15 Days and 30 Days already say how often money is collected, so the
 * next screen states it instead of asking again. Vehicle, Jewel and Custom say what is
 * held (or nothing), so there the question is asked.
 */
export function typeSetsFrequency(type: LoanType | null | undefined): boolean {
  return type === "weekly" || type === "monthly" || type === "15day" || type === "30day";
}

const EVERY: Record<Frequency, string> = {
  weekly: "every week",
  monthly: "every month",
  "15days": "every 15 days",
  "30days": "every 30 days",
  custom: "on dates you set",
};

/** "Collected every week": how often, in words. */
export const collectedEvery = (frequency: Frequency) => `Collected ${EVERY[frequency]}`;
