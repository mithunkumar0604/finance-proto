"use client";

import { clsx } from "clsx";
import { useState } from "react";
import { Chip } from "@/components/ui/bits";
import { dShort, LOAN_TYPE_SHORT, money, phoneFmt } from "@/lib/format";
import { OVERDUE_BUCKETS, overdueReport, type OverdueRow } from "@/lib/reports";
import { TYPE_GROUPS } from "@/lib/selectors";
import type { AppState } from "@/lib/store";
import { DataReport, type Column } from "./data-report";
import { cardSubFor, MiniStat, SectionTitle, SumTile } from "./shared";

const COLUMNS: Column<OverdueRow>[] = [
  { key: "customer", label: "Customer", primary: true, render: (r) => r.customer.name, sort: (r) => r.customer.name },
  { key: "phone", label: "Phone", render: (r) => <a href={`tel:${r.customer.phone}`} onClick={(e) => e.stopPropagation()} className="text-brand-700">{phoneFmt(r.customer.phone)}</a> },
  { key: "amount", label: "Loan Amount", align: "right", render: (r) => money(r.loan.amount), sort: (r) => r.loan.amount },
  { key: "interestDue", label: "Interest Due", align: "right", render: (r) => <b className="text-rose-700">{money(r.interestDue)}</b>, sort: (r) => r.interestDue },
  { key: "principalLeft", label: "Principal Left", align: "right", render: (r) => money(r.loan.principalLeft), sort: (r) => r.loan.principalLeft },
  { key: "lastPaid", label: "Last Interest Paid", render: (r) => (r.lastInterestPaid ? dShort(r.lastInterestPaid.date) : "Never"), sort: (r) => r.lastInterestPaid?.date ?? "" },
  { key: "dueDate", label: "Due Date", render: (r) => dShort(r.dueDate), sort: (r) => r.dueDate },
  { key: "days", label: "Days Overdue", align: "right", render: (r) => `${r.days} days`, sort: (r) => r.days },
  {
    key: "status",
    label: "Status",
    status: true,
    render: (r) => (r.partPaid ? <Chip tone="amber" dot>PART PAID</Chip> : <Chip tone="red" dot>OVERDUE {r.days}d</Chip>),
    sort: (r) => r.days,
  },
  // Optional
  { key: "loanId", label: "Loan ID", render: (r) => r.loan.id },
  { key: "type", label: "Loan Type", render: (r) => LOAN_TYPE_SHORT[r.loan.type] },
  { key: "area", label: "Area", render: (r) => r.customer.area },
  { key: "totalDue", label: "Total Due (incl. principal part)", align: "right", render: (r) => money(r.amountDue), sort: (r) => r.amountDue },
];

const DEFAULT = ["phone", "amount", "interestDue", "principalLeft", "lastPaid", "dueDate", "days", "status"];
// Mostly-red ramp, lighter to darker as lateness grows.
const BUCKET_TONE = ["bg-rose-50 text-rose-700", "bg-rose-100 text-rose-800", "bg-rose-200 text-rose-900", "bg-rose-700 text-white", "bg-rose-900 text-white"];

export function OverdueTab({ s, today }: { s: AppState; today: string }) {
  const [bucket, setBucket] = useState("all");
  const [group, setGroup] = useState("all");
  const r = overdueReport(s, today);
  const b = OVERDUE_BUCKETS.find((x) => x.value === bucket);
  const g = TYPE_GROUPS.find((x) => x.key === group);
  const rows = r.rows.filter((x) => (!b || (x.days >= b.min && x.days <= b.max)) && (!g || g.types.includes(x.loan.type)));

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Missed interest · as of {dShort(today)}</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <SumTile label="Overdue Interest" value={r.interest} tone="text-rose-700" short={false} />
          <SumTile label="Overdue Customers" raw={r.customers} sub={`${r.rows.length} loans`} />
        </div>
        <div className="mt-3 rounded-3xl border border-line bg-surface">
          <MiniStat label="Principal with overdue customers (settlement exposure)" value={money(r.principalAtRisk)} />
        </div>
      </section>

      <section>
        <SectionTitle>How late</SectionTitle>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          {OVERDUE_BUCKETS.map((x, i) => {
            const list = r.rows.filter((row) => row.days >= x.min && row.days <= x.max);
            const on = bucket === x.value;
            return (
              <button
                key={x.value}
                type="button"
                onClick={() => setBucket(on ? "all" : x.value)}
                className={clsx("rounded-2xl p-3.5 text-left transition active:scale-[0.98]", BUCKET_TONE[i], on && "ring-2 ring-ink ring-offset-2 ring-offset-canvas")}
              >
                <p className="text-[13px] font-semibold opacity-80">{x.label}</p>
                <p className="num mt-0.5 text-xl font-extrabold">{new Set(list.map((row) => row.customer.id)).size}</p>
                <p className="num text-xs opacity-80">{money(list.reduce((a, row) => a + row.interestDue, 0))}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle>Overdue customers</SectionTitle>
        <DataReport
          id="overdue"
          rows={rows}
          columns={COLUMNS}
          defaultColumns={DEFAULT}
          rowKey={(x) => x.loan.id}
          href={(x) => `/loan/?id=${x.loan.id}`}
          searchText={(x) => `${x.customer.name} ${x.loan.id} ${x.customer.phone}`}
          cardSub={(x) => cardSubFor(x.loan)}
          countLabel={(n) => `${n} overdue loan${n === 1 ? "" : "s"}`}
          defaultSort={{ key: "days", dir: "desc" }}
          sortOptions={["days", "interestDue", "principalLeft", "lastPaid"]}
          filters={[
            { label: "Days Overdue", value: bucket, onChange: setBucket, options: [{ value: "all", label: "All" }, ...OVERDUE_BUCKETS.map((x) => ({ value: x.value, label: x.label }))] },
            { label: "Loan Type", value: group, onChange: setGroup, options: [{ value: "all", label: "All" }, ...TYPE_GROUPS.map((x) => ({ value: x.key, label: x.label }))] },
          ]}
        />
      </section>
    </div>
  );
}
