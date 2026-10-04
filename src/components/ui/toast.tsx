"use client";

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { useSyncExternalStore } from "react";

let current: { id: number; text: string; kind: "ok" | "error" } | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string, kind: "ok" | "error" = "ok") {
  current = { id: Date.now(), text, kind };
  listeners.forEach((l) => l());
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    listeners.forEach((l) => l());
  }, kind === "error" ? 6000 : 2600);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function Toaster() {
  const t = useSyncExternalStore(subscribe, () => current, () => null);
  if (!t) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(16px,env(safe-area-inset-top))] z-[70] flex justify-center px-4">
      <div key={t.id} role={t.kind === "error" ? "alert" : "status"} className="flex animate-page items-center gap-2.5 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-xl">
        {t.kind === "error" ? <AlertCircle className="size-5 shrink-0 text-rose-300" /> : <CheckCircle2 className="size-5 shrink-0 text-emerald-300" />}
        {t.text}
      </div>
    </div>
  );
}
