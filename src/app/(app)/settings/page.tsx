"use client";

import { clsx } from "clsx";
import { KeyRound, Laptop, Lock, LockKeyhole, LogOut, RotateCcw, Smartphone, Tablet, Timer } from "lucide-react";
import { useState } from "react";
import { PinPad } from "@/components/layout/lock-screen";
import { PageHeader } from "@/components/layout/page-header";
import { Card, Chip, SectionHeader } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";
import { MIN_PASSWORD, passwordProblem } from "@/lib/password";
import { actions, LIVE, useAppState } from "@/lib/store";
import { useSave } from "@/lib/use-save";

const DEVICES = [
  { id: "d1", icon: Smartphone, name: "This phone", detail: "Chrome · Perundurai", current: true, when: "Active now" },
  { id: "d2", icon: Laptop, name: "Office laptop", detail: "Chrome · Windows", when: "Yesterday, 5:05 PM" },
  { id: "d3", icon: Tablet, name: "Mani's phone (Collector)", detail: "Android app", when: "Today, 11:20 AM" },
];

export default function SettingsPage() {
  const s = useAppState();
  // LIVE: only this device is listed; other sign-ins are ended on the server, not in a list.
  const [devices, setDevices] = useState(LIVE ? DEVICES.filter((d) => d.current) : DEVICES);
  const { busy, run } = useSave();
  const [pinStep, setPinStep] = useState<"closed" | "current" | "new">("closed");
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" subtitle="Privacy & security" />

      <SectionHeader title="Privacy" />
      <Card className="mb-6 divide-y divide-line-2 overflow-hidden">
        <div className="px-4 py-4">
          <div className="mb-3 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-700">
              <Timer className="size-5" />
            </span>
            <div>
              <p className="font-semibold">Automatic screen lock</p>
              <p className="text-[13px] text-muted">Asks for PIN after no activity</p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 5, 15].map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  actions.updateSettings({ autoLockMinutes: m });
                  toast(m ? `Auto-lock after ${m} min` : "Auto-lock turned off");
                }}
                className={clsx(
                  "h-11 rounded-xl border text-sm font-semibold",
                  s.settings.autoLockMinutes === m ? "border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600" : "border-line text-ink-2",
                )}
              >
                {m ? `${m} min` : "Off"}
              </button>
            ))}
          </div>
        </div>
        <Action icon={KeyRound} label="Change PIN" sub="4-digit PIN used to unlock" onClick={() => setPinStep("current")} />
        <Action icon={Lock} label="Lock Application now" onClick={actions.lock} />
      </Card>

      {LIVE && (
        <>
          <SectionHeader title="Security" />
          <Card className="mb-6 overflow-hidden">
            <Action icon={LockKeyhole} label="Change Password" sub="The password used to sign in" onClick={() => setChangingPassword(true)} />
          </Card>
        </>
      )}

      <SectionHeader title="Device Sessions" />
      <Card className="mb-3 divide-y divide-line-2 overflow-hidden">
        {devices.map((d) => (
          <div key={d.id} className="flex items-center gap-3 px-4 py-3.5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
              <d.icon className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 font-semibold">
                {d.name} {d.current && <Chip tone="green">This device</Chip>}
              </p>
              <p className="truncate text-[13px] text-muted">
                {d.detail} · {d.when}
              </p>
            </div>
            {!d.current && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDevices(devices.filter((x) => x.id !== d.id));
                  toast(`${d.name} signed out`);
                }}
              >
                Sign out
              </Button>
            )}
          </div>
        ))}
      </Card>
      <Button
        variant="danger"
        className="mb-8 w-full"
        disabled={LIVE ? busy : devices.length === 1}
        onClick={async () => {
          if (LIVE && !(await run(() => actions.logoutOthers().then(() => true)))) return;
          setDevices(devices.filter((x) => x.current));
          toast(LIVE ? "Other devices logged out. You are still signed in here." : "All other devices logged out");
        }}
      >
        <LogOut className="size-4" /> Logout all other devices
      </Button>

      {!LIVE && <SectionHeader title="Prototype" />}
      <Card className={LIVE ? "hidden" : "overflow-hidden"}>
        <Action
          icon={RotateCcw}
          label="Reset demo data"
          sub="Undo all payments & changes made in this demo"
          onClick={() => {
            actions.resetDemo();
            toast("Demo data reset");
          }}
        />
      </Card>

      {changingPassword && <ChangePasswordSheet onClose={() => setChangingPassword(false)} />}

      <Sheet open={pinStep !== "closed"} onClose={() => setPinStep("closed")}>
        <div className="-mx-5 -mb-4 flex flex-col items-center rounded-t-[28px] bg-brand-900 px-6 pt-8 pb-10 text-white md:rounded-[28px]">
          <h2 className="mb-1 text-xl font-bold">{pinStep === "current" ? "Enter current PIN" : "Enter new PIN"}</h2>
          <p className="mb-8 text-sm text-white/65">{pinStep === "current" ? "To confirm it's you" : "Choose 4 digits you'll remember"}</p>
          <PinPad
            key={pinStep}
            error={pinStep === "current" ? (LIVE ? "Wrong PIN. Try again" : "Demo PIN: " + s.settings.pin) : undefined}
            onComplete={(pin) => {
              if (pinStep === "current") {
                if (pin !== s.settings.pin) return false;
                setPinStep("new");
                return true;
              }
              actions.updateSettings({ pin });
              setPinStep("closed");
              toast("PIN changed");
              return true;
            }}
          />
        </div>
      </Sheet>
    </div>
  );
}

function ChangePasswordSheet({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { busy, run } = useSave();

  const submit = async () => {
    const p = passwordProblem(current, next, confirm);
    setProblem(p);
    if (p) return;
    const done = await run(() => actions.changePassword(current, next).then((othersOut) => ({ othersOut })));
    if (!done) return;
    if (done.othersOut) toast("Password changed");
    else toast("Password changed, but other devices could not be signed out. Use \"Logout all other devices\" below.", "error");
    onClose();
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title="Change Password"
      subtitle="You stay signed in on this device. Other devices are signed out."
      footer={
        <Button size="lg" className="w-full" disabled={busy} onClick={submit}>
          {busy ? "Saving…" : "Change Password"}
        </Button>
      }
    >
      <form
        className="space-y-4 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label="Current Password">
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New Password" hint={`At least ${MIN_PASSWORD} characters`}>
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
        <Field label="Confirm Password">
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        {problem && (
          <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-800">
            {problem}
          </p>
        )}
        {/* lets Enter on the keyboard submit */}
        <button type="submit" className="hidden" />
      </form>
    </Sheet>
  );
}

function Action({ icon: Icon, label, sub, onClick }: { icon: typeof Lock; label: string; sub?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-line-2/60">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        {sub && <span className="block text-[13px] text-muted">{sub}</span>}
      </span>
    </button>
  );
}
