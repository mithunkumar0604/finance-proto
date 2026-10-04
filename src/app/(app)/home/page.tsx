"use client";

import { clsx } from "clsx";
import { AlertTriangle, ArrowUpRight, Bell, CalendarClock, CalendarDays, HandCoins, Landmark, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { DueList } from "@/components/collections/due-row";
import { SearchTrigger } from "@/components/layout/search-overlay";
import { useUI } from "@/components/layout/ui-context";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Card, EmptyState, SectionHeader } from "@/components/ui/bits";
import { Button, LinkButton } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { dHeading, money, moneyShort, todayISO } from "@/lib/format";
import { badge, moneyOutside, overdueRows, permissions, todayRows, todaySummary, toCollectRows, tomorrowRows, upcomingRows } from "@/lib/selectors";
import { useAppState } from "@/lib/store";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

export default function HomePage() {
  const s = useAppState();
  const ui = useUI();
  const today = todayISO();
  const perm = permissions(s);
  const [notif, setNotif] = useState(false);

  const sum = todaySummary(s, today);
  const dueToday = todayRows(s, today).filter((r) => r.due.dueDate === today && r.remaining > 0);
  const overdue = overdueRows(s, today);
  const tomorrow = tomorrowRows(s, today);
  const week = upcomingRows(s, today, 7);
  const toCollect = toCollectRows(s, today);
  const activeLoans = s.loans.filter((l) => {
    const c = s.customers.find((x) => x.id === l.customerId);
    return l.status === "active" && !!c && perm.customerScope(c);
  }).length;
  const outside = moneyOutside(s);
  const progress = sum.expected ? sum.dueReceived / sum.expected : 0;

  const stats = [
    { label: "Due Today", value: dueToday.length, href: "/collections/?tab=today", icon: CalendarDays, tone: "text-brand-700 bg-brand-50" },
    { label: "Overdue", value: overdue.length, href: "/collections/?tab=overdue", icon: AlertTriangle, tone: "text-rose-700 bg-rose-50" },
    { label: "Tomorrow", value: tomorrow.length, href: "/collections/?tab=tomorrow", icon: CalendarClock, tone: "text-indigo-700 bg-indigo-50" },
    { label: "Active Loans", value: activeLoans, href: "/loans/", icon: Landmark, tone: "text-amber-800 bg-amber-50" },
  ];

  return (
    <div className="pb-4">
      {/* Greeting */}
      <header className="flex items-center gap-3 pt-[max(16px,env(safe-area-inset-top))] pb-4 md:pt-0">
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold tracking-tight md:text-3xl">{greeting()}</p>
          <p className="text-[15px] text-muted">{dHeading(today)}</p>
        </div>
        <button type="button" onClick={() => setNotif(true)} aria-label="Notifications" className="relative grid size-11 place-items-center rounded-full border border-line bg-surface text-ink-2">
          <Bell className="size-5" />
          {overdue.length > 0 && <span className="absolute top-2.5 right-2.5 size-2.5 rounded-full bg-rose-500 ring-2 ring-surface" />}
        </button>
        <Link href="/more/" aria-label="Profile" className="grid size-11 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white md:hidden">
          {badge(s).initials}
        </Link>
      </header>

      <SearchTrigger onClick={ui.openSearch} className="mb-5" />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px] lg:gap-8">
        <div className="min-w-0 space-y-5">
          {/* Today's collection */}
          <section className="relative overflow-hidden rounded-[28px] bg-[radial-gradient(130%_120%_at_0%_0%,#10745b_0%,#083f33_70%)] p-5 text-white shadow-[0_18px_40px_-20px_rgba(8,63,51,.8)] md:p-7">
            <div className="flex items-start justify-between">
              <p className="text-[15px] font-semibold text-white/75">Today&apos;s Collection</p>
              <Link href="/collections/?tab=today" className="-mt-1 -mr-1 grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Open collections">
                <ArrowUpRight className="size-4.5" />
              </Link>
            </div>
            <p className="mt-1 flex items-baseline gap-2">
              <AnimatedMoney value={sum.expected} className="num text-[40px] leading-tight font-extrabold tracking-tight md:text-5xl" />
              <span className="text-white/65">expected</span>
            </p>
            <div className="mt-5 text-emerald-300">
              <Progress value={progress} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm text-white/70">
                  <span className="size-2 rounded-full bg-emerald-300" /> Collected
                </p>
                <AnimatedMoney value={sum.dueReceived} className="num mt-0.5 block text-2xl font-bold" />
              </div>
              <div>
                <p className="flex items-center gap-2 text-sm text-white/70">
                  <span className="size-2 rounded-full bg-white/35" /> Pending
                </p>
                <AnimatedMoney value={sum.pending} className="num mt-0.5 block text-2xl font-bold" />
              </div>
            </div>
            {sum.extra > 0 && (
              <p className="mt-4 rounded-xl bg-white/10 px-3 py-2 text-[13px] text-white/85">
                + <b className="num">{money(sum.extra)}</b> more received today (overdue &amp; extra principal) · Total cash in <b className="num">{money(sum.collected)}</b>
              </p>
            )}
          </section>

          {/* Quick counts */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map((t) => (
              <Link key={t.label} href={t.href} className="group rounded-3xl border border-line bg-surface p-4 transition hover:border-faint active:scale-[0.98]">
                <span className={clsx("grid size-9 place-items-center rounded-xl", t.tone)}>
                  <t.icon className="size-4.5" />
                </span>
                <p className="num mt-3 text-[28px] leading-none font-extrabold tracking-tight">{t.value}</p>
                <p className="mt-1.5 text-sm font-medium text-muted">{t.label}</p>
              </Link>
            ))}
          </div>

          {/* Primary actions (mobile/tablet) */}
          <div className="grid grid-cols-2 gap-3 lg:hidden">
            {perm.receive && (
              <Button size="lg" onClick={() => ui.openPayment()} className="h-15">
                <HandCoins className="size-5" /> Receive Payment
              </Button>
            )}
            {perm.createLoan && (
              <LinkButton href="/loans/new/" size="lg" variant="secondary" className="h-15">
                <Plus className="size-5" /> New Loan
              </LinkButton>
            )}
          </div>

          {/* To collect */}
          <section>
            <SectionHeader title="Today's Collections" href="/collections/?tab=today" />
            <DueList
              rows={toCollect.slice(0, 6)}
              canReceive={perm.receive}
              empty={
                <Card>
                  <EmptyState icon={Wallet} title="All collected for today" text="Nothing pending. Nice work." />
                </Card>
              }
            />
            {toCollect.length > 6 && (
              <Link href="/collections/?tab=today" className="mt-3 flex h-12 items-center justify-center rounded-2xl border border-dashed border-line text-sm font-semibold text-brand-700 hover:bg-brand-50">
                View all {toCollect.length} to collect
              </Link>
            )}
          </section>
        </div>

        {/* Right column */}
        <aside className="space-y-5">
          <div className="hidden gap-3 lg:grid">
            {perm.receive && (
              <Button size="lg" onClick={() => ui.openPayment()}>
                <HandCoins className="size-5" /> Receive Payment
              </Button>
            )}
            {perm.createLoan && (
              <LinkButton href="/loans/new/" size="lg" variant="secondary">
                <Plus className="size-5" /> New Loan
              </LinkButton>
            )}
          </div>

          <section>
            <SectionHeader title="Upcoming" href="/collections/?tab=upcoming" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-1">
              <UpcomingCard href="/collections/?tab=tomorrow" label="Tomorrow" count={tomorrow.filter((r) => r.remaining > 0).length} amount={tomorrow.reduce((a, r) => a + r.remaining, 0)} />
              <UpcomingCard href="/collections/?tab=upcoming" label="This Week" count={week.length} amount={week.reduce((a, r) => a + r.remaining, 0)} />
            </div>
          </section>

          {perm.seeTotals && (
            <Link href="/reports/" className="block rounded-3xl border border-line bg-surface p-5 transition hover:border-faint">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-muted">Money Outside</p>
                <ArrowUpRight className="size-4.5 text-faint" />
              </div>
              <AnimatedMoney value={outside} className="num mt-1 block text-[28px] font-extrabold tracking-tight" />
              <p className="mt-1 text-sm text-muted">
                Principal with customers · {activeLoans} loans · {moneyShort(outside)}
              </p>
            </Link>
          )}
        </aside>
      </div>

      <Sheet open={notif} onClose={() => setNotif(false)} title="Notifications">
        <div className="space-y-2.5 pb-4">
          {overdue.slice(0, 3).map((r) => (
            <Link key={r.due.id} href={`/loan/?id=${r.loan.id}`} onClick={() => setNotif(false)} className="flex gap-3 rounded-2xl border border-line p-3.5 hover:bg-line-2">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700">
                <AlertTriangle className="size-5" />
              </span>
              <span className="text-[15px]">
                <b>{r.customer.name}</b> is {r.daysLate} days late · <span className="num font-semibold">{money(r.remaining)}</span> pending
              </span>
            </Link>
          ))}
          <div className="flex gap-3 rounded-2xl border border-line p-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
              <CalendarClock className="size-5" />
            </span>
            <span className="text-[15px]">
              <b>{tomorrow.length} payments</b> due tomorrow · <span className="num font-semibold">{money(tomorrow.reduce((a, r) => a + r.remaining, 0))}</span>
            </span>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function Progress({ value }: { value: number }) {
  return (
    <div className="h-3 overflow-hidden rounded-full bg-white/15">
      <div className="h-full rounded-full bg-current transition-[width] duration-700 ease-out" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  );
}

function UpcomingCard({ href, label, count, amount }: { href: string; label: string; count: number; amount: number }) {
  return (
    <Link href={href} className="flex flex-col rounded-3xl border border-line bg-surface p-4 transition hover:border-faint lg:flex-row lg:items-center lg:justify-between">
      <div>
        <p className="text-sm font-semibold text-muted">{label}</p>
        <p className="num mt-1 text-xl font-extrabold tracking-tight">{money(amount)}</p>
      </div>
      <p className="mt-1 text-sm text-muted lg:mt-0">
        {count} {count === 1 ? "payment" : "payments"}
      </p>
    </Link>
  );
}
