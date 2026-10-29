"use client";

import { Landmark, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { DeleteLoansSheet } from "@/components/loans/delete-loans-sheet";
import { HEALTH_META } from "@/components/loans/loan-card";
import { Avatar, Card, Chip, EmptyState, FilterChips, Segmented } from "@/components/ui/bits";
import { Button, LinkButton } from "@/components/ui/button";
import { dueRemaining } from "@/lib/finance/engine";
import { dRelative, LOAN_TYPE_SHORT, money, todayISO } from "@/lib/format";
import { currentUser, loanView, permissions, TYPE_GROUPS } from "@/lib/selectors";
import { LIVE, useAppState } from "@/lib/store";

type Tab = "active" | "due" | "overdue" | "closed";

export default function LoansPage() {
  const s = useAppState();
  const router = useRouter();
  const today = todayISO();
  const perm = permissions(s);
  const [tab, setTab] = useState<Tab>("active");
  const [type, setType] = useState("all");
  // LIVE, admin only: pick loans to delete (the database checks the admin mark too)
  const isAdmin = LIVE && !!currentUser(s)?.isAdmin;
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const stopSelecting = () => {
    setSelecting(false);
    setPicked([]);
  };

  const customers = new Map(s.customers.map((c) => [c.id, c]));
  const all = s.loans
    .filter((l) => customers.has(l.customerId) && perm.customerScope(customers.get(l.customerId)!))
    .map((l) => ({ loan: l, customer: customers.get(l.customerId)!, v: loanView(s, l, today) }));

  const inTab = (t: Tab, x: (typeof all)[number]) =>
    t === "active" ? x.loan.status === "active" : t === "due" ? x.v.health === "due" : t === "overdue" ? x.v.health === "overdue" : x.loan.status === "closed";

  const group = TYPE_GROUPS.find((g) => g.key === type);
  const list = all
    .filter((x) => inTab(tab, x) && (!group || group.types.includes(x.loan.type)))
    .sort((a, b) => (a.v.next?.dueDate ?? "9").localeCompare(b.v.next?.dueDate ?? "9"));

  const tabCount = (t: Tab) => all.filter((x) => inTab(t, x)).length;

  return (
    <div>
      <PageHeader
        title="Loans"
        subtitle={`${tabCount("active")} active · ${money(all.filter((x) => x.loan.status === "active").reduce((a, x) => a + x.loan.principalLeft, 0))} outside`}
        back={false}
        actions={
          (isAdmin || perm.createLoan) && (
            <>
              {isAdmin && (
                <Button size="sm" variant="secondary" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>
                  {selecting ? "Cancel" : "Select"}
                </Button>
              )}
              {perm.createLoan && !selecting && (
                <LinkButton href="/loans/new/" size="sm" variant="soft">
                  <Plus className="size-4" /> New
                </LinkButton>
              )}
            </>
          )
        }
      />

      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "active", label: "Active", count: tabCount("active") },
          { value: "due", label: "Due", count: tabCount("due") },
          { value: "overdue", label: "Overdue", count: tabCount("overdue") },
          { value: "closed", label: "Closed", count: tabCount("closed") },
        ]}
      />
      <FilterChips
        className="mt-4"
        value={type}
        onChange={setType}
        options={[{ value: "all", label: "All" }, ...TYPE_GROUPS.map((g) => ({ value: g.key, label: g.label }))]}
      />

      {list.length === 0 ? (
        <Card className="mt-4">
          <EmptyState icon={Landmark} title="No loans here" text="Try another tab or filter." />
        </Card>
      ) : (
        <>
          {/* Mobile: cards */}
          <div className="mt-4 space-y-2.5 md:hidden">
            {list.map(({ loan, customer, v }) => {
              const h = HEALTH_META[v.health];
              const body = (
                <>
                  <div className="flex items-center gap-3">
                    {selecting && (
                      <input type="checkbox" checked={picked.includes(loan.id)} onChange={() => toggle(loan.id)} aria-label={`Select ${loan.id}`} className="size-5 shrink-0 accent-brand-700" />
                    )}
                    <Avatar name={customer.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{customer.name}</p>
                      <p className="text-[13px] text-muted">
                        {loan.id} · {LOAN_TYPE_SHORT[loan.type]}
                      </p>
                    </div>
                    <Chip tone={h.tone} dot>
                      {h.label}
                    </Chip>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl bg-line-2/70 p-3">
                    <Mini label="Given" value={money(loan.amount)} />
                    <Mini label="Outstanding" value={money(loan.principalLeft)} strong />
                    <Mini
                      label="Next Due"
                      value={v.next && loan.status === "active" ? dRelative(v.next.dueDate, today) : "—"}
                      tone={v.health === "overdue" ? "text-rose-700" : undefined}
                    />
                  </div>
                </>
              );
              return selecting ? (
                <label key={loan.id} className="block cursor-pointer rounded-3xl border border-line bg-surface p-4">
                  {body}
                </label>
              ) : (
                <Link key={loan.id} href={`/loan/?id=${loan.id}`} className="block rounded-3xl border border-line bg-surface p-4 active:scale-[0.99]">
                  {body}
                </Link>
              );
            })}
          </div>

          {/* Tablet/desktop: table */}
          <Card className="mt-4 hidden overflow-hidden md:block">
            <table className="w-full text-left text-[15px]">
              <thead className="border-b border-line bg-line-2/60 text-xs font-bold tracking-[0.06em] text-muted uppercase">
                <tr>
                  {selecting && <th className="w-0 py-3 pl-5" aria-label="Select" />}
                  <th className="px-5 py-3">Customer</th>
                  <th className="px-3 py-3">Loan</th>
                  <th className="px-3 py-3 text-right">Original</th>
                  <th className="px-3 py-3 text-right">Outstanding</th>
                  <th className="px-3 py-3">Next Due</th>
                  <th className="px-5 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {list.map(({ loan, customer, v }) => {
                  const h = HEALTH_META[v.health];
                  return (
                    <tr key={loan.id} onClick={() => (selecting ? toggle(loan.id) : router.push(`/loan/?id=${loan.id}`))} className="cursor-pointer hover:bg-line-2/50">
                      {selecting && (
                        <td className="py-3 pl-5">
                          <input
                            type="checkbox"
                            checked={picked.includes(loan.id)}
                            onChange={() => toggle(loan.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label={`Select ${loan.id}`}
                            className="size-5 accent-brand-700"
                          />
                        </td>
                      )}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={customer.name} size="sm" />
                          <span className="font-semibold">{customer.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold">{loan.id}</p>
                        <p className="text-[13px] text-muted">{LOAN_TYPE_SHORT[loan.type]}</p>
                      </td>
                      <td className="num px-3 py-3 text-right">{money(loan.amount)}</td>
                      <td className="num px-3 py-3 text-right font-bold">{money(loan.principalLeft)}</td>
                      <td className="px-3 py-3">
                        {v.next && loan.status === "active" ? (
                          <>
                            <p className={`num font-semibold ${v.health === "overdue" ? "text-rose-700" : ""}`}>{money(dueRemaining(v.next))}</p>
                            <p className="text-[13px] text-muted">{dRelative(v.next.dueDate, today)}</p>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <Chip tone={h.tone} dot>
                          {h.label}
                        </Chip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {selecting && (
        <div className="sticky bottom-[calc(80px+env(safe-area-inset-bottom))] z-10 -mx-4 mt-5 bg-gradient-to-t from-canvas from-70% to-transparent px-4 pt-6 pb-3 md:bottom-0 md:mx-0 md:px-0 md:pb-6">
          <Button size="lg" variant="danger" className="w-full" disabled={!picked.length} onClick={() => setConfirming(true)}>
            <Trash2 className="size-5" /> Delete Selected ({picked.length})
          </Button>
        </div>
      )}
      {confirming && (
        <DeleteLoansSheet
          ids={picked}
          onClose={() => setConfirming(false)}
          onDeleted={() => {
            setConfirming(false);
            stopSelecting();
          }}
        />
      )}
    </div>
  );
}

function Mini({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-muted">{label}</p>
      <p className={`num truncate text-[14px] ${strong ? "font-extrabold" : "font-semibold"} ${tone ?? ""}`}>{value}</p>
    </div>
  );
}
