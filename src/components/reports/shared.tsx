"use client";

import { clsx } from "clsx";
import type { ReactNode } from "react";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Chip } from "@/components/ui/bits";
import { LOAN_TYPE_SHORT } from "@/lib/format";
import type { InterestStatus, SecurityState } from "@/lib/reports";
import type { LoanHealth } from "@/lib/selectors";
import type { Loan, LoanType } from "@/lib/types";

/** Headline figure tile. `money` values count up; `raw` values render as-is. */
export function SumTile({
  label,
  value,
  raw,
  sub,
  tone,
  hero,
  short = true,
}: {
  label: string;
  value?: number;
  raw?: ReactNode;
  sub?: ReactNode;
  tone?: string;
  hero?: boolean;
  short?: boolean;
}) {
  return (
    <div className={clsx("h-full min-w-0 rounded-3xl p-4 md:p-5", hero ? "bg-[radial-gradient(130%_120%_at_0%_0%,#10745b_0%,#083f33_70%)] text-white" : "border border-line bg-surface")}>
      <p className={clsx("truncate text-[13px] font-semibold", hero ? "text-white/70" : "text-muted")}>{label}</p>
      {raw !== undefined ? (
        <p className={clsx("num mt-1 truncate text-[26px] leading-tight font-extrabold tracking-tight md:text-3xl", tone)}>{raw}</p>
      ) : (
        <AnimatedMoney value={value ?? 0} short={short} className={clsx("num mt-1 block truncate text-[26px] leading-tight font-extrabold tracking-tight md:text-3xl", tone)} />
      )}
      {sub && <p className={clsx("mt-1 truncate text-[13px]", hero ? "text-white/60" : "text-muted")}>{sub}</p>}
    </div>
  );
}

/** Small secondary figure row item. */
export function MiniStat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 px-4 py-3.5 md:px-5">
      <p className="truncate text-[13px] text-muted">{label}</p>
      <p className="num mt-0.5 truncate text-lg font-bold">{value}</p>
      {sub && <p className="truncate text-xs text-muted">{sub}</p>}
    </div>
  );
}

export function InterestChip({ status }: { status: InterestStatus }) {
  const m = { paid: ["PAID", "green"], partial: ["PARTIAL", "amber"], pending: ["PENDING", "slate"], overdue: ["OVERDUE", "red"] } as const;
  return <Chip tone={m[status][1]} dot>{m[status][0]}</Chip>;
}

export function HealthChip({ health, days }: { health: LoanHealth; days?: number }) {
  if (health === "overdue") return <Chip tone="red" dot>OVERDUE{days ? ` · ${days}d` : ""}</Chip>;
  if (health === "due") return <Chip tone="brand" dot>DUE TODAY</Chip>;
  if (health === "closed") return <Chip dot>CLOSED</Chip>;
  return <Chip tone="green" dot>ACTIVE</Chip>;
}

export function SecurityChip({ state }: { state: SecurityState }) {
  if (state === "released") return <Chip tone="green">Released</Chip>;
  if (state === "pending") return <Chip tone="amber">Pending Release</Chip>;
  return <Chip>Not Applicable</Chip>;
}

export const LOAN_TYPE_FILTER: { value: "all" | LoanType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "15day", label: "15 Day" },
  { value: "30day", label: "30 Day" },
  { value: "vehicle", label: "Vehicle" },
  { value: "jewel", label: "Jewel" },
  { value: "custom", label: "Custom" },
];

/** Loan-type filter options with counts, hiding empty types. */
export function typeOptions<R>(rows: R[], loanOf: (r: R) => Loan) {
  return LOAN_TYPE_FILTER.map((o) => ({
    ...o,
    count: o.value === "all" ? rows.length : rows.filter((r) => loanOf(r).type === o.value).length,
  })).filter((o) => o.value === "all" || o.count > 0);
}

export const cardSubFor = (loan: Loan) => `${LOAN_TYPE_SHORT[loan.type]} · ${loan.id}`;

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3 px-1">
      <h2 className="text-[13px] font-bold tracking-[0.08em] text-muted uppercase">{children}</h2>
      {right}
    </div>
  );
}
