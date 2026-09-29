"use client";

import { ChevronRight, FileSearch } from "lucide-react";
import { Avatar, Card, EmptyState } from "@/components/ui/bits";
import { dShort, LOAN_TYPE_LABEL, money } from "@/lib/format";
import type { RegisterLine } from "@/lib/reports";
import type { ReportDoc } from "@/lib/report-pdf";
import { pdfMoney } from "@/lib/report-pdf";
import { StatusLabel, statusText } from "./bits";

const d = (iso?: string) => (iso ? dShort(iso) : "—");

/** All People: a simple register, one line per loan. Tap a line to open that person. */
export function RegisterView({ lines, onPerson }: { lines: RegisterLine[]; onPerson: (id: string) => void }) {
  if (!lines.length)
    return (
      <Card>
        <EmptyState icon={FileSearch} title="Nobody in this report" text="Try another period or choose All in Show." />
      </Card>
    );

  return (
    <>
      {/* Phone: one card per person-loan, no sideways scrolling */}
      <div className="space-y-2.5 md:hidden">
        {lines.map((l) => (
          <button key={l.loan.id} type="button" onClick={() => onPerson(l.customer.id)} className="block w-full rounded-3xl border border-line bg-surface p-4 text-left active:scale-[0.99]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-[17px] font-bold">{l.customer.name}</p>
                <p className="truncate text-[13px] text-muted">
                  {LOAN_TYPE_LABEL[l.loan.type]} · {l.loan.id}
                </p>
              </div>
              <StatusLabel status={l.status} />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2.5 rounded-2xl bg-line-2/70 p-3">
              <Cell label="Loan" value={money(l.loan.amount)} />
              <Cell label="Interest" value={money(l.interest)} />
              <Cell label="Paid" value={money(l.paid)} tone={l.paid ? "text-emerald-700" : undefined} />
              <Cell label="Pending" value={money(l.pending)} tone={l.pending ? (l.status === "overdue" ? "text-rose-700" : "text-amber-700") : undefined} />
              <Cell label="Principal Left" value={money(l.loan.principalLeft)} strong />
              <Cell label="Last Paid" value={d(l.lastPaid)} />
            </div>
            {l.nextDue && <p className="mt-2 px-1 text-[13px] text-muted">Next due {d(l.nextDue)}</p>}
          </button>
        ))}
      </div>

      {/* Tablet / desktop: one readable table */}
      <Card className="hidden overflow-hidden md:block">
        <table className="w-full text-left text-[15px]">
          <thead className="border-b border-line bg-line-2/60 text-xs font-bold tracking-[0.04em] text-muted uppercase">
            <tr>
              <th className="py-3.5 pr-2 pl-5">Person</th>
              <Th>Loan Amount</Th>
              <Th>Interest</Th>
              <Th>Paid</Th>
              <Th>Pending</Th>
              <Th>Principal Left</Th>
              <th className="px-2 py-3.5">Last Paid</th>
              <th className="px-2 py-3.5">Next Due</th>
              <th className="px-2 py-3.5">Status</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line-2">
            {lines.map((l) => (
              <tr key={l.loan.id} onClick={() => onPerson(l.customer.id)} className="cursor-pointer hover:bg-line-2/50">
                <td className="py-3.5 pr-2 pl-5">
                  <div className="flex items-center gap-3">
                    <Avatar name={l.customer.name} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{l.customer.name}</p>
                      <p className="truncate text-xs text-muted">{LOAN_TYPE_LABEL[l.loan.type]}</p>
                    </div>
                  </div>
                </td>
                <Td>{money(l.loan.amount)}</Td>
                <Td>{money(l.interest)}</Td>
                <Td className={l.paid ? "text-emerald-700" : "text-muted"}>{money(l.paid)}</Td>
                <Td className={l.pending ? (l.status === "overdue" ? "font-bold text-rose-700" : "font-bold text-amber-700") : "text-muted"}>{money(l.pending)}</Td>
                <Td className="font-bold">{money(l.loan.principalLeft)}</Td>
                <td className="num px-2 py-3.5 whitespace-nowrap">{d(l.lastPaid)}</td>
                <td className="num px-2 py-3.5 whitespace-nowrap">{d(l.nextDue)}</td>
                <td className="px-2 py-3.5">
                  <StatusLabel status={l.status} />
                </td>
                <td className="pr-4 text-faint">
                  <ChevronRight className="size-4" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function Th({ children }: { children: string }) {
  return <th className="px-2 py-3.5 text-right whitespace-nowrap">{children}</th>;
}

function Td({ children, className }: { children: string; className?: string }) {
  return <td className={`num px-2 py-3.5 text-right whitespace-nowrap ${className ?? ""}`}>{children}</td>;
}

function Cell({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <p className={`num truncate text-[14px] ${strong ? "font-extrabold" : "font-semibold"} ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

/** Same register, as a printable document. */
export function registerDoc(lines: RegisterLine[]): Pick<ReportDoc, "head" | "body" | "rightCols" | "statusCol" | "landscape"> {
  return {
    landscape: true,
    head: ["Person", "Loan Amount", "Interest", "Paid", "Pending", "Principal Left", "Last Paid", "Next Due", "Status"],
    body: lines.map((l) => [
      `${l.customer.name}\n${LOAN_TYPE_LABEL[l.loan.type]} · ${l.loan.id}`,
      pdfMoney(l.loan.amount),
      pdfMoney(l.interest),
      pdfMoney(l.paid),
      pdfMoney(l.pending),
      pdfMoney(l.loan.principalLeft),
      d(l.lastPaid),
      d(l.nextDue),
      statusText(l.status),
    ]),
    rightCols: [1, 2, 3, 4, 5],
    statusCol: 8,
  };
}
