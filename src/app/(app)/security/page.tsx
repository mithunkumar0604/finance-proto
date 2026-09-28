"use client";

import { ChevronRight, Search, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { SecurityIcon } from "@/components/loans/loan-card";
import { Card, Chip, EmptyState, Segmented } from "@/components/ui/bits";
import { money, moneyShort } from "@/lib/format";
import { permissions } from "@/lib/selectors";
import { useAppState } from "@/lib/store";
import type { Security } from "@/lib/types";

type Tab = "all" | "jewel" | "vehicle" | "document";

function title(sec: Security) {
  if (sec.kind === "vehicle") return sec.registration;
  if (sec.kind === "jewel") return sec.description;
  if (sec.kind === "document") return sec.documentType;
  return sec.description;
}

function detail(sec: Security) {
  if (sec.kind === "vehicle") return `${sec.make} ${sec.model} · ${sec.vehicleType === "bike" ? "Bike" : sec.vehicleType === "car" ? "Car" : "Commercial"}`;
  if (sec.kind === "jewel") return `${sec.weightGrams}g · ${sec.purity} · Packet ${sec.packetNo}`;
  if (sec.kind === "document") return `${sec.original ? "Original" : "Copy"} · ${sec.referenceNo}`;
  return sec.storage;
}

export default function SecurityPage() {
  const s = useAppState();
  const perm = permissions(s);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const customers = new Map(s.customers.map((c) => [c.id, c]));

  const all = s.loans
    .filter((l) => l.security && customers.has(l.customerId) && perm.customerScope(customers.get(l.customerId)!))
    .map((l) => ({ loan: l, sec: l.security!, customer: customers.get(l.customerId)! }))
    .sort((a, b) => (a.sec.status === b.sec.status ? b.loan.amount - a.loan.amount : a.sec.status === "held" ? -1 : 1));

  const nq = q.toLowerCase().replace(/\s/g, "");
  const list = all.filter(
    (x) =>
      (tab === "all" || x.sec.kind === tab) &&
      (!nq || (title(x.sec) + x.customer.name + x.loan.id + detail(x.sec)).toLowerCase().replace(/\s/g, "").includes(nq)),
  );

  const held = all.filter((x) => x.sec.status === "held");
  const gold = held.reduce((a, x) => a + (x.sec.kind === "jewel" ? x.sec.weightGrams : 0), 0);
  const count = (t: Tab) => all.filter((x) => t === "all" || x.sec.kind === t).length;

  return (
    <div>
      <PageHeader title="Security" subtitle={`${held.length} items held · ${gold.toFixed(1)} g gold`} />

      <div className="flex h-13 items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
        <Search className="size-5 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Vehicle no, jewel, packet, customer…" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear" className="grid size-7 place-items-center rounded-full bg-line text-muted">
            <X className="size-4" />
          </button>
        )}
      </div>

      <Segmented
        className="mt-4"
        value={tab}
        onChange={setTab}
        options={[
          { value: "all", label: "All", count: count("all") },
          { value: "jewel", label: "Jewels", count: count("jewel") },
          { value: "vehicle", label: "Vehicles", count: count("vehicle") },
          { value: "document", label: "Docs", count: count("document") },
        ]}
      />

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        {list.map(({ loan, sec, customer }) => (
          <Link key={loan.id} href={`/loan/?id=${loan.id}`} className="flex items-center gap-3.5 rounded-3xl border border-line bg-surface p-4 transition hover:border-faint active:scale-[0.99]">
            <span className={`grid size-13 shrink-0 place-items-center rounded-2xl ${sec.kind === "jewel" ? "bg-amber-50 text-[#8a6418]" : sec.kind === "vehicle" ? "bg-slate-100 text-slate-700" : "bg-indigo-50 text-indigo-700"}`}>
              <SecurityIcon sec={sec} className="size-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`truncate text-[16px] font-extrabold ${sec.kind === "vehicle" ? "tracking-wide" : ""}`}>{title(sec)}</p>
              <p className="truncate text-[13px] text-muted">{detail(sec)}</p>
              <p className="mt-1 truncate text-[13px] text-ink-2">
                <b>{customer.name}</b> · Loan <span className="num">{money(loan.amount)}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <Chip tone={sec.status === "held" ? "gold" : "slate"}>{sec.status === "held" ? "Held" : "Released"}</Chip>
              {sec.kind === "jewel" && <span className="num text-xs text-muted">~{moneyShort(sec.estimatedValue)}</span>}
              <ChevronRight className="size-4 text-faint" />
            </div>
          </Link>
        ))}
      </div>
      {list.length === 0 && (
        <Card className="mt-4">
          <EmptyState icon={ShieldCheck} title="Nothing found" text="No security items match." />
        </Card>
      )}
    </div>
  );
}
