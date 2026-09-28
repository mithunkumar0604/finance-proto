"use client";

import { CalendarClock, HandCoins, Landmark, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/bits";
import { dRelative, todayISO } from "@/lib/format";
import { useAppState } from "@/lib/store";
import type { Activity } from "@/lib/types";

const ICON: Record<Activity["kind"], { icon: typeof HandCoins; tone: string }> = {
  payment: { icon: HandCoins, tone: "bg-emerald-50 text-emerald-700" },
  loan: { icon: Landmark, tone: "bg-brand-50 text-brand-700" },
  customer: { icon: UserPlus, tone: "bg-indigo-50 text-indigo-700" },
  reschedule: { icon: CalendarClock, tone: "bg-violet-50 text-violet-700" },
  security: { icon: ShieldCheck, tone: "bg-amber-50 text-amber-800" },
  system: { icon: LogIn, tone: "bg-slate-100 text-slate-700" },
};

export default function ActivityPage() {
  const s = useAppState();
  const today = todayISO();
  const items = [...s.activity].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Activity" subtitle="Every change is recorded" />
      <Card className="divide-y divide-line-2 overflow-hidden">
        {items.map((a) => {
          const m = ICON[a.kind];
          const d = new Date(a.at);
          const day = a.at.slice(0, 10);
          return (
            <div key={a.id} className="flex gap-3 px-4 py-3.5">
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${m.tone}`}>
                <m.icon className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[15px]">{a.text}</p>
                <p className="text-[13px] text-muted">
                  {a.by} · {dRelative(day, today)}, {d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}
                </p>
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
