"use client";

import { clsx } from "clsx";
import { Check, ChevronDown, Search, Users, X } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/bits";
import { Sheet } from "@/components/ui/sheet";
import { phoneFmt } from "@/lib/format";
import type { Customer } from "@/lib/types";

/** Searchable person dropdown: "All People" or one customer (search by name or phone). */
export function PersonPicker({ people, value, onChange }: { people: Customer[]; value: string | null; onChange: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = people.find((p) => p.id === value);
  const nq = q.toLowerCase().replace(/\s/g, "");
  const list = [...people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter((p) => !nq || p.name.toLowerCase().replace(/\s/g, "").includes(nq) || p.phone.includes(nq));

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQ("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-13 w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-left transition hover:border-faint"
      >
        {selected ? (
          <Avatar name={selected.name} size="sm" className="size-8 text-[11px]" />
        ) : (
          <span className="grid size-8 place-items-center rounded-full bg-brand-50 text-brand-700">
            <Users className="size-4" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{selected ? selected.name : "All People"}</span>
        <ChevronDown className="size-5 text-muted" />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Choose Person">
        <div className="sticky top-0 z-10 -mx-1 bg-surface px-1 pb-3">
          <div className="flex h-13 items-center gap-2.5 rounded-2xl border border-line px-4 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
            <Search className="size-5 text-muted" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type name or phone" className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
            {q && (
              <button type="button" onClick={() => setQ("")} aria-label="Clear" className="grid size-7 place-items-center rounded-full bg-line text-muted">
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="mb-4 divide-y divide-line-2 overflow-hidden rounded-2xl border border-line">
          {!nq && <Option label="All People" sub={`${people.length} people`} on={!value} onClick={() => pick(null)} all />}
          {list.map((p) => (
            <Option key={p.id} label={p.name} sub={`${phoneFmt(p.phone)} · ${p.area}`} on={value === p.id} onClick={() => pick(p.id)} />
          ))}
          {list.length === 0 && <p className="px-4 py-8 text-center text-sm text-muted">No person found</p>}
        </div>
      </Sheet>
    </>
  );
}

function Option({ label, sub, on, onClick, all }: { label: string; sub: string; on: boolean; onClick: () => void; all?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={clsx("flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-line-2/60", on && "bg-brand-50")}>
      {all ? (
        <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-brand-700">
          <Users className="size-4.5" />
        </span>
      ) : (
        <Avatar name={label} size="sm" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold">{label}</span>
        <span className="num block truncate text-sm text-muted">{sub}</span>
      </span>
      {on && <Check className="size-5 text-brand-700" />}
    </button>
  );
}
