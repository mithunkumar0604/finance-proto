"use client";

import { useState } from "react";
import { Chip } from "@/components/ui/bits";
import { dShort, LOAN_TYPE_SHORT, METHOD_LABEL, money } from "@/lib/format";
import { settlementsReport, type DateRange, type SettlementRow } from "@/lib/reports";
import type { AppState } from "@/lib/store";
import { DataReport, type Column } from "./data-report";
import { cardSubFor, SectionTitle, SumTile } from "./shared";

const COLUMNS: Column<SettlementRow>[] = [
  { key: "customer", label: "Customer", primary: true, render: (r) => r.customer.name, sort: (r) => r.customer.name },
  {
    key: "date",
    label: "Date",
    render: (r) => (
      <span>
        {dShort(r.payment.date)}
        {r.payment.recordedOn > r.payment.date && <span className="ml-1.5 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700">Backdated</span>}
      </span>
    ),
    sort: (r) => r.payment.date,
  },
  { key: "loanId", label: "Loan ID", render: (r) => r.loan.id, sort: (r) => r.loan.id },
  { key: "before", label: "Principal Before", align: "right", render: (r) => money(r.before), sort: (r) => r.before },
  { key: "received", label: "Principal Received", align: "right", render: (r) => <b className="text-brand-700">{money(r.payment.principal)}</b>, sort: (r) => r.payment.principal },
  { key: "remaining", label: "Principal Remaining", align: "right", render: (r) => money(r.remaining), sort: (r) => r.remaining },
  {
    key: "type",
    label: "Settlement Type",
    render: (r) => (r.type === "full" ? <Chip tone="brand">FULL SETTLEMENT</Chip> : <Chip tone="indigo">PARTIAL PRINCIPAL</Chip>),
    sort: (r) => r.type,
  },
  {
    key: "status",
    label: "Status",
    status: true,
    render: (r) => (r.loan.status === "closed" ? <Chip dot>CLOSED</Chip> : <Chip tone="green" dot>ACTIVE</Chip>),
    sort: (r) => r.loan.status,
  },
  // Optional
  { key: "interest", label: "Interest in same payment", align: "right", render: (r) => money(r.payment.interest) },
  { key: "recorded", label: "Recorded Date", render: (r) => dShort(r.payment.recordedOn), sort: (r) => r.payment.recordedOn },
  { key: "method", label: "Method", render: (r) => METHOD_LABEL[r.payment.method] },
  { key: "loanType", label: "Loan Type", render: (r) => LOAN_TYPE_SHORT[r.loan.type] },
  { key: "notes", label: "Notes", render: (r) => r.payment.note ?? "—" },
];

const DEFAULT = ["date", "loanId", "before", "received", "remaining", "type", "status"];

export function SettlementsTab({ s, range }: { s: AppState; range: DateRange }) {
  const [kind, setKind] = useState("all");
  const r = settlementsReport(s, range);
  const rows = r.rows.filter((x) => kind === "all" || x.type === kind);

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Principal returned · {range.label}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SumTile hero label="Principal Received" value={r.principalReceived} sub={`${r.rows.length} payments`} />
          <SumTile label="Partial Principal" value={r.partialPrincipal} sub={`${r.partialCount} payments`} tone="text-indigo-700" />
          <SumTile label="Full Settlements" value={r.fullAmount} sub={`${r.fullCount} loans settled`} tone="text-brand-700" />
          <SumTile label="Loans Closed" raw={r.loansClosed} sub="In this period" />
        </div>
      </section>

      <section>
        <SectionTitle>Principal payments</SectionTitle>
        <DataReport
          id="settlements"
          rows={rows}
          columns={COLUMNS}
          defaultColumns={DEFAULT}
          rowKey={(x) => x.payment.id}
          href={(x) => `/loan/?id=${x.loan.id}`}
          searchText={(x) => `${x.customer.name} ${x.loan.id}`}
          cardSub={(x) => `${cardSubFor(x.loan)} · ${dShort(x.payment.date)}`}
          countLabel={(n) => `${n} principal payment${n === 1 ? "" : "s"}`}
          defaultSort={{ key: "date", dir: "desc" }}
          sortOptions={["date", "received", "before", "remaining"]}
          filters={[
            {
              label: "Settlement Type",
              value: kind,
              onChange: setKind,
              options: [
                { value: "all", label: "All", count: r.rows.length },
                { value: "partial", label: "Partial Principal", count: r.partialCount },
                { value: "full", label: "Full Settlement", count: r.fullCount },
              ],
            },
          ]}
        />
      </section>
    </div>
  );
}
