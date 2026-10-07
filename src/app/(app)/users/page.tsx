"use client";

import { clsx } from "clsx";
import { Check, Eye, Minus, PencilLine, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, Card, Chip, SectionHeader } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { phoneFmt } from "@/lib/format";
import { actions, LIVE, useAppState } from "@/lib/store";
import { useSave } from "@/lib/use-save";
import type { AppUser, Role } from "@/lib/types";

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
  const [renaming, setRenaming] = useState<AppUser | null>(null);
  // LIVE: the owner sets the name shown for each login (the database allows only the owner)
  const canRename = LIVE && s.session.viewAs === "owner";

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
            {canRename && (
              <button type="button" onClick={() => setRenaming(u)} aria-label={`Edit name of ${u.name}`} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-line-2">
                <PencilLine className="size-4" />
              </button>
            )}
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
      {renaming && <RenameSheet user={renaming} onClose={() => setRenaming(null)} />}
    </div>
  );
}

/** The name shown in the app for a login (on More, in the activity list, on this page). */
function RenameSheet({ user, onClose }: { user: AppUser; onClose: () => void }) {
  const [name, setName] = useState(user.name);
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, run } = useSave();
  const save = async () => {
    const clean = name.trim();
    if (!clean) return setProblem("Enter a name.");
    if (clean.length > 60) return setProblem("Keep the name under 60 letters.");
    setProblem(null);
    if (!(await run(() => actions.updateUser(user.id, { name: clean }).then(() => true)))) return;
    toast("Name changed");
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Name"
      subtitle={`${ROLE_INFO[user.role].name} · ${phoneFmt(user.phone)}`}
      footer={
        <Button size="lg" className="w-full" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save"}
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <Field label="Name" hint="Shown in the app and beside every entry this person makes.">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={60} />
        </Field>
        {problem && (
          <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800">
            {problem}
          </p>
        )}
      </div>
    </Sheet>
  );
}
