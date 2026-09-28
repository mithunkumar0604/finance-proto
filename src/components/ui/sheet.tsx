"use client";

import { clsx } from "clsx";
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

/**
 * Bottom sheet on phones, centred dialog on tablet/desktop.
 * Content scrolls inside; the footer stays pinned above the keyboard/safe area.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "md" | "lg";
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true">
      <div className="absolute inset-0 animate-fade-in bg-[#0b1512]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        className={clsx(
          "relative flex max-h-[92dvh] w-full animate-sheet-up flex-col rounded-t-[28px] bg-surface shadow-2xl md:max-h-[88dvh] md:animate-pop md:rounded-[28px]",
          size === "lg" ? "md:max-w-2xl" : "md:max-w-lg",
        )}
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-black/10 md:hidden" />
        {(title || subtitle) && (
          <div className="flex shrink-0 items-start gap-3 px-5 pt-3 pb-3 md:px-6 md:pt-6">
            <div className="min-w-0 flex-1">
              {title && <h2 className="text-xl font-bold tracking-tight text-ink">{title}</h2>}
              {subtitle && <div className="mt-0.5 text-sm text-muted">{subtitle}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 -mr-2 grid size-10 place-items-center rounded-full text-muted hover:bg-line-2">
              <X className="size-5" />
            </button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 md:px-6">{children}</div>
        {footer && <div className="pb-safe shrink-0 border-t border-line-2 bg-surface px-5 pt-3 md:rounded-b-[28px] md:px-6 md:pb-5"><div className="pb-3 md:pb-0">{footer}</div></div>}
      </div>
    </div>
  );
}
