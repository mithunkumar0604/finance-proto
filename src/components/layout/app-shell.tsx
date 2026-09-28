"use client";

import { Eye } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ReceivePaymentSheet } from "@/components/payments/receive-payment-sheet";
import { RescheduleSheet } from "@/components/loans/reschedule-sheet";
import { Skeleton } from "@/components/ui/bits";
import { Toaster } from "@/components/ui/toast";
import { actions, useMaybeAppState } from "@/lib/store";
import { LockScreen } from "./lock-screen";
import { BottomNav, Sidebar } from "./nav";
import { QuickActions } from "./quick-actions";
import { SearchOverlay } from "./search-overlay";
import { UIContext, type PaymentOpenOptions, type UIActions } from "./ui-context";

type Overlay =
  | { kind: "payment"; loanId?: string; opts?: PaymentOpenOptions; key: number }
  | { kind: "reschedule"; dueId: string }
  | { kind: "search" }
  | { kind: "quick" }
  | null;

export function AppShell({ children }: { children: ReactNode }) {
  const s = useMaybeAppState();
  const router = useRouter();
  const path = usePathname();
  const [overlay, setOverlay] = useState<Overlay>(null);

  const loggedIn = s?.session.loggedIn;
  useEffect(() => {
    if (s && !loggedIn) router.replace("/");
  }, [s, loggedIn, router]);

  useAutoLock(s?.settings.autoLockMinutes ?? 0, !!loggedIn && !s?.session.locked);

  const close = useCallback(() => setOverlay(null), []);
  const ui: UIActions = useMemo(
    () => ({
      openPayment: (loanId, opts) => setOverlay({ kind: "payment", loanId, opts, key: Date.now() }),
      openReschedule: (dueId) => setOverlay({ kind: "reschedule", dueId }),
      openSearch: () => setOverlay({ kind: "search" }),
      openQuick: () => setOverlay({ kind: "quick" }),
    }),
    [],
  );

  if (!s || !loggedIn) return <ShellSkeleton />;

  const role = s.session.viewAs;
  const viewer = s.users.find((u) => u.role === role);

  return (
    <UIContext.Provider value={ui}>
      <Sidebar />
      <div className="min-h-dvh pb-28 md:pb-10 md:pl-64">
        {role !== "owner" && (
          <div className="relative z-30 flex items-center justify-center gap-2 bg-indigo-700 px-4 py-2 pt-[max(8px,env(safe-area-inset-top))] text-center text-sm font-semibold text-white">
            <Eye className="size-4" />
            Viewing as {viewer?.name} ({role === "collector" ? "Collector" : "Staff"})
            <button type="button" onClick={() => actions.setViewAs("owner")} className="ml-1 rounded-full bg-white/15 px-2.5 py-0.5 text-xs hover:bg-white/25">
              Back to Owner
            </button>
          </div>
        )}
        <main key={path} className="mx-auto w-full max-w-[1120px] animate-page px-4 md:px-8 md:pt-8">
          {children}
        </main>
      </div>
      <BottomNav />

      {overlay?.kind === "payment" && (
        <ReceivePaymentSheet key={overlay.key} loanId={overlay.loanId} dueId={overlay.opts?.dueId} preset={overlay.opts?.preset} onClose={close} />
      )}
      {overlay?.kind === "reschedule" && <RescheduleSheet dueId={overlay.dueId} onClose={close} />}
      {overlay?.kind === "search" && <SearchOverlay onClose={close} />}
      <QuickActions open={overlay?.kind === "quick"} onClose={close} onReceive={() => ui.openPayment()} />

      {s.session.locked && <LockScreen />}
      <Toaster />
    </UIContext.Provider>
  );
}

/** Locks the app after N minutes without touches/keys, or when the tab is hidden that long. */
function useAutoLock(minutes: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled || minutes <= 0) return;
    const ms = minutes * 60_000;
    let timer = setTimeout(actions.lock, ms);
    let hiddenAt = 0;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(actions.lock, ms);
    };
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= ms) actions.lock();
    };
    const events = ["pointerdown", "keydown", "scroll"] as const;
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [minutes, enabled]);
}

function ShellSkeleton() {
  return (
    <div className="md:pl-64">
      <div className="mx-auto max-w-[1120px] space-y-4 px-4 pt-6 md:px-8 md:pt-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-13 w-full" />
        <Skeleton className="h-48 w-full rounded-3xl" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-24 rounded-3xl" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-3xl" />
      </div>
    </div>
  );
}
