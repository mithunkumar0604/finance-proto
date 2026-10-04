"use client";

import { clsx } from "clsx";
import { Delete, Lock } from "lucide-react";
import { useState } from "react";
import { APP } from "@/lib/config";
import { actions, LIVE } from "@/lib/store";

/** PIN pad used by the lock screen. */
export function PinPad({ onComplete, length = 4, error }: { onComplete: (pin: string) => boolean; length?: number; error?: string }) {
  const [pin, setPin] = useState("");
  const [bad, setBad] = useState(false);

  const press = (d: string) => {
    if (pin.length >= length) return;
    const next = pin + d;
    setPin(next);
    setBad(false);
    if (next.length === length) {
      setTimeout(() => {
        if (!onComplete(next)) {
          setBad(true);
          setPin("");
        }
      }, 120);
    }
  };

  return (
    <div className="flex flex-col items-center">
      <div className={clsx("mb-2 flex gap-4", bad && "animate-shake")}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={clsx("size-3.5 rounded-full transition", i < pin.length ? "scale-110 bg-white" : "bg-white/25")} />
        ))}
      </div>
      <p className={clsx("mb-8 h-5 text-sm", bad ? "text-rose-200" : "text-white/60")}>{bad ? "Wrong PIN, try again" : error}</p>
      <div className="grid grid-cols-3 gap-x-7 gap-y-4">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} onClick={() => press(d)}>{d}</Key>
        ))}
        <span />
        <Key onClick={() => press("0")}>0</Key>
        <button type="button" aria-label="Delete" onClick={() => setPin((p) => p.slice(0, -1))} className="grid size-18 place-items-center rounded-full text-white/80 active:bg-white/10">
          <Delete className="size-6" />
        </button>
      </div>
    </div>
  );
}

function Key({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="num grid size-18 place-items-center rounded-full bg-white/10 text-[28px] font-semibold text-white transition active:scale-95 active:bg-white/25">
      {children}
    </button>
  );
}

export function LockScreen() {
  return (
    <div className="fixed inset-0 z-[80] flex animate-fade-in flex-col items-center justify-center bg-[radial-gradient(120%_80%_at_50%_0%,#0f6f57_0%,#06352c_70%)] px-6 text-white">
      <span className="mb-5 grid size-16 place-items-center rounded-2xl bg-white/12 ring-1 ring-white/20">
        <Lock className="size-7" />
      </span>
      <h1 className="text-2xl font-bold tracking-tight">Application Locked</h1>
      <p className="mt-1.5 mb-10 text-white/70">Enter PIN to continue</p>
      <PinPad onComplete={(p) => actions.unlock(p)} error={LIVE ? "Wrong PIN. Try again" : `Demo PIN: ${APP.demoPin}`} />
      <button type="button" onClick={() => void actions.logout()} className="mt-10 text-sm font-semibold text-white/70 hover:text-white">
        Sign out instead
      </button>
    </div>
  );
}
