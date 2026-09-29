"use client";

import { clsx } from "clsx";
import { CalendarRange, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { ClosedTab } from "@/components/reports/closed-tab";
import { InterestTab } from "@/components/reports/interest-tab";
import { OverdueTab } from "@/components/reports/overdue-tab";
import { OverviewTab, type ReportTab } from "@/components/reports/overview-tab";
import { PositionTab } from "@/components/reports/position-tab";
import { SettlementsTab } from "@/components/reports/settlements-tab";
import { Card, EmptyState, Skeleton } from "@/components/ui/bits";
import { todayISO } from "@/lib/format";
import { RANGE_OPTIONS, rangeFor, type RangeKey } from "@/lib/reports";
import { permissions } from "@/lib/selectors";
import { useAppState } from "@/lib/store";

const TABS: { value: ReportTab; label: string; dated: boolean }[] = [
  { value: "overview", label: "Overview", dated: true },
  { value: "interest", label: "Interest", dated: true },
  { value: "position", label: "Loan Position", dated: false },
  { value: "overdue", label: "Overdue", dated: false },
  { value: "settlements", label: "Settlements", dated: true },
  { value: "closed", label: "Closed", dated: true },
];

export default function ReportsPage() {
  return (
    <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
      <Reports />
    </Suspense>
  );
}

function Reports() {
  const s = useAppState();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();
  const pending = useRef<string | null>(null);
  useEffect(() => {
    pending.current = null; // the router has caught up
  }, [params]);

  const tabParam = params.get("tab") as ReportTab | null;
  const tab = TABS.find((t) => t.value === tabParam) ?? TABS[0];
  const rangeKey = (RANGE_OPTIONS.find((r) => r.value === params.get("range"))?.value ?? "month") as RangeKey;
  const range = rangeFor(rangeKey, today, { from: params.get("from"), to: params.get("to") });

  const update = (patch: Record<string, string | null>) => {
    // Build on the latest pending change: a quick second tap must not overwrite the first.
    const next = new URLSearchParams(pending.current ?? window.location.search);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    pending.current = next.toString();
    router.replace(`/reports/?${next.toString()}`, { scroll: false });
  };

  if (!permissions(s).seeReports)
    return (
      <>
        <PageHeader title="Reports" />
        <Card>
          <EmptyState icon={Lock} title="Owner only" text="Reports are visible to the owner. Switch back to Owner to view them." />
        </Card>
      </>
    );

  return (
    <div>
      <PageHeader title="Reports" subtitle={tab.dated ? range.label : "Current position · today"} />

      {/* Report tabs */}
      <div className="no-scrollbar sticky top-[calc(64px+env(safe-area-inset-top))] z-10 -mx-4 overflow-x-auto bg-canvas/90 px-4 pb-3 backdrop-blur-md md:static md:mx-0 md:bg-transparent md:px-0 md:backdrop-blur-none" role="tablist">
        <div className="flex w-max gap-1 rounded-2xl bg-black/[0.05] p-1">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab.value === t.value}
              onClick={() => update({ tab: t.value })}
              className={clsx(
                "h-10 rounded-xl px-3.5 text-sm font-semibold whitespace-nowrap transition",
                tab.value === t.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Period */}
      {tab.dated && (
        <div className="mb-5">
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
            {RANGE_OPTIONS.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => update({ range: r.value, ...(r.value === "custom" ? { from: range.from, to: range.to } : { from: null, to: null }) })}
                className={clsx(
                  "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition",
                  rangeKey === r.value ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-faint",
                )}
              >
                {r.value === "custom" && <CalendarRange className="size-4" />}
                {r.label}
              </button>
            ))}
          </div>
          {rangeKey === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:max-w-md">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">From</span>
                <input type="date" value={range.from} max={today} onChange={(e) => e.target.value && update({ from: e.target.value })} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[16px]" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-muted">To</span>
                <input type="date" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && update({ to: e.target.value })} className="h-11 w-full rounded-xl border border-line bg-surface px-3 text-[16px]" />
              </label>
            </div>
          )}
        </div>
      )}

      <div key={tab.value + range.from + range.to} className="animate-page">
        {tab.value === "overview" && <OverviewTab s={s} today={today} range={range} go={(t) => update({ tab: t })} />}
        {tab.value === "interest" && <InterestTab s={s} today={today} range={range} />}
        {tab.value === "position" && <PositionTab s={s} today={today} />}
        {tab.value === "overdue" && <OverdueTab s={s} today={today} />}
        {tab.value === "settlements" && <SettlementsTab s={s} range={range} />}
        {tab.value === "closed" && <ClosedTab s={s} range={range} />}
      </div>
    </div>
  );
}
