"use client";

import { ChevronRight, HandCoins, Landmark, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Sheet } from "@/components/ui/sheet";
import { permissions } from "@/lib/selectors";
import { useAppState } from "@/lib/store";

export function QuickActions({ open, onClose, onReceive }: { open: boolean; onClose: () => void; onReceive: () => void }) {
  const router = useRouter();
  const perm = permissions(useAppState());
  const items = [
    { show: perm.receive, icon: HandCoins, title: "Receive Payment", sub: "Record money collected", onClick: onReceive, tone: "bg-brand-700 text-white" },
    { show: perm.createLoan, icon: Landmark, title: "New Loan", sub: "Give money to a customer", onClick: () => router.push("/loans/new/"), tone: "bg-amber-100 text-amber-800" },
    { show: perm.addCustomer, icon: UserPlus, title: "Add Customer", sub: "Save a new person", onClick: () => router.push("/customers/new/"), tone: "bg-indigo-100 text-indigo-700" },
  ].filter((i) => i.show);

  return (
    <Sheet open={open} onClose={onClose} title="What would you like to do?">
      <div className="flex flex-col gap-2.5 pb-4">
        {items.map((i) => (
          <button
            key={i.title}
            type="button"
            onClick={() => {
              onClose();
              i.onClick();
            }}
            className="flex items-center gap-4 rounded-3xl border border-line bg-surface p-4 text-left transition hover:bg-line-2 active:scale-[0.99]"
          >
            <span className={`grid size-13 place-items-center rounded-2xl ${i.tone}`}>
              <i.icon className="size-6" />
            </span>
            <span className="flex-1">
              <span className="block text-[17px] font-bold">{i.title}</span>
              <span className="block text-sm text-muted">{i.sub}</span>
            </span>
            <ChevronRight className="size-5 text-faint" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
