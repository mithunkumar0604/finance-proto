"use client";

import { Camera, Landmark, UserRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, Card } from "@/components/ui/bits";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, PhotoPlaceholder, Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { FILE_ACCEPT, fileProblem } from "@/lib/files";
import { phoneFmt } from "@/lib/format";
import { actions, LIVE } from "@/lib/store";
import { useSave } from "@/lib/use-save";
import type { Customer } from "@/lib/types";

export default function NewCustomerPage() {
  const [saved, setSaved] = useState<Customer | null>(null);
  const [f, setF] = useState({ name: "", phone: "", altPhone: "", area: "", address: "", idRef: "", notes: "" });
  const [touched, setTouched] = useState(false);
  const [photo, setPhoto] = useState<File | undefined>();
  const [photoSaved, setPhotoSaved] = useState(false);
  const savedFace = useMemo(() => (photoSaved && photo && photo.type !== "application/pdf" ? URL.createObjectURL(photo) : null), [photoSaved, photo]);
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
    // One "save": the customer first, then the photo. If the photo fails the customer stays,
    // and the photo can be added from the customer's page.
    const done = await run(async () => {
      const c = await actions.addCustomer({
        name: f.name.trim(),
        phone: phoneDigits,
        altPhone: f.altPhone.replace(/\D/g, "") || undefined,
        area: f.area.trim() || "—",
        address: f.address.trim() || undefined,
        idRef: f.idRef.trim() || undefined,
        notes: f.notes.trim() || undefined,
      });
      const failed = photo ? await actions.savePhotos(c.id, { photo }) : 0;
      return { c, failed };
    });
    if (!done) return;
    if (done.failed) toast("The customer is saved, but the photo could not be saved. Add it from the customer's page.", "error");
    setPhotoSaved(!!photo && !done.failed);
    setSaved(done.c);
  };

  if (saved)
    return (
      <div>
        <PageHeader title="Customer Saved" back={false} />
        <Card className="mx-auto max-w-lg p-6 text-center">
          {savedFace ? (
            // eslint-disable-next-line @next/next/no-img-element -- the photo just chosen on this device
            <img src={savedFace} alt={`Photo of ${saved.name}`} className="mx-auto size-18 animate-pop rounded-full object-cover" />
          ) : (
            <Avatar name={saved.name} size="xl" className="mx-auto animate-pop" />
          )}
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
          {LIVE ? <CustomerPhotoPick file={photo} onPick={setPhoto} /> : <PhotoPlaceholder label="Photo" className="!size-24 shrink-0 rounded-full" />}
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
          {busy ? "Saving…" : <>Save &amp; Continue</>}
        </Button>
      </div>
    </div>
  );
}

/** The round photo box: choose a photo (camera or gallery on a phone); it is saved together with the customer. */
function CustomerPhotoPick({ file, onPick }: { file?: File; onPick: (f: File | undefined) => void }) {
  const preview = useMemo(() => (file && file.type !== "application/pdf" ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  return (
    <label
      aria-label={file ? "Change customer photo" : "Add customer photo"}
      className={`relative flex size-24 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-full border-2 border-dashed text-sm font-medium transition ${file ? "border-brand-600 text-brand-800" : "border-line text-muted hover:border-brand-200 hover:bg-brand-50/50"}`}
    >
      <input
        type="file"
        accept={FILE_ACCEPT}
        className="sr-only"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (!picked) return;
          const problem = fileProblem(picked);
          if (problem) toast(problem, "error");
          else onPick(picked);
        }}
      />
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element -- a preview of the file just chosen on this device
        <img src={preview} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <>
          <Camera className="size-6" />
          {file ? "PDF" : "Photo"}
        </>
      )}
    </label>
  );
}
