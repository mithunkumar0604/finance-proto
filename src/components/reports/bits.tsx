"use client";

import { clsx } from "clsx";
import { AnimatedMoney } from "@/components/ui/animated-money";
import type { EntryKind, Figure } from "@/lib/reports";

const LABEL: Record<EntryKind, { text: string; cls: string }> = {
  paid: { text: "PAID", cls: "bg-emerald-50 text-emerald-700 ring-emerald-600/15" },
  pending: { text: "PENDING", cls: "bg-slate-100 text-slate-600 ring-slate-500/10" },
  partial: { text: "PARTIAL", cls: "bg-amber-50 text-amber-800 ring-amber-600/20" },
  overdue: { text: "OVERDUE", cls: "bg-rose-50 text-rose-700 ring-rose-600/15" },
  upcoming: { text: "UPCOMING", cls: "bg-indigo-50 text-indigo-700 ring-indigo-600/15" },
  closed: { text: "CLOSED", cls: "bg-stone-100 text-stone-600 ring-stone-500/15" },
  loan: { text: "LOAN", cls: "bg-brand-50 text-brand-800 ring-brand-600/15" },
};

export const statusText = (s: EntryKind) => LABEL[s].text;

/** PAID / PENDING / PARTIAL / OVERDUE / UPCOMING / CLOSED — soft colours, always with a word. */
export function StatusLabel({ status }: { status: EntryKind }) {
  const m = LABEL[status];
  return (
    <span className={clsx("inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold tracking-wide whitespace-nowrap ring-1 ring-inset", m.cls)}>
      {m.text}
    </span>
  );
}

const TONE = { green: "text-emerald-700", amber: "text-amber-700", red: "text-rose-700" };

/** The 4 headline figures. */
export function Figures({ figures }: { figures: Figure[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {figures.map((f, i) => (
        <div key={f.label} className={clsx("min-w-0 rounded-3xl p-4 md:p-5", i === 0 ? "bg-[radial-gradient(130%_120%_at_0%_0%,#10745b_0%,#083f33_70%)] text-white" : "border border-line bg-surface")}>
          <p className={clsx("truncate text-[13px] font-semibold", i === 0 ? "text-white/70" : "text-muted")}>{f.label}</p>
          {f.money ? (
            <AnimatedMoney value={f.value} className={clsx("num mt-1 block truncate text-[22px] leading-tight font-extrabold tracking-tight md:text-[26px]", i > 0 && f.tone && TONE[f.tone])} />
          ) : (
            <p className={clsx("num mt-1 truncate text-[22px] leading-tight font-extrabold tracking-tight md:text-[26px]", i > 0 && f.tone && TONE[f.tone])}>{f.value}</p>
          )}
        </div>
      ))}
    </div>
  );
}
