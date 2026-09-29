"use client";

import { useState } from "react";
import { securityLabel } from "@/components/loans/loan-card";
import { dLong, dShort, interestLabel, LOAN_TYPE_SHORT, money, phoneFmt } from "@/lib/format";
import { loanPosition, type PositionRow } from "@/lib/reports";
import type { AppState } from "@/lib/store";
import { DataReport, type Column } from "./data-report";
import { cardSubFor, HealthChip, MiniStat, SectionTitle, SumTile, typeOptions } from "./shared";

const COLUMNS: Column<PositionRow>[] = [
  { key: "customer", label: "Customer", primary: true, render: (r) => r.customer.name, sort: (r) => r.customer.name },
  { key: "loanId", label: "Loan ID", render: (r) => r.loan.id, sort: (r) => r.loan.id },
  { key: "amount", label: "Loan Amount", align: "right", render: (r) => money(r.loan.amount), sort: (r) => r.loan.amount },
  { key: "interest", label: "Interest", render: (r) => interestLabel(r.loan).replace(" · on balance", "").replace(" · flat", "") },
  { key: "interestDue", label: "Interest Due", align: "right", render: (r) => money(r.interestDue), sort: (r) => r.interestDue },
  { key: "principalLeft", label: "Principal Left", align: "right", render: (r) => <b>{money(r.loan.principalLeft)}</b>, sort: (r) => r.loan.principalLeft },
  { key: "lastPaid", label: "Last Paid", render: (r) => (r.lastPaid ? dShort(r.lastPaid.date) : "—"), sort: (r) => r.lastPaid?.date ?? "" },
  { key: "nextDue", label: "Next Due", render: (r) => (r.nextDue ? <span className={r.overdueDays ? "text-rose-700" : ""}>{dShort(r.nextDue.dueDate)}</span> : "—"), sort: (r) => r.nextDue?.dueDate ?? "9" },
  { key: "status", label: "Status", status: true, render: (r) => <HealthChip health={r.health} days={r.overdueDays} />, sort: (r) => r.overdueDays },
  // Optional
  { key: "principalPaid", label: "Principal Paid", align: "right", render: (r) => <span className={r.principalPaid ? "text-brand-700" : "text-muted"}>{money(r.principalPaid)}</span>, sort: (r) => r.principalPaid },
  { key: "overdueDays", label: "Overdue Days", align: "right", render: (r) => (r.overdueDays ? `${r.overdueDays}d` : "—"), sort: (r) => r.overdueDays },
  { key: "phone", label: "Phone", render: (r) => phoneFmt(r.customer.phone) },
  { key: "area", label: "Area", render: (r) => r.customer.area },
  { key: "start", label: "Start Date", render: (r) => dLong(r.loan.startDate), sort: (r) => r.loan.startDate },
  { key: "type", label: "Loan Type", render: (r) => LOAN_TYPE_SHORT[r.loan.type] },
  { key: "security", label: "Vehicle / Security", render: (r) => (r.loan.security ? securityLabel(r.loan.security) : "—") },
  { key: "recorded", label: "Recorded Date", render: (r) => (r.lastPaid ? dShort(r.lastPaid.recordedOn) : "—") },
  { key: "notes", label: "Notes", render: (r) => <span className="block max-w-56 truncate">{r.customer.notes ?? "—"}</span> },
];

// Client's preferred default view: Customer, Loan Amount, Interest, Interest Due, Principal Left, Last Paid, Next Due, Status.
const DEFAULT = ["amount", "interest", "interestDue", "principalLeft", "lastPaid", "nextDue", "status"];

export function PositionTab({ s, today }: { s: AppState; today: string }) {
  const [type, setType] = useState("all");
  const [health, setHealth] = useState("all");
  const all = loanPosition(s, today);
  const rows = all.filter((r) => (type === "all" || r.loan.type === type) && (health === "all" || r.health === health));

  const given = all.reduce((a, r) => a + r.loan.amount, 0);
  const left = all.reduce((a, r) => a + r.loan.principalLeft, 0);
  const untouched = all.filter((r) => r.principalPaid === 0).length;

  return (
    <div className="space-y-6">
      <section>
        <SectionTitle>Who has the money · as of {dShort(today)}</SectionTitle>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <SumTile hero label="Principal Left" value={left} sub={`${all.length} active loans`} />
          <SumTile label="Interest Due Now" value={all.reduce((a, r) => a + r.interestDue, 0)} tone="text-amber-700" />
          <div className="col-span-2 lg:col-span-1">
            <SumTile label="Loans with no principal repaid" raw={`${untouched} of ${all.length}`} sub="Paying interest only" />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 divide-x divide-line-2 rounded-3xl border border-line bg-surface">
          <MiniStat label="Originally given" value={money(given)} />
          <MiniStat label="Principal returned so far" value={money(given - left)} />
        </div>
      </section>

      <section>
        <SectionTitle>Loan position</SectionTitle>
        <DataReport
          id="position"
          rows={rows}
          columns={COLUMNS}
          defaultColumns={DEFAULT}
          rowKey={(x) => x.loan.id}
          href={(x) => `/loan/?id=${x.loan.id}`}
          searchText={(x) => `${x.customer.name} ${x.loan.id} ${x.customer.phone} ${x.loan.security?.kind === "vehicle" ? x.loan.security.registration : ""}`}
          cardSub={(x) => cardSubFor(x.loan)}
          countLabel={(n) => `${n} active loan${n === 1 ? "" : "s"}`}
          defaultSort={{ key: "principalLeft", dir: "desc" }}
          sortOptions={["principalLeft", "interestDue", "nextDue", "lastPaid", "overdueDays", "amount"]}
          filters={[
            {
              label: "Status",
              value: health,
              onChange: setHealth,
              options: [
                { value: "all", label: "All", count: all.length },
                { value: "active", label: "Active", count: all.filter((r) => r.health === "active").length },
                { value: "due", label: "Due Today", count: all.filter((r) => r.health === "due").length },
                { value: "overdue", label: "Overdue", count: all.filter((r) => r.health === "overdue").length },
              ],
            },
            { label: "Loan Type", value: type, onChange: setType, options: typeOptions(all, (x) => x.loan) },
          ]}
        />
      </section>
    </div>
  );
}
