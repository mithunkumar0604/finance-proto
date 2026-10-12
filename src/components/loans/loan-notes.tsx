"use client";

import { CalendarClock, StickyNote } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { dLong, dShort, todayISO } from "@/lib/format";
import { actions } from "@/lib/store";
import type { LoanNote } from "@/lib/types";
import { useSave } from "@/lib/use-save";

const when = (at: string) => `${dShort(at.slice(0, 10))} ${at.slice(0, 4)}`;

/**
 * Remarks on a loan that are not a payment: "will pay next week", "shop was shut".
 * Anyone who can see the loan can add one; a note is kept as written. Notes change no amount.
 */
export function LoanNotes({ loanId, notes }: { loanId: string; notes: LoanNote[] }) {
  const [text, setText] = useState("");
  const [promised, setPromised] = useState("");
  const { busy, run } = useSave();
  const today = todayISO();
  const list = [...notes].sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

  const add = async () => {
    if (!text.trim()) return toast("Type the note first.", "error");
    if (!(await run(() => actions.addLoanNote(loanId, text.trim(), promised || undefined).then(() => true)))) return;
    setText("");
    setPromised("");
    toast("Note added");
  };

  return (
    <Card className="p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2 font-bold">
        <StickyNote className="size-5 text-amber-600" /> Notes
      </div>

      <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="e.g. Will pay next week" aria-label="New note" className="min-h-20" />
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Promised to pay on (optional)" className="min-w-0 flex-1">
          <Input type="date" value={promised} min={today} onChange={(e) => setPromised(e.target.value)} />
        </Field>
        <Button disabled={busy} onClick={add}>
          {busy ? "Saving…" : "Add Note"}
        </Button>
      </div>

      {list.length > 0 && (
        <ul className="mt-4 divide-y divide-line-2 border-t border-line-2">
          {list.map((n) => (
            <li key={n.id} className="py-3">
              <p className="text-[15px] whitespace-pre-wrap text-ink">{n.text}</p>
              {n.promisedOn && (
                <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[12px] font-semibold text-indigo-700">
                  <CalendarClock className="size-3.5" /> Promised {dLong(n.promisedOn)}
                </p>
              )}
              <p className="mt-1 text-[12px] text-muted">
                {when(n.at)}
                {n.by ? ` · ${n.by}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
