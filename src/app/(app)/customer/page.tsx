"use client";

import { FileText, HandCoins, IdCard, Image as ImageIcon, MapPin, Phone, Plus, Receipt, StickyNote, UserX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { useUI } from "@/components/layout/ui-context";
import { LoanCard, SecurityIcon, securityLabel } from "@/components/loans/loan-card";
import { Avatar, Card, Chip, EmptyState, Segmented, Skeleton } from "@/components/ui/bits";
import { Button, buttonClass, LinkButton } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { toast } from "@/components/ui/toast";
import { paymentTotal } from "@/lib/demo-calculations";
import { dLong, dShort, METHOD_LABEL, money, phoneFmt, todayISO } from "@/lib/format";
import { customerView, permissions } from "@/lib/selectors";
import { actions, useAppState } from "@/lib/store";

export default function CustomerPage() {
  return (
    <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
      <CustomerProfile />
    </Suspense>
  );
}

type Tab = "loans" | "payments" | "documents" | "notes";

function CustomerProfile() {
  const s = useAppState();
  const ui = useUI();
  const id = useSearchParams().get("id");
  const today = todayISO();
  const perm = permissions(s);
  const [tab, setTab] = useState<Tab>("loans");
  const c = s.customers.find((x) => x.id === id);

  if (!c)
    return (
      <>
        <PageHeader title="Customer" />
        <Card>
          <EmptyState icon={UserX} title="Customer not found" text="This record may have been removed or the link is wrong." />
        </Card>
      </>
    );

  const v = customerView(s, c, today);
  const active = v.loans.filter((l) => l.loan.status === "active");
  const closed = v.loans.filter((l) => l.loan.status === "closed");
  const payments = s.payments.filter((p) => p.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const receiveTarget = v.next?.loan.id ?? active[0]?.loan.id;

  return (
    <div>
      <PageHeader title={c.name} subtitle={`Customer ${c.id}`} />

      <div className="grid gap-5 lg:grid-cols-[360px_1fr] lg:gap-8">
        {/* Identity + summary */}
        <div className="space-y-4">
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <Avatar name={c.name} size="xl" />
              <div className="min-w-0">
                <p className="truncate text-xl font-bold tracking-tight">{c.name}</p>
                <p className="num mt-0.5 flex items-center gap-1.5 text-[15px] text-ink-2">
                  <Phone className="size-4 text-muted" /> {phoneFmt(c.phone)}
                </p>
                <p className="mt-0.5 flex items-center gap-1.5 text-[15px] text-ink-2">
                  <MapPin className="size-4 text-muted" /> {c.area}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Chip>ID {c.id}</Chip>
              <Chip>Since {dShort(c.createdAt)} {c.createdAt.slice(0, 4)}</Chip>
              {v.worst === "overdue" && <Chip tone="red" dot>Overdue {v.maxDaysLate} days</Chip>}
            </div>

            <div className="mt-5 grid grid-cols-3 gap-2">
              <a href={`tel:${c.phone}`} className={buttonClass("secondary", "md", "flex-col gap-1 h-16 text-[13px]")}>
                <Phone className="size-5 text-brand-700" /> Call
              </a>
              <Button variant="primary" className="h-16 flex-col gap-1 text-[13px]" disabled={!perm.receive || !receiveTarget} onClick={() => ui.openPayment(receiveTarget)}>
                <HandCoins className="size-5" /> Receive
              </Button>
              {perm.createLoan ? (
                <LinkButton href={`/loans/new/?customer=${c.id}`} variant="secondary" className="h-16 flex-col gap-1 text-[13px]">
                  <Plus className="size-5 text-brand-700" /> New Loan
                </LinkButton>
              ) : (
                <Button variant="secondary" disabled className="h-16 flex-col gap-1 text-[13px]">
                  <Plus className="size-5" /> New Loan
                </Button>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <SummaryTile label="Total Given" value={v.totalGiven} />
            <SummaryTile label="Principal Remaining" value={v.principalLeft} strong />
            <SummaryTile label="Current Due" value={v.currentDue} tone={v.currentDue ? (v.worst === "overdue" ? "text-rose-700" : "text-amber-700") : undefined} />
            <SummaryTile label="Total Collected" value={v.collected} tone="text-emerald-700" />
          </div>
        </div>

        {/* Tabs */}
        <div className="min-w-0">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: "loans", label: "Loans", count: active.length },
              { value: "payments", label: "Payments" },
              { value: "documents", label: "Docs" },
              { value: "notes", label: "Notes" },
            ]}
          />

          <div className="mt-4">
            {tab === "loans" && (
              <div className="space-y-3">
                <h2 className="px-1 text-[13px] font-bold tracking-[0.08em] text-muted uppercase">Active Loans</h2>
                {active.map((l) => (
                  <LoanCard key={l.loan.id} loan={l.loan} view={l} today={today} />
                ))}
                {active.length === 0 && (
                  <Card>
                    <EmptyState icon={Receipt} title={v.loans.length ? "No running loans" : "No loans yet"} text={v.loans.length ? "All loans for this customer are closed." : "Give this customer their first loan."}>
                      {!v.loans.length && perm.createLoan && <LinkButton href={`/loans/new/?customer=${c.id}`}>New Loan</LinkButton>}
                    </EmptyState>
                  </Card>
                )}
                {closed.length > 0 && (
                  <>
                    <h2 className="px-1 pt-3 text-[13px] font-bold tracking-[0.08em] text-muted uppercase">Closed Loans</h2>
                    {closed.map((l) => (
                      <LoanCard key={l.loan.id} loan={l.loan} view={l} today={today} />
                    ))}
                  </>
                )}
              </div>
            )}

            {tab === "payments" && (
              <Card className="divide-y divide-line-2 overflow-hidden">
                {payments.length === 0 && <EmptyState icon={Receipt} title="No payments yet" />}
                {payments.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-3.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                      <HandCoins className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        {dLong(p.date)} <span className="font-normal text-muted">· {p.loanId}</span>
                      </p>
                      <p className="num text-[13px] text-muted">
                        Interest {money(p.interest)} · Principal {money(p.principal)} · {METHOD_LABEL[p.method]}
                      </p>
                    </div>
                    <p className="num font-extrabold text-emerald-700">{money(paymentTotal(p))}</p>
                  </div>
                ))}
              </Card>
            )}

            {tab === "documents" && (
              <div className="space-y-3">
                <Card className="p-4">
                  <p className="mb-3 font-bold">Identity</p>
                  <div className="flex items-center gap-3">
                    <span className="grid size-10 place-items-center rounded-xl bg-line-2 text-muted">
                      <IdCard className="size-5" />
                    </span>
                    <p className="text-[15px]">{c.idRef ?? "No ID reference saved"}</p>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2">
                    {["Customer photo", "ID front", "ID back"].map((t) => (
                      <div key={t} className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-line text-xs text-muted">
                        <ImageIcon className="size-5" />
                        {t}
                      </div>
                    ))}
                  </div>
                </Card>
                {v.securities.map(({ loan, security }) => (
                  <Card key={loan.id} className="flex items-center gap-3 p-4">
                    <span className="grid size-11 place-items-center rounded-xl bg-amber-50 text-[#8a6418]">
                      <SecurityIcon sec={security} className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{securityLabel(security)}</p>
                      <p className="text-[13px] text-muted">Security for {loan.id}</p>
                    </div>
                    <Chip tone={security.status === "held" ? "gold" : "slate"}>{security.status === "held" ? "HELD" : "RELEASED"}</Chip>
                  </Card>
                ))}
                {v.securities.length === 0 && (
                  <Card>
                    <EmptyState icon={FileText} title="No security held" text="None of this customer's loans have collateral." />
                  </Card>
                )}
              </div>
            )}

            {tab === "notes" && <Notes customerId={c.id} initial={c.notes ?? ""} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ label, value, tone, strong }: { label: string; value: number; tone?: string; strong?: boolean }) {
  return (
    <div className={`rounded-3xl border p-4 ${strong ? "border-brand-100 bg-brand-50" : "border-line bg-surface"}`}>
      <p className={`text-[13px] ${strong ? "text-brand-800/70" : "text-muted"}`}>{label}</p>
      <p className={`num mt-0.5 text-xl font-extrabold tracking-tight ${tone ?? (strong ? "text-brand-800" : "")}`}>{money(value)}</p>
    </div>
  );
}

function Notes({ customerId, initial }: { customerId: string; initial: string }) {
  const [text, setText] = useState(initial);
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center gap-2 font-bold">
        <StickyNote className="size-5 text-amber-600" /> Notes
      </div>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Anything to remember about this customer…" className="min-h-32" />
      <div className="mt-3 flex justify-end">
        <Button
          size="sm"
          disabled={text === initial}
          onClick={() => {
            actions.updateCustomer(customerId, { notes: text });
            toast("Note saved");
          }}
        >
          Save Note
        </Button>
      </div>
    </Card>
  );
}
