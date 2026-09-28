"use client";

import { clsx } from "clsx";
import {
  ArrowLeft,
  Calendar,
  CalendarDays,
  CalendarRange,
  Car,
  Check,
  FileText,
  Gem,
  Info,
  Package,
  Repeat,
  Search,
  Settings2,
  ShieldOff,
  Timer,
  UserPlus,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { buildSecurity, EMPTY_SECURITY, SecurityFields, type SecurityDraft, type SecurityKind } from "@/components/loans/security-form";
import { securityLabel } from "@/components/loans/loan-card";
import { Avatar, Card, Row, Skeleton } from "@/components/ui/bits";
import { Button, LinkButton } from "@/components/ui/button";
import { Field, Input, MoneyInput, OptionGrid } from "@/components/ui/form";
import { demoLoanDefaults, previewFirstCollection } from "@/lib/demo-calculations";
import { dLong, FREQ_LABEL, interestLabel, LOAN_TYPE_LABEL, money, moneyShort, phoneFmt, todayISO } from "@/lib/format";
import { actions, useAppState } from "@/lib/store";
import type { Frequency, InterestSetting, Loan, LoanType } from "@/lib/types";

export default function NewLoanPage() {
  return (
    <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
      <Wizard />
    </Suspense>
  );
}

const STEPS = ["Customer", "Loan Amount", "Loan Type", "Interest & Collection", "Security", "Review"];

const TYPE_OPTIONS: { value: LoanType; label: string; sub: string; icon: ReactNode }[] = [
  { value: "weekly", label: "Weekly", sub: "Collect every week", icon: <Repeat className="size-5" /> },
  { value: "monthly", label: "Monthly", sub: "Interest every month", icon: <CalendarDays className="size-5" /> },
  { value: "15day", label: "15 Days", sub: "Short term", icon: <Timer className="size-5" /> },
  { value: "30day", label: "30 Days", sub: "Short term", icon: <CalendarRange className="size-5" /> },
  { value: "vehicle", label: "Vehicle", sub: "Vehicle as security", icon: <Car className="size-5" /> },
  { value: "jewel", label: "Jewel", sub: "Gold as security", icon: <Gem className="size-5" /> },
  { value: "custom", label: "Custom", sub: "Set your own terms", icon: <Settings2 className="size-5" /> },
];

function Wizard() {
  const s = useAppState();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();

  const preCustomer = params.get("customer");
  const [step, setStep] = useState(preCustomer ? 1 : 0);
  const [customerId, setCustomerId] = useState<string | null>(preCustomer);
  const [q, setQ] = useState("");
  const [amount, setAmount] = useState<number | "">("");
  const [startDate, setStartDate] = useState(today);
  const [reference, setReference] = useState("");
  const [type, setType] = useState<LoanType>();
  const [frequency, setFrequency] = useState<Frequency>("monthly");
  const [interest, setInterest] = useState<InterestSetting>({ style: "percent", value: 3, method: "reducing" });
  const [principalPerDue, setPrincipalPerDue] = useState<number | "">("");
  const [secKind, setSecKind] = useState<SecurityKind>("none");
  const [sec, setSec] = useState<SecurityDraft>(EMPTY_SECURITY);
  const [created, setCreated] = useState<Loan | null>(null);

  const customer = s.customers.find((c) => c.id === customerId);

  const pickType = (t: LoanType) => {
    setType(t);
    const d = demoLoanDefaults(t, amount || 0);
    setFrequency(d.frequency);
    setInterest(d.interest);
    setPrincipalPerDue(d.principalPerDue || "");
    if (t === "vehicle") setSecKind("vehicle");
    else if (t === "jewel") setSecKind("jewel");
  };

  const canNext = [!!customer, !!amount && amount > 0, !!type, interest.value > 0 || interest.style === "custom", true, true][step];

  const draft = {
    customerId: customerId!,
    type: type ?? "monthly",
    amount: amount || 0,
    startDate,
    reference: reference.trim() || undefined,
    interest,
    frequency,
    principalPerDue: principalPerDue || 0,
    security: customer ? buildSecurity(secKind, sec, customer.name) : null,
  };
  const preview = previewFirstCollection({ ...draft, principalLeft: draft.amount });

  const create = () => {
    const loan = actions.createLoan(draft);
    setCreated(loan);
  };

  if (created)
    return (
      <div>
        <PageHeader title="Loan Created" back={false} />
        <Card className="mx-auto max-w-lg p-6 text-center">
          <span className="mx-auto grid size-18 animate-pop place-items-center rounded-full bg-brand-700 text-white">
            <Check className="size-9" strokeWidth={2.6} />
          </span>
          <p className="mt-4 text-2xl font-bold tracking-tight">Loan {created.id}</p>
          <p className="mt-1 text-muted">
            <b className="num text-ink">{money(created.amount)}</b> given to {customer?.name}
          </p>
          <div className="mt-5 rounded-2xl bg-line-2 px-4 py-1 text-left">
            <div className="divide-y divide-line">
              <Row label="First collection" value={dLong(preview.date)} />
              <Row label="Expected amount" value={money(preview.total)} strong />
            </div>
          </div>
          <div className="mt-6 grid gap-2.5">
            <LinkButton href={`/loan/?id=${created.id}`} size="lg">View Loan</LinkButton>
            <LinkButton href="/home/" size="lg" variant="secondary">Back to Home</LinkButton>
          </div>
        </Card>
      </div>
    );

  const hits = q.trim().length >= 1
    ? s.customers.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()) || c.phone.includes(q.replace(/\s/g, "")))
    : s.customers.slice(0, 8);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="New Loan" subtitle={`Step ${step + 1} of ${STEPS.length} · ${STEPS[step]}`} />

      {/* Progress */}
      <div className="mb-6 flex gap-1.5">
        {STEPS.map((label, i) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            disabled={i > step}
            onClick={() => setStep(i)}
            className={clsx("h-1.5 flex-1 rounded-full transition-colors", i <= step ? "bg-brand-600" : "bg-black/[0.08]")}
          />
        ))}
      </div>

      <div key={step} className="animate-page">
        {step === 0 && (
          <div>
            <h2 className="mb-4 text-2xl font-bold tracking-tight">Who is taking the loan?</h2>
            <div className="flex h-13 items-center gap-2.5 rounded-2xl border border-line bg-surface px-4 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
              <Search className="size-5 text-muted" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search existing customer" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
            </div>
            <Link href="/customers/new/" className="mt-3 flex h-14 items-center gap-3 rounded-2xl border border-dashed border-brand-200 bg-brand-50/60 px-4 font-semibold text-brand-800">
              <UserPlus className="size-5" /> Create new customer
            </Link>
            <div className="mt-4 divide-y divide-line-2 overflow-hidden rounded-3xl border border-line bg-surface">
              {hits.slice(0, 12).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setCustomerId(c.id);
                    setStep(1);
                  }}
                  className={clsx("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-line-2/60", customerId === c.id && "bg-brand-50")}
                >
                  <Avatar name={c.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.name}</p>
                    <p className="num truncate text-sm text-muted">
                      {phoneFmt(c.phone)} · {c.area}
                    </p>
                  </div>
                  {customerId === c.id && <Check className="size-5 text-brand-700" />}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            {customer && <CustomerPill name={customer.name} sub={`${phoneFmt(customer.phone)} · ${customer.area}`} onChange={() => setStep(0)} />}
            <h2 className="mb-4 text-2xl font-bold tracking-tight">How much are you giving?</h2>
            <Field label="Amount Given">
              <MoneyInput size="xl" value={amount} onChange={setAmount} autoFocus />
            </Field>
            <div className="mt-3 flex flex-wrap gap-2">
              {[25000, 50000, 100000, 200000, 500000].map((a) => (
                <button key={a} type="button" onClick={() => setAmount(a)} className={clsx("num h-10 rounded-full border px-4 text-sm font-semibold", amount === a ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2")}>
                  {moneyShort(a)}
                </button>
              ))}
            </div>
            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <Field label="Date Given">
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || today)} />
              </Field>
              <Field label="Reference (optional)">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Shop stock" />
              </Field>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="mb-4 text-2xl font-bold tracking-tight">What kind of loan?</h2>
            <OptionGrid options={TYPE_OPTIONS} value={type} onChange={pickType} />
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold tracking-tight">Interest &amp; collection</h2>
            <Field label="Interest Style" group>
              <OptionGrid
                cols={3}
                value={interest.style}
                onChange={(style) => setInterest({ ...interest, style, method: style === "fixed" ? "fixed" : interest.method })}
                options={[
                  { value: "percent", label: "Percentage", sub: "e.g. 3%" },
                  { value: "fixed", label: "Fixed Amount", sub: "e.g. ₹2,000" },
                  { value: "custom", label: "Custom", sub: "Set later" },
                ]}
              />
            </Field>
            <Field label="Interest Value">
              {interest.style === "percent" ? (
                <div className="flex h-13 items-center rounded-2xl border border-line bg-surface px-4 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
                  <input
                    inputMode="decimal"
                    value={interest.value || ""}
                    onChange={(e) => setInterest({ ...interest, value: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })}
                    className="num w-full bg-transparent text-lg font-bold outline-none"
                    placeholder="3"
                  />
                  <span className="text-lg font-semibold text-muted">%</span>
                </div>
              ) : (
                <MoneyInput value={interest.value || ""} onChange={(v) => setInterest({ ...interest, value: v || 0 })} />
              )}
            </Field>
            <Field label="Collection Frequency" group>
              <OptionGrid
                cols={3}
                value={frequency}
                onChange={setFrequency}
                options={(["weekly", "monthly", "15days", "30days", "custom"] as Frequency[]).map((f) => ({ value: f, label: FREQ_LABEL[f].replace("Every ", "") }))}
              />
            </Field>
            <Field label="Interest Calculation" group>
              <OptionGrid
                cols={3}
                value={interest.method}
                onChange={(method) => setInterest({ ...interest, method })}
                options={[
                  { value: "fixed", label: "Fixed", sub: "On amount given" },
                  { value: "reducing", label: "Reducing", sub: "On balance left" },
                  { value: "manual", label: "Manual", sub: "Enter each time" },
                ]}
              />
            </Field>
            <Field label="Principal with each collection (optional)" hint="Leave empty if the customer pays only interest until they return the principal.">
              <MoneyInput value={principalPerDue} onChange={setPrincipalPerDue} />
            </Field>
            <DemoPreview date={preview.date} interest={preview.interest} principal={preview.principal} />
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="mb-4 text-2xl font-bold tracking-tight">Any security held?</h2>
            <OptionGrid
              cols={3}
              value={secKind}
              onChange={setSecKind}
              options={[
                { value: "none", label: "None", icon: <ShieldOff className="size-5" /> },
                { value: "jewel", label: "Jewel", icon: <Gem className="size-5" /> },
                { value: "vehicle", label: "Vehicle", icon: <Car className="size-5" /> },
                { value: "document", label: "Document", icon: <FileText className="size-5" /> },
                { value: "other", label: "Other", icon: <Package className="size-5" /> },
              ]}
            />
            <SecurityFields kind={secKind} d={sec} onChange={setSec} />
          </div>
        )}

        {step === 5 && customer && (
          <div>
            <h2 className="mb-4 text-2xl font-bold tracking-tight">Check and confirm</h2>
            <Card className="overflow-hidden">
              <div className="bg-[radial-gradient(120%_120%_at_0%_0%,#10745b_0%,#083f33_70%)] p-5 text-white">
                <p className="text-sm text-white/70">Loan Amount</p>
                <p className="num text-4xl font-extrabold tracking-tight">{money(draft.amount)}</p>
                <p className="mt-1 text-white/80">to {customer.name}</p>
              </div>
              <div className="divide-y divide-line-2 px-5 py-1">
                <Row label="Customer" value={customer.name} />
                <Row label="Loan Type" value={LOAN_TYPE_LABEL[draft.type]} />
                <Row label="Interest Setting" value={interestLabel(draft)} />
                <Row label="Collection Frequency" value={FREQ_LABEL[draft.frequency]} />
                {draft.principalPerDue > 0 && <Row label="Principal per collection" value={money(draft.principalPerDue)} />}
                <Row label="Start Date" value={dLong(draft.startDate)} />
                <Row label="Security" value={draft.security ? securityLabel(draft.security) : "None"} />
                {draft.reference && <Row label="Reference" value={draft.reference} />}
              </div>
            </Card>
            <div className="mt-4">
              <DemoPreview date={preview.date} interest={preview.interest} principal={preview.principal} />
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] z-10 -mx-4 mt-8 flex gap-3 bg-gradient-to-t from-canvas from-70% to-transparent px-4 pt-6 pb-3 md:bottom-0 md:mx-0 md:px-0 md:pb-6">
        {step > 0 && (
          <Button variant="secondary" size="lg" onClick={() => setStep(step - 1)} className="px-5" aria-label="Back">
            <ArrowLeft className="size-5" />
          </Button>
        )}
        {step < STEPS.length - 1 ? (
          step > 0 && (
            <Button size="lg" className="flex-1" disabled={!canNext} onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          )
        ) : (
          <Button size="lg" className="flex-1 tracking-wide uppercase" onClick={create}>
            Create Loan
          </Button>
        )}
        {step === 0 && (
          <Button size="lg" variant="ghost" className="flex-1" onClick={() => router.back()}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}

function CustomerPill({ name, sub, onChange }: { name: string; sub: string; onChange: () => void }) {
  return (
    <div className="mb-5 flex items-center gap-3 rounded-2xl border border-line bg-surface p-3">
      <Avatar name={name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{name}</p>
        <p className="num truncate text-sm text-muted">{sub}</p>
      </div>
      <button type="button" onClick={onChange} className="h-9 rounded-xl px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50">
        Change
      </button>
    </div>
  );
}

function DemoPreview({ date, interest, principal }: { date: string; interest: number; principal: number }) {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-ink-2">
        <Calendar className="size-4 text-brand-700" /> First collection · {dLong(date)}
      </div>
      <div className="num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[15px]">
        <span>
          Interest <b>{money(interest)}</b>
        </span>
        <span>
          Principal <b>{money(principal)}</b>
        </span>
        <span>
          Total <b className="text-brand-700">{money(interest + principal)}</b>
        </span>
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-faint">
        <Info className="size-3.5" /> Demo calculation — your exact rules will be added before go-live.
      </p>
    </div>
  );
}

