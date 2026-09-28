"use client";

import { CalendarCheck2, PartyPopper } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { DueList } from "@/components/collections/due-row";
import { PageHeader } from "@/components/layout/page-header";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Card, EmptyState, FilterChips, Segmented, Skeleton } from "@/components/ui/bits";
import { dHeading, dShort, money, shiftISO, todayISO } from "@/lib/format";
import { overdueRows, permissions, TYPE_GROUPS, todayRows, tomorrowRows, upcomingRows, type RegisterRow } from "@/lib/selectors";
import { useAppState } from "@/lib/store";

type Tab = "today" | "tomorrow" | "overdue" | "upcoming";
const TABS: Tab[] = ["today", "tomorrow", "overdue", "upcoming"];

export default function CollectionsPage() {
  return (
    <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
      <Collections />
    </Suspense>
  );
}

function Collections() {
  const s = useAppState();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();
  const perm = permissions(s);
  const tabParam = params.get("tab") as Tab | null;
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : "today";
  const [type, setType] = useState("all");

  const lists: Record<Tab, RegisterRow[]> = {
    today: todayRows(s, today),
    tomorrow: tomorrowRows(s, today),
    overdue: overdueRows(s, today),
    upcoming: upcomingRows(s, today, 30),
  };
  const group = TYPE_GROUPS.find((g) => g.key === type);
  const rows = lists[tab].filter((r) => !group || group.types.includes(r.loan.type));

  const expected = rows.filter((r) => r.status !== "rescheduled").reduce((a, r) => a + r.total, 0);
  const remaining = rows.filter((r) => r.status !== "rescheduled").reduce((a, r) => a + r.remaining, 0);
  const collected = expected - remaining;

  const setTab = (t: Tab) => router.replace(`/collections/?tab=${t}`, { scroll: false });

  const typeOptions = [
    { value: "all", label: "All", count: lists[tab].length },
    ...TYPE_GROUPS.map((g) => ({ value: g.key, label: g.label, count: lists[tab].filter((r) => g.types.includes(r.loan.type)).length })),
  ];

  return (
    <div>
      <PageHeader title="Collections" subtitle={dHeading(today)} back={false} />

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "today", label: "Today", count: lists.today.filter((r) => r.remaining > 0 && r.status !== "rescheduled").length },
          { value: "tomorrow", label: "Tomorrow" },
          { value: "overdue", label: "Overdue", count: lists.overdue.length },
          { value: "upcoming", label: "Upcoming" },
        ]}
      />

      {/* Totals for this tab */}
      <div className="mt-4 grid grid-cols-3 overflow-hidden rounded-3xl border border-line bg-surface">
        {tab === "overdue" ? (
          <>
            <Tot label="Overdue" value={remaining} tone="text-rose-700" />
            <Tot label="Customers" raw={String(new Set(rows.map((r) => r.customer.id)).size)} />
            <Tot label="Part paid" value={collected} tone="text-amber-700" />
          </>
        ) : tab === "upcoming" ? (
          <>
            <Tot label="Next 30 days" value={remaining} />
            <Tot label="Payments" raw={String(rows.length)} />
            <Tot label="This week" value={rows.filter((r) => r.due.dueDate <= shiftISO(today, 7)).reduce((a, r) => a + r.remaining, 0)} />
          </>
        ) : (
          <>
            <Tot label="Expected" value={expected} />
            <Tot label="Collected" value={collected} tone="text-emerald-700" />
            <Tot label="Remaining" value={remaining} tone={remaining ? "text-amber-700" : "text-ink"} />
          </>
        )}
      </div>
      {tab !== "upcoming" && tab !== "overdue" && expected > 0 && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/[0.06]">
          <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-700" style={{ width: `${(collected / expected) * 100}%` }} />
        </div>
      )}

      <FilterChips className="mt-4" options={typeOptions} value={type} onChange={setType} />

      <div className="mt-4">
        {tab === "upcoming" ? (
          <UpcomingGrouped rows={rows} canReceive={perm.receive} today={today} />
        ) : (
          <DueList
            rows={rows}
            canReceive={perm.receive}
            showMove={perm.receive}
            empty={
              <Card>
                {tab === "overdue" ? (
                  <EmptyState icon={PartyPopper} title="No overdue payments" text="Everyone is up to date." />
                ) : (
                  <EmptyState icon={CalendarCheck2} title="Nothing here" text="No collections match this filter." />
                )}
              </Card>
            }
          />
        )}
      </div>
    </div>
  );
}

function Tot({ label, value, raw, tone = "text-ink" }: { label: string; value?: number; raw?: string; tone?: string }) {
  return (
    <div className="border-r border-line-2 p-3.5 last:border-0 md:p-5">
      <p className="text-[13px] text-muted">{label}</p>
      {raw !== undefined ? (
        <p className={`num mt-0.5 text-lg font-extrabold md:text-2xl ${tone}`}>{raw}</p>
      ) : (
        <AnimatedMoney value={value ?? 0} className={`num mt-0.5 block text-[17px] font-extrabold tracking-tight md:text-2xl ${tone}`} />
      )}
    </div>
  );
}

function UpcomingGrouped({ rows, canReceive, today }: { rows: RegisterRow[]; canReceive: boolean; today: string }) {
  if (!rows.length)
    return (
      <Card>
        <EmptyState icon={CalendarCheck2} title="Nothing upcoming" />
      </Card>
    );
  const byDate = new Map<string, RegisterRow[]>();
  rows.forEach((r) => byDate.set(r.due.dueDate, [...(byDate.get(r.due.dueDate) ?? []), r]));
  return (
    <div className="space-y-5">
      {[...byDate.entries()].map(([date, list]) => (
        <section key={date}>
          <div className="mb-2 flex items-baseline justify-between px-1">
            <h3 className="font-bold">
              {date === shiftISO(today, 1) ? "Tomorrow" : dShort(date)}{" "}
              <span className="font-medium text-muted">· {new Date(date + "T00:00").toLocaleDateString("en-IN", { weekday: "long" })}</span>
            </h3>
            <span className="num text-sm font-semibold text-muted">{money(list.reduce((a, r) => a + r.remaining, 0))}</span>
          </div>
          <DueList rows={list} canReceive={canReceive} />
        </section>
      ))}
    </div>
  );
}
