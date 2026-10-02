"use client";

import { ChevronRight, FileSearch } from "lucide-react";
import { Avatar, Card, EmptyState } from "@/components/ui/bits";
import { dShort, LOAN_TYPE_LABEL, money } from "@/lib/format";
import type { Mode, RegisterLine } from "@/lib/reports";
import type { ReportDoc } from "@/lib/report-pdf";
import { pdfMoney } from "@/lib/report-pdf";
import { StatusLabel, statusText } from "./bits";

const d = (iso?: string) => (iso ? dShort(iso) : "—");

interface Col {
  label: string;
  /** Short label for phone cards. */
  short?: string;
  value: (l: RegisterLine, m: (n: number) => string) => string;
  money?: boolean;
  tone?: (l: RegisterLine) => string;
}

const LOAN: Col = { label: "Loan Amount", short: "Loan", value: (l, m) => m(l.loan.amount), money: true };
const PRINCIPAL: Col = { label: "Principal Left", value: (l, m) => m(l.loan.principalLeft), money: true, tone: () => "font-bold" };
const UPCOMING: Col = { label: "Upcoming", value: (l, m) => m(l.upcoming), money: true, tone: (l) => (l.upcoming ? "text-indigo-700" : "text-muted") };

const PAST: Col[] = [
  LOAN,
  { label: "Interest", value: (l, m) => m(l.interest), money: true },
  { label: "Paid", value: (l, m) => m(l.paid), money: true, tone: (l) => (l.paid ? "text-emerald-700" : "text-muted") },
  { label: "Pending", value: (l, m) => m(l.pending), money: true, tone: (l) => (l.pending ? (l.status === "overdue" ? "font-bold text-rose-700" : "font-bold text-amber-700") : "text-muted") },
  PRINCIPAL,
  { label: "Last Paid", value: (l) => d(l.lastPaid) },
  { label: "Next Due", value: (l) => d(l.nextDue) },
];

/** Which columns suit the period: what happened, what is coming, or both. */
function columnsFor(mode: Mode): Col[] {
  if (mode === "future")
    return [
      LOAN,
      { label: "To Collect", value: (l, m) => m(l.upcoming), money: true, tone: () => "font-bold text-indigo-700" },
      { label: "Payments", value: (l) => String(l.upcomingCount) },
      { label: "First Due", value: (l) => d(l.firstUpcoming) },
      PRINCIPAL,
    ];
  if (mode === "mixed") return [...PAST.slice(0, 4), UPCOMING, ...PAST.slice(4)];
  return PAST;
}

/** All People: a simple register, one line per loan. Tap a line to open that person. */
export function RegisterView({ lines, mode, onPerson }: { lines: RegisterLine[]; mode: Mode; onPerson: (id: string) => void }) {
  if (!lines.length)
    return (
      <Card>
        <EmptyState icon={FileSearch} title="Nobody in this report" text={mode === "future" ? "For coming dates choose All or Upcoming in Show." : "Try another period or choose All in Show."} />
      </Card>
    );
  const cols = columnsFor(mode);

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
              {cols.map((c) => (
                <div key={c.label} className="min-w-0">
                  <p className="truncate text-[11px] text-muted">{c.short ?? c.label}</p>
                  <p className={`num truncate text-[14px] font-semibold ${c.tone?.(l) ?? ""}`}>{c.value(l, money)}</p>
                </div>
              ))}
            </div>
          </button>
        ))}
      </div>

      {/* Tablet / desktop: one readable table */}
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-[15px]">
          <thead className="border-b border-line bg-line-2/60 text-xs font-bold tracking-[0.04em] text-muted uppercase">
            <tr>
              <th className="py-3.5 pr-2 pl-5">Person</th>
              {cols.map((c) => (
                <th key={c.label} className={`px-2 py-3.5 whitespace-nowrap ${c.money ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
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
                {cols.map((c) => (
                  <td key={c.label} className={`num px-2 py-3.5 whitespace-nowrap ${c.money ? "text-right" : ""} ${c.tone?.(l) ?? ""}`}>
                    {c.value(l, money)}
                  </td>
                ))}
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

/** Same register, as a printable document. */
export function registerDoc(lines: RegisterLine[], mode: Mode): Pick<ReportDoc, "head" | "body" | "rightCols" | "statusCol" | "landscape"> {
  const cols = columnsFor(mode);
  return {
    landscape: true,
    head: ["Person", ...cols.map((c) => c.label), "Status"],
    body: lines.map((l) => [`${l.customer.name}\n${LOAN_TYPE_LABEL[l.loan.type]} · ${l.loan.id}`, ...cols.map((c) => c.value(l, pdfMoney)), statusText(l.status)]),
    rightCols: cols.map((c, i) => (c.money ? i + 1 : -1)).filter((i) => i > 0),
    statusCol: cols.length + 1,
  };
}
