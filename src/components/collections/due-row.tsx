"use client";

import { clsx } from "clsx";
import { CalendarClock, Check } from "lucide-react";
import Link from "next/link";
import { useUI } from "@/components/layout/ui-context";
import { Avatar, StatusChip } from "@/components/ui/bits";
import { dRelative, dShort, LOAN_TYPE_SHORT, money, todayISO } from "@/lib/format";
import type { RegisterRow } from "@/lib/selectors";
import type { ISODate } from "@/lib/types";
import type { ReactNode } from "react";

/** Human sentence for where a due stands. */
export function dueLine(r: RegisterRow, today: ISODate) {
  if (r.status === "paid") return r.due.lastPaidDate === today ? "Received today" : `Paid ${r.due.lastPaidDate ? dShort(r.due.lastPaidDate) : ""}`;
  if (r.status === "rescheduled") return `Moved to ${dShort(r.due.dueDate)}`;
  const when = r.daysLate > 0 ? `Overdue ${r.daysLate} day${r.daysLate > 1 ? "s" : ""}` : r.due.dueDate === today ? "Due Today" : `Due ${dRelative(r.due.dueDate, today)}`;
  if (r.status === "partial") return `${money(r.due.paid)} paid · ${when}`;
  return when;
}

export function DueRow({ row: r, canReceive = true, showMove = false }: { row: RegisterRow; canReceive?: boolean; showMove?: boolean }) {
  const ui = useUI();
  const today = todayISO();
  const paid = r.status === "paid";
  const late = r.daysLate > 0 && !paid;

  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Link href={`/loan/?id=${r.loan.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={r.customer.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] font-bold text-ink">{r.customer.name}</p>
          <p className="truncate text-[13px] text-muted">
            {LOAN_TYPE_SHORT[r.loan.type]} · {r.loan.id}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            {r.status !== "pending" && (
              <StatusChip status={r.status} suffix={r.status === "rescheduled" ? dShort(r.due.dueDate) : undefined} />
            )}
            {r.status !== "rescheduled" && (
              <span className={clsx("text-[13px] font-medium", late ? "text-rose-700" : r.due.dueDate === today && !paid ? "text-ink-2" : "text-muted")}>
                {dueLine(r, today)}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <p className={clsx("num text-[16px] font-extrabold", paid ? "text-emerald-700" : "text-ink")}>
          {money(paid ? r.total : r.remaining)}
        </p>
        {paid ? (
          <span className="flex h-9 items-center gap-1 text-sm font-semibold text-emerald-700">
            <Check className="size-4" strokeWidth={3} /> Received
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            {showMove && (
              <button
                type="button"
                onClick={() => ui.openReschedule(r.due.id)}
                aria-label="Move date"
                className="hidden size-9 place-items-center rounded-xl border border-line text-muted hover:bg-line-2 sm:grid"
              >
                <CalendarClock className="size-4" />
              </button>
            )}
            {canReceive && (
              <button
                type="button"
                onClick={() => ui.openPayment(r.loan.id, { dueId: r.due.id })}
                className="h-9 rounded-xl bg-brand-700 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-brand-800 active:scale-95"
              >
                Collect
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function DueList({ rows, canReceive, showMove, empty }: { rows: RegisterRow[]; canReceive?: boolean; showMove?: boolean; empty?: ReactNode }) {
  if (!rows.length) return <>{empty}</>;
  return (
    <div className="divide-y divide-line-2 overflow-hidden rounded-3xl border border-line bg-surface">
      {rows.map((r) => (
        <DueRow key={r.due.id} row={r} canReceive={canReceive} showMove={showMove} />
      ))}
    </div>
  );
}
