"use client";

import { Activity, BarChart3, ChevronRight, Landmark, Lock, LogOut, Settings, ShieldCheck, UserCog } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/bits";
import { APP } from "@/lib/config";
import { permissions } from "@/lib/selectors";
import { actions, useAppState } from "@/lib/store";

export default function MorePage() {
  const s = useAppState();
  const router = useRouter();
  const perm = permissions(s);
  const viewer = s.users.find((u) => u.role === s.session.viewAs);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="More" back={false} />

      <Card className="mb-5 flex items-center gap-4 p-4">
        <span className="grid size-14 place-items-center rounded-full bg-brand-700 text-lg font-bold text-white">{viewer?.name.slice(0, 2).toUpperCase() ?? APP.owner.initials}</span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold">{viewer?.name ?? APP.owner.name}</p>
          <p className="text-sm text-muted">
            {APP.owner.business} · {s.session.viewAs === "owner" ? "Owner" : s.session.viewAs === "collector" ? "Collector" : "Staff"}
          </p>
        </div>
      </Card>

      <Group>
        <Item href="/loans/" icon={<Landmark />} label="Loans" tone="bg-brand-50 text-brand-700" />
        {perm.seeReports && <Item href="/reports/" icon={<BarChart3 />} label="Reports" tone="bg-emerald-50 text-emerald-700" />}
        <Item href="/security/" icon={<ShieldCheck />} label="Security" sub="Jewels, vehicles & documents held" tone="bg-amber-50 text-[#8a6418]" />
      </Group>

      <Group>
        {perm.role === "owner" && <Item href="/users/" icon={<UserCog />} label="Users" sub="Owner, collectors & staff" tone="bg-indigo-50 text-indigo-700" />}
        <Item href="/activity/" icon={<Activity />} label="Activity" sub="Who did what, and when" tone="bg-slate-100 text-slate-700" />
        <Item href="/settings/" icon={<Settings />} label="Settings" sub="PIN, auto-lock, devices" tone="bg-slate-100 text-slate-700" />
      </Group>

      <Group>
        <Item onClick={actions.lock} icon={<Lock />} label="Lock Application" tone="bg-slate-100 text-slate-700" />
        <Item
          onClick={() => {
            actions.logout();
            router.replace("/");
          }}
          icon={<LogOut />}
          label="Logout"
          tone="bg-rose-50 text-rose-700"
          danger
        />
      </Group>

      <p className="mt-6 text-center text-xs text-faint">
        {APP.name} · Prototype v0.1 · Demo data
      </p>
    </div>
  );
}

function Group({ children }: { children: ReactNode }) {
  return <Card className="mb-4 divide-y divide-line-2 overflow-hidden">{children}</Card>;
}

function Item({ href, onClick, icon, label, sub, tone, danger }: { href?: string; onClick?: () => void; icon: ReactNode; label: string; sub?: string; tone: string; danger?: boolean }) {
  const inner = (
    <>
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl [&>svg]:size-5 ${tone}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[16px] font-semibold ${danger ? "text-rose-700" : ""}`}>{label}</span>
        {sub && <span className="block truncate text-[13px] text-muted">{sub}</span>}
      </span>
      {!danger && <ChevronRight className="size-5 text-faint" />}
    </>
  );
  const cls = "flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition hover:bg-line-2/60 active:bg-line-2";
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
