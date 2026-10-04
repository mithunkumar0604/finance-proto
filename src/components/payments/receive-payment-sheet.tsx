"use client";

import { clsx } from "clsx";
import { format, parseISO } from "date-fns";
import { Banknote, Building2, ChevronDown, ChevronRight, History, Info, MoreHorizontal, Search, Smartphone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Avatar, Chip, StatusChip } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, PillSelect } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import {
  dueInterestLeft,
  dueRemaining,
  dueStatus,
  openDue,
  settlementAmount,
  suggestAllocation,
  type Allocation,
  type PaymentResult,
} from "@/lib/finance/engine";
import { dLong, dRelative, dShort, LOAN_TYPE_LABEL, LOAN_TYPE_SHORT, money, shiftISO, todayISO } from "@/lib/format";
import { customerView, permissions, search, toCollectRows } from "@/lib/selectors";
import { actions, useAppState } from "@/lib/store";
import type { PaymentMethod } from "@/lib/types";
import { PaymentSuccess } from "./payment-success";

export function ReceivePaymentSheet({
  loanId: initialLoanId,
  dueId,
  preset,
  onClose,
}: {
  loanId?: string;
  dueId?: string;
  preset?: "due" | "settle";
  onClose: () => void;
}) {
  const [loanId, setLoanId] = useState(initialLoanId);
  const [done, setDone] = useState<{ result: PaymentResult; before: { principal: number; customer: string } } | null>(null);

  if (done) {
    return (
      <Sheet open onClose={onClose}>
        <PaymentSuccess result={done.result} customerName={done.before.customer} principalBefore={done.before.principal} onDone={onClose} />
      </Sheet>
    );
  }

  if (!loanId) return <PickLoan onPick={setLoanId} onClose={onClose} />;

  return (
    <PaymentForm
      key={loanId}
      loanId={loanId}
      dueId={dueId}
      preset={preset}
      onClose={onClose}
      onDone={(result, before) => setDone({ result, before })}
    />
  );
}

// ---------------------------------------------------------------------------
// Step 0: who is paying?
// ---------------------------------------------------------------------------

function PickLoan({ onPick, onClose }: { onPick: (loanId: string) => void; onClose: () => void }) {
  const s = useAppState();
  const today = todayISO();
  const [q, setQ] = useState("");
  const [customerId, setCustomerId] = useState<string>();

  if (customerId) {
    const c = s.customers.find((x) => x.id === customerId)!;
    const v = customerView(s, c, today);
    const active = v.loans.filter((l) => l.loan.status === "active");
    return (
      <Sheet open onClose={onClose} title="Which loan?" subtitle={c.name}>
        <div className="flex flex-col gap-2.5 pb-4">
          {active.map((l) => (
            <button key={l.loan.id} type="button" onClick={() => onPick(l.loan.id)} className="flex items-center gap-3 rounded-2xl border border-line p-4 text-left hover:bg-line-2">
              <div className="flex-1">
                <p className="font-bold">{l.loan.id} · {LOAN_TYPE_LABEL[l.loan.type]}</p>
                <p className="text-sm text-muted">Principal left {money(l.loan.principalLeft)}</p>
              </div>
              {l.next && <span className="num font-bold">{money(dueRemaining(l.next))}</span>}
              <ChevronRight className="size-5 text-faint" />
            </button>
          ))}
          {active.length === 0 && <p className="py-8 text-center text-muted">No running loans for this customer.</p>}
        </div>
      </Sheet>
    );
  }

  const pickCustomer = (id: string) => {
    const c = s.customers.find((x) => x.id === id)!;
    const act = s.loans.filter((l) => l.customerId === id && l.status === "active");
    if (act.length === 1) onPick(act[0].id);
    else setCustomerId(c.id);
  };

  const hits = search(s, q);
  const dueNow = toCollectRows(s, today).slice(0, 8);

  return (
    <Sheet open onClose={onClose} title="Receive Payment" subtitle="Who is paying?">
      <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 pb-3">
        <div className="flex h-13 items-center gap-2.5 rounded-2xl border border-line px-4 focus-within:border-brand-500">
          <Search className="size-5 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone, vehicle or loan ID" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
        </div>
      </div>
      <p className="mb-2 px-1 text-xs font-bold tracking-[0.08em] text-muted uppercase">{q.length >= 2 ? "Results" : "Due now"}</p>
      <div className="mb-4 overflow-hidden rounded-2xl border border-line">
        {(q.length >= 2 ? hits.map((h) => ({ key: h.customer.id + (h.loan?.id ?? ""), name: h.customer.name, sub: h.loan ? `${h.loan.id} · ${h.match}` : h.customer.area, onClick: () => (h.loan ? onPick(h.loan.id) : pickCustomer(h.customer.id)), right: null as ReactNode }))
          : dueNow.map((r) => ({ key: r.due.id, name: r.customer.name, sub: `${r.loan.id} · ${LOAN_TYPE_LABEL[r.loan.type]}`, onClick: () => onPick(r.loan.id), right: <span className="num font-bold">{money(r.remaining)}</span> }))
        ).map((row) => (
          <button key={row.key} type="button" onClick={row.onClick} className="flex w-full items-center gap-3 border-b border-line-2 px-4 py-3 text-left last:border-0 hover:bg-line-2/60">
            <Avatar name={row.name} size="sm" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{row.name}</p>
              <p className="truncate text-sm text-muted">{row.sub}</p>
            </div>
            {row.right}
          </button>
        ))}
        {q.length >= 2 && hits.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No match</p>}
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Step 1: amount, split, method
// ---------------------------------------------------------------------------

const METHODS: { value: PaymentMethod; label: string; icon: ReactNode }[] = [
  { value: "cash", label: "Cash", icon: <Banknote className="size-4" /> },
  { value: "upi", label: "UPI", icon: <Smartphone className="size-4" /> },
  { value: "bank", label: "Bank", icon: <Building2 className="size-4" /> },
  { value: "other", label: "Other", icon: <MoreHorizontal className="size-4" /> },
];

/** Common, everyday modes first; principal-related modes sit under "More options". */
type Mode = "interest" | "part" | "settle" | "principal" | "both" | "adjust";
const ADVANCED: Mode[] = ["principal", "both", "adjust"];

function PaymentForm({
  loanId,
  dueId,
  preset,
  onClose,
  onDone,
}: {
  loanId: string;
  dueId?: string;
  preset?: "due" | "settle";
  onClose: () => void;
  onDone: (r: PaymentResult, before: { principal: number; customer: string }) => void;
}) {
  const s = useAppState();
  const today = todayISO();
  const loan = s.loans.find((l) => l.id === loanId)!;
  const customer = s.customers.find((c) => c.id === loan.customerId)!;
  const loanDues = s.dues.filter((d) => d.loanId === loanId && !d.cancelled);
  const due = loanDues.find((d) => d.id === dueId && dueRemaining(d) > 0) ?? openDue(loanDues);
  const remaining = due ? dueRemaining(due) : 0;
  const interestDue = due ? dueInterestLeft(due) : 0;
  const settle = settlementAmount(loan, due);
  const canReceive = permissions(s).receive;
  const scheduledPrincipal = !!due && due.principalAmount > 0;

  const [mode, setMode] = useState<Mode>(preset === "settle" ? "settle" : "interest");
  const [more, setMore] = useState(false);
  const [amount, setAmount] = useState<number | "">(remaining || "");
  const [manual, setManual] = useState<Allocation | null>(null);
  const [principalAmt, setPrincipalAmt] = useState<number | "">("");
  const [interestAmt, setInterestAmt] = useState<number | "">(interestDue || "");
  const [adj, setAdj] = useState<number | "">("");
  const [adjLess, setAdjLess] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");

  // DEMO: how the money is counted in each mode (rules live in lib/finance/engine).
  let split: Allocation;
  if (mode === "settle") {
    const a = adj || 0;
    split = { interest: Math.max(0, interestDue - (adjLess ? a : 0)), principal: loan.principalLeft, other: adjLess ? 0 : a };
  } else if (mode === "principal") {
    split = { interest: 0, principal: Math.min(principalAmt || 0, loan.principalLeft), other: 0 };
  } else if (mode === "both") {
    split = { interest: interestAmt || 0, principal: Math.min(principalAmt || 0, loan.principalLeft), other: 0 };
  } else if (mode === "adjust") {
    split = { interest: 0, principal: 0, other: adj || 0 };
  } else {
    split = manual ?? suggestAllocation(amount || 0, loan, due);
  }
  const total = split.interest + split.principal + split.other;
  const principalAfter = Math.max(0, loan.principalLeft - split.principal);
  const interestAfter = Math.max(0, interestDue - split.interest);
  const backdated = date < today;

  const choose = (m: Mode) => {
    setMode(m);
    setManual(null);
    if (m === "interest") setAmount(remaining);
    if (m === "part") {
      setAmount("");
      setTimeout(() => document.getElementById("pay-amount")?.focus(), 30);
    }
    if (m === "principal" || m === "both") setTimeout(() => document.getElementById("pay-principal")?.focus(), 30);
  };

  const confirm = () => {
    const result = actions.receivePayment({
      loanId: loan.id,
      dueId: due?.id,
      date,
      interest: split.interest,
      principal: split.principal,
      other: split.other,
      method,
      note: note.trim() || (mode === "adjust" ? "Adjustment" : undefined),
    });
    onDone(result, { principal: loan.principalLeft, customer: customer.name });
  };

  const modeButton = (m: Mode, label: string, sub: string) => (
    <button
      key={m}
      type="button"
      onClick={() => choose(m)}
      className={clsx(
        "flex min-w-0 flex-col items-center rounded-2xl border px-1 py-2.5 transition active:scale-[0.98]",
        mode === m ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line hover:border-faint",
      )}
    >
      <span className={clsx("text-sm font-bold", mode === m ? "text-brand-800" : "text-ink")}>{label}</span>
      <span className="num mt-0.5 max-w-full truncate text-xs text-muted">{sub}</span>
    </button>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title={mode === "settle" ? "Full Settlement" : "Receive Payment"}
      subtitle={
        <span>
          <span className="font-semibold text-ink-2">{customer.name}</span> · Loan {loan.id} · {LOAN_TYPE_SHORT[loan.type]}
        </span>
      }
      footer={
        <Button size="lg" className="w-full text-[16px] tracking-wide uppercase" disabled={!canReceive || total <= 0} onClick={confirm}>
          {mode === "settle" ? "Confirm Settlement" : "Confirm Payment"}
          {total > 0 && <span className="num normal-case"> · {money(total)}</span>}
        </Button>
      }
    >
      {/* Where this loan stands */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        <div className="bg-surface p-3.5">
          <p className="text-[13px] text-muted">{scheduledPrincipal ? "Current Due" : "Interest Due"}</p>
          <p className="num mt-0.5 text-xl font-bold">{money(remaining)}</p>
          {due && (
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              {dRelative(due.dueDate, today)}
              {dueStatus(due, today) !== "pending" && <StatusChip status={dueStatus(due, today)} />}
            </p>
          )}
        </div>
        <div className="bg-surface p-3.5">
          <p className="text-[13px] text-muted">Principal Left</p>
          <p className="num mt-0.5 text-xl font-bold">{money(loan.principalLeft)}</p>
          <p className="num mt-1 text-xs text-muted">of {money(loan.amount)} given</p>
        </div>
      </div>

      {due && due.paid > 0 && remaining > 0 && (
        <p className="-mt-3 mb-5 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {money(due.paid)} already paid on this due — {money(remaining)} left.
        </p>
      )}

      {/* Mode */}
      <div className="grid grid-cols-3 gap-2">
        {modeButton("interest", "Pay Interest", money(remaining))}
        {modeButton("part", "Part Payment", "Any amount")}
        {modeButton("settle", "Full Settlement", money(settle))}
      </div>
      <button
        type="button"
        onClick={() => setMore(!more)}
        className="mt-2 flex h-9 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-brand-700 hover:bg-brand-50"
        aria-expanded={more || ADVANCED.includes(mode)}
      >
        More options <ChevronDown className={clsx("size-4 transition", (more || ADVANCED.includes(mode)) && "rotate-180")} />
      </button>
      {(more || ADVANCED.includes(mode)) && (
        <div className="mt-1 grid grid-cols-3 gap-2">
          {modeButton("principal", "Pay Principal", "Return capital")}
          {modeButton("both", "Principal + Interest", "Both together")}
          {modeButton("adjust", "Adjustment", "Charges / other")}
        </div>
      )}

      <div className="mt-5">
        {(mode === "interest" || mode === "part") && (
          <>
            <Field label={mode === "interest" ? "Interest Amount" : "Payment Amount"}>
              <MoneyInput
                id="pay-amount"
                size="xl"
                value={amount}
                onChange={(v) => {
                  setAmount(v);
                  setManual(null);
                }}
              />
            </Field>
            <div className="mt-4 rounded-2xl bg-line-2/70 p-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-bold text-ink-2">How this is counted</p>
                {mode === "part" &&
                  (manual ? (
                    <button type="button" onClick={() => setManual(null)} className="text-sm font-semibold text-brand-700">Auto split</button>
                  ) : (
                    <button type="button" onClick={() => setManual(split)} className="text-sm font-semibold text-brand-700">Change</button>
                  ))}
              </div>
              {(["interest", "principal", "other"] as const).map((k) =>
                !manual && k !== "interest" && split[k] === 0 ? null : (
                  <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-[15px] text-muted">{{ interest: "Interest", principal: "Principal", other: "Other / Adjustment" }[k]}</span>
                    {manual ? (
                      <MoneyInput className="h-11 w-40" value={manual[k] || ""} onChange={(v) => setManual({ ...manual, [k]: v || 0 })} />
                    ) : (
                      <span className="num text-[15px] font-semibold">{money(split[k])}</span>
                    )}
                  </div>
                ),
              )}
              {total > 0 && (
                <p className="mt-2 border-t border-line pt-2.5 text-sm text-muted">
                  {interestAfter > 0 ? (
                    <>
                      Interest still due <b className="num text-amber-700">{money(interestAfter)}</b> ·{" "}
                    </>
                  ) : (
                    <>Interest cleared · </>
                  )}
                  principal left <b className="num text-ink">{money(principalAfter)}</b>
                </p>
              )}
            </div>
          </>
        )}

        {mode === "settle" && (
          <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
            <div className="divide-y divide-brand-100">
              <Line label="Principal Left" value={money(loan.principalLeft)} />
              <Line label="Current Interest Due" value={money(interestDue)} />
              <div className="py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[15px] text-muted">Adjustment (optional)</span>
                  <div className="flex rounded-lg bg-surface p-0.5">
                    {[false, true].map((less) => (
                      <button
                        key={String(less)}
                        type="button"
                        onClick={() => setAdjLess(less)}
                        className={clsx("h-8 rounded-md px-3 text-xs font-semibold whitespace-nowrap", adjLess === less ? "bg-ink text-white" : "text-ink-2")}
                      >
                        {less ? "− Waive" : "+ Add"}
                      </button>
                    ))}
                  </div>
                </div>
                <MoneyInput className="mt-2 h-11" value={adj} onChange={setAdj} placeholder="0" />
                <p className="mt-1 text-xs text-muted">{adjLess ? "Interest waived off from the settlement." : "Extra charges added to the settlement."}</p>
              </div>
              <div className="flex items-center justify-between pt-3">
                <span className="font-bold">Total Settlement</span>
                <span className="num text-xl font-extrabold text-brand-800">{money(total)}</span>
              </div>
            </div>
            <p className="mt-2 text-sm text-brand-800/80">After this, principal left becomes ₹0 and the loan is closed on the payment date.</p>
          </div>
        )}

        {(mode === "principal" || mode === "both") && (
          <div className="space-y-4">
            {mode === "both" && (
              <Field label="Interest">
                <MoneyInput value={interestAmt} onChange={setInterestAmt} />
              </Field>
            )}
            <Field label="Principal Payment">
              <MoneyInput id="pay-principal" size="xl" value={principalAmt} onChange={setPrincipalAmt} />
            </Field>
            <div className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line text-center">
              <Mini label="Principal Before" value={money(loan.principalLeft)} />
              <Mini label="Principal Paid" value={money(split.principal)} tone="text-brand-700" />
              <Mini label="Remaining" value={money(principalAfter)} strong />
            </div>
            {mode === "principal" && interestDue > 0 && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Interest due {money(interestDue)} stays pending — collect it with “Principal + Interest”.</p>
            )}
            {principalAfter === 0 && split.principal > 0 && <p className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-brand-800">This clears all principal — the loan will close.</p>}
          </div>
        )}

        {mode === "adjust" && (
          <Field label="Adjustment Amount" hint="Late fees, charges or any other amount that is not interest or principal.">
            <MoneyInput size="xl" value={adj} onChange={setAdj} autoFocus />
          </Field>
        )}

        <p className="mt-3 flex items-start gap-1.5 text-xs text-faint">
          <Info className="mt-px size-3.5 shrink-0" /> Demo rules (interest is counted first). Final rules will be set with you.
        </p>
      </div>

      <div className="mt-6 space-y-5">
        <Field label="Payment Date" group>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Today", v: today },
              { label: "Yesterday", v: shiftISO(today, -1) },
            ].map((d) => (
              <button
                key={d.label}
                type="button"
                onClick={() => setDate(d.v)}
                className={clsx("h-11 rounded-xl border px-4 text-sm font-semibold", date === d.v ? "border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600" : "border-line text-ink-2")}
              >
                {d.label}
              </button>
            ))}
            <Input type="date" aria-label="Pick payment date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} className="h-11 w-auto min-w-40 flex-1" />
          </div>
        </Field>
        {backdated && (
          <div className="flex items-start gap-2.5 rounded-2xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <History className="mt-0.5 size-4 shrink-0" />
            <div>
              <p className="font-bold">Backdated payment</p>
              <p>
                Paid on <b>{dLong(date)}</b>, recorded today ({dShort(today)}). It will count in <b>{format(parseISO(date), "MMMM yyyy")}</b> reports, not today&apos;s collection.
              </p>
            </div>
          </div>
        )}
        <Field label="Payment Method" group>
          <PillSelect options={METHODS} value={method} onChange={setMethod} />
        </Field>
        <Field label="Notes (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid at shop" />
        </Field>
        {!canReceive && <Chip tone="amber">Your role cannot receive payments</Chip>}
      </div>
      <div className="h-2" />
    </Sheet>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-[15px] text-muted">{label}</span>
      <span className="num text-[15px] font-semibold">{value}</span>
    </div>
  );
}

function Mini({ label, value, tone, strong }: { label: string; value: string; tone?: string; strong?: boolean }) {
  return (
    <div className="min-w-0 bg-surface px-2 py-3">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <p className={clsx("num truncate text-[15px]", strong ? "font-extrabold" : "font-bold", tone)}>{value}</p>
    </div>
  );
}
