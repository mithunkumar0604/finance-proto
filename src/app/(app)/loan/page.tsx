"use client";

import { CalendarClock, CircleCheckBig, FileX2, HandCoins, Info, PencilLine, Unlock } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { useUI } from "@/components/layout/ui-context";
import { HEALTH_META } from "@/components/loans/loan-card";
import { LoanTimeline } from "@/components/loans/loan-timeline";
import { SecurityDetails } from "@/components/security/security-details";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Avatar, Card, Chip, EmptyState, Row, SectionHeader, Skeleton, StatusChip } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { DecimalInput, Field, Input, OptionGrid } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { dueRemaining, loanSchedule } from "@/lib/finance/engine";
import { dLong, dRelative, FREQ_LABEL, interestLabel, LOAN_TYPE_LABEL, money, todayISO } from "@/lib/format";
import { loanView, permissions } from "@/lib/selectors";
import { actions, useAppState } from "@/lib/store";
import type { InterestSetting, Loan } from "@/lib/types";

export default function LoanPage() {
  return (
    <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
      <LoanDetails />
    </Suspense>
  );
}

function LoanDetails() {
  const s = useAppState();
  const ui = useUI();
  const id = useSearchParams().get("id");
  const today = todayISO();
  const perm = permissions(s);
  const [editing, setEditing] = useState(false);
  const loan = s.loans.find((l) => l.id === id);

  if (!loan)
    return (
      <>
        <PageHeader title="Loan" />
        <Card>
          <EmptyState icon={FileX2} title="Loan not found" />
        </Card>
      </>
    );

  const customer = s.customers.find((c) => c.id === loan.customerId)!;
  const v = loanView(s, loan, today);
  const h = HEALTH_META[v.health];
  const repaid = loan.amount - loan.principalLeft;
  const active = loan.status === "active";
  const schedule = loanSchedule(loan, s.dues.filter((d) => d.loanId === loan.id && !d.cancelled));

  return (
    <div>
      <PageHeader
        title={`Loan ${loan.id}`}
        subtitle={LOAN_TYPE_LABEL[loan.type]}
        actions={
          <Chip tone={h.tone} dot className="mr-1 uppercase">
            {h.label}
          </Chip>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_400px] lg:gap-8">
        <div className="min-w-0 space-y-5">
          {/* Customer + principal */}
          <Card className="overflow-hidden">
            <Link href={`/customer/?id=${customer.id}`} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 hover:bg-line-2/60 md:px-5">
              <Avatar name={customer.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-bold">{customer.name}</p>
                <p className="text-[13px] text-muted">{customer.area}</p>
              </div>
              <span className="text-sm font-semibold text-brand-700">Profile</span>
            </Link>
            <div className="p-4 md:p-5">
              <p className="text-sm font-semibold text-muted">Principal Left</p>
              <AnimatedMoney value={loan.principalLeft} className="num mt-0.5 block text-[40px] leading-tight font-extrabold tracking-tight" />
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-black/[0.06]">
                <div className="h-full rounded-full bg-brand-600 transition-[width] duration-700" style={{ width: `${(repaid / loan.amount) * 100}%` }} />
              </div>
              <p className="num mt-2 text-sm text-muted">
                {money(repaid)} of {money(loan.amount)} principal returned · {Math.round((repaid / loan.amount) * 100)}%
              </p>
            </div>
          </Card>

          {/* Current due */}
          {active && v.next && (
            <Card className="p-4 md:p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-muted">{v.next.dueDate < today ? "Overdue payment" : "Next Collection"}</p>
                  <p className="num mt-0.5 text-2xl font-extrabold">{money(dueRemaining(v.next))}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {dLong(v.next.dueDate)} · {dRelative(v.next.dueDate, today)}
                    {v.next.paid > 0 && <> · {money(v.next.paid)} already paid</>}
                  </p>
                  {v.next.rescheduled && (
                    <p className="mt-1 text-[13px] text-indigo-700">
                      Moved from {dLong(v.next.rescheduled.originalDate)} — {v.next.rescheduled.reason}
                    </p>
                  )}
                </div>
                {v.nextStatus && <StatusChip status={v.nextStatus} />}
              </div>
            </Card>
          )}

          {/* Actions */}
          {active && (
            <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
              <Button size="lg" className="col-span-2 md:col-span-1" disabled={!perm.receive} onClick={() => ui.openPayment(loan.id, { dueId: v.next?.id })}>
                <HandCoins className="size-5" /> Receive Payment
              </Button>
              <Button variant="secondary" size="lg" disabled={!perm.createLoan} onClick={() => setEditing(true)}>
                <PencilLine className="size-5 text-muted" /> Edit Loan
              </Button>
              <Button variant="secondary" size="lg" disabled={!v.next || !perm.receive} onClick={() => v.next && ui.openReschedule(v.next.id)}>
                <CalendarClock className="size-5 text-muted" /> Reschedule
              </Button>
              <Button variant="secondary" size="lg" className="col-span-2 md:col-span-1" disabled={!perm.receive} onClick={() => ui.openPayment(loan.id, { preset: "settle" })}>
                <CircleCheckBig className="size-5 text-muted" /> Close Loan
              </Button>
            </div>
          )}

          {/* Loan summary */}
          <Card className="px-4 py-2 md:px-5">
            <div className="divide-y divide-line-2">
              <Row label="Original Amount" value={money(loan.amount)} />
              <Row label="Principal Left" value={money(loan.principalLeft)} strong />
              <Row label="Interest Setting" value={interestLabel(loan)} />
              {loan.principalPerDue > 0 && <Row label="Principal per collection" value={money(loan.principalPerDue)} />}
              <Row label="Payment Frequency" value={FREQ_LABEL[loan.frequency]} />
              <Row label="Given On" value={dLong(loan.startDate)} />
              <Row label="Next Collection" value={active && v.next ? dLong(v.next.dueDate) : "—"} />
              {schedule && (
                <Row
                  label="Ends On"
                  value={schedule.endsOn ? `${dLong(schedule.endsOn)} · ${schedule.rows.length} collection${schedule.rows.length === 1 ? "" : "s"} left` : "No end date · interest only"}
                />
              )}
              <Row label="Security" value={loan.security ? "Held — see below" : "None"} />
              {loan.reference && <Row label="Reference" value={loan.reference} />}
              <Row label="Total Collected" value={money(v.collected)} />
              <Row label="Interest Collected" value={money(v.interestCollected)} />
            </div>
            <p className="flex items-center gap-1.5 py-3 text-xs text-faint">
              <Info className="size-3.5" /> Demonstration values. Final interest rules will be configured with you.
            </p>
          </Card>

          {loan.security && (
            <Card className="p-4 md:p-5">
              <SecurityDetails sec={loan.security} />
              {loan.security.status === "held" && !active && (
                <Button
                  variant="secondary"
                  className="mt-4 w-full"
                  onClick={() => {
                    actions.releaseSecurity(loan.id);
                    toast("Security marked as released");
                  }}
                >
                  <Unlock className="size-4" /> Mark as Released
                </Button>
              )}
            </Card>
          )}
        </div>

        {/* Timeline */}
        <section>
          <SectionHeader title="Payment Timeline" />
          <Card className="p-4 md:p-5">
            <LoanTimeline loan={loan} payments={v.payments} schedule={schedule} today={today} />
          </Card>
        </section>
      </div>

      {editing && <EditLoanSheet loan={loan} onClose={() => setEditing(false)} />}
    </div>
  );
}

function EditLoanSheet({ loan, onClose }: { loan: Loan; onClose: () => void }) {
  const [interest, setInterest] = useState<InterestSetting>(loan.interest);
  const [reference, setReference] = useState(loan.reference ?? "");
  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit Loan"
      subtitle={`${loan.id} · changes apply to future collections`}
      footer={
        <Button
          size="lg"
          className="w-full"
          onClick={() => {
            actions.updateLoan(loan.id, { interest, reference: reference || undefined });
            toast("Loan updated");
            onClose();
          }}
        >
          Save Changes
        </Button>
      }
    >
      <div className="space-y-5 pb-2">
        <Field label="Interest Style" group>
          <OptionGrid
            cols={3}
            value={interest.style}
            onChange={(style) => setInterest({ ...interest, style })}
            options={[
              { value: "percent", label: "Percentage" },
              { value: "fixed", label: "Fixed ₹" },
              { value: "custom", label: "Custom" },
            ]}
          />
        </Field>
        <Field label={interest.style === "percent" ? "Interest Value (%)" : "Interest Amount (₹)"}>
          <DecimalInput key={interest.style} value={interest.value} onChange={(value) => setInterest({ ...interest, value })} suffix={interest.style === "percent" ? "%" : "₹"} />
        </Field>
        <Field label="Interest Calculation" group>
          <OptionGrid
            cols={3}
            value={interest.method}
            onChange={(method) => setInterest({ ...interest, method })}
            options={[
              { value: "fixed", label: "Fixed" },
              { value: "reducing", label: "Reducing" },
              { value: "manual", label: "Manual" },
            ]}
          />
        </Field>
        <Field label="Reference (optional)">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
