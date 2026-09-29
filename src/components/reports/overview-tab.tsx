"use client";

import { clsx } from "clsx";
import { History } from "lucide-react";
import { useState } from "react";
import { Card } from "@/components/ui/bits";
import { money, moneyShort } from "@/lib/format";
import { overviewReport, receivedTrend, type DateRange } from "@/lib/reports";
import { TYPE_GROUPS } from "@/lib/selectors";
import type { AppState } from "@/lib/store";
import { MiniStat, SectionTitle, SumTile } from "./shared";

// Chart palette validated with the dataviz validator (CVD ΔE 9.3, contrast >= 3:1 on white).
const C_INTEREST = "#0e8a6a";
const C_PRINCIPAL = "#c47f12";

export type ReportTab = "overview" | "interest" | "position" | "overdue" | "settlements" | "closed";

export function OverviewTab({ s, today, range, go }: { s: AppState; today: string; range: DateRange; go: (t: ReportTab) => void }) {
  const o = overviewReport(s, today, range);
  const active = s.loans.filter((l) => l.status === "active");
  const byType = TYPE_GROUPS.map((g) => {
    const ls = active.filter((l) => g.types.includes(l.type));
    return { ...g, count: ls.length, outside: ls.reduce((a, l) => a + l.principalLeft, 0) };
  }).sort((a, b) => b.outside - a.outside);
  const maxType = Math.max(1, ...byType.map((t) => t.outside));

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Business summary · {range.label}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <SumTile hero label="Money Outside" value={o.moneyOutside} sub="Principal with customers" />
          <button type="button" onClick={() => go("interest")} className="text-left">
            <SumTile label="Interest Expected" value={o.interestExpected} sub="Due in this period" />
          </button>
          <button type="button" onClick={() => go("interest")} className="text-left">
            <SumTile label="Interest Collected" value={o.interestCollected} tone="text-emerald-700" sub="Received (by payment date)" />
          </button>
          <button type="button" onClick={() => go("interest")} className="text-left">
            <SumTile label="Interest Pending" value={o.interestPending} tone="text-amber-700" sub="Still to collect" />
          </button>
          <button type="button" onClick={() => go("overdue")} className="text-left">
            <SumTile label="Overdue Customers" raw={o.overdueCustomers} tone={o.overdueCustomers ? "text-rose-700" : undefined} sub="Missed interest" />
          </button>
          <button type="button" onClick={() => go("position")} className="text-left">
            <SumTile label="Active Loans" raw={o.activeLoans} sub="Running today" />
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 divide-x divide-line-2 rounded-3xl border border-line bg-surface">
          <button type="button" onClick={() => go("settlements")} className="text-left hover:bg-line-2/50">
            <MiniStat label="Principal Received" value={moneyShort(o.principalReceived)} />
          </button>
          <button type="button" onClick={() => go("closed")} className="text-left hover:bg-line-2/50">
            <MiniStat label="Loans Closed" value={o.loansClosed} />
          </button>
          <MiniStat label="New Loans Given" value={moneyShort(o.newLoansAmount)} sub={`${o.newLoansCount} loans`} />
        </div>

        {o.backdatedCount > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-2xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <History className="mt-0.5 size-4 shrink-0" />
            <span>
              {o.backdatedCount} payment{o.backdatedCount > 1 ? "s" : ""} in this period {o.backdatedCount > 1 ? "were" : "was"} entered later (backdated). They are counted on the date the customer paid.
            </span>
          </p>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>Money received · 6 months</SectionTitle>
          <Card className="p-5">
            <Trend data={receivedTrend(s, today)} />
          </Card>
        </section>

        <section>
          <SectionTitle>Money outside by loan type</SectionTitle>
          <Card className="p-5">
            <div className="space-y-4">
              {byType.map((t) => (
                <div key={t.key}>
                  <div className="mb-1.5 flex items-baseline justify-between gap-3">
                    <span className="font-semibold">
                      {t.label} <span className="text-sm font-normal text-muted">· {t.count} loans</span>
                    </span>
                    <span className="num font-bold">{moneyShort(t.outside)}</span>
                  </div>
                  <div className="h-3 rounded-full bg-black/[0.05]">
                    <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.max(2, (t.outside / maxType) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}

/** Stacked monthly bars — interest (the day-to-day income) sits on the baseline. */
function Trend({ data }: { data: { label: string; interest: number; principal: number }[] }) {
  const [active, setActive] = useState(data.length - 1);
  const max = Math.max(1, ...data.map((d) => d.interest + d.principal));
  const cur = data[active];
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-[13px] text-muted">{cur.label}</p>
          <p className="num text-2xl font-extrabold tracking-tight">{money(cur.interest + cur.principal)}</p>
        </div>
        <div className="flex gap-4 text-[13px] text-ink-2">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: C_INTEREST }} /> Interest <b className="num">{moneyShort(cur.interest)}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: C_PRINCIPAL }} /> Principal <b className="num">{moneyShort(cur.principal)}</b>
          </span>
        </div>
      </div>
      <div className="flex h-44 items-end gap-3 border-b border-line">
        {data.map((d, i) => {
          const total = d.interest + d.principal;
          return (
            <button
              key={d.label}
              type="button"
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={`${d.label}: ${money(total)}`}
              className="group flex h-full flex-1 flex-col justify-end"
            >
              <div className={clsx("flex flex-col gap-[2px] transition-opacity", i === active ? "opacity-100" : "opacity-55 group-hover:opacity-80")} style={{ height: `${(total / max) * 100}%` }}>
                {d.principal > 0 && <div className="rounded-t-[4px]" style={{ background: C_PRINCIPAL, flex: d.principal }} />}
                <div className={d.principal > 0 ? "" : "rounded-t-[4px]"} style={{ background: C_INTEREST, flex: d.interest || 0.0001 }} />
              </div>
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex gap-3">
        {data.map((d, i) => (
          <span key={d.label} className={clsx("flex-1 text-center text-xs font-semibold", i === active ? "text-ink" : "text-muted")}>
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
