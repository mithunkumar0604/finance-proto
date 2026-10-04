import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import type { Frequency, ISODate, Loan, LoanType, PaymentMethod } from "./types";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Paise as plain digits with Indian grouping: 14250000 -> "1,42,500", 600050 -> "6,000.50". No float maths. */
export function rupeeDigits(paise: number): string {
  const a = Math.abs(Math.round(paise));
  const frac = a % 100;
  return inr.format((a - frac) / 100) + (frac ? `.${String(frac).padStart(2, "0")}` : "");
}

/** ₹1,42,500 (amounts are whole paise; paise are shown only when there are any) */
export function money(n: number): string {
  if (!Number.isFinite(n)) return "₹0";
  return `${n < 0 ? "-" : ""}₹${rupeeDigits(n)}`;
}

/** ₹1.73 Cr · ₹3.8 L · ₹42.5K */
export function moneyShort(paise: number): string {
  if (!Number.isFinite(paise)) return "₹0";
  const n = paise / 100;
  const a = Math.abs(n);
  const trim = (v: number, d: number) => v.toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  if (a >= 1e7) return `₹${trim(n / 1e7, 2)} Cr`;
  if (a >= 1e5) return `₹${trim(n / 1e5, 1)} L`;
  if (a >= 1e3) return `₹${trim(n / 1e3, 1)}K`;
  return money(paise);
}

export function phoneFmt(p: string): string {
  const d = p.replace(/\D/g, "");
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : p;
}

export const toISO = (d: Date): ISODate => format(d, "yyyy-MM-dd");
export const todayISO = (): ISODate => toISO(new Date());
export const shiftISO = (iso: ISODate, days: number): ISODate => toISO(addDays(parseISO(iso), days));
export const daysBetween = (from: ISODate, to: ISODate) => differenceInCalendarDays(parseISO(to), parseISO(from));

/** 02 Oct */
export const dShort = (iso: ISODate) => format(parseISO(iso), "dd MMM");
/** 02 Oct 2026 */
export const dLong = (iso: ISODate) => format(parseISO(iso), "dd MMM yyyy");
/** Monday, 28 September */
export const dHeading = (iso: ISODate) => format(parseISO(iso), "EEEE, d MMMM");

/** "Today", "Tomorrow", "Yesterday", "In 4 days", "3 days ago", else "02 Oct" */
export function dRelative(iso: ISODate, today: ISODate): string {
  const diff = daysBetween(today, iso);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return `In ${diff} days`;
  if (diff < -1 && diff > -30) return `${-diff} days ago`;
  return dShort(iso);
}

export const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  weekly: "Weekly Loan",
  monthly: "Monthly Loan",
  "15day": "15-Day Loan",
  "30day": "30-Day Loan",
  vehicle: "Vehicle Loan",
  jewel: "Jewel Loan",
  custom: "Custom Loan",
};

export const LOAN_TYPE_SHORT: Record<LoanType, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  "15day": "15 Days",
  "30day": "30 Days",
  vehicle: "Vehicle",
  jewel: "Jewel",
  custom: "Custom",
};

export const FREQ_LABEL: Record<Frequency, string> = {
  weekly: "Weekly",
  "15days": "Every 15 Days",
  "30days": "Every 30 Days",
  monthly: "Monthly",
  custom: "Custom",
};

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank: "Bank",
  upi: "UPI",
  other: "Other",
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0]?.[1] ?? "")).toUpperCase();
}

/** "3% Monthly · on balance", "₹500 per week" */
export function interestLabel(loan: Pick<Loan, "interest" | "frequency">): string {
  const per = { weekly: "week", "15days": "15 days", "30days": "30 days", monthly: "month", custom: "period" }[loan.frequency];
  const { style, value, method } = loan.interest;
  if (style === "percent")
    return `${value}% ${loan.frequency === "monthly" ? "Monthly" : `per ${per}`}${method === "reducing" ? " · on balance" : method === "fixed" ? " · flat" : ""}`;
  if (style === "fixed") return `${money(value)} per ${per}`;
  return `Custom · ${money(value)}`;
}
