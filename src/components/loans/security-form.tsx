"use client";

import { Field, Input, MoneyInput, OptionGrid, PhotoPlaceholder, Textarea } from "@/components/ui/form";
import type { Security } from "@/lib/types";

export type SecurityKind = "none" | Security["kind"];

/** Flat, string-based form state for every security type (easy to bind to inputs). */
export interface SecurityDraft {
  // jewel
  description: string;
  weight: string;
  purity: string;
  estimatedValue: number | "";
  packetNo: string;
  // vehicle
  registration: string;
  vehicleType: "car" | "bike" | "commercial" | "other";
  make: string;
  model: string;
  ownerName: string;
  rcRef: string;
  documentHeld: string;
  // document
  documentType: string;
  referenceNo: string;
  original: "original" | "copy";
  // shared
  storage: string;
  notes: string;
}

export const EMPTY_SECURITY: SecurityDraft = {
  description: "",
  weight: "",
  purity: "22K",
  estimatedValue: "",
  packetNo: "",
  registration: "",
  vehicleType: "bike",
  make: "",
  model: "",
  ownerName: "",
  rcRef: "",
  documentHeld: "Original RC",
  documentType: "",
  referenceNo: "",
  original: "original",
  storage: "Office locker A",
  notes: "",
};

export function buildSecurity(kind: SecurityKind, d: SecurityDraft, customerName: string): Security | null {
  if (kind === "none") return null;
  if (kind === "jewel")
    return {
      kind,
      description: d.description || "Gold Jewellery",
      weightGrams: Number(d.weight) || 0,
      purity: d.purity,
      estimatedValue: d.estimatedValue || 0,
      packetNo: d.packetNo || "—",
      storage: d.storage,
      notes: d.notes || undefined,
      status: "held",
    };
  if (kind === "vehicle")
    return {
      kind,
      registration: d.registration.toUpperCase() || "Vehicle (no. not entered)",
      vehicleType: d.vehicleType,
      make: d.make,
      model: d.model,
      ownerName: d.ownerName || customerName,
      rcRef: d.rcRef || "—",
      documentHeld: d.documentHeld,
      storage: d.storage,
      status: "held",
    };
  if (kind === "document")
    return {
      kind,
      documentType: d.documentType || "Document",
      owner: d.ownerName || customerName,
      referenceNo: d.referenceNo || "—",
      original: d.original === "original",
      description: d.description,
      storage: d.storage,
      status: "held",
    };
  return { kind: "other", description: d.description || "Other security", storage: d.storage, status: "held" };
}

export function SecurityFields({ kind, d, onChange }: { kind: SecurityKind; d: SecurityDraft; onChange: (d: SecurityDraft) => void }) {
  const set = (k: keyof SecurityDraft) => (e: { target: { value: string } }) => onChange({ ...d, [k]: e.target.value });

  if (kind === "none") return null;

  return (
    <div className="mt-5 space-y-4 rounded-3xl border border-line bg-surface p-4">
      {kind === "jewel" && (
        <>
          <Field label="Security Type">
            <Input value="Gold Jewellery" readOnly className="bg-line-2 text-muted" />
          </Field>
          <Field label="Item Description">
            <Input value={d.description} onChange={set("description")} placeholder="e.g. Chain + Ring" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Weight (grams)">
              <Input value={d.weight} onChange={set("weight")} inputMode="decimal" placeholder="38.5" />
            </Field>
            <Field label="Purity" group>
              <OptionGrid cols={3} value={d.purity} onChange={(purity) => onChange({ ...d, purity })} options={[{ value: "24K", label: "24K" }, { value: "22K", label: "22K" }, { value: "18K", label: "18K" }]} />
            </Field>
          </div>
          <Field label="Estimated Value">
            <MoneyInput value={d.estimatedValue} onChange={(estimatedValue) => onChange({ ...d, estimatedValue })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reference / Packet No.">
              <Input value={d.packetNo} onChange={set("packetNo")} placeholder="PKT-0501" />
            </Field>
            <Field label="Storage Location">
              <Input value={d.storage} onChange={set("storage")} />
            </Field>
          </div>
          <PhotoPlaceholder label="Add jewel photo" />
          <Field label="Notes">
            <Textarea value={d.notes} onChange={set("notes")} className="min-h-20" placeholder="Any marks, stones, damage…" />
          </Field>
        </>
      )}

      {kind === "vehicle" && (
        <>
          <Field label="Vehicle Registration">
            <Input value={d.registration} onChange={(e) => onChange({ ...d, registration: e.target.value.toUpperCase() })} placeholder="TN 33 AB 1234" className="font-semibold tracking-wide uppercase" />
          </Field>
          <Field label="Vehicle Type" group>
            <OptionGrid
              cols={4}
              value={d.vehicleType}
              onChange={(vehicleType) => onChange({ ...d, vehicleType })}
              options={[
                { value: "car", label: "Car" },
                { value: "bike", label: "Bike" },
                { value: "commercial", label: "Commercial" },
                { value: "other", label: "Other" },
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Make">
              <Input value={d.make} onChange={set("make")} placeholder="Honda" />
            </Field>
            <Field label="Model">
              <Input value={d.model} onChange={set("model")} placeholder="Shine" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Owner Name">
              <Input value={d.ownerName} onChange={set("ownerName")} placeholder="As per RC" />
            </Field>
            <Field label="RC Reference">
              <Input value={d.rcRef} onChange={set("rcRef")} placeholder="RC number" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Document Held">
              <Input value={d.documentHeld} onChange={set("documentHeld")} />
            </Field>
            <Field label="Storage Location">
              <Input value={d.storage} onChange={set("storage")} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PhotoPlaceholder label="Vehicle photo" />
            <PhotoPlaceholder label="RC photo" />
          </div>
        </>
      )}

      {kind === "document" && (
        <>
          <Field label="Document Type">
            <Input value={d.documentType} onChange={set("documentType")} placeholder="e.g. Property Sale Deed" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Document Owner">
              <Input value={d.ownerName} onChange={set("ownerName")} />
            </Field>
            <Field label="Reference Number">
              <Input value={d.referenceNo} onChange={set("referenceNo")} />
            </Field>
          </div>
          <Field label="Original / Copy" group>
            <OptionGrid cols={2} value={d.original} onChange={(original) => onChange({ ...d, original })} options={[{ value: "original", label: "Original" }, { value: "copy", label: "Copy" }]} />
          </Field>
          <Field label="Description">
            <Textarea value={d.description} onChange={set("description")} className="min-h-20" />
          </Field>
          <Field label="Storage Location">
            <Input value={d.storage} onChange={set("storage")} />
          </Field>
          <PhotoPlaceholder label="Add document image" />
        </>
      )}

      {kind === "other" && (
        <>
          <Field label="Description">
            <Textarea value={d.description} onChange={set("description")} className="min-h-20" placeholder="What is being held?" />
          </Field>
          <Field label="Storage Location">
            <Input value={d.storage} onChange={set("storage")} />
          </Field>
        </>
      )}
    </div>
  );
}
