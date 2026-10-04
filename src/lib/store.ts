"use client";

// Prototype data store: an in-memory database persisted to localStorage.
// Each exported action maps 1:1 to a future API call, so swapping this file for
// real fetch() calls should not require changes in the screens.

import { format } from "date-fns";
import { useSyncExternalStore } from "react";
import { applyPayment, buildDue, nextDueDate, type PaymentInput, type PaymentResult } from "./finance/engine";
import { buildDemoDB, type DemoDB } from "./demo-data";
import { money, todayISO } from "./format";
import type { Activity, Customer, Due, ISODate, Loan, Role } from "./types";
import { APP } from "./config";

// v2: amounts are stored in paise.
const STORAGE_KEY = "ledgerpro-demo-v2";

export interface Session {
  loggedIn: boolean;
  locked: boolean;
  viewAs: Role["id"];
}

export interface Settings {
  autoLockMinutes: number; // 0 = off
  pin: string;
}

export interface AppState extends DemoDB {
  seedDate: ISODate;
  session: Session;
  settings: Settings;
}

const DEFAULT_SESSION: Session = { loggedIn: false, locked: false, viewAs: "owner" };
const DEFAULT_SETTINGS: Settings = { autoLockMinutes: 5, pin: APP.demoPin };

let state: AppState | null = null;
const listeners = new Set<() => void>();

function fresh(session = DEFAULT_SESSION, settings = DEFAULT_SETTINGS): AppState {
  const today = todayISO();
  return { ...buildDemoDB(today), seedDate: today, session, settings };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as AppState;
      // Demo data is dated relative to today: re-seed when the day changes, keep the session.
      if (saved.seedDate === todayISO()) return saved;
      return fresh(saved.session ?? DEFAULT_SESSION, saved.settings ?? DEFAULT_SETTINGS);
    }
  } catch {
    // Storage blocked or corrupt: fall back to fresh demo data.
  }
  return fresh();
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota: the demo still works for this tab.
  }
}

function set(updater: (s: AppState) => AppState) {
  state = updater(getState());
  persist();
  listeners.forEach((l) => l());
}

export function getState(): AppState {
  if (!state) state = load();
  return state;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** null during server render / hydration, the live state afterwards. */
export function useMaybeAppState(): AppState | null {
  return useSyncExternalStore(subscribe, getState, () => null);
}

/** Use inside the app shell, which only renders once state is available. */
export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function nextLoanId(loans: Loan[]) {
  const max = Math.max(1000, ...loans.map((l) => Number(l.id.replace(/\D/g, "")) || 0));
  return `LP-${max + 1}`;
}

function nextCustomerId(customers: Customer[]) {
  const max = Math.max(0, ...customers.map((c) => Number(c.id.replace(/\D/g, "")) || 0));
  return `C${String(max + 1).padStart(3, "0")}`;
}

function actor(s: AppState) {
  return s.users.find((u) => u.role === s.session.viewAs)?.name ?? APP.owner.name;
}

function log(s: AppState, text: string, kind: Activity["kind"]): Activity[] {
  return [{ id: uid("A"), at: format(new Date(), "yyyy-MM-dd'T'HH:mm:ss"), by: actor(s), text, kind }, ...s.activity];
}

// ---------------------------------------------------------------------------
// Session actions
// ---------------------------------------------------------------------------

export const actions = {
  login() {
    set((s) => ({ ...s, session: { ...s.session, loggedIn: true, locked: false } }));
  },
  logout() {
    set((s) => ({ ...s, session: { ...DEFAULT_SESSION } }));
  },
  lock() {
    set((s) => ({ ...s, session: { ...s.session, locked: true } }));
  },
  unlock(pin: string): boolean {
    if (pin !== getState().settings.pin) return false;
    set((s) => ({ ...s, session: { ...s.session, locked: false } }));
    return true;
  },
  setViewAs(viewAs: Role["id"]) {
    set((s) => ({ ...s, session: { ...s.session, viewAs } }));
  },
  updateSettings(patch: Partial<Settings>) {
    set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  },
  resetDemo() {
    const s = getState();
    state = fresh(s.session, s.settings);
    persist();
    listeners.forEach((l) => l());
  },

  // -------------------------------------------------------------------------
  // Business actions (future API endpoints)
  // -------------------------------------------------------------------------

  /** POST /loans/:id/payments */
  receivePayment(input: PaymentInput): PaymentResult {
    let result!: PaymentResult;
    set((s) => {
      const loan = s.loans.find((l) => l.id === input.loanId)!;
      const loanDues = s.dues.filter((d) => d.loanId === loan.id);
      const recordedOn = input.recordedOn ?? todayISO();
      result = applyPayment(loan, loanDues, { ...input, recordedOn }, { paymentId: uid("P"), nextDueId: uid("D") }, recordedOn);
      const customer = s.customers.find((c) => c.id === loan.customerId);
      const total = input.interest + input.principal + input.other;
      return {
        ...s,
        loans: s.loans.map((l) => (l.id === loan.id ? result.loan : l)),
        dues: [...s.dues.filter((d) => d.loanId !== loan.id), ...result.dues],
        payments: [...s.payments, result.payment],
        activity: log(
          s,
          `Received ${money(total)} from ${customer?.name} · ${loan.id}${result.closed ? " · Loan closed" : ""}${input.date < recordedOn ? ` · backdated to ${input.date}` : ""}`,
          "payment",
        ),
      };
    });
    return result;
  },

  /** PATCH /dues/:id (move date) */
  reschedule(dueId: string, newDate: ISODate, reason: string) {
    set((s) => {
      const due = s.dues.find((d) => d.id === dueId)!;
      const loan = s.loans.find((l) => l.id === due.loanId);
      const customer = s.customers.find((c) => c.id === loan?.customerId);
      const updated: Due = {
        ...due,
        dueDate: newDate,
        rescheduled: { originalDate: due.rescheduled?.originalDate ?? due.dueDate, reason },
      };
      return {
        ...s,
        dues: s.dues.map((d) => (d.id === dueId ? updated : d)),
        activity: log(s, `Moved ${customer?.name}'s payment (${loan?.id}) to ${newDate}`, "reschedule"),
      };
    });
  },

  /** POST /customers */
  addCustomer(data: Omit<Customer, "id" | "createdAt">): Customer {
    const s = getState();
    const customer: Customer = { ...data, id: nextCustomerId(s.customers), createdAt: todayISO() };
    set((st) => ({ ...st, customers: [customer, ...st.customers], activity: log(st, `Added customer ${customer.name}`, "customer") }));
    return customer;
  },

  /** PATCH /customers/:id */
  updateCustomer(id: string, patch: Partial<Omit<Customer, "id">>) {
    set((s) => ({ ...s, customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  },

  /** POST /loans */
  createLoan(data: Omit<Loan, "id" | "principalLeft" | "status">): Loan {
    const s = getState();
    const loan: Loan = { ...data, id: nextLoanId(s.loans), principalLeft: data.amount, status: "active" };
    const firstDue = buildDue(loan, nextDueDate(loan.startDate, loan.frequency), uid("D"));
    const customer = s.customers.find((c) => c.id === loan.customerId);
    set((st) => ({
      ...st,
      loans: [...st.loans, loan],
      dues: [...st.dues, firstDue],
      activity: log(st, `New loan ${loan.id} · ${money(loan.amount)} given to ${customer?.name}`, "loan"),
    }));
    return loan;
  },

  /** PATCH /loans/:id */
  updateLoan(loanId: string, patch: Partial<Pick<Loan, "interest" | "reference" | "frequency">>) {
    set((s) => ({
      ...s,
      loans: s.loans.map((l) => (l.id === loanId ? { ...l, ...patch } : l)),
      activity: log(s, `Edited loan ${loanId}`, "loan"),
    }));
  },

  /** PATCH /loans/:id/security */
  releaseSecurity(loanId: string) {
    set((s) => ({
      ...s,
      loans: s.loans.map((l) => (l.id === loanId && l.security ? { ...l, security: { ...l.security, status: "released" } } : l)),
      activity: log(s, `Security released for ${loanId}`, "security"),
    }));
  },
};
