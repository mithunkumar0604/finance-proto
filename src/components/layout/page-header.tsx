"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/** Sticky title bar for inner pages. On mobile shows a back button. */
export function PageHeader({ title, subtitle, back = true, actions }: { title: ReactNode; subtitle?: ReactNode; back?: boolean; actions?: ReactNode }) {
  const router = useRouter();
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 bg-canvas/90 px-2 pt-[max(8px,env(safe-area-inset-top))] pb-2 backdrop-blur-md md:static md:mx-0 md:mb-6 md:bg-transparent md:px-0 md:pt-0 md:backdrop-blur-none">
      <div className="flex min-h-12 items-center gap-1">
        {back && (
          <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/home/"))} aria-label="Back" className="grid size-11 shrink-0 place-items-center rounded-full text-ink-2 hover:bg-line-2 md:-ml-2">
            <ArrowLeft className="size-5" />
          </button>
        )}
        <div className={back ? "min-w-0 flex-1" : "min-w-0 flex-1 px-2 md:px-0"}>
          <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
          {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
    </header>
  );
}
