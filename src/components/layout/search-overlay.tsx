"use client";

import { ArrowLeft, Car, ChevronRight, Gem, FileText, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Avatar, Chip } from "@/components/ui/bits";
import { LOAN_TYPE_LABEL, money, phoneFmt } from "@/lib/format";
import { search } from "@/lib/selectors";
import { useAppState } from "@/lib/store";

const SUGGESTIONS = ["Ravi", "98765", "TN 33 AB 1234", "LP-1024", "Gold Chain"];

export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const s = useAppState();
  const router = useRouter();
  const [q, setQ] = useState("");
  const hits = search(s, q);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in flex-col bg-canvas md:items-center md:bg-[#0b1512]/45 md:p-10 md:backdrop-blur-[2px]" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="flex min-h-0 w-full flex-1 flex-col bg-canvas md:max-h-[640px] md:max-w-xl md:flex-none md:animate-pop md:rounded-[28px] md:shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-3 pt-[max(12px,env(safe-area-inset-top))] pb-3 md:px-4 md:pt-4">
          <button type="button" onClick={onClose} aria-label="Back" className="grid size-11 place-items-center rounded-full text-ink-2 hover:bg-line-2 md:hidden">
            <ArrowLeft className="size-5" />
          </button>
          <div className="flex h-13 flex-1 items-center gap-2.5 rounded-2xl border border-brand-500 bg-surface px-4 ring-4 ring-brand-500/10">
            <Search className="size-5 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, phone, vehicle, loan..."
              className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint"
              enterKeyHint="search"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear" className="grid size-7 place-items-center rounded-full bg-line text-muted">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8">
          {q.trim().length < 2 ? (
            <div className="pt-4">
              <p className="mb-3 px-1 text-xs font-bold tracking-[0.08em] text-muted uppercase">Try searching</p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((t) => (
                  <button key={t} type="button" onClick={() => setQ(t)} className="h-10 rounded-full border border-line bg-surface px-4 text-sm font-semibold text-ink-2 hover:border-faint">
                    {t}
                  </button>
                ))}
              </div>
            </div>
          ) : hits.length === 0 ? (
            <div className="py-16 text-center">
              <p className="font-semibold">No match for “{q}”</p>
              <p className="mt-1 text-sm text-muted">Try a name, phone number, vehicle number or loan ID.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-3xl border border-line bg-surface">
              {hits.map((h) => {
                const sec = h.loan?.security;
                const Icon = sec?.kind === "vehicle" ? Car : sec?.kind === "jewel" ? Gem : FileText;
                return (
                  <button
                    key={h.kind + h.customer.id + (h.loan?.id ?? "")}
                    type="button"
                    onClick={() => go(h.kind === "loan" ? `/loan/?id=${h.loan!.id}` : `/customer/?id=${h.customer.id}`)}
                    className="flex w-full items-center gap-3 border-b border-line-2 px-4 py-3.5 text-left last:border-0 hover:bg-line-2/60"
                  >
                    {h.kind === "loan" ? (
                      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-700">
                        <Icon className="size-5" />
                      </span>
                    ) : (
                      <Avatar name={h.customer.name} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">
                        {h.kind === "loan" ? `${h.loan!.id} · ${h.customer.name}` : h.customer.name}
                      </p>
                      <p className="truncate text-sm text-muted">
                        {h.kind === "loan"
                          ? `${LOAN_TYPE_LABEL[h.loan!.type]} · ${money(h.loan!.amount)}`
                          : `${phoneFmt(h.customer.phone)} · ${h.customer.area}`}
                      </p>
                    </div>
                    {h.kind === "loan" && sec?.kind === "vehicle" && <Chip tone="brand">{sec.registration}</Chip>}
                    <ChevronRight className="size-5 shrink-0 text-faint" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The prominent fake search field that opens the overlay. */
export function SearchTrigger({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex h-13 w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-left text-[15px] text-faint shadow-[0_1px_2px_rgba(16,32,27,.04)] transition hover:border-faint " +
        (className ?? "")
      }
    >
      <Search className="size-5 text-muted" />
      Search name, phone, vehicle, loan...
    </button>
  );
}
