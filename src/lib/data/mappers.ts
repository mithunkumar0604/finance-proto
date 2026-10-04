// Database rows <-> the types the screens use. Pure functions, no network.

import { format } from "date-fns";
import type { Activity, AppUser, Customer, Due, Loan, Payment, Security } from "../types";

/* eslint-disable @typescript-eslint/no-explicit-any -- rows arrive as untyped JSON */
type Row = Record<string, any>;

const opt = <T,>(v: T | null | undefined): T | undefined => (v === null || v === undefined || v === "" ? undefined : v);

export function customerFromRow(r: Row): Customer {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone ?? "",
    altPhone: opt(r.alt_phone),
    area: r.area ?? "",
    address: opt(r.address),
    idRef: opt(r.id_ref),
    notes: opt(r.notes),
    createdAt: r.created_on,
    collectorId: opt(r.collector_id),
  };
}

export function customerToRow(c: Partial<Omit<Customer, "id" | "createdAt">>): Row {
  const row: Row = {};
  if ("name" in c) row.name = c.name?.trim();
  if ("phone" in c) row.phone = c.phone ?? "";
  if ("altPhone" in c) row.alt_phone = c.altPhone || null;
  if ("area" in c) row.area = c.area ?? "";
  if ("address" in c) row.address = c.address || null;
  if ("idRef" in c) row.id_ref = c.idRef || null;
  if ("notes" in c) row.notes = c.notes || null;
  if ("collectorId" in c) row.collector_id = c.collectorId || null;
  return row;
}

export function securityFromRow(r: Row | undefined): Security | null {
  if (!r) return null;
  return { ...(r.details ?? {}), kind: r.kind, status: r.status } as Security;
}

/** The words a person would search a security by: registration, packet, reference, description. */
function securitySearchText(s: Security): string {
  switch (s.kind) {
    case "vehicle":
      return [s.registration, s.make, s.model].filter(Boolean).join(" ");
    case "jewel":
      return [s.description, s.packetNo].filter(Boolean).join(" ");
    case "document":
      return [s.documentType, s.referenceNo].filter(Boolean).join(" ");
    case "other":
      return s.description;
  }
}

export function collateralToRow(s: Security): { kind: Security["kind"]; details: Row; search_text: string } {
  const { kind, status: _status, ...details } = s;
  void _status;
  return { kind, details, search_text: securitySearchText(s) };
}

export function loanFromRow(r: Row, collateral: Row | undefined, lastInterestPaidOn?: string): Loan {
  return {
    id: r.id,
    customerId: r.customer_id,
    type: r.type,
    amount: Number(r.amount),
    startDate: r.start_date,
    reference: opt(r.reference),
    interest: { style: r.interest_style, value: Number(r.interest_value), method: r.interest_method },
    frequency: r.frequency,
    principalPerDue: Number(r.principal_per_due),
    principalLeft: Number(r.principal_left),
    status: r.status,
    closedDate: opt(r.closed_date),
    security: securityFromRow(collateral),
    ...(lastInterestPaidOn ? { lastInterestPaidOn } : {}),
    version: r.version,
  };
}

export function loanToRow(l: Pick<Loan, "customerId" | "type" | "amount" | "startDate" | "reference" | "interest" | "frequency" | "principalPerDue">): Row {
  return {
    customer_id: l.customerId,
    type: l.type,
    amount: l.amount,
    start_date: l.startDate,
    reference: l.reference ?? null,
    interest_style: l.interest.style,
    interest_value: l.interest.value,
    interest_method: l.interest.method,
    frequency: l.frequency,
    principal_per_due: l.principalPerDue,
  };
}

export function dueFromRow(r: Row): Due {
  return {
    id: r.id,
    loanId: r.loan_id,
    dueDate: r.due_date,
    interestAmount: Number(r.interest_amount),
    principalAmount: Number(r.principal_amount),
    paid: Number(r.paid),
    interestPaid: Number(r.interest_paid),
    waived: Number(r.waived ?? 0),
    lastPaidDate: opt(r.last_paid_date),
    rescheduled: r.original_date ? { originalDate: r.original_date, reason: r.reschedule_reason ?? "" } : undefined,
    cancelled: !!r.cancelled,
  };
}

/** A due as record_payment expects it. Amounts the engine left out go as 0, never as missing. */
export function dueToRow(d: Due): Row {
  return {
    id: d.id,
    due_date: d.dueDate,
    interest_amount: d.interestAmount,
    principal_amount: d.principalAmount,
    paid: d.paid,
    interest_paid: d.interestPaid ?? Math.min(d.interestAmount, d.paid),
    waived: d.waived ?? 0,
    last_paid_date: d.lastPaidDate ?? null,
    cancelled: !!d.cancelled,
  };
}

export function paymentFromRow(r: Row): Payment {
  return {
    id: r.id,
    loanId: r.loan_id,
    customerId: r.customer_id,
    date: r.payment_date,
    recordedOn: r.recorded_on,
    ...(r.recorded_at ? { recordedAt: r.recorded_at } : {}),
    principalBefore: Number(r.principal_before),
    interest: Number(r.interest),
    principal: Number(r.principal),
    other: Number(r.other),
    method: r.method,
    note: opt(r.note),
    dueId: opt(r.due_id),
  };
}

export function activityFromRow(r: Row): Activity {
  // The activity screen groups by local day, so times are kept as local "YYYY-MM-DDTHH:mm:ss".
  return { id: String(r.id), at: format(new Date(r.at), "yyyy-MM-dd'T'HH:mm:ss"), by: r.by_name ?? "", text: r.text, kind: r.kind };
}

export function userFromRow(r: Row): AppUser {
  return { id: r.id, name: r.name, phone: r.phone ?? "", role: r.role, area: opt(r.area), active: !!r.active };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** An error that is safe to show to the person using the app. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const sentence = (s: string) => {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
};

/** Turns anything thrown by the network or the database into a short, plain message. */
export function parseDbError(e: unknown): { code: string; message: string } {
  const err = (e ?? {}) as { message?: string; code?: string; status?: number; name?: string };
  const msg = String(err.message ?? e ?? "");
  const known = /^([A-Z_]{3,}): ([\s\S]+)$/.exec(msg);
  if (known) return { code: known[1], message: sentence(known[2]) };
  if (/failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout/i.test(msg))
    return { code: "NETWORK", message: "No connection. Nothing was saved. Check the internet and try again." };
  if (/jwt|not authenticated|invalid refresh token|session/i.test(msg) || err.code === "PGRST301" || err.status === 401)
    return { code: "SIGNED_OUT", message: "You have been signed out. Please sign in again." };
  if (err.code === "42501" || err.status === 403) return { code: "NOT_ALLOWED", message: "You are not allowed to do this." };
  if (err.code === "23505") return { code: "DUPLICATE", message: "This was already saved." };
  return { code: "REJECTED", message: "This could not be saved. Nothing was changed. Please check and try again." };
}

export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const { code, message } = parseDbError(e);
  return new AppError(code, message);
}
