"use client";

import { createContext, useContext } from "react";

export interface PaymentOpenOptions {
  dueId?: string;
  preset?: "due" | "settle";
}

export interface UIActions {
  /** Open Receive Payment. With no loanId the sheet first asks which customer/loan. */
  openPayment: (loanId?: string, opts?: PaymentOpenOptions) => void;
  openReschedule: (dueId: string) => void;
  openSearch: () => void;
  openQuick: () => void;
}

export const UIContext = createContext<UIActions | null>(null);

export function useUI(): UIActions {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used inside AppShell");
  return ctx;
}
