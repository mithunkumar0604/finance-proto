"use client";

import { ArrowLeft, BookOpen, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { Avatar, Card, EmptyState } from "@/components/ui/bits";
import { dLong, LOAN_TYPE_SHORT, money, phoneFmt } from "@/lib/format";
import type { LedgerEntry, personReport } from "@/lib/reports";
import { pdfMoney, type ReportDoc } from "@/lib/report-pdf";
import { Figures, StatusLabel, statusText } from "./bits";

type PersonData = NonNullable<ReturnType<typeof personReport>>;

/** One person's statement — reads like a page of the old paper ledger. */
export function PersonView({ data, onAllPeople }: { data: PersonData; onAllPeople: () => void }) {
  const { customer: c, loans, entries } = data;
  return (
    <div className="space-y-5">
      <Card className="p-4 md:p-5">
        <div className="flex items-start gap-4">
          <Avatar name={c.name} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-xl font-bold tracking-tight">{c.name}</p>
            <p className="num mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[15px] text-ink-2">
              <span className="flex items-center gap-1.5">
                <Phone className="size-4 text-muted" /> {phoneFmt(c.phone)}
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="size-4 text-muted" /> {c.area}
              </span>
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {loans.map((l) => (
                <Link key={l.id} href={`/loan/?id=${l.id}`} className="rounded-full bg-line-2 px-2.5 py-1 text-xs font-semibold text-ink-2 hover:bg-line">
                  Loan {l.id} · {LOAN_TYPE_SHORT[l.type]}
                  {l.status === "closed" ? " · Closed" : ""}
                </Link>
              ))}
            </div>
          </div>
        </div>
        <button type="button" onClick={onAllPeople} className="mt-4 flex h-9 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">
          <ArrowLeft className="size-4" /> Back to All People
        </button>
      </Card>

      <Figures figures={data.figures} />

      <section>
        <h2 className="mb-3 px-1 text-[13px] font-bold tracking-[0.08em] text-muted uppercase">History</h2>
        {entries.length === 0 ? (
          <Card>
            <EmptyState icon={BookOpen} title="Nothing in this period" text="Try This Year, or choose All in Show." />
          </Card>
        ) : (
          <Card className="overflow-hidden">
            {/* Phone: ledger lines */}
            <div className="divide-y divide-line-2 md:hidden">
              {entries.map((e, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <p className="num text-[13px] font-semibold text-muted">{dLong(e.date)}</p>
                    <p className="truncate font-bold">{e.details}</p>
                    {e.note && <p className="truncate text-xs text-faint">{e.note}</p>}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <p className="num font-extrabold">{money(e.amount)}</p>
                    <StatusLabel status={e.status} />
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop: Date · Details · Amount · Status */}
            <table className="hidden w-full text-left text-[15px] md:table">
              <thead className="border-b border-line bg-line-2/60 text-xs font-bold tracking-[0.04em] text-muted uppercase">
                <tr>
                  <th className="py-3.5 pr-2 pl-5">Date</th>
                  <th className="px-2 py-3.5">Details</th>
                  <th className="px-2 py-3.5 text-right">Amount</th>
                  <th className="py-3.5 pr-5 pl-6">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td className="num py-3.5 pr-2 pl-5 whitespace-nowrap">{dLong(e.date)}</td>
                    <td className="px-2 py-3.5">
                      <p className="font-semibold">{e.details}</p>
                      {e.note && <p className="text-xs text-faint">{e.note}</p>}
                    </td>
                    <td className="num px-2 py-3.5 text-right font-bold whitespace-nowrap">{money(e.amount)}</td>
                    <td className="py-3.5 pr-5 pl-6">
                      <StatusLabel status={e.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        <div className="mt-3 flex items-center justify-between rounded-3xl bg-brand-50 px-5 py-4">
          <span className="font-bold text-brand-800">Principal Left</span>
          <span className="num text-2xl font-extrabold text-brand-800">{money(data.principalLeft)}</span>
        </div>
      </section>
    </div>
  );
}

/** Same statement, as a printable document. */
export function personDoc(data: PersonData): Pick<ReportDoc, "person" | "head" | "body" | "rightCols" | "statusCol" | "footerTotal"> {
  return {
    person: {
      name: data.customer.name,
      phone: phoneFmt(data.customer.phone),
      area: data.customer.area,
      loans: data.loans.map((l) => l.id).join(", "),
    },
    head: ["Date", "Details", "Amount", "Status"],
    body: data.entries.map((e: LedgerEntry) => [dLong(e.date), e.note ? `${e.details}\n${e.note}` : e.details, pdfMoney(e.amount), statusText(e.status)]),
    rightCols: [2],
    statusCol: 3,
    footerTotal: { label: "Principal Left", value: pdfMoney(data.principalLeft) },
  };
}
