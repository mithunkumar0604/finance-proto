"use client";

import { CheckCircle2 } from "lucide-react";
import { useSyncExternalStore } from "react";

let current: { id: number; text: string } | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string) {
  current = { id: Date.now(), text };
  listeners.forEach((l) => l());
  clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    listeners.forEach((l) => l());
  }, 2600);
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
      <div key={t.id} className="flex animate-page items-center gap-2.5 rounded-2xl bg-ink px-4 py-3 text-sm font-semibold text-white shadow-xl">
        <CheckCircle2 className="size-5 text-emerald-300" />
        {t.text}
      </div>
    </div>
  );
}
