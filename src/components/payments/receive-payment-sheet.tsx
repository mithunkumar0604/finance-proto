"use client";

import { clsx } from "clsx";
import { Banknote, Building2, ChevronRight, Info, MoreHorizontal, Search, Smartphone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Avatar, Chip, StatusChip } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, MoneyInput, PillSelect } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import {
  dueRemaining,
  dueStatus,
  openDue,
  settlementAmount,
  suggestAllocation,
  type Allocation,
  type PaymentResult,
} from "@/lib/demo-calculations";
import { dRelative, LOAN_TYPE_LABEL, money, todayISO } from "@/lib/format";
import { customerView, permissions, search, toCollectRows } from "@/lib/selectors";
import { actions, useAppState } from "@/lib/store";
import type { PaymentMethod } from "@/lib/types";
import { PaymentSuccess } from "./payment-success";

type Mode = "due" | "part" | "settle";

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
  const settle = settlementAmount(loan, due);
  const canReceive = permissions(s).receive;

  const initialMode: Mode = preset === "settle" ? "settle" : "due";
  const [mode, setMode] = useState<Mode>(initialMode);
  const [amount, setAmount] = useState<number | "">(initialMode === "settle" ? settle : remaining || "");
  const [manual, setManual] = useState<Allocation | null>(null);
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");

  const auto = suggestAllocation(amount || 0, loan, due);
  const split = manual ?? auto;
  const total = split.interest + split.principal + split.other;
  const principalAfter = Math.max(0, loan.principalLeft - split.principal);
  const dueAfter = due ? Math.max(0, remaining - split.interest - split.principal) : 0;

  const choose = (m: Mode) => {
    setMode(m);
    setManual(null);
    if (m === "due") setAmount(remaining);
    if (m === "settle") setAmount(settle);
    if (m === "part") {
      setAmount("");
      setTimeout(() => document.getElementById("pay-amount")?.focus(), 30);
    }
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
      note: note.trim() || undefined,
    });
    onDone(result, { principal: loan.principalLeft, customer: customer.name });
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Receive Payment"
      subtitle={
        <span>
          <span className="font-semibold text-ink-2">{customer.name}</span> · Loan {loan.id}
        </span>
      }
      footer={
        <Button size="lg" className="w-full text-[16px] tracking-wide uppercase" disabled={!canReceive || total <= 0} onClick={confirm}>
          Confirm Payment{total > 0 && <span className="num normal-case"> · {money(total)}</span>}
        </Button>
      }
    >
      {/* Where this loan stands */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line">
        <div className="bg-surface p-3.5">
          <p className="text-[13px] text-muted">Current Due</p>
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
          <p className="mt-1 text-xs text-muted">{LOAN_TYPE_LABEL[loan.type]}</p>
        </div>
      </div>

      {due && due.paid > 0 && (
        <p className="-mt-3 mb-5 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {money(due.paid)} already paid on this due — {money(remaining)} left.
        </p>
      )}

      <Field label="Payment Amount">
        <MoneyInput
          id="pay-amount"
          size="xl"
          value={amount}
          onChange={(v) => {
            setAmount(v);
            setManual(null);
            if (mode !== "part") setMode("part");
          }}
        />
      </Field>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {([
          ["due", "Pay Due", money(remaining)],
          ["part", "Part Payment", "Any amount"],
          ["settle", "Full Settlement", money(settle)],
        ] as const).map(([m, label, sub]) => (
          <button
            key={m}
            type="button"
            onClick={() => choose(m)}
            className={clsx(
              "flex flex-col items-center rounded-2xl border px-1 py-2.5 transition active:scale-[0.98]",
              mode === m ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line hover:border-faint",
            )}
          >
            <span className={clsx("text-sm font-bold", mode === m ? "text-brand-800" : "text-ink")}>{label}</span>
            <span className="num mt-0.5 text-xs text-muted">{sub}</span>
          </button>
        ))}
      </div>

      {/* Split */}
      <div className="mt-6 rounded-2xl bg-line-2/70 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-bold text-ink-2">How this is counted</p>
          {manual ? (
            <button type="button" onClick={() => setManual(null)} className="text-sm font-semibold text-brand-700">Auto split</button>
          ) : (
            <button type="button" onClick={() => setManual(auto)} className="text-sm font-semibold text-brand-700">Change</button>
          )}
        </div>
        {(["interest", "principal", "other"] as const).map((k) => (
          <div key={k} className="flex items-center justify-between gap-3 py-1.5">
            <span className="text-[15px] text-muted">{{ interest: "Interest", principal: "Principal", other: "Other / Adjustment" }[k]}</span>
            {manual ? (
              <MoneyInput
                className="h-11 w-40"
                value={manual[k] || ""}
                onChange={(v) => setManual({ ...manual, [k]: v || 0 })}
              />
            ) : (
              <span className="num text-[15px] font-semibold">{money(split[k])}</span>
            )}
          </div>
        ))}
        <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
          <span className="font-bold">Total Received</span>
          <span className="num text-lg font-extrabold">{money(total)}</span>
        </div>
        {total > 0 && (
          <p className="mt-2 text-sm text-muted">
            After this: principal left <b className="num text-ink">{money(principalAfter)}</b>
            {due && dueAfter > 0 && (
              <>
                {" "}· still due <b className="num text-amber-700">{money(dueAfter)}</b>
              </>
            )}
          </p>
        )}
        <p className="mt-3 flex items-start gap-1.5 text-xs text-faint">
          <Info className="mt-px size-3.5 shrink-0" /> Split uses demo rules (interest first). Final rules will be set with you.
        </p>
      </div>

      <div className="mt-6 space-y-5">
        <Field label="Payment Method" group>
          <PillSelect options={METHODS} value={method} onChange={setMethod} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
          </Field>
          <Field label="Notes (optional)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. paid at shop" />
          </Field>
        </div>
        {!canReceive && <Chip tone="amber">Your role cannot receive payments</Chip>}
      </div>
      <div className="h-2" />
    </Sheet>
  );
}

