"use client";

import { useState } from "react";
import { Chip } from "@/components/ui/bits";
import { dShort, LOAN_TYPE_SHORT, money, phoneFmt } from "@/lib/format";
import { closedReport, type ClosedRow, type DateRange } from "@/lib/reports";
import type { AppState } from "@/lib/store";
import { securityLabel } from "@/components/loans/loan-card";
import { DataReport, type Column } from "./data-report";
import { cardSubFor, SectionTitle, SecurityChip, SumTile } from "./shared";

const COLUMNS: Column<ClosedRow>[] = [
  { key: "customer", label: "Customer", primary: true, render: (r) => r.customer.name, sort: (r) => r.customer.name },
  { key: "loanId", label: "Loan ID", render: (r) => r.loan.id, sort: (r) => r.loan.id },
  { key: "type", label: "Loan Type", render: (r) => LOAN_TYPE_SHORT[r.loan.type], sort: (r) => r.loan.type },
  { key: "amount", label: "Original Principal", align: "right", render: (r) => money(r.loan.amount), sort: (r) => r.loan.amount },
  { key: "interest", label: "Total Interest Collected", align: "right", render: (r) => <span className="text-emerald-700">{money(r.interestCollected)}</span>, sort: (r) => r.interestCollected },
  { key: "settled", label: "Principal Settled", align: "right", render: (r) => money(r.principalSettled), sort: (r) => r.principalSettled },
  { key: "start", label: "Start Date", render: (r) => dShort(r.loan.startDate), sort: (r) => r.loan.startDate },
  { key: "closed", label: "Closed Date", render: (r) => (r.loan.closedDate ? dShort(r.loan.closedDate) : "—"), sort: (r) => r.loan.closedDate ?? "" },
  { key: "security", label: "Security Status", render: (r) => <SecurityChip state={r.security} />, sort: (r) => r.security },
  { key: "status", label: "Status", status: true, render: () => <Chip dot>CLOSED</Chip> },
  // Optional
  { key: "securityItem", label: "Vehicle / Security", render: (r) => (r.loan.security ? securityLabel(r.loan.security) : "—") },
  { key: "phone", label: "Phone", render: (r) => phoneFmt(r.customer.phone) },
  { key: "area", label: "Area", render: (r) => r.customer.area },
];

const DEFAULT = ["loanId", "type", "amount", "interest", "settled", "start", "closed", "security", "status"];

export function ClosedTab({ s, range }: { s: AppState; range: DateRange }) {
  const [sec, setSec] = useState("all");
  const all = closedReport(s, range);
  const rows = all.filter((x) => sec === "all" || x.security === sec);

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Completed loans · {range.label}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SumTile hero label="Loans Closed" raw={all.length} sub="In this period" />
          <SumTile label="Principal Settled" value={all.reduce((a, r) => a + r.principalSettled, 0)} />
          <SumTile label="Interest Earned" value={all.reduce((a, r) => a + r.interestCollected, 0)} tone="text-emerald-700" sub="Over the life of these loans" />
          <SumTile label="Security to Release" raw={all.filter((r) => r.security === "pending").length} tone={all.some((r) => r.security === "pending") ? "text-amber-700" : undefined} sub="Still in the locker" />
        </div>
      </section>

      <section>
        <SectionTitle>Closed loans</SectionTitle>
        <DataReport
          id="closed"
          rows={rows}
          columns={COLUMNS}
          defaultColumns={DEFAULT}
          rowKey={(x) => x.loan.id}
          href={(x) => `/loan/?id=${x.loan.id}`}
          searchText={(x) => `${x.customer.name} ${x.loan.id}`}
          cardSub={(x) => cardSubFor(x.loan)}
          countLabel={(n) => `${n} closed loan${n === 1 ? "" : "s"}`}
          defaultSort={{ key: "closed", dir: "desc" }}
          sortOptions={["closed", "amount", "interest"]}
          filters={[
            {
              label: "Security Status",
              value: sec,
              onChange: setSec,
              options: [
                { value: "all", label: "All", count: all.length },
                { value: "pending", label: "Pending Release", count: all.filter((r) => r.security === "pending").length },
                { value: "released", label: "Released", count: all.filter((r) => r.security === "released").length },
                { value: "na", label: "Not Applicable", count: all.filter((r) => r.security === "na").length },
              ],
            },
          ]}
        />
      </section>
    </div>
  );
}
