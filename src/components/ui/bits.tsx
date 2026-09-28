"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { initials } from "@/lib/format";
import type { DueStatus } from "@/lib/types";

// ---------------------------------------------------------------------------
// Status chip
// ---------------------------------------------------------------------------

export type ChipTone = "green" | "amber" | "red" | "slate" | "indigo" | "brand" | "gold";

const TONES: Record<ChipTone, string> = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/15",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/15",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/10",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/15",
  brand: "bg-brand-50 text-brand-800 ring-brand-600/15",
  gold: "bg-amber-50 text-[#8a6418] ring-amber-700/15",
};

export function Chip({ tone = "slate", children, className, dot }: { tone?: ChipTone; children: ReactNode; className?: string; dot?: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap ring-1 ring-inset",
        TONES[tone],
        className,
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export const STATUS_META: Record<DueStatus, { label: string; tone: ChipTone }> = {
  paid: { label: "Paid", tone: "green" },
  partial: { label: "Partial", tone: "amber" },
  pending: { label: "Pending", tone: "slate" },
  overdue: { label: "Overdue", tone: "red" },
  rescheduled: { label: "Rescheduled", tone: "indigo" },
};

export function StatusChip({ status, suffix }: { status: DueStatus; suffix?: string }) {
  const m = STATUS_META[status];
  return (
    <Chip tone={m.tone} dot>
      {m.label}
      {suffix ? ` · ${suffix}` : ""}
    </Chip>
  );
}

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

const AVATAR_TONES = [
  "bg-[#e3efe9] text-[#0b5a47]",
  "bg-[#efe8dc] text-[#7a5b1c]",
  "bg-[#e5ebf3] text-[#2d4f7c]",
  "bg-[#f1e6e6] text-[#8a3b3b]",
  "bg-[#ebe7f2] text-[#5a3f86]",
  "bg-[#e4eeee] text-[#2d6a6a]",
];

export function Avatar({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const hash = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span
      className={clsx(
        "grid shrink-0 place-items-center rounded-full font-bold tracking-tight",
        AVATAR_TONES[hash % AVATAR_TONES.length],
        { sm: "size-9 text-xs", md: "size-11 text-sm", lg: "size-14 text-base", xl: "size-18 text-xl" }[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("rounded-3xl border border-line bg-surface", className)}>{children}</div>;
}

export function SectionHeader({ title, href, action, className }: { title: string; href?: string; action?: string; className?: string }) {
  return (
    <div className={clsx("mb-3 flex items-center justify-between px-1", className)}>
      <h2 className="text-[13px] font-bold tracking-[0.08em] text-muted uppercase">{title}</h2>
      {href && (
        <Link href={href} className="-mr-2 flex h-9 items-center gap-0.5 rounded-xl px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50">
          {action ?? "View all"} <ChevronRight className="size-4" />
        </Link>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, text, children }: { icon: LucideIcon; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="mb-4 grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-700">
        <Icon className="size-6" />
      </span>
      <p className="font-semibold text-ink">{title}</p>
      {text && <p className="mt-1 max-w-xs text-sm text-muted">{text}</p>}
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

export function Progress({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  return (
    <div className={clsx("h-2.5 overflow-hidden rounded-full bg-black/8", className)}>
      <div className="h-full rounded-full bg-current transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Scrollable pill filter row. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx("no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:px-0", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition",
            value === o.value ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-faint",
          )}
        >
          {o.label}
          {o.count !== undefined && <span className={clsx("num text-xs", value === o.value ? "text-white/70" : "text-faint")}>{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Segmented tab control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={clsx("flex rounded-2xl bg-black/[0.05] p-1", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={clsx(
            "flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink-2",
          )}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && (
            <span
              className={clsx(
                "num grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11px]",
                value === o.value ? "bg-ink text-white" : "bg-black/[0.07] text-ink-2",
              )}
            >
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Label / value pair used in detail grids. */
export function Stat({ label, value, sub, className, valueClass }: { label: string; value: ReactNode; sub?: ReactNode; className?: string; valueClass?: string }) {
  return (
    <div className={className}>
      <p className="text-[13px] text-muted">{label}</p>
      <p className={clsx("num mt-0.5 text-lg font-bold tracking-tight text-ink", valueClass)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <span className="text-[15px] text-muted">{label}</span>
      <span className={clsx("num text-right text-[15px]", strong ? "font-bold text-ink" : "font-semibold text-ink-2")}>{value}</span>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-2xl bg-black/[0.06]", className)} />;
}
