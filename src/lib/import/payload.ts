// Turns a checked import file into what the database's import_book function takes.

import { createHash } from "node:crypto";
import { collateralToRow } from "../data/mappers";
import type { Security } from "../types";
import type { ImportCustomer, ImportLoan, ImportResult } from "./validate";

/** The security details the app's screens expect, from the two columns the file has. */
function security(l: ImportLoan, customer: ImportCustomer): Security | null {
  const s = l.security;
  if (!s) return null;
  const description = s.description ?? "";
  const status = l.status === "closed" ? "released" : "held";
  switch (s.kind) {
    case "vehicle":
      return { kind: "vehicle", registration: s.registration ?? "", vehicleType: "other", make: description, model: "", ownerName: customer.name, rcRef: "", documentHeld: "", storage: "", status };
    case "jewel":
      return { kind: "jewel", description, weightGrams: 0, purity: "", estimatedValue: 0, packetNo: "", storage: "", status };
    case "document":
      return { kind: "document", documentType: description, owner: customer.name, referenceNo: "", original: true, description, storage: "", status };
    case "other":
      return { kind: "other", description, storage: "", status };
  }
}

/** The same file always gets the same id, so importing it twice saves it once. */
export function batchId(fileText: string): string {
  const h = createHash("sha256").update(fileText.replace(/\r\n/g, "\n").trim()).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function importPayload(result: ImportResult) {
  if (!result.ok) throw new Error("This file has errors and cannot be imported.");
  const byKey = new Map(result.customers.map((c) => [c.key, c]));
  return {
    p_customers: result.customers.map((c) => ({
      key: c.key,
      ref: c.ref ?? null,
      name: c.name,
      phone: c.phone,
      alt_phone: c.altPhone ?? null,
      area: c.area,
      address: c.address ?? null,
      id_ref: c.idRef ?? null,
      notes: c.notes ?? null,
    })),
    p_loans: result.loans.map((l) => {
      const sec = security(l, byKey.get(l.customerKey)!);
      return {
        customer_key: l.customerKey,
        ref: l.ref ?? null,
        type: l.type,
        amount: l.amount,
        principal_left: l.principalLeft,
        start_date: l.startDate,
        interest_style: l.interest.style,
        interest_value: l.interest.value,
        interest_method: l.interest.method,
        frequency: l.frequency,
        principal_per_due: l.principalPerDue,
        next_due_date: l.nextDueDate ?? null,
        status: l.status,
        closed_date: l.closedDate ?? null,
        reference: l.reference ?? null,
        interest_already_paid: l.interestAlreadyPaid ?? 0,
        last_paid_date: l.lastPaidDate ?? null,
        collateral: sec ? collateralToRow(sec) : null,
      };
    }),
  };
}
