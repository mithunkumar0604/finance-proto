"use client";

import { Car, FileText, Gem, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { Avatar, Chip } from "@/components/ui/bits";
import { dueRemaining } from "@/lib/demo-calculations";
import { dRelative, money, phoneFmt } from "@/lib/format";
import type { customerView } from "@/lib/selectors";
import type { Customer } from "@/lib/types";

type View = ReturnType<typeof customerView>;

export function CustomerCard({ customer: c, view: v, today }: { customer: Customer; view: View; today: string }) {
  const next = v.next?.next;
  const sec = v.securities.find((x) => x.security.status === "held")?.security;
  const SecIcon = sec?.kind === "vehicle" ? Car : sec?.kind === "jewel" ? Gem : FileText;

  return (
    <Link href={`/customer/?id=${c.id}`} className="block rounded-3xl border border-line bg-surface p-4 transition hover:border-faint hover:shadow-[0_4px_20px_-12px_rgba(16,32,27,.25)] active:scale-[0.99]">
      <div className="flex items-start gap-3">
        <Avatar name={c.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate text-[17px] font-bold">{c.name}</p>
            {v.worst === "overdue" ? (
              <Chip tone="red" dot>
                Overdue {v.maxDaysLate}d
              </Chip>
            ) : v.worst === "due" ? (
              <Chip tone="brand" dot>
                Due today
              </Chip>
            ) : v.worst === "closed" ? (
              <Chip>Closed</Chip>
            ) : null}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted">
            <span className="num flex items-center gap-1">
              <Phone className="size-3.5" /> {phoneFmt(c.phone)}
            </span>
            <span className="flex items-center gap-1">
              <MapPin className="size-3.5" /> {c.area}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 rounded-2xl bg-line-2/70 p-3">
        <div>
          <p className="text-xs text-muted">Outstanding</p>
          <p className="num text-[17px] font-extrabold">{money(v.principalLeft)}</p>
        </div>
        <div>
          <p className="text-xs text-muted">Next Payment</p>
          {next ? (
            <p className="num text-[15px] font-bold">
              {money(dueRemaining(next))} <span className={next.dueDate < today ? "text-rose-700" : "text-muted"}>· {dRelative(next.dueDate, today)}</span>
            </p>
          ) : (
            <p className="text-[15px] font-semibold text-muted">—</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] font-medium text-muted">
        <span>
          {v.activeCount} Active Loan{v.activeCount === 1 ? "" : "s"}
        </span>
        {sec && (
          <Chip tone="gold">
            <SecIcon className="size-3.5" />
            {sec.kind === "vehicle" ? "Vehicle Security" : sec.kind === "jewel" ? "Jewel Security" : "Document Held"}
          </Chip>
        )}
      </div>
    </Link>
  );
}
