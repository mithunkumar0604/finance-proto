// Small rules for the New Loan screens.

import { previewFirstCollection } from "./finance/engine";
import type { Frequency, InterestSetting, InterestStyle, Loan, LoanType } from "./types";

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

/**
 * The interest setting after the user taps another Interest Style. A percentage and a
 * rupee amount are different things, so the figure is never carried from one to the
 * other (₹2,500 once became 2,50,000 %, which broke the screen). Going to the style the
 * kind of loan normally uses brings that kind's usual figure back; otherwise the box is
 * left empty for the user to fill.
 */
export function switchInterestStyle(now: InterestSetting, style: InterestStyle, usual: InterestSetting): InterestSetting {
  if (style === now.style) return now;
  return {
    style,
    value: style === usual.style ? usual.value : 0,
    method: style === "fixed" ? "fixed" : style === usual.style ? usual.method : now.style === "fixed" ? "reducing" : now.method,
  };
}

/** What is wrong with the interest typed, in words for the user; null when it is usable. */
export function interestProblem(i: InterestSetting): string | null {
  if (!Number.isFinite(i.value) || i.value < 0) return "Enter the interest.";
  if (i.style === "percent" && i.value > 100) return "Interest cannot be more than 100%. Enter a percentage such as 3.";
  if (i.style !== "percent" && !Number.isInteger(i.value)) return "Enter the interest amount in whole rupees.";
  return null;
}

/** The first collection for what is typed so far. While the figures are not usable it is all zero: a preview must never break the screen. */
export function safePreview(loan: Pick<Loan, "interest" | "amount" | "principalLeft" | "principalPerDue" | "frequency" | "startDate">) {
  try {
    return previewFirstCollection(loan);
  } catch {
    return { date: loan.startDate, interest: 0, principal: 0, total: 0 };
  }
}
