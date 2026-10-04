"use client";

import { useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { AppError } from "./data/mappers";
import { FinanceError } from "./finance/engine";

/** The message to show for anything a save can throw. Never raw technical text. */
export function errorText(e: unknown): string {
  if (e instanceof FinanceError || e instanceof AppError) return e.message;
  return "This could not be saved. Nothing was changed. Please try again.";
}

/**
 * Runs a save: `busy` is true while it is in progress (disable the button), a second
 * press while busy is ignored, and a failure is shown to the user. Resolves to the
 * result, or undefined when the save failed.
 */
export function useSave() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await work();
    } catch (e) {
      toast(errorText(e), "error");
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  return { busy, run };
}
