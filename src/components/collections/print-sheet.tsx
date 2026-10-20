"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { collectionSheet } from "@/lib/collection-sheet";
import { dLong, money, todayISO } from "@/lib/format";
import { useAppState } from "@/lib/store";

/** "Print Sheet": the day's collection list as a PDF to print and take on the round. */
export function PrintSheetButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        <Printer className="size-4" /> Print Sheet
      </Button>
      {open && <PrintSheet onClose={() => setOpen(false)} />}
    </>
  );
}

function PrintSheet({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const sheet = collectionSheet(s, date);

  const download = async () => {
    setBusy(true);
    try {
      const { downloadCollectionSheet } = await import("@/lib/collection-sheet-pdf");
      await downloadCollectionSheet(sheet);
      toast("Collection sheet downloaded");
      onClose();
    } catch {
      toast("The sheet could not be made. Please try again.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Print Collection Sheet"
      subtitle="A page to print and take on the round"
      footer={
        <Button size="lg" className="w-full" disabled={busy || !date} onClick={download}>
          <Printer className="size-5" /> {busy ? "Preparing…" : "Download PDF"}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Sheet for" hint={date ? dLong(date) : undefined}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="rounded-2xl bg-line-2/80 px-4 py-3 text-sm text-ink-2">
          <p>
            <b className="num">{sheet.rows.length}</b> loan{sheet.rows.length === 1 ? "" : "s"} to collect by that day, <b className="num">{money(sheet.total)}</b> expected
            (that day&apos;s collections and anything overdue).
          </p>
          <p className="mt-1 text-[13px] text-muted">Each row has the loan number, name, latest note and the amount expected. Date and Amount are left blank to write in.</p>
        </div>
      </div>
    </Sheet>
  );
}
