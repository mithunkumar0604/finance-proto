"use client";

import { History, MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Chip, Row } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { APP } from "@/lib/config";
import { dueInterestLeft, dueRemaining, paymentTotal, type PaymentResult } from "@/lib/finance/engine";
import { dLong, dShort, money } from "@/lib/format";
import { LIVE, useAppState } from "@/lib/store";

export function PaymentSuccess({
  result,
  customerName,
  principalBefore,
  onDone,
}: {
  result: PaymentResult;
  customerName: string;
  principalBefore: number;
  onDone: () => void;
}) {
  const router = useRouter();
  const s = useAppState();
  const { payment, loan } = result;
  const paidDue = result.dues.find((d) => d.id === payment.dueId);
  const stillDue = paidDue && !result.closed ? dueRemaining(paidDue) : 0;
  const interestStillDue = paidDue && !result.closed ? dueInterestLeft(paidDue) : 0;
  const nextDate = result.nextDue?.dueDate ?? paidDue?.dueDate;
  const liveLoan = s.loans.find((l) => l.id === loan.id) ?? loan;
  const principalMoved = payment.principal > 0;
  const backdated = payment.recordedOn > payment.date;

  // LIVE: opens WhatsApp with the receipt text ready to send to the customer.
  const sendReceipt = () => {
    if (!LIVE) return toast("Receipt sent on WhatsApp (demo)");
    const digits = (s.customers.find((c) => c.id === loan.customerId)?.phone ?? "").replace(/\D/g, "");
    const text = [
      APP.owner.business,
      `Received ${money(paymentTotal(payment))} on ${dLong(payment.date)}`,
      `Loan ${loan.id}`,
      payment.interest > 0 ? `Interest: ${money(payment.interest)}` : "",
      payment.principal > 0 ? `Principal: ${money(payment.principal)}` : "",
      payment.other > 0 ? `Other: ${money(payment.other)}` : "",
      result.closed ? "Loan closed. Thank you." : `Principal left: ${money(liveLoan.principalLeft)}`,
    ]
      .filter(Boolean)
      .join("\n");
    window.open(`https://wa.me/${digits.length === 10 ? "91" + digits : digits}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  const title = result.closed ? "Loan Closed" : principalMoved && payment.interest === 0 ? "Principal Recorded" : "Payment Recorded";

  return (
    <div className="flex flex-col items-center pt-4 pb-5 text-center md:pt-8">
      <span className="grid size-20 animate-pop place-items-center rounded-full bg-brand-700 text-white shadow-[0_12px_30px_-10px_rgba(11,90,71,.7)]">
        <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="48" className="animate-draw" />
        </svg>
      </span>
      <h2 className="mt-5 text-2xl font-bold tracking-tight">{title}</h2>
      <p className="mt-1.5 text-muted">
        <span className="num font-bold text-ink">{money(paymentTotal(payment))}</span> received from {customerName}
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {result.closed && <Chip tone="brand" dot>CLOSED · {dShort(loan.closedDate!)}</Chip>}
        {stillDue > 0 && (
          <Chip tone="amber" dot>
            {payment.interest > 0 ? `PARTIAL · ${money(stillDue)} still due` : `Interest ${money(stillDue)} still due`}
          </Chip>
        )}
        {backdated && (
          <Chip tone="indigo">
            <History className="size-3.5" /> Paid {dShort(payment.date)} · recorded {dShort(payment.recordedOn)}
          </Chip>
        )}
      </div>

      <div className="mt-6 w-full rounded-2xl border border-line px-4 text-left">
        <div className="divide-y divide-line-2">
          <Row label="Interest" value={money(payment.interest)} />
          {principalMoved && <Row label="Principal" value={money(payment.principal)} />}
          {payment.other > 0 && <Row label="Other / Adjustment" value={money(payment.other)} />}
          <Row label="Payment Date" value={dLong(payment.date)} />
        </div>
      </div>

      {principalMoved ? (
        <div className="mt-3 grid w-full grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line text-left">
          <Box label="Before" value={money(principalBefore)} />
          <Box label="Paid" value={money(payment.principal)} tone="text-brand-700" />
          <div className="min-w-0 bg-brand-50 p-3">
            <p className="truncate text-[12px] text-brand-800/70">Remaining</p>
            <AnimatedMoney value={liveLoan.principalLeft} className="num mt-0.5 block truncate text-base font-extrabold text-brand-800" />
          </div>
        </div>
      ) : (
        <div className="mt-3 grid w-full grid-cols-2 gap-3 text-left">
          <div className="rounded-2xl bg-brand-50 p-4">
            <p className="text-[13px] text-brand-800/70">Principal Left</p>
            <p className="num mt-0.5 text-xl font-extrabold text-brand-800">{money(loan.principalLeft)}</p>
            <p className="mt-0.5 text-xs text-brand-800/60">Unchanged</p>
          </div>
          <div className="rounded-2xl bg-line-2 p-4">
            <p className="text-[13px] text-muted">{stillDue > 0 ? "Remaining Due" : "Next Interest"}</p>
            <p className="num mt-0.5 text-xl font-extrabold">{stillDue > 0 ? money(stillDue) : nextDate ? dShort(nextDate) : "—"}</p>
            {stillDue === 0 && result.nextDue && (
              <p className="num mt-0.5 text-xs text-muted">{money(result.nextDue.interestAmount + result.nextDue.principalAmount)} expected</p>
            )}
          </div>
        </div>
      )}

      {principalMoved && !result.closed && interestStillDue === 0 && (
        <p className="mt-3 w-full rounded-xl bg-line-2 px-3 py-2 text-left text-sm text-ink-2">
          Next interest {nextDate ? `on ${dShort(nextDate)}` : ""}
          {result.nextDue ? ` · ${money(result.nextDue.interestAmount)} (on the new balance${LIVE ? "" : " — demo"})` : ""}
        </p>
      )}

      <div className="mt-6 flex w-full flex-col gap-2.5">
        <Button size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" onClick={sendReceipt}>
            <MessageCircle className="size-4" /> Send receipt
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              onDone();
              router.push(`/loan/?id=${loan.id}`);
            }}
          >
            View loan
          </Button>
        </div>
      </div>
    </div>
  );
}

function Box({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0 bg-surface p-3">
      <p className="truncate text-[12px] text-muted">{label}</p>
      <p className={`num mt-0.5 truncate text-base font-extrabold ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
