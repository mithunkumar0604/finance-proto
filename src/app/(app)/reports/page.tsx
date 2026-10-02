"use client";

import { CalendarClock, Download, Lock } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Figures } from "@/components/reports/bits";
import { PersonView, personDoc } from "@/components/reports/person-view";
import { RegisterView, registerDoc } from "@/components/reports/register-view";
import { ReportControls, type ReportChoice } from "@/components/reports/report-controls";
import { Card, EmptyState, Skeleton } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { todayISO } from "@/lib/format";
import { pdfMoney, type ReportDoc } from "@/lib/report-pdf";
import { modeOf, personReport, RANGE_OPTIONS, rangeFor, registerReport, reportTitle, SHOW_OPTIONS, type RangeKey, type Show } from "@/lib/reports";
import { permissions } from "@/lib/selectors";
import { useAppState } from "@/lib/store";

export default function ReportsPage() {
  return (
    <Suspense fallback={<Skeleton className="mt-6 h-96" />}>
      <Reports />
    </Suspense>
  );
}

function Reports() {
  const s = useAppState();
  const router = useRouter();
  const params = useSearchParams();
  const today = todayISO();
  const [busy, setBusy] = useState(false);
  const perm = permissions(s);

  // The report on screen is described entirely by the URL, so Back returns to it.
  const choice: ReportChoice = {
    person: params.get("person"),
    range: (RANGE_OPTIONS.find((o) => o.value === params.get("range"))?.value ?? "month") as RangeKey,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    show: (SHOW_OPTIONS.find((o) => o.value === params.get("show"))?.value ?? "all") as Show,
  };
  const apply = (c: ReportChoice) => {
    const q = new URLSearchParams();
    if (c.person) q.set("person", c.person);
    q.set("range", c.range);
    if (c.range === "custom") {
      if (c.from) q.set("from", c.from);
      if (c.to) q.set("to", c.to);
    }
    q.set("show", c.show);
    router.replace(`/reports/?${q.toString()}`, { scroll: false });
    // Bring the new report into view (the controls fill most of a phone screen).
    setTimeout(() => document.getElementById("report-results")?.scrollIntoView({ behavior: "smooth", block: "start" }), 120);
  };

  if (!perm.seeReports)
    return (
      <>
        <PageHeader title="Reports" />
        <Card>
          <EmptyState icon={Lock} title="Owner only" text="Reports are visible to the owner. Switch back to Owner to view them." />
        </Card>
      </>
    );

  const range = rangeFor(choice.range, today, { from: choice.from, to: choice.to });
  const people = s.customers.filter(perm.customerScope);
  const person = choice.person ? personReport(s, today, range, choice.show, choice.person) : null;
  const register = person ? null : registerReport(s, today, range, choice.show);
  const mode = modeOf(range, today);
  const title = reportTitle(range, choice.show, mode, person?.customer.name);
  const showLabel = SHOW_OPTIONS.find((o) => o.value === choice.show)!.label;
  const figures = person ? person.figures : register!.figures;

  // Whatever is on screen is exactly what goes into the PDF.
  const download = async () => {
    const doc: ReportDoc = {
      title,
      period: `${range.label}${choice.show !== "all" ? ` · Show: ${showLabel}` : ""}`,
      summary: figures.map((f) => ({ label: f.label, value: f.money ? pdfMoney(f.value) : String(f.value) })),
      fileName: `LedgerPro - ${title.replace(/[·–/\\:*?"<>|]+/g, "-")}.pdf`,
      ...(person ? personDoc(person) : registerDoc(register!.lines, mode)),
    };
    setBusy(true);
    try {
      const { downloadReportPdf } = await import("@/lib/report-pdf");
      await downloadReportPdf(doc);
      toast(`${title} — PDF downloaded`);
    } catch {
      toast(`${title} prepared`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1120px]">
      <PageHeader title="Reports" subtitle="Choose person, date and what to see" />

      <ReportControls key={params.toString()} applied={choice} people={people} today={today} onApply={apply} />

      <section id="report-results" className="mt-6 scroll-mt-20 space-y-5" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3 px-1">
          <div className="min-w-0">
            <h2 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h2>
            <p className="text-sm text-muted">
              {person ? person.customer.name : "All People"} · {range.label} · Show {showLabel}
              {register && ` · ${register.lines.length} ${register.lines.length === 1 ? "loan" : "loans"}`}
            </p>
          </div>
          <Button variant="secondary" onClick={download} disabled={busy} className="shrink-0 tracking-wide uppercase">
            <Download className="size-4.5" /> {busy ? "Preparing…" : "Download PDF"}
          </Button>
        </div>

        {person ? (
          <PersonView data={person} onAllPeople={() => apply({ ...choice, person: null })} />
        ) : (
          <>
            <Figures figures={figures} />
            <RegisterView lines={register!.lines} mode={mode} onPerson={(id) => apply({ ...choice, person: id })} />
            {register!.lines.length > 0 && mode !== "future" && (
              <p className="px-1 text-xs text-muted">Paid is counted on the day the customer paid. Tap a person to see their full history.</p>
            )}
          </>
        )}
        {mode !== "past" && (
          <p className="flex items-start gap-2 rounded-2xl bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
            <CalendarClock className="mt-0.5 size-4 shrink-0" />
            <span>
              Upcoming amounts are <b>expected</b> interest, worked out from today&apos;s principal. They change if a customer returns principal or closes the loan.
            </span>
          </p>
        )}
      </section>
    </div>
  );
}
