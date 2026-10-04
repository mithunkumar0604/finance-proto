"use client";

import { clsx } from "clsx";
import { Check, Eye, Minus, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, Card, Chip, SectionHeader } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { phoneFmt } from "@/lib/format";
import { actions, LIVE, useAppState } from "@/lib/store";
import type { Role } from "@/lib/types";

const ROLE_INFO: Record<Role["id"], { name: string; text: string; tone: "brand" | "indigo" | "slate" }> = {
  owner: { name: "Owner", text: "Sees everything — money, reports, all customers.", tone: "brand" },
  collector: { name: "Collector", text: "Sees assigned customers and receives payments.", tone: "indigo" },
  staff: { name: "Staff", text: "Searches customers and views permitted records.", tone: "slate" },
};

const MATRIX: { label: string; owner: boolean; collector: boolean; staff: boolean }[] = [
  { label: "See today's collections", owner: true, collector: true, staff: true },
  { label: "Receive payments", owner: true, collector: true, staff: false },
  { label: "Search customers", owner: true, collector: true, staff: true },
  { label: "See all customers", owner: true, collector: false, staff: true },
  { label: "Give new loans", owner: true, collector: false, staff: false },
  { label: "Add customers", owner: true, collector: false, staff: true },
  { label: "See Money Outside & reports", owner: true, collector: false, staff: false },
  { label: "Manage users", owner: true, collector: false, staff: false },
];

export default function UsersPage() {
  const s = useAppState();
  const router = useRouter();

  const viewAs = (role: Role["id"]) => {
    actions.setViewAs(role);
    toast(`Now viewing as ${ROLE_INFO[role].name}`);
    router.push("/home/");
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Users & Roles"
        subtitle="Who can see what"
        actions={
          <Button size="sm" variant="soft" onClick={() => toast(LIVE ? "New logins are added by your administrator" : "Invite sent (demo)")}>
            <UserPlus className="size-4" /> Add
          </Button>
        }
      />

      <Card className="mb-6 divide-y divide-line-2 overflow-hidden">
        {s.users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3.5">
            <Avatar name={u.name} />
            <div className="min-w-0 flex-1">
              <p className="font-bold">{u.name}</p>
              <p className="num truncate text-[13px] text-muted">
                {phoneFmt(u.phone)}
                {u.area ? ` · ${u.area}` : ""}
              </p>
            </div>
            <Chip tone={ROLE_INFO[u.role].tone}>{ROLE_INFO[u.role].name}</Chip>
          </div>
        ))}
      </Card>

      {!LIVE && <SectionHeader title="Try it — view the app as" />}
      <div className={LIVE ? "hidden" : "mb-6 grid gap-3 sm:grid-cols-3"}>
        {(Object.keys(ROLE_INFO) as Role["id"][]).map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => viewAs(r)}
            className={clsx(
              "rounded-3xl border p-4 text-left transition active:scale-[0.99]",
              s.session.viewAs === r ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-line bg-surface hover:border-faint",
            )}
          >
            <div className="flex items-center justify-between">
              <p className="font-bold">{ROLE_INFO[r].name}</p>
              <Eye className="size-4 text-muted" />
            </div>
            <p className="mt-1 text-[13px] text-muted">{ROLE_INFO[r].text}</p>
          </button>
        ))}
      </div>

      <SectionHeader title="Permissions" />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_repeat(3,56px)] border-b border-line bg-line-2/60 px-4 py-2.5 text-xs font-bold text-muted uppercase sm:grid-cols-[1fr_repeat(3,90px)]">
          <span>Action</span>
          <span className="text-center">Owner</span>
          <span className="text-center">Collect.</span>
          <span className="text-center">Staff</span>
        </div>
        {MATRIX.map((m) => (
          <div key={m.label} className="grid grid-cols-[1fr_repeat(3,56px)] items-center border-b border-line-2 px-4 py-3 text-[14px] last:border-0 sm:grid-cols-[1fr_repeat(3,90px)]">
            <span>{m.label}</span>
            {[m.owner, m.collector, m.staff].map((ok, i) => (
              <span key={i} className="flex justify-center">
                {ok ? <Check className="size-5 text-emerald-600" strokeWidth={2.6} /> : <Minus className="size-5 text-faint" />}
              </span>
            ))}
          </div>
        ))}
      </Card>
      {!LIVE && <p className="mt-3 px-1 text-xs text-muted">Concept only — detailed permissions will be finalised with you.</p>}
    </div>
  );
}
