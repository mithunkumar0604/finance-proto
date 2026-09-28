"use client";

import { Search, UserPlus, Users, X } from "lucide-react";
import { useState } from "react";
import { CustomerCard } from "@/components/customers/customer-card";
import { PageHeader } from "@/components/layout/page-header";
import { Card, EmptyState, FilterChips } from "@/components/ui/bits";
import { LinkButton } from "@/components/ui/button";
import { todayISO } from "@/lib/format";
import { customerView, permissions } from "@/lib/selectors";
import { useAppState } from "@/lib/store";

type Filter = "all" | "running" | "due" | "overdue" | "closed";

export default function CustomersPage() {
  const s = useAppState();
  const today = todayISO();
  const perm = permissions(s);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const all = s.customers
    .filter(perm.customerScope)
    .map((c) => ({ c, v: customerView(s, c, today) }))
    .sort((a, b) => rank(a.v.worst) - rank(b.v.worst) || a.c.name.localeCompare(b.c.name));

  const match = (f: Filter, v: (typeof all)[number]["v"]) =>
    f === "all" ||
    (f === "running" && v.activeCount > 0) ||
    (f === "due" && v.worst === "due") ||
    (f === "overdue" && v.worst === "overdue") ||
    (f === "closed" && v.worst === "closed");

  const nq = q.toLowerCase().replace(/\s/g, "");
  const list = all.filter(
    ({ c, v }) =>
      match(filter, v) &&
      (!nq || c.name.toLowerCase().replace(/\s/g, "").includes(nq) || c.phone.includes(nq) || c.area.toLowerCase().includes(nq)),
  );

  const count = (f: Filter) => all.filter(({ v }) => match(f, v)).length;

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle={`${all.length} people`}
        back={false}
        actions={
          perm.addCustomer && (
            <LinkButton href="/customers/new/" size="sm" variant="soft">
              <UserPlus className="size-4" /> Add
            </LinkButton>
          )
        }
      />

      <div className="flex h-13 items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
        <Search className="size-5 text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone or area" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
        {q && (
          <button type="button" onClick={() => setQ("")} aria-label="Clear" className="grid size-7 place-items-center rounded-full bg-line text-muted">
            <X className="size-4" />
          </button>
        )}
      </div>

      <FilterChips
        className="mt-4"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "All", count: count("all") },
          { value: "running", label: "Running", count: count("running") },
          { value: "due", label: "Payment Due", count: count("due") },
          { value: "overdue", label: "Overdue", count: count("overdue") },
          { value: "closed", label: "Closed", count: count("closed") },
        ]}
      />

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 [&>*]:min-w-0">
        {list.map(({ c, v }) => (
          <CustomerCard key={c.id} customer={c} view={v} today={today} />
        ))}
      </div>
      {list.length === 0 && (
        <Card className="mt-4">
          <EmptyState icon={Users} title="No customers found" text={q ? `Nothing matches “${q}”.` : "No customers in this list."} />
        </Card>
      )}
    </div>
  );
}

const rank = (w: string) => ({ overdue: 0, due: 1, new: 2, active: 3, closed: 4 })[w] ?? 5;
