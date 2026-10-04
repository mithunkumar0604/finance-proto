"use client";

import { useEffect, useState } from "react";
import { toast } from "@/components/ui/toast";
import { actions, LIVE } from "./store";
import type { ISODate } from "./types";
import { errorText } from "./use-save";

// The app starts with recent history only. These hooks read older history when a
// screen needs it. In the demo everything is already in memory, so they do nothing.

/** Loan and customer pages: the full history of these loans. */
export function useLoanHistory(loanIds: string[]) {
  const key = loanIds.join(",");
  useEffect(() => {
    if (!LIVE || !key) return;
    actions.ensureLoans(key.split(",")).catch((e) => toast(errorText(e), "error"));
  }, [key]);
}

/** Reports: history back to `from`. Returns true while it is being read. */
export function useHistoryFrom(from: ISODate | undefined): boolean {
  const [loaded, setLoaded] = useState<ISODate | null>(null);
  useEffect(() => {
    if (!LIVE || !from) return;
    let alive = true;
    actions
      .ensureHistory(from)
      .catch((e) => toast(errorText(e), "error"))
      .finally(() => alive && setLoaded(from));
    return () => {
      alive = false;
    };
  }, [from]);
  return LIVE && !!from && loaded !== from;
}
