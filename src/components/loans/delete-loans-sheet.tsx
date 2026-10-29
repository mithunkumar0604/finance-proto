"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { money, todayISO } from "@/lib/format";
import { loanView } from "@/lib/selectors";
import { actions, useAppState } from "@/lib/store";
import { useLoanHistory } from "@/lib/use-history";
import { useSave } from "@/lib/use-save";

/**
 * Admin only: delete loans entered by mistake, with everything attached. The database
 * checks the admin mark and deletes all of them or none; the customers stay.
 */
export function DeleteLoansSheet({ ids, onClose, onDeleted }: { ids: string[]; onClose: () => void; onDeleted: () => void }) {
  const s = useAppState();
  const today = todayISO();
  const [typed, setTyped] = useState("");
  const { busy, run } = useSave();
  // the counts below need every payment of these loans, not just the recent ones
  useLoanHistory(ids);
  const loans = s.loans.filter((l) => ids.includes(l.id));
  const one = loans.length === 1;

  const remove = async () => {
    if (!(await run(() => actions.deleteLoans(loans.map((l) => l.id)).then(() => true)))) return;
    toast(one ? "Loan deleted" : `Deleted ${loans.length} loans`);
    onDeleted();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={one ? "Delete this loan?" : `Delete ${loans.length} loans?`}
      footer={
        <div className="grid grid-cols-2 gap-2.5">
          <Button size="lg" variant="secondary" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button size="lg" variant="danger" disabled={busy || typed !== "DELETE" || !loans.length} onClick={remove}>
            {busy ? "Deleting…" : one ? "Delete Loan" : `Delete ${loans.length} Loans`}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pb-2">
        <ul className="divide-y divide-line-2 rounded-2xl border border-line">
          {loans.map((l) => {
            const v = loanView(s, l, today);
            const n = v.payments.length;
            return (
              <li key={l.id} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate font-bold">{s.customers.find((c) => c.id === l.customerId)?.name ?? l.customerId}</p>
                  <p className="num shrink-0 font-semibold">{money(l.amount)}</p>
                </div>
                <p className="text-[13px] text-muted">
                  {l.loanNo ? `No. ${l.loanNo} · ${l.id}` : l.id} · {n} payment{n === 1 ? "" : "s"} · {money(v.collected)} received
                </p>
              </li>
            );
          })}
        </ul>
        <p className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
          This cannot be undone. All payments, interest, jewel details and notes of these loans are deleted. The customers stay.
        </p>
        <Field label="Type DELETE to confirm">
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} />
        </Field>
      </div>
    </Sheet>
  );
}
