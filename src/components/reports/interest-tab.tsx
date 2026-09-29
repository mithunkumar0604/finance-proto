"use client";

import { useState } from "react";
import { Info } from "lucide-react";
import { dShort, interestLabel, LOAN_TYPE_SHORT, money, phoneFmt } from "@/lib/format";
import { interestReport, type DateRange, type InterestRow, type InterestStatus } from "@/lib/reports";
import type { AppState } from "@/lib/store";
import { DataReport, type Column } from "./data-report";
import { cardSubFor, InterestChip, SectionTitle, SumTile, typeOptions } from "./shared";

const COLUMNS: Column<InterestRow>[] = [
  { key: "customer", label: "Customer", primary: true, render: (r) => r.customer.name, sort: (r) => r.customer.name },
  { key: "loanId", label: "Loan ID", render: (r) => r.loan.id, sort: (r) => r.loan.id },
  { key: "amount", label: "Loan Amount", align: "right", render: (r) => money(r.loan.amount), sort: (r) => r.loan.amount },
  { key: "expected", label: "Interest Expected", align: "right", render: (r) => money(r.expected), sort: (r) => r.expected },
  { key: "received", label: "Interest Received", align: "right", render: (r) => <span className={r.received ? "text-emerald-700" : ""}>{money(r.received)}</span>, sort: (r) => r.received },
  { key: "pending", label: "Interest Pending", align: "right", render: (r) => <span className={r.pending ? "font-bold text-amber-700" : ""}>{money(r.pending)}</span>, sort: (r) => r.pending },
  { key: "lastPaid", label: "Last Interest Paid", render: (r) => (r.lastPaid ? dShort(r.lastPaid.date) : "—"), sort: (r) => r.lastPaid?.date ?? "" },
  { key: "next", label: "Next Interest Date", render: (r) => (r.nextDate ? dShort(r.nextDate) : "—"), sort: (r) => r.nextDate ?? "9" },
  { key: "status", label: "Status", status: true, render: (r) => <InterestChip status={r.status} />, sort: (r) => r.status },
  { key: "setting", label: "Interest Setting", render: (r) => interestLabel(r.loan) },
  { key: "type", label: "Loan Type", render: (r) => LOAN_TYPE_SHORT[r.loan.type] },
  { key: "phone", label: "Phone", render: (r) => phoneFmt(r.customer.phone) },
  { key: "area", label: "Area", render: (r) => r.customer.area },
  { key: "recorded", label: "Recorded Date", render: (r) => (r.lastPaid ? dShort(r.lastPaid.recordedOn) : "—") },
];

const DEFAULT = ["loanId", "amount", "expected", "received", "pending", "lastPaid", "next", "status"];

export function InterestTab({ s, today, range }: { s: AppState; today: string; range: DateRange }) {
  const [status, setStatus] = useState<"all" | InterestStatus>("all");
  const [type, setType] = useState("all");
  const r = interestReport(s, today, range);
  const rows = r.rows.filter((x) => (status === "all" || x.status === status) && (type === "all" || x.loan.type === type));
  const count = (st: InterestStatus) => r.rows.filter((x) => x.status === st).length;

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Interest Collection · {range.label}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <SumTile hero label="Expected Interest" value={r.expected} sub={`${r.rows.length} loans`} />
          <SumTile label="Interest Received" value={r.received} tone="text-emerald-700" sub={`${r.expected ? Math.round((r.received / r.expected) * 100) : 0}% collected`} />
          <SumTile label="Interest Pending" value={r.pending} tone="text-amber-700" />
          <SumTile label="Customers Paid" raw={r.customersPaid} sub="Fully paid" />
          <div className="col-span-2 lg:col-span-1">
            <SumTile label="Customers Pending" raw={r.customersPending} tone={r.customersPending ? "text-rose-700" : undefined} sub="Still to pay" />
          </div>
        </div>
        <div className="mt-3 h-3 overflow-hidden rounded-full bg-amber-200/70">
          <div className="h-full rounded-full bg-emerald-600 transition-[width] duration-700" style={{ width: `${r.expected ? (r.received / r.expected) * 100 : 0}%` }} />
        </div>
        <p className="mt-2 flex items-center gap-1.5 px-1 text-xs text-muted">
          <Info className="size-3.5" /> Interest falling due in this period, and how much of it has been paid.
        </p>
      </section>

      <section>
        <SectionTitle>Loan-wise interest</SectionTitle>
        <DataReport
          id="interest"
          rows={rows}
          columns={COLUMNS}
          defaultColumns={DEFAULT}
          rowKey={(x) => x.loan.id}
          href={(x) => `/loan/?id=${x.loan.id}`}
          searchText={(x) => `${x.customer.name} ${x.loan.id} ${x.customer.phone}`}
          cardSub={(x) => cardSubFor(x.loan)}
          countLabel={(n) => `${n} loan${n === 1 ? "" : "s"}`}
          defaultSort={{ key: "pending", dir: "desc" }}
          sortOptions={["pending", "expected", "received", "next", "lastPaid", "customer"]}
          filters={[
            {
              label: "Status",
              value: status,
              onChange: (v) => setStatus(v as typeof status),
              options: [
                { value: "all", label: "All", count: r.rows.length },
                { value: "paid", label: "Paid", count: count("paid") },
                { value: "partial", label: "Partial", count: count("partial") },
                { value: "pending", label: "Pending", count: count("pending") },
                { value: "overdue", label: "Overdue", count: count("overdue") },
              ],
            },
            { label: "Loan Type", value: type, onChange: setType, options: typeOptions(r.rows, (x) => x.loan) },
          ]}
        />
      </section>
    </div>
  );
}
