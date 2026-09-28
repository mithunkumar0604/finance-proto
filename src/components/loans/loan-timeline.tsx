"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { dueTotal } from "@/lib/demo-calculations";
import { dLong, dShort, METHOD_LABEL, money } from "@/lib/format";
import type { Due, Loan, Payment } from "@/lib/types";

/** Vertical history: money given → each payment (with split) → where principal stands now. */
export function LoanTimeline({ loan, payments, next }: { loan: Loan; payments: Payment[]; next?: Due }) {
  const items = payments.reduce<{ p: Payment; after: number }[]>(
    (acc, p) => [...acc, { p, after: (acc.at(-1)?.after ?? loan.amount) - p.principal }],
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
          </Item>
        );
      })}

      <Item dot="bg-brand-700 ring-4 ring-brand-100" date="Now" last={!next}>
        <div className="flex items-baseline justify-between gap-3 rounded-2xl bg-brand-50 px-3 py-2.5">
          <p className="font-bold text-brand-800">{loan.status === "closed" ? "Loan Closed" : "Current Principal"}</p>
          <p className="num text-lg font-extrabold text-brand-800">{money(loan.principalLeft)}</p>
        </div>
      </Item>

      {next && (
        <Item dot="border-2 border-dashed border-faint bg-surface" date={dShort(next.dueDate)} year={next.dueDate.slice(0, 4)} last muted>
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-semibold text-muted">Next Collection</p>
            <p className="num font-bold text-muted">{money(dueTotal(next) - next.paid)}</p>
          </div>
          <p className="text-[13px] text-faint">Expected {dLong(next.dueDate)}</p>
        </Item>
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
