"use client";

import { Car, ChevronRight, FileText, Gem } from "lucide-react";
import Link from "next/link";
import { Chip, type ChipTone } from "@/components/ui/bits";
import { dueRemaining } from "@/lib/finance/engine";
import { dLong, dRelative, LOAN_TYPE_LABEL, money } from "@/lib/format";
import type { LoanHealth, loanView } from "@/lib/selectors";
import type { Loan, Security } from "@/lib/types";

export const HEALTH_META: Record<LoanHealth, { label: string; tone: ChipTone }> = {
  active: { label: "Active", tone: "green" },
  due: { label: "Due Today", tone: "brand" },
  overdue: { label: "Overdue", tone: "red" },
  closed: { label: "Closed", tone: "slate" },
};

export function securityLabel(sec: Security): string {
  if (sec.kind === "vehicle") return sec.registration;
  if (sec.kind === "jewel") return `${sec.description} · ${sec.weightGrams}g`;
  if (sec.kind === "document") return sec.documentType;
  return sec.description;
}

export function SecurityIcon({ sec, className }: { sec: Security; className?: string }) {
  const Icon = sec.kind === "vehicle" ? Car : sec.kind === "jewel" ? Gem : FileText;
  return <Icon className={className} />;
}

export function LoanCard({ loan, view, today }: { loan: Loan; view: ReturnType<typeof loanView>; today: string }) {
  const h = HEALTH_META[view.health];
  const next = view.next;
  return (
    <Link href={`/loan/?id=${loan.id}`} className="block rounded-3xl border border-line bg-surface p-4 transition hover:border-faint active:scale-[0.99] md:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[17px] font-bold">Loan {loan.id}</p>
          <p className="text-[13px] text-muted">
            {LOAN_TYPE_LABEL[loan.type]} · Started {dLong(loan.startDate)}
          </p>
        </div>
        <Chip tone={h.tone} dot>
          {h.label}
          {view.health === "overdue" ? ` · ${view.daysLate}d` : ""}
        </Chip>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <p className="text-xs text-muted">Original Amount</p>
          <p className="num font-bold">{money(loan.amount)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Principal Remaining</p>
          <p className="num font-extrabold">{money(loan.principalLeft)}</p>
        </div>
        {loan.status === "active" ? (
          <>
            <div>
              <p className="text-xs text-muted">Current Due</p>
              <p className={`num font-bold ${view.currentDue ? "text-amber-700" : ""}`}>{money(view.currentDue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Next Payment</p>
              <p className="num font-bold">
                {next ? (
                  <>
                    {money(dueRemaining(next))} <span className="font-medium text-muted">· {dRelative(next.dueDate, today)}</span>
                  </>
                ) : (
                  "—"
                )}
              </p>
            </div>
          </>
        ) : (
          <div className="col-span-2">
            <p className="text-xs text-muted">Closed on</p>
            <p className="font-bold">{loan.closedDate ? dLong(loan.closedDate) : "—"}</p>
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-line-2 pt-3">
        {loan.security ? (
          <Chip tone="gold">
            <SecurityIcon sec={loan.security} className="size-3.5" />
            {securityLabel(loan.security)}
          </Chip>
        ) : (
          <span className="text-[13px] text-muted">No security</span>
        )}
        <span className="flex items-center text-sm font-semibold text-brand-700">
          View Loan <ChevronRight className="size-4" />
        </span>
      </div>
    </Link>
  );
}
