"use client";

import { clsx } from "clsx";
import { ArrowDown, ArrowUp, Check, ChevronRight, Columns3, FileSearch, Search, SlidersHorizontal, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { Card, EmptyState } from "@/components/ui/bits";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toast";

export interface Column<R> {
  key: string;
  label: string;
  render: (r: R) => ReactNode;
  /** Value used for sorting; columns without it are not sortable. */
  sort?: (r: R) => number | string;
  align?: "right";
  /** Customer column: always shown, becomes the card title on mobile. */
  primary?: boolean;
  /** Status column: shown in the card's top-right corner on mobile. */
  status?: boolean;
}

export interface FilterGroup {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; count?: number }[];
}

// ---------------------------------------------------------------------------
// Column preference (per report) — live state + "Save as default" in localStorage
// ---------------------------------------------------------------------------

const storageKey = (id: string) => `ledgerpro-cols-${id}`;

function readSaved(id: string): string[] | null {
  try {
    const raw = localStorage.getItem(storageKey(id));
    return raw ? (JSON.parse(raw) as string[]) : null;
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

function useColumns(id: string, factory: string[]) {
  // Saved default is read on the client only (null during prerender).
  const saved = useSyncExternalStore(noopSubscribe, () => localStorage.getItem(storageKey(id)), () => null);
  const [live, setLive] = useState<string[] | null>(null);
  const initial = (saved ? readSaved(id) : null) ?? factory;
  const visible = live ?? initial;
  return {
    visible,
    toggle: (key: string) => setLive(visible.includes(key) ? visible.filter((k) => k !== key) : [...visible, key]),
    reset: () => setLive(factory),
    save: () => {
      try {
        localStorage.setItem(storageKey(id), JSON.stringify(visible));
      } catch {
        // Storage blocked: the view still applies for this session.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Report table
// ---------------------------------------------------------------------------

export function DataReport<R>({
  id,
  rows,
  columns,
  defaultColumns,
  rowKey,
  href,
  searchText,
  searchPlaceholder = "Search customer or loan",
  filters = [],
  sortOptions,
  defaultSort,
  cardSub,
  countLabel,
}: {
  id: string;
  rows: R[];
  columns: Column<R>[];
  defaultColumns: string[];
  rowKey: (r: R) => string;
  href?: (r: R) => string;
  searchText: (r: R) => string;
  searchPlaceholder?: string;
  filters?: FilterGroup[];
  /** Keys of sortable columns to offer in the Filter sheet (mobile sort). */
  sortOptions?: string[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  /** Second line under the customer name on mobile cards. */
  cardSub?: (r: R) => ReactNode;
  countLabel: (n: number) => string;
}) {
  const router = useRouter();
  const cols = useColumns(id, defaultColumns);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState(defaultSort ?? null);
  const [panel, setPanel] = useState<"filter" | "columns" | null>(null);

  const shown = columns.filter((c) => c.primary || cols.visible.includes(c.key));
  const nq = q.trim().toLowerCase().replace(/\s/g, "");
  let list = nq ? rows.filter((r) => searchText(r).toLowerCase().replace(/\s/g, "").includes(nq)) : rows;
  const sortCol = sort && columns.find((c) => c.key === sort.key);
  if (sortCol?.sort) {
    const f = sortCol.sort;
    list = [...list].sort((a, b) => {
      const x = f(a);
      const y = f(b);
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort!.dir === "asc" ? cmp : -cmp;
    });
  }

  const activeFilters = filters.filter((f) => f.value !== "all");
  const toggleSort = (key: string) =>
    setSort((cur) => (cur?.key === key ? { key, dir: cur.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" }));

  const titleCol = columns.find((c) => c.primary);
  const statusCol = shown.find((c) => c.status);
  const fieldCols = shown.filter((c) => !c.primary && !c.status);

  return (
    <div>
      {/* Toolbar */}
      <div className="flex gap-2">
        <div className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
          <Search className="size-4.5 shrink-0 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-faint" />
          {q && (
            <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="grid size-6 place-items-center rounded-full bg-line text-muted">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        {(filters.length > 0 || sortOptions) && (
          <ToolButton onClick={() => setPanel("filter")} icon={<SlidersHorizontal className="size-4.5" />} label="Filter" badge={activeFilters.length} />
        )}
        <ToolButton onClick={() => setPanel("columns")} icon={<Columns3 className="size-4.5" />} label="Columns" />
      </div>

      {/* Active filters + count */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-muted">{countLabel(list.length)}</span>
        {activeFilters.map((f) => (
          <button key={f.label} type="button" onClick={() => f.onChange("all")} className="flex h-7 items-center gap-1 rounded-full bg-ink px-2.5 text-xs font-semibold text-white">
            {f.options.find((o) => o.value === f.value)?.label}
            <X className="size-3" />
          </button>
        ))}
        {sortCol && (
          <span className="ml-auto flex items-center gap-1 text-xs font-semibold text-muted">
            Sorted by {sortCol.label} {sort!.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
          </span>
        )}
      </div>

      {list.length === 0 ? (
        <Card className="mt-3">
          <EmptyState icon={FileSearch} title="Nothing to show" text="Try another period, filter or search." />
        </Card>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="mt-3 space-y-2.5 md:hidden">
            {list.map((r) => (
              <div
                key={rowKey(r)}
                role={href ? "link" : undefined}
                onClick={href ? () => router.push(href(r)) : undefined}
                className={clsx("rounded-3xl border border-line bg-surface p-4", href && "cursor-pointer active:scale-[0.99]")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[16px] font-bold">{titleCol?.render(r)}</div>
                    {cardSub && <div className="truncate text-[13px] text-muted">{cardSub(r)}</div>}
                  </div>
                  {statusCol && <div className="shrink-0">{statusCol.render(r)}</div>}
                </div>
                {fieldCols.length > 0 && (
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-2xl bg-line-2/70 p-3">
                    {fieldCols.map((c) => (
                      <div key={c.key} className="min-w-0">
                        <p className="truncate text-[11px] text-muted">{c.label}</p>
                        <div className="num truncate text-[14px] font-semibold">{c.render(r)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Tablet / desktop table */}
          <Card className="mt-3 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-[14px]">
              <thead className="border-b border-line bg-line-2/60 text-xs font-bold tracking-[0.04em] text-muted uppercase">
                <tr>
                  {shown.map((c) => (
                    <th key={c.key} className={clsx("px-3 py-3 whitespace-nowrap first:pl-5", c.align === "right" && "text-right")}>
                      {c.sort ? (
                        <button type="button" onClick={() => toggleSort(c.key)} className={clsx("inline-flex items-center gap-1 uppercase hover:text-ink", sort?.key === c.key && "text-ink")}>
                          {c.label}
                          {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  ))}
                  {href && <th className="w-8" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {list.map((r) => (
                  <tr key={rowKey(r)} onClick={href ? () => router.push(href(r)) : undefined} className={clsx(href && "cursor-pointer hover:bg-line-2/50")}>
                    {shown.map((c) => (
                      <td key={c.key} className={clsx("num px-3 py-3 whitespace-nowrap first:pl-5", c.align === "right" && "text-right", c.primary && "font-semibold")}>
                        {c.render(r)}
                      </td>
                    ))}
                    {href && (
                      <td className="pr-4 text-faint">
                        <ChevronRight className="size-4" />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {/* Filter + sort sheet */}
      <Sheet open={panel === "filter"} onClose={() => setPanel(null)} title="Filter" footer={<Button size="lg" className="w-full" onClick={() => setPanel(null)}>Show {countLabel(list.length)}</Button>}>
        <div className="space-y-6 pb-2">
          {filters.map((f) => (
            <div key={f.label}>
              <p className="mb-2 text-sm font-bold text-ink-2">{f.label}</p>
              <div className="flex flex-wrap gap-2">
                {f.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => f.onChange(o.value)}
                    className={clsx(
                      "flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition",
                      f.value === o.value ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2",
                    )}
                  >
                    {o.label}
                    {o.count !== undefined && <span className={clsx("num text-xs", f.value === o.value ? "text-white/70" : "text-faint")}>{o.count}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {sortOptions && (
            <div>
              <p className="mb-2 text-sm font-bold text-ink-2">Sort by</p>
              <div className="flex flex-wrap gap-2">
                {sortOptions.map((key) => {
                  const c = columns.find((x) => x.key === key);
                  const on = sort?.key === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleSort(key)}
                      className={clsx("flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold", on ? "border-brand-600 bg-brand-50 text-brand-800 ring-1 ring-brand-600" : "border-line text-ink-2")}
                    >
                      {c?.label}
                      {on && (sort!.dir === "asc" ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />)}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-muted">Tap again to switch high → low / low → high.</p>
            </div>
          )}
        </div>
      </Sheet>

      {/* Columns sheet */}
      <Sheet
        open={panel === "columns"}
        onClose={() => setPanel(null)}
        title="Columns"
        subtitle="Changes apply straight away"
        footer={
          <div className="grid grid-cols-[auto_1fr] gap-2.5">
            <Button variant="secondary" size="lg" onClick={cols.reset}>
              Reset
            </Button>
            <Button
              size="lg"
              onClick={() => {
                cols.save();
                toast("Column view saved as default");
                setPanel(null);
              }}
            >
              Save as Default
            </Button>
          </div>
        }
      >
        <ColumnList columns={columns} visible={cols.visible} defaults={defaultColumns} onToggle={cols.toggle} />
      </Sheet>
    </div>
  );
}

function ColumnList<R>({ columns, visible, defaults, onToggle }: { columns: Column<R>[]; visible: string[]; defaults: string[]; onToggle: (k: string) => void }) {
  const main = columns.filter((c) => c.primary || defaults.includes(c.key));
  const extra = columns.filter((c) => !c.primary && !defaults.includes(c.key));
  const item = (c: Column<R>) => {
    const on = c.primary || visible.includes(c.key);
    return (
      <button
        key={c.key}
        type="button"
        disabled={c.primary}
        onClick={() => onToggle(c.key)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-line-2/60 disabled:opacity-60"
      >
        <span className={clsx("grid size-6 shrink-0 place-items-center rounded-lg border-2 transition", on ? "border-brand-700 bg-brand-700 text-white" : "border-line")}>
          {on && <Check className="size-4" strokeWidth={3} />}
        </span>
        <span className="flex-1 text-[15px] font-semibold">{c.label}</span>
        {c.primary && <span className="text-xs text-muted">Always</span>}
      </button>
    );
  };
  return (
    <div className="space-y-4 pb-3">
      <div>
        <p className="mb-1.5 px-1 text-xs font-bold tracking-[0.08em] text-muted uppercase">Shown by default</p>
        <div className="divide-y divide-line-2 overflow-hidden rounded-2xl border border-line">{main.map(item)}</div>
      </div>
      {extra.length > 0 && (
        <div>
          <p className="mb-1.5 px-1 text-xs font-bold tracking-[0.08em] text-muted uppercase">Optional</p>
          <div className="divide-y divide-line-2 overflow-hidden rounded-2xl border border-line">{extra.map(item)}</div>
        </div>
      )}
    </div>
  );
}

function ToolButton({ onClick, icon, label, badge }: { onClick: () => void; icon: ReactNode; label: string; badge?: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="relative flex h-11 shrink-0 items-center gap-1.5 rounded-2xl border border-line bg-surface px-3 text-sm font-semibold text-ink-2 transition hover:border-faint sm:px-3.5"
    >
      {icon}
      <span>{label}</span>
      {!!badge && <span className="num absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-brand-700 text-[11px] text-white">{badge}</span>}
    </button>
  );
}

