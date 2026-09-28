"use client";

import { MessageCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { AnimatedMoney } from "@/components/ui/animated-money";
import { Chip, Row } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { dueRemaining, paymentTotal, type PaymentResult } from "@/lib/demo-calculations";
import { dShort, money } from "@/lib/format";
import { useAppState } from "@/lib/store";

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
  const stillDue = paidDue ? dueRemaining(paidDue) : 0;
  const nextDate = result.nextDue?.dueDate ?? paidDue?.dueDate;
  const liveLoan = s.loans.find((l) => l.id === loan.id) ?? loan;

  return (
    <div className="flex flex-col items-center pt-4 pb-5 text-center md:pt-8">
      <span className="grid size-20 animate-pop place-items-center rounded-full bg-brand-700 text-white shadow-[0_12px_30px_-10px_rgba(11,90,71,.7)]">
        <svg viewBox="0 0 24 24" className="size-10" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" strokeDasharray="48" className="animate-draw" />
        </svg>
      </span>
      <h2 className="mt-5 text-2xl font-bold tracking-tight">{result.closed ? "Loan Closed" : "Payment Recorded"}</h2>
      <p className="mt-1.5 text-muted">
        <span className="num font-bold text-ink">{money(paymentTotal(payment))}</span> received from {customerName}
      </p>
      {stillDue > 0 && (
        <Chip tone="amber" dot className="mt-3">
          PARTIAL · {money(stillDue)} still due
        </Chip>
      )}

      <div className="mt-6 w-full rounded-2xl border border-line px-4 text-left">
        <div className="divide-y divide-line-2">
          <Row label="Interest" value={money(payment.interest)} />
          <Row label="Principal" value={money(payment.principal)} />
          {payment.other > 0 && <Row label="Other / Adjustment" value={money(payment.other)} />}
        </div>
      </div>

      <div className="mt-3 grid w-full grid-cols-2 gap-3 text-left">
        <div className="rounded-2xl bg-brand-50 p-4">
          <p className="text-[13px] text-brand-800/70">Updated Principal</p>
          <p className="num mt-0.5 text-xl font-extrabold text-brand-800">
            {principalBefore !== loan.principalLeft ? <AnimatedMoney value={liveLoan.principalLeft} /> : money(loan.principalLeft)}
          </p>
          {principalBefore !== loan.principalLeft && (
            <p className="num mt-0.5 text-xs text-brand-800/60 line-through">{money(principalBefore)}</p>
          )}
        </div>
        <div className="rounded-2xl bg-line-2 p-4">
          <p className="text-[13px] text-muted">{result.closed ? "Status" : stillDue > 0 ? "Remaining Due" : "Next Payment"}</p>
          <p className="num mt-0.5 text-xl font-extrabold">
            {result.closed ? "Closed" : stillDue > 0 ? money(stillDue) : nextDate ? dShort(nextDate) : "—"}
          </p>
          {!result.closed && stillDue === 0 && result.nextDue && (
            <p className="num mt-0.5 text-xs text-muted">{money(result.nextDue.interestAmount + result.nextDue.principalAmount)} expected</p>
          )}
        </div>
      </div>

      <div className="mt-6 flex w-full flex-col gap-2.5">
        <Button size="lg" className="w-full" onClick={onDone}>
          Done
        </Button>
        <div className="grid grid-cols-2 gap-2.5">
          <Button variant="secondary" onClick={() => toast("Receipt sent on WhatsApp (demo)")}>
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
