"use client";

import { Check, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/layout/nav";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { APP } from "@/lib/config";
import { actions, useMaybeAppState } from "@/lib/store";

export default function LoginPage() {
  const router = useRouter();
  const s = useMaybeAppState();
  const [user, setUser] = useState("98000 12345");
  const [pin, setPin] = useState("1234");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const loggedIn = s?.session.loggedIn;
  useEffect(() => {
    if (loggedIn) router.replace("/home/");
  }, [loggedIn, router]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      actions.login();
      router.replace("/home/");
    }, 450);
  };

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Brand panel (desktop) / header (mobile) */}
      <div className="relative overflow-hidden bg-[radial-gradient(120%_90%_at_0%_0%,#0f6f57_0%,#06352c_75%)] px-6 pt-[max(40px,env(safe-area-inset-top))] pb-16 text-white md:flex md:w-[46%] md:flex-col md:justify-between md:p-14">
        <div className="flex items-center gap-3">
          <Logo className="bg-white/12 ring-1 ring-white/20" />
          <div className="leading-tight">
            <p className="text-lg font-extrabold tracking-tight">{APP.name}</p>
            <p className="text-xs text-white/65">{APP.subtitle}</p>
          </div>
        </div>
        <div className="mt-10 md:mt-0">
          <h2 className="max-w-md text-[28px] leading-tight font-bold tracking-tight md:text-4xl">Know who has your money. Every day.</h2>
          <ul className="mt-6 hidden space-y-3 text-white/80 md:block">
            {["Today's collections at a glance", "Every customer, loan and payment in one place", "Private and locked to your PIN"].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-white/15">
                  <Check className="size-3.5" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="hidden text-sm text-white/50 md:block">© {new Date().getFullYear()} {APP.owner.business}</p>
        <svg className="pointer-events-none absolute -right-24 -bottom-24 size-80 text-white/[0.04] md:size-[520px]" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="48" fill="none" stroke="currentColor" strokeWidth="10" />
          <circle cx="50" cy="50" r="24" fill="none" stroke="currentColor" strokeWidth="10" />
        </svg>
      </div>

      {/* Form */}
      <div className="relative z-10 -mt-8 flex flex-1 items-start justify-center rounded-t-[32px] bg-canvas px-6 pt-9 pb-10 md:mt-0 md:items-center md:rounded-none">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h1 className="text-[28px] font-bold tracking-tight">Welcome Back</h1>
          <p className="mt-1 text-muted">Sign in to continue to {APP.name}</p>

          <div className="mt-8 space-y-5">
            <Field label="Mobile / Username">
              <Input value={user} onChange={(e) => setUser(e.target.value)} inputMode="tel" autoComplete="username" />
            </Field>
            <Field label="Password / PIN">
              <div className="relative">
                <Input type={show ? "text" : "password"} value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="current-password" className="pr-12" />
                <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide PIN" : "Show PIN"} className="absolute top-1/2 right-1.5 grid size-10 -translate-y-1/2 place-items-center rounded-xl text-muted hover:bg-line-2">
                  {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </Field>
            <label className="flex cursor-pointer items-center gap-3 select-none">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-5 accent-brand-700" />
              <span className="text-[15px] text-ink-2">Remember this device</span>
            </label>
          </div>

          <Button type="submit" size="lg" className="mt-8 w-full" disabled={busy}>
            {busy ? <span className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" /> : "Sign In"}
          </Button>

          <p className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-muted">
            <ShieldCheck className="size-4 text-brand-600" /> Demo login — details are pre-filled
          </p>
        </form>
      </div>
    </div>
  );
}
