"use client";

import { clsx } from "clsx";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Home,
  Landmark,
  Lock,
  Menu,
  Plus,
  Settings,
  ShieldCheck,
  Users,
  UserCog,
  Wallet,
} from "lucide-react";
import { APP } from "@/lib/config";
import { actions, useAppState } from "@/lib/store";
import { badge, permissions } from "@/lib/selectors";
import { useUI } from "./ui-context";

const strip = (p: string) => p.replace(/\/+$/, "") || "/";
const SECTION_OF: Record<string, string> = { "/customer": "/customers", "/loan": "/loans" };

function isActive(path: string, href: string) {
  const p = strip(path);
  const h = strip(href);
  return p === h || p.startsWith(h + "/") || SECTION_OF[p] === h;
}

export function BottomNav() {
  const path = usePathname();
  const ui = useUI();
  const item = (href: string, label: string, Icon: typeof Home) => {
    const on = isActive(path, href);
    return (
      <Link href={href} className="flex flex-1 flex-col items-center justify-center gap-1 pt-2 pb-1.5">
        <span className={clsx("grid h-8 w-14 place-items-center rounded-full transition", on ? "bg-brand-50 text-brand-700" : "text-muted")}>
          <Icon className="size-[22px]" strokeWidth={on ? 2.3 : 1.9} />
        </span>
        <span className={clsx("text-[11px] font-semibold", on ? "text-brand-800" : "text-muted")}>{label}</span>
      </Link>
    );
  };
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md md:hidden">
      <div className="mx-auto flex max-w-lg items-stretch px-1">
        {item("/home/", "Home", Home)}
        {item("/collections/", "Collections", Wallet)}
        <div className="flex flex-1 items-start justify-center">
          <button
            type="button"
            onClick={ui.openQuick}
            aria-label="Quick actions"
            className="-mt-5 grid size-15 place-items-center rounded-full bg-brand-700 text-white shadow-[0_10px_24px_-8px_rgba(11,90,71,.7)] ring-4 ring-canvas transition active:scale-95"
          >
            <Plus className="size-7" strokeWidth={2.4} />
          </button>
        </div>
        {item("/customers/", "Customers", Users)}
        {item("/more/", "More", Menu)}
      </div>
    </nav>
  );
}

export function Sidebar() {
  const path = usePathname();
  const ui = useUI();
  const s = useAppState();
  const perm = permissions(s);
  const link = (href: string, label: string, Icon: typeof Home, show = true) =>
    show && (
      <Link
        key={href}
        href={href}
        className={clsx(
          "flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-semibold transition",
          isActive(path, href) ? "bg-brand-50 text-brand-800" : "text-ink-2 hover:bg-line-2",
        )}
      >
        <Icon className="size-5" strokeWidth={isActive(path, href) ? 2.3 : 1.9} />
        {label}
      </Link>
    );
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface px-4 py-5 md:flex">
      <div className="mb-6 flex items-center gap-3 px-2">
        <Logo />
        <div className="leading-tight">
          <p className="text-lg font-extrabold tracking-tight">{APP.name}</p>
          <p className="text-xs text-muted">{APP.subtitle}</p>
        </div>
      </div>
      <button type="button" onClick={ui.openQuick} className="mb-5 flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand-700 font-semibold text-white shadow-[0_8px_20px_-8px_rgba(11,90,71,.6)] transition hover:bg-brand-800 active:scale-[0.98]">
        <Plus className="size-5" /> New
      </button>
      <nav className="flex flex-col gap-1">
        {link("/home/", "Home", Home)}
        {link("/collections/", "Collections", Wallet)}
        {link("/customers/", "Customers", Users)}
        {link("/loans/", "Loans", Landmark)}
        {link("/reports/", "Reports", BarChart3, perm.seeReports)}
        {link("/security/", "Security", ShieldCheck)}
      </nav>
      <p className="mt-6 mb-2 px-3 text-xs font-bold tracking-[0.08em] text-faint uppercase">Manage</p>
      <nav className="flex flex-col gap-1">
        {link("/users/", "Users & Roles", UserCog, perm.role === "owner")}
        {link("/activity/", "Activity", Activity)}
        {link("/settings/", "Settings", Settings)}
      </nav>
      <div className="mt-auto">
        <button type="button" onClick={actions.lock} className="flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[15px] font-semibold text-ink-2 hover:bg-line-2">
          <Lock className="size-5" /> Lock App
        </button>
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-line-2 p-3">
          <span className="grid size-10 place-items-center rounded-full bg-brand-700 text-sm font-bold text-white">{badge(s).initials}</span>
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-bold">{badge(s).name}</p>
            <p className="truncate text-xs text-muted">{APP.owner.business}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("grid size-10 place-items-center rounded-xl bg-brand-700 text-white", className)}>
      <svg viewBox="0 0 64 64" className="size-6">
        <path d="M20 16v30h24" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="43" cy="21" r="5.5" fill="#d9b25f" />
      </svg>
    </span>
  );
}
