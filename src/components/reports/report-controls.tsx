"use client";

import { clsx } from "clsx";
import { AlertTriangle, CalendarDays, CalendarRange, Clock, FileSearch } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { RANGE_OPTIONS, SHOW_OPTIONS, type RangeKey, type Show } from "@/lib/reports";
import type { Customer } from "@/lib/types";
import { PersonPicker } from "./person-picker";

export interface ReportChoice {
  person: string | null;
  range: RangeKey;
  from?: string;
  to?: string;
  show: Show;
}

/** Person / Period / Show + Show Report. Quick buttons apply straight away, on top of what is picked. */
export function ReportControls({
  applied,
  people,
  today,
  onApply,
}: {
  applied: ReportChoice;
  people: Customer[];
  today: string;
  onApply: (c: ReportChoice) => void;
}) {
  const [c, setC] = useState<ReportChoice>(applied);
  const changed = JSON.stringify(c) !== JSON.stringify(applied);

  const quick: { label: string; icon: ReactNode; next: ReportChoice; on: boolean }[] = [
    { label: "Today", icon: <Clock className="size-4" />, next: { ...c, range: "today", from: undefined, to: undefined }, on: applied.range === "today" },
    { label: "This Month", icon: <CalendarDays className="size-4" />, next: { ...c, range: "month", from: undefined, to: undefined }, on: applied.range === "month" },
    { label: "Pending", icon: <FileSearch className="size-4" />, next: { ...c, show: "pending" }, on: applied.show === "pending" },
    { label: "Overdue", icon: <AlertTriangle className="size-4" />, next: { ...c, show: "overdue" }, on: applied.show === "overdue" },
  ];

  return (
    <Card className="p-4 md:p-5">
      {/* Quick reports */}
      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {quick.map((q) => (
          <button
            key={q.label}
            type="button"
            onClick={() => onApply(q.next)}
            className={clsx(
              "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-sm font-semibold transition active:scale-[0.98]",
              q.on ? "border-brand-600 bg-brand-50 text-brand-800" : "border-line bg-surface text-ink-2 hover:border-faint",
            )}
          >
            {q.icon}
            <span className="truncate">{q.label}</span>
          </button>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-[1fr_1.3fr_1.3fr]">
        <Group label="Person">
          <PersonPicker people={people} value={c.person} onChange={(person) => setC({ ...c, person })} />
        </Group>

        <Group label="Period">
          <Pills
            value={c.range}
            options={RANGE_OPTIONS.map((o) => ({ ...o, icon: o.value === "custom" ? <CalendarRange className="size-4" /> : undefined }))}
            onChange={(range) => setC({ ...c, range, ...(range === "custom" ? { from: c.from ?? today.slice(0, 8) + "01", to: c.to ?? today } : { from: undefined, to: undefined }) })}
          />
          {c.range === "custom" && (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <DateBox label="From Date" value={c.from ?? ""} onChange={(from) => setC({ ...c, from, to: c.to && c.to < from ? from : c.to })} />
              <DateBox label="To Date" value={c.to ?? ""} min={c.from} onChange={(to) => setC({ ...c, to })} />
            </div>
          )}
        </Group>

        <Group label="Show">
          <Pills value={c.show} options={SHOW_OPTIONS} onChange={(show) => setC({ ...c, show })} />
        </Group>
      </div>

      <Button size="lg" className={clsx("mt-5 w-full tracking-wide uppercase", !changed && "opacity-90")} onClick={() => onApply(c)}>
        Show Report
      </Button>
      {changed && <p className="mt-2 text-center text-xs font-medium text-amber-700">Press Show Report to see your new choice</p>}
    </Card>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-2 text-sm font-bold text-ink-2">{label}</p>
      {children}
    </div>
  );
}

function Pills<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={clsx(
            "flex h-10 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition",
            value === o.value ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-faint",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function DateBox({ label, value, min, onChange }: { label: string; value: string; min?: string; onChange: (v: string) => void }) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-xs font-semibold text-muted">{label}</span>
      <input type="date" value={value} min={min} onChange={(e) => e.target.value && onChange(e.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-[16px]" />
    </label>
  );
}
