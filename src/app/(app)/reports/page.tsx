"use client";

import { clsx } from "clsx";
import { ChevronRight, Lock } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DueList } from "@/components/collections/due-row";
import { PageHeader } from "@/components/layout/page-header";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Card, EmptyState, SectionHeader } from "@/components/ui/bits";
import { Sheet } from "@/components/ui/sheet";
import { money, moneyShort, todayISO } from "@/lib/format";
import { permissions, reports, type RegisterRow } from "@/lib/selectors";
import { useAppState } from "@/lib/store";

// Chart palette validated with the dataviz validator (CVD ΔE 9.3, contrast >= 3:1 on white).
const C_PRINCIPAL = "#0e8a6a";
const C_INTEREST = "#c47f12";
// Aging: one hue, light -> dark as lateness grows.
const AGING_RAMP = ["#f4a8b4", "#e5677f", "#c9304f", "#8f1631"];

export default function ReportsPage() {
  const s = useAppState();
  const today = todayISO();
  const r = reports(s, today);
  const [drill, setDrill] = useState<{ title: string; rows: RegisterRow[] } | null>(null);

  if (!permissions(s).seeReports)
    return (
      <>
        <PageHeader title="Reports" />
        <Card>
          <EmptyState icon={Lock} title="Owner only" text="Reports are visible to the owner. Switch back to Owner to view them." />
        </Card>
      </>
    );

  const receivedPct = r.expected ? r.received / r.expected : 0;
  const maxType = Math.max(1, ...r.byType.map((t) => t.outside));
  const maxAging = Math.max(1, ...r.aging.map((a) => a.amount));

  return (
    <div>
      <PageHeader title="Reports" subtitle={`${r.monthLabel} · month so far`} />

      {/* Overview */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Money Outside" value={r.moneyOutside} sub={`${r.activeLoans} active loans`} hero />
        <Tile label="Interest Collected" value={r.interestThisMonth} sub="This month" />
        <Tile label="Principal Collected" value={r.principalThisMonth} sub="This month" />
        <Tile label="New Money Given" value={r.newMoneyGiven} sub="This month" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Collections this month */}
        <section>
          <SectionHeader title={`Collections · ${r.monthLabel}`} href="/collections/" action="Register" />
          <Card className="p-5">
            <div className="grid grid-cols-3 gap-3">
              <Fig label="Expected" value={r.expected} />
              <Fig label="Received" value={r.received} tone="text-emerald-700" />
              <Fig label="Pending" value={r.pending} tone="text-amber-700" />
            </div>
            <div className="mt-5 flex h-4 gap-0.5 overflow-hidden rounded-md" role="img" aria-label={`${Math.round(receivedPct * 100)}% received`}>
              <div className="rounded-l-md bg-emerald-600" style={{ width: `${receivedPct * 100}%` }} />
              <div className="flex-1 rounded-r-md bg-amber-200" />
            </div>
            <p className="mt-2 text-sm text-muted">
              <b className="text-ink">{Math.round(receivedPct * 100)}%</b> of this month&apos;s dues received
            </p>
            <Link href="/collections/?tab=overdue" className="mt-4 flex items-center justify-between rounded-2xl bg-rose-50 px-4 py-3 text-rose-800 hover:bg-rose-100">
              <span className="text-sm font-semibold">Overdue now · {r.overdueCustomers} customers</span>
              <span className="num flex items-center gap-1 font-extrabold">
                {money(r.overdueTotal)} <ChevronRight className="size-4" />
              </span>
            </Link>
          </Card>
        </section>

        {/* Trend */}
        <section>
          <SectionHeader title="Money Received · 6 months" />
          <Card className="p-5">
            <Trend data={r.trend} />
          </Card>
        </section>

        {/* Breakdown */}
        <section>
          <SectionHeader title="Money Outside by Loan Type" />
          <Card className="p-5">
            <div className="space-y-4">
              {[...r.byType]
                .sort((a, b) => b.outside - a.outside)
                .map((t) => (
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

        {/* Aging */}
        <section>
          <SectionHeader title="Overdue Aging" />
          <Card className="divide-y divide-line-2 overflow-hidden">
            {r.aging.map((a, i) => (
              <button
                key={a.key}
                type="button"
                disabled={!a.rows.length}
                onClick={() => setDrill({ title: `Overdue ${a.label}`, rows: a.rows })}
                className="flex w-full items-center gap-4 px-5 py-4 text-left transition hover:bg-line-2/60 disabled:opacity-60"
              >
                <div className="w-24 shrink-0">
                  <p className="font-bold">{a.label}</p>
                  <p className="text-sm text-muted">
                    <span className="num font-semibold text-ink">{a.customers}</span> customer{a.customers === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="h-3 flex-1 rounded-full bg-black/[0.05]">
                  <div className="h-full rounded-full" style={{ width: `${a.amount ? Math.max(4, (a.amount / maxAging) * 100) : 0}%`, background: AGING_RAMP[i] }} />
                </div>
                <span className="num w-20 shrink-0 text-right font-bold">{moneyShort(a.amount)}</span>
                <ChevronRight className="size-4 shrink-0 text-faint" />
              </button>
            ))}
          </Card>
          <p className="mt-2 px-1 text-xs text-muted">Tap a row to see those customers.</p>
        </section>
      </div>

      <Sheet open={!!drill} onClose={() => setDrill(null)} title={drill?.title} subtitle={drill ? `${drill.rows.length} payments · ${money(drill.rows.reduce((a, x) => a + x.remaining, 0))}` : undefined}>
        <div className="pb-4">{drill && <DueList rows={drill.rows} />}</div>
      </Sheet>
    </div>
  );
}

function Tile({ label, value, sub, hero }: { label: string; value: number; sub: string; hero?: boolean }) {
  return (
    <div className={clsx("rounded-3xl p-4 md:p-5", hero ? "bg-[radial-gradient(130%_120%_at_0%_0%,#10745b_0%,#083f33_70%)] text-white" : "border border-line bg-surface")}>
      <p className={clsx("text-[13px] font-semibold", hero ? "text-white/70" : "text-muted")}>{label}</p>
      <AnimatedMoney value={value} short className="num mt-1 block text-[26px] leading-tight font-extrabold tracking-tight md:text-3xl" />
      <p className={clsx("mt-1 text-[13px]", hero ? "text-white/60" : "text-muted")}>{sub}</p>
    </div>
  );
}

function Fig({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-muted">{label}</p>
      <p className={clsx("num truncate text-xl font-extrabold tracking-tight", tone)}>{moneyShort(value)}</p>
    </div>
  );
}

/** Stacked monthly bars (principal + interest) with a tap/hover tooltip. */
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
            <span className="size-2.5 rounded-sm" style={{ background: C_PRINCIPAL }} /> Principal <b className="num">{moneyShort(cur.principal)}</b>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: C_INTEREST }} /> Interest <b className="num">{moneyShort(cur.interest)}</b>
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
                <div className="rounded-t-[4px]" style={{ background: C_INTEREST, flex: d.interest || 0.0001 }} />
                <div style={{ background: C_PRINCIPAL, flex: d.principal || 0.0001 }} />
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
