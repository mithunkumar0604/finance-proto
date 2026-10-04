"use client";

import { Landmark, UserRound } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, Card } from "@/components/ui/bits";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, PhotoPlaceholder, Textarea } from "@/components/ui/form";
import { phoneFmt } from "@/lib/format";
import { actions } from "@/lib/store";
import { useSave } from "@/lib/use-save";
import type { Customer } from "@/lib/types";

export default function NewCustomerPage() {
  const [saved, setSaved] = useState<Customer | null>(null);
  const [f, setF] = useState({ name: "", phone: "", altPhone: "", area: "", address: "", idRef: "", notes: "" });
  const [touched, setTouched] = useState(false);
  const { busy, run } = useSave();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const phoneDigits = f.phone.replace(/\D/g, "");
  const errors = {
    name: !f.name.trim() ? "Enter the customer's name" : "",
    phone: phoneDigits.length !== 10 ? "Enter a 10-digit mobile number" : "",
  };
  const valid = !errors.name && !errors.phone;

  const save = async () => {
    setTouched(true);
    if (!valid) return;
    const c = await run(() =>
      actions.addCustomer({
      name: f.name.trim(),
      phone: phoneDigits,
      altPhone: f.altPhone.replace(/\D/g, "") || undefined,
      area: f.area.trim() || "—",
      address: f.address.trim() || undefined,
      idRef: f.idRef.trim() || undefined,
      notes: f.notes.trim() || undefined,
      }),
    );
    if (c) setSaved(c);
  };

  if (saved)
    return (
      <div>
        <PageHeader title="Customer Saved" back={false} />
        <Card className="mx-auto max-w-lg p-6 text-center">
          <Avatar name={saved.name} size="xl" className="mx-auto animate-pop" />
          <p className="mt-4 text-xl font-bold">{saved.name}</p>
          <p className="num text-muted">
            {phoneFmt(saved.phone)} · {saved.area}
          </p>
          <p className="mt-1 text-sm text-muted">Customer ID {saved.id}</p>
          <div className="mt-6 grid gap-2.5">
            <LinkButton href={`/loans/new/?customer=${saved.id}`} size="lg">
              <Landmark className="size-5" /> Create Loan
            </LinkButton>
            <LinkButton href={`/customer/?id=${saved.id}`} size="lg" variant="secondary">
              <UserRound className="size-5" /> View Profile
            </LinkButton>
          </div>
        </Card>
      </div>
    );

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Customer" subtitle="Only name and mobile are required" />
      <Card className="space-y-5 p-5">
        <div className="flex items-center gap-4">
          <PhotoPlaceholder label="Photo" className="size-24 shrink-0 rounded-full" />
          <p className="text-sm text-muted">Add a photo so collectors can recognise the customer. (Optional)</p>
        </div>
        <Field label="Full Name" required hint={touched && errors.name ? <span className="text-rose-600">{errors.name}</span> : undefined}>
          <Input value={f.name} onChange={set("name")} placeholder="e.g. Ravi Kumar" autoComplete="off" />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Mobile Number" required hint={touched && errors.phone ? <span className="text-rose-600">{errors.phone}</span> : undefined}>
            <Input value={f.phone} onChange={set("phone")} inputMode="tel" placeholder="98765 43210" />
          </Field>
          <Field label="Alternate Number">
            <Input value={f.altPhone} onChange={set("altPhone")} inputMode="tel" placeholder="Optional" />
          </Field>
        </div>
        <Field label="Area / Location">
          <Input value={f.area} onChange={set("area")} placeholder="e.g. Perundurai" />
        </Field>
        <Field label="Address">
          <Textarea value={f.address} onChange={set("address")} placeholder="House no, street, town" className="min-h-20" />
        </Field>
        <Field label="ID Reference" hint="Aadhaar / Voter ID / PAN — last digits are enough">
          <Input value={f.idRef} onChange={set("idRef")} placeholder="e.g. Aadhaar •••• 4821" />
        </Field>
        <Field label="Notes">
          <Textarea value={f.notes} onChange={set("notes")} placeholder="Anything to remember" className="min-h-20" />
        </Field>
      </Card>
      <div className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] z-10 -mx-4 mt-5 bg-gradient-to-t from-canvas from-70% to-transparent px-4 pt-6 pb-3 md:bottom-0 md:mx-0 md:px-0 md:pb-6">
        <Button size="lg" className="w-full uppercase tracking-wide" onClick={save} disabled={busy}>
          Save &amp; Continue
        </Button>
      </div>
    </div>
  );
}
