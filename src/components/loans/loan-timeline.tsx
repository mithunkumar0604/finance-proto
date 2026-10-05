"use client";

import { clsx } from "clsx";
import { useState, type ReactNode } from "react";
import type { LoanSchedule } from "@/lib/finance/engine";
import { dLong, dShort, METHOD_LABEL, money } from "@/lib/format";
import type { Loan, Payment } from "@/lib/types";

/** How many coming collections to show before "Show all". */
const PREVIEW = 4;

/**
 * Vertical history: money given → each payment (with split) → where principal stands now
 * → what is still to come (and, for instalment loans, when the loan ends).
 */
export function LoanTimeline({
  loan,
  payments,
  schedule,
  today,
  reversibleId,
  onReverse,
}: {
  loan: Loan;
  payments: Payment[];
  schedule?: LoanSchedule | null;
  today: string;
  /** The one payment that may be reversed (the latest entered), when the viewer is allowed to. */
  reversibleId?: string;
  onReverse?: (p: Payment) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const rows = schedule?.rows ?? [];
  const missed = rows.filter((r) => r.date < today).length;
  const shown = showAll ? rows : rows.slice(0, Math.max(PREVIEW, missed + 1));
  const hidden = rows.length - shown.length;
  // Missed periods come first, each on its own; then the next one to collect.
  const firstComing = rows.findIndex((r) => r.date >= today);
  const items = payments.reduce<{ p: Payment; after: number }[]>(
    // a loan brought in from the old book starts from the principal owed that day
    (acc, p) => [...acc, { p, after: (acc.at(-1)?.after ?? loan.opening?.principalLeft ?? loan.amount) - p.principal }],
    [],
  );

  return (
    <ol className="relative">
      <Item dot="bg-ink" date={dShort(loan.startDate)} year={loan.startDate.slice(0, 4)}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-bold">Loan Given</p>
          <p className="num text-[17px] font-extrabold">{money(loan.amount)}</p>
        </div>
        <p className="text-[13px] text-muted">Money given to customer</p>
      </Item>

      {loan.opening && (
        <Item dot="bg-faint" date={dShort(loan.opening.on)} year={loan.opening.on.slice(0, 4)}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-bold">Brought into LedgerPro</p>
            <p className="num text-[17px] font-extrabold">{money(loan.opening.principalLeft)}</p>
          </div>
          <p className="text-[13px] text-muted">Principal owed that day. Earlier payments are in the old book, not here.</p>
        </Item>
      )}

      {items.map(({ p, after }) => {
        const principalPaid = p.principal > 0;
        const total = p.interest + p.principal + p.other;
        return (
          <Item key={p.id} dot={principalPaid ? "bg-brand-600" : "bg-emerald-400"} date={dShort(p.date)} year={p.date.slice(0, 4)}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-bold">{principalPaid ? "Received" : "Interest Received"}</p>
              <p className="num text-[17px] font-extrabold text-emerald-700">{money(total)}</p>
            </div>
            {principalPaid ? (
              <div className="mt-1.5 rounded-xl bg-line-2/80 px-3 py-2 text-[13px]">
                <div className="num flex justify-between">
                  <span className="text-muted">Interest</span>
                  <span className="font-semibold">{money(p.interest)}</span>
                </div>
                <div className="num flex justify-between">
                  <span className="text-muted">Principal</span>
                  <span className="font-semibold text-brand-700">{money(p.principal)}</span>
                </div>
                <div className="num mt-1 flex justify-between border-t border-line pt-1">
                  <span className="text-muted">Principal left</span>
                  <span className="font-bold">{money(after)}</span>
                </div>
              </div>
            ) : (
              <p className="text-[13px] text-muted">{METHOD_LABEL[p.method]}{p.note ? ` · ${p.note}` : ""}</p>
            )}
            {p.recordedOn > p.date && (
              <p className="mt-1 inline-flex rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">Backdated · recorded {dShort(p.recordedOn)}</p>
            )}
            {onReverse && p.id === reversibleId && (
              <button type="button" onClick={() => onReverse(p)} className="mt-1 block text-[12px] font-semibold text-rose-700 underline underline-offset-2">
                Entered by mistake? Reverse
              </button>
            )}
          </Item>
        );
      })}

      <Item dot="bg-brand-700 ring-4 ring-brand-100" date="Now" last={!schedule}>
        <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-brand-50 px-3 py-2.5">
          <p className="font-bold text-brand-800">{loan.status === "closed" ? "Loan Closed" : "Current Principal"}</p>
          <p className="num text-lg font-extrabold text-brand-800">{money(loan.principalLeft)}</p>
        </div>
      </Item>

      {schedule && (
        <>
          <li className="grid grid-cols-[56px_20px_1fr] gap-x-2 pb-3">
            <span />
            <span className="relative flex justify-center">
              <span className="absolute -top-2 -bottom-3 w-0.5 bg-line" />
            </span>
            <p className="text-[11px] font-bold tracking-[0.08em] text-faint uppercase">Coming collections · expected</p>
          </li>

          {shown.map((r, n) => {
            const late = r.date < today;
            return (
              <Item key={r.date + n} dot="border-2 border-dashed border-faint bg-surface" date={dShort(r.date)} year={r.date.slice(0, 4)} muted={!late && n !== firstComing}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className={clsx("font-semibold", late ? "text-rose-700" : n === firstComing ? "text-ink-2" : "text-muted")}>
                    {late ? "Overdue Collection" : n === firstComing ? "Next Collection" : r.principal > 0 ? "Collection" : "Interest"}
                  </p>
                  <p className={clsx("num font-bold", late || n === firstComing ? "text-ink-2" : "text-muted")}>{money(r.interest + r.principal)}</p>
                </div>
                {r.principal > 0 ? (
                  <p className="num text-[13px] text-faint">
                    Interest {money(r.interest)} · Principal {money(r.principal)} · Left {money(r.balanceAfter)}
                  </p>
                ) : (
                  n === firstComing && <p className="text-[13px] text-faint">Expected {dLong(r.date)}</p>
                )}
              </Item>
            );
          })}

          {hidden > 0 && (
            <li className="grid grid-cols-[56px_20px_1fr] gap-x-2 pb-5">
              <span />
              <span className="relative flex justify-center">
                <span className="absolute -top-5 -bottom-5 w-0.5 bg-line" />
              </span>
              <button type="button" onClick={() => setShowAll(true)} className="h-9 w-fit rounded-xl bg-line-2 px-3 text-sm font-semibold text-brand-700 hover:bg-line">
                Show all {rows.length} collections
              </button>
            </li>
          )}

          {schedule.endsOn ? (
            <Item dot="bg-ink" date={dShort(schedule.endsOn)} year={schedule.endsOn.slice(0, 4)} last>
              <div className="rounded-2xl border border-line px-3 py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-bold">Loan Ends</p>
                  <p className="num font-extrabold">{dLong(schedule.endsOn)}</p>
                </div>
                <p className="num mt-0.5 text-[13px] text-muted">
                  {rows.length} collection{rows.length === 1 ? "" : "s"} left · {money(schedule.totalToCollect)} to collect (interest {money(schedule.totalInterest)})
                </p>
              </div>
            </Item>
          ) : (
            <Item dot="border-2 border-dashed border-faint bg-surface" date="Later" last muted>
              <p className="text-[13px] text-muted">
                {schedule.interestOnly
                  ? "No end date. Interest continues each period until the principal is returned."
                  : "More collections follow."}
              </p>
            </Item>
          )}
        </>
      )}
    </ol>
  );
}

function Item({ dot, date, year, children, last, muted }: { dot: string; date: string; year?: string; children: ReactNode; last?: boolean; muted?: boolean }) {
  return (
    <li className="relative grid grid-cols-[56px_20px_1fr] gap-x-2 pb-5">
      <div className={clsx("pt-0.5 text-right", muted && "opacity-60")}>
        <p className="num text-[13px] leading-tight font-bold">{date}</p>
        {year && <p className="num text-[11px] text-faint">{year}</p>}
      </div>
      <div className="relative flex justify-center">
        {!last && <span className="absolute top-3 -bottom-5 w-0.5 bg-line" />}
        <span className={clsx("relative mt-1 size-3 rounded-full", dot)} />
      </div>
      <div className="min-w-0">{children}</div>
    </li>
  );
}
