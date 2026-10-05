// "Delete Payment" for the owner. Nothing is erased underneath: the database marks the
// payment as taken back, puts the loan back as it was, and keeps both in its records.

import type { Payment } from "./types";

export const DEFAULT_DELETE_REASON = "Entered by mistake";

/** The one payment on a loan that can be deleted: the one entered last. */
export function deletablePayment(payments: Payment[]): Payment | undefined {
  return payments.reduce<Payment | undefined>((a, p) => (p.recordedAt && (!a || p.recordedAt > a.recordedAt!) ? p : a), undefined);
}

/** The reason is optional on screen; the record always has one. */
export const deleteReason = (typed: string) => typed.trim() || DEFAULT_DELETE_REASON;
