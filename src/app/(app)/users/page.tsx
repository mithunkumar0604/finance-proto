"use client";

import { clsx } from "clsx";
import { Check, Eye, Minus, PencilLine, ShieldCheck, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar, Card, Chip, SectionHeader } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Input, OptionGrid } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { phoneFmt } from "@/lib/format";
import { currentUser } from "@/lib/selectors";
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
  { label: "Add or change logins", owner: false, collector: false, staff: false },
];

export default function UsersPage() {
  const s = useAppState();
  const router = useRouter();
  const [editing, setEditing] = useState<AppUser | null>(null);
  const [adding, setAdding] = useState(false);
  // LIVE: only an admin manages logins (the database and the server function check it too).
  // The business owner sees who has a login but cannot add or change anyone.
  const me = currentUser(s);
  const isAdmin = LIVE && !!me?.isAdmin;

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
          isAdmin ? (
            <Button size="sm" variant="soft" onClick={() => setAdding(true)}>
              <UserPlus className="size-4" /> Add User
            </Button>
          ) : !LIVE ? (
            <Button size="sm" variant="soft" onClick={() => toast("Invite sent (demo)")}>
              <UserPlus className="size-4" /> Add
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-6 divide-y divide-line-2 overflow-hidden">
        {s.users.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3.5">
            <Avatar name={u.name} />
            <div className="min-w-0 flex-1">
              <p className={clsx("font-bold", !u.active && "text-muted line-through")}>{u.name}</p>
              <p className="num truncate text-[13px] text-muted">
                {phoneFmt(u.phone)}
                {u.area ? ` · ${u.area}` : ""}
              </p>
            </div>
            {!u.active ? <Chip tone="slate">Off</Chip> : u.isAdmin ? <Chip tone="brand">Admin</Chip> : <Chip tone={ROLE_INFO[u.role].tone}>{ROLE_INFO[u.role].name}</Chip>}
            {isAdmin && (
              <button type="button" onClick={() => setEditing(u)} aria-label={`Edit login of ${u.name}`} className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-line-2">
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
      {LIVE && (
        <p className="mt-3 flex items-start gap-1.5 px-1 text-xs text-muted">
          <ShieldCheck className="mt-px size-3.5 shrink-0" /> Logins are added and changed by your administrator.
        </p>
      )}
      {editing && <EditLoginSheet user={editing} self={editing.id === me?.id} onClose={() => setEditing(null)} />}
      {adding && <AddLoginSheet onClose={() => setAdding(false)} />}
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: "owner" as const, label: "Owner", sub: "Everything except logins" },
  { value: "collector" as const, label: "Collector", sub: "Own customers, takes payments" },
  { value: "staff" as const, label: "Staff", sub: "Adds customers, no money" },
];

const passwordWrong = (p: string) => (p.length < 8 ? "The password needs at least 8 characters." : null);

/** Admin: add a login. The person signs in at once with the mobile number and this password. */
function AddLoginSheet({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: "", phone: "", area: "", password: "" });
  const [role, setRole] = useState<AppUser["role"]>("collector");
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, run } = useSave();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const phone = f.phone.replace(/\D/g, "");
    const p = !f.name.trim() ? "Enter the person's name." : phone.length !== 10 ? "Enter a 10-digit mobile number." : passwordWrong(f.password);
    setProblem(p);
    if (p) return;
    const user = await run(() => actions.addUser({ name: f.name.trim(), phone, role, area: f.area.trim() || undefined, password: f.password }));
    if (!user) return;
    toast(`Login added for ${user.name}`);
    onClose();
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Add User"
      subtitle="They sign in with this mobile number and password"
      footer={
        <Button size="lg" className="w-full" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Add User"}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Name" required>
          <Input value={f.name} onChange={set("name")} autoComplete="off" maxLength={60} />
        </Field>
        <Field label="Mobile Number" required>
          <Input value={f.phone} onChange={set("phone")} inputMode="tel" placeholder="98765 43210" autoComplete="off" />
        </Field>
        <Field label="Role" group>
          <OptionGrid cols={3} value={role} onChange={setRole} options={ROLE_OPTIONS} />
        </Field>
        {role === "collector" && (
          <Field label="Area (optional)">
            <Input value={f.area} onChange={set("area")} placeholder="e.g. Perundurai" />
          </Field>
        )}
        <Field label="Starting Password" required hint="Tell them this password. They can change it later in Settings.">
          <Input value={f.password} onChange={set("password")} autoComplete="new-password" />
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

/** Admin: change a login's name, role or area, switch it off or on, or give it a new password. */
function EditLoginSheet({ user, self, onClose }: { user: AppUser; self: boolean; onClose: () => void }) {
  const [name, setName] = useState(user.name);
  const [area, setArea] = useState(user.area ?? "");
  const [role, setRole] = useState<AppUser["role"]>(user.role);
  const [password, setPassword] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, run } = useSave();
  // an admin keeps the owner role, and nobody can lock themselves out
  const fixedRole = self || !!user.isAdmin;

  const save = async () => {
    const p = !name.trim() ? "Enter a name." : null;
    setProblem(p);
    if (p) return;
    const patch = { name: name.trim(), area: area.trim(), ...(fixedRole ? {} : { role }) };
    if (!(await run(() => actions.updateUser(user.id, patch).then(() => true)))) return;
    toast("Login updated");
    onClose();
  };
  const switchActive = async () => {
    if (!(await run(() => actions.updateUser(user.id, { active: !user.active }).then(() => true)))) return;
    toast(user.active ? `${user.name} can no longer sign in` : `${user.name} can sign in again`);
    onClose();
  };
  const reset = async () => {
    const p = passwordWrong(password);
    setProblem(p);
    if (p) return;
    if (!(await run(() => actions.resetUserPassword(user.id, password).then(() => true)))) return;
    toast(`New password set for ${user.name}`);
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit Login"
      subtitle={`${phoneFmt(user.phone)}${user.isAdmin ? " · Admin" : ""}`}
      footer={
        <Button size="lg" className="w-full" disabled={busy} onClick={save}>
          {busy ? "Saving…" : "Save Changes"}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={60} />
        </Field>
        {fixedRole ? (
          <p className="rounded-xl bg-line-2/80 px-3 py-2.5 text-sm text-ink-2">{self ? "You cannot change your own role." : "An admin login is always an owner."}</p>
        ) : (
          <Field label="Role" group>
            <OptionGrid cols={3} value={role} onChange={setRole} options={ROLE_OPTIONS} />
          </Field>
        )}
        <Field label="Area (optional)">
          <Input value={area} onChange={(e) => setArea(e.target.value)} />
        </Field>

        <div className="border-t border-line-2 pt-4">
          <Field label="New Password" hint="For a forgotten password. Tell them the new one.">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <Button variant="secondary" className="mt-2.5 w-full" disabled={busy || !password} onClick={reset}>
            Set New Password
          </Button>
        </div>

        {!self && (
          <div className="border-t border-line-2 pt-4">
            <Button variant={user.active ? "danger" : "secondary"} className="w-full" disabled={busy} onClick={switchActive}>
              {user.active ? "Switch Off This Login" : "Switch This Login On"}
            </Button>
            <p className="mt-1.5 text-[13px] text-muted">{user.active ? "They will not be able to sign in or see anything. Their past entries stay." : "They can sign in again with their password."}</p>
          </div>
        )}
        {problem && (
          <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800">
            {problem}
          </p>
        )}
      </div>
    </Sheet>
  );
}
