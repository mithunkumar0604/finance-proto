"use client";

import { clsx } from "clsx";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { dueRemaining } from "@/lib/finance/engine";
import { dLong, dShort, money, shiftISO, todayISO } from "@/lib/format";
import { actions, useAppState } from "@/lib/store";
import { useSave } from "@/lib/use-save";

const REASONS = ["Customer travelling", "Salary not received", "Medical emergency", "Festival week"];

export function RescheduleSheet({ dueId, onClose }: { dueId: string; onClose: () => void }) {
  const s = useAppState();
  const today = todayISO();
  const due = s.dues.find((d) => d.id === dueId)!;
  const loan = s.loans.find((l) => l.id === due.loanId)!;
  const customer = s.customers.find((c) => c.id === loan.customerId)!;
  const base = due.dueDate < today ? today : due.dueDate;
  const [date, setDate] = useState(shiftISO(base, 5));
  const [reason, setReason] = useState("");
  const { busy, run } = useSave();

  const quick = [
    { label: "+1 day", v: shiftISO(base, 1) },
    { label: "+3 days", v: shiftISO(base, 3) },
    { label: "+1 week", v: shiftISO(base, 7) },
    { label: "+15 days", v: shiftISO(base, 15) },
  ];

  const save = async () => {
    const ok = await run(() => actions.reschedule(dueId, date, reason.trim() || "No reason given").then(() => true));
    if (!ok) return;
    toast(`Rescheduled · ${dShort(date)}`);
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Move Payment Date"
      subtitle={`${customer.name} · ${loan.id} · ${money(dueRemaining(due))}`}
      footer={
        <Button size="lg" className="w-full" onClick={save} disabled={busy || !date || date === due.dueDate}>
          Save
        </Button>
      }
    >
      <div className="mb-5 flex items-center gap-3 rounded-2xl border border-line p-4">
        <div className="flex-1">
          <p className="text-[13px] text-muted">Existing Date</p>
          <p className="text-lg font-bold">{dShort(due.dueDate)}</p>
        </div>
        <ArrowRight className="size-5 text-faint" />
        <div className="flex-1 text-right">
          <p className="text-[13px] text-muted">New Date</p>
          <p className="text-lg font-bold text-indigo-700">{date ? dShort(date) : "—"}</p>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-4 gap-2">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => setDate(q.v)}
            className={clsx(
              "h-11 rounded-xl border text-sm font-semibold transition",
              date === q.v ? "border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600" : "border-line text-ink-2",
            )}
          >
            {q.label}
          </button>
        ))}
      </div>

      <Field label="Or pick a date" hint={date ? dLong(date) : undefined}>
        <Input type="date" value={date} min={shiftISO(today, 1)} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <Field label="Reason / Note" className="mt-5" group>
        <div className="mb-2 flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className={clsx("h-9 rounded-full border px-3 text-sm font-medium", reason === r ? "border-ink bg-ink text-white" : "border-line text-ink-2")}>
              {r}
            </button>
          ))}
        </div>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is the date moving?" className="min-h-20" />
      </Field>
      <div className="h-2" />
    </Sheet>
  );
}
