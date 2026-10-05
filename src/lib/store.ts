"use client";

// The app's data store. Screens read from it synchronously and call `actions` to
// change things. It runs in one of two modes:
//
//   LIVE  (Supabase configured)  data is read from the database after sign-in; every
//         action is saved by the database first and only then shown on screen.
//   DEMO  (not configured)       fictional data kept in this browser, re-made daily.
//
// Money is never calculated here: the engine in ./finance works a change out, and in
// LIVE mode the database checks it and saves it in one transaction.

import { format } from "date-fns";
import { useSyncExternalStore } from "react";
import { accrueDues, applyPayment, applyWaiver, buildDue, nextDueDate, openDue, type InterestPick, type PaymentInput, type PaymentResult } from "./finance/engine";
import { buildDemoDB, type DemoDB } from "./demo-data";
import { money, todayISO } from "./format";
import type { Activity, AppUser, Customer, Due, ISODate, Loan, Role } from "./types";
import { APP } from "./config";
import { AppError, toAppError } from "./data/mappers";
import * as remote from "./data/remote";
import { LIVE, setRemember } from "./data/supabase";

export { LIVE };

// v3: amounts in paise; every missed period is its own collection.
const STORAGE_KEY = "ledgerpro-demo-v3";
/** LIVE mode keeps only this device's settings in the browser, never customer data. */
const DEVICE_KEY = "ledgerpro-device-v1";

export interface Session {
  loggedIn: boolean;
  locked: boolean;
  viewAs: Role["id"];
  /** LIVE: the signed-in user's id. */
  userId?: string;
}

export interface Settings {
  autoLockMinutes: number; // 0 = off
  pin: string;
}

export interface AppState extends DemoDB {
  seedDate: ISODate;
  session: Session;
  settings: Settings;
  /** starting = checking the sign-in / reading data. Screens show a skeleton until ready. */
  boot: "starting" | "ready" | "error";
  bootError?: string;
  /** LIVE: collections and payments dated on or after this day are loaded. */
  historyFrom: ISODate;
  /** LIVE: loans whose full history has been loaded. */
  fullLoans: Record<string, true>;
}

const DEFAULT_SESSION: Session = { loggedIn: false, locked: false, viewAs: "owner" };
const DEFAULT_SETTINGS: Settings = { autoLockMinutes: 5, pin: APP.demoPin };
const EMPTY_DB: DemoDB = { customers: [], loans: [], dues: [], payments: [], activity: [], users: [] };

let state: AppState | null = null;
const listeners = new Set<() => void>();

function fresh(session = DEFAULT_SESSION, settings = DEFAULT_SETTINGS): AppState {
  const today = todayISO();
  return { ...buildDemoDB(today), seedDate: today, session, settings, boot: "ready", historyFrom: "0000-01-01", fullLoans: {} };
}

/** LIVE: start of last year, so "This Year" and "Last Month" never need a second read. */
const defaultHistoryFrom = () => `${Number(todayISO().slice(0, 4)) - 1}-01-01`;

function loadLive(): AppState {
  let device: { settings?: Settings; locked?: boolean } = {};
  try {
    device = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "{}");
  } catch {
    // storage blocked or corrupt: defaults
  }
  return {
    ...EMPTY_DB,
    seedDate: todayISO(),
    session: { ...DEFAULT_SESSION, locked: !!device.locked },
    settings: { ...DEFAULT_SETTINGS, ...device.settings },
    boot: "starting",
    historyFrom: defaultHistoryFrom(),
    fullLoans: {},
  };
}

function load(): AppState {
  if (LIVE) return loadLive();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as AppState;
      // Demo data is dated relative to today: re-seed when the day changes, keep the session.
      if (saved.seedDate === todayISO()) return { ...saved, boot: "ready", historyFrom: "0000-01-01", fullLoans: {} };
      return fresh(saved.session ?? DEFAULT_SESSION, saved.settings ?? DEFAULT_SETTINGS);
    }
  } catch {
    // Storage blocked or corrupt: fall back to fresh demo data.
  }
  return fresh();
}

function persist() {
  try {
    if (LIVE) localStorage.setItem(DEVICE_KEY, JSON.stringify({ settings: state?.settings, locked: state?.session.locked }));
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode / quota: the app still works for this tab.
  }
}

function set(updater: (s: AppState) => AppState) {
  state = updater(getState());
  persist();
  listeners.forEach((l) => l());
}

export function getState(): AppState {
  if (!state) {
    state = load();
    if (LIVE && typeof window !== "undefined") void startLive();
  }
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
// LIVE: sign-in and reading
// ---------------------------------------------------------------------------

let started = false;

async function startLive() {
  if (started) return;
  started = true;
  remote.onSignedOut(() => {
    if (getState().session.loggedIn) set((s) => ({ ...s, ...EMPTY_DB, fullLoans: {}, session: { ...DEFAULT_SESSION } }));
  });
  await boot();
}

/** Check who is signed in on this device and read their data. */
async function boot() {
  set((s) => ({ ...s, boot: "starting", bootError: undefined }));
  try {
    const who = await remote.currentUser();
    if (!who) {
      set((s) => ({ ...s, ...EMPTY_DB, boot: "ready", session: { ...DEFAULT_SESSION } }));
      return;
    }
    await enter(who);
  } catch (e) {
    const err = toAppError(e);
    if (err.code === "SIGNED_OUT" || err.code === "NOT_ALLOWED") set((s) => ({ ...s, ...EMPTY_DB, boot: "ready", session: { ...DEFAULT_SESSION } }));
    else set((s) => ({ ...s, boot: "error", bootError: err.message }));
  }
}

async function enter(who: remote.SignedIn) {
  const from = defaultHistoryFrom();
  // Every period that has started since the app was last opened becomes a pending collection.
  await remote.accrueAll();
  const book = await remote.loadBook(from, who.profile.role === "owner");
  set((s) => ({
    ...s,
    ...book,
    boot: "ready",
    bootError: undefined,
    historyFrom: from,
    fullLoans: {},
    seedDate: todayISO(),
    session: { loggedIn: true, locked: s.session.locked, viewAs: who.profile.role, userId: who.userId },
  }));
}

const byId = <T extends { id: string }>(old: T[], incoming: T[]): T[] => {
  const map = new Map(old.map((x) => [x.id, x]));
  for (const x of incoming) map.set(x.id, x);
  return [...map.values()];
};

/** Replace what is held for these loans with what the database has now. */
async function reloadLoans(loanIds: string[]) {
  const ids = new Set(loanIds);
  const got = await remote.loadLoans(loanIds);
  set((s) => ({
    ...s,
    loans: byId(s.loans, got.loans),
    dues: [...s.dues.filter((d) => !ids.has(d.loanId)), ...got.dues],
    payments: [...s.payments.filter((p) => !ids.has(p.loanId)), ...got.payments],
    fullLoans: { ...s.fullLoans, ...Object.fromEntries(loanIds.map((id) => [id, true as const])) },
  }));
}

function refreshActivity() {
  if (getState().session.viewAs !== "owner") return;
  remote
    .loadActivity()
    .then((activity) => set((s) => ({ ...s, activity })))
    .catch(() => {
      // the log is not critical; it is read again on the next load
    });
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A fresh key for one "save" press. Sending the same key twice saves only once. */
export const newKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16));

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

/** Payments being saved right now, by key: a second press joins the first instead of saving again. */
const inFlight = new Map<string, Promise<PaymentResult>>();

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const actions = {
  /** Throws AppError with a message to show when the sign-in fails. */
  async login(user = "", password = "", remember = true): Promise<void> {
    if (!LIVE) {
      set((s) => ({ ...s, session: { ...s.session, loggedIn: true, locked: false } }));
      return;
    }
    setRemember(remember);
    const who = await remote.signIn(user, password);
    try {
      await enter(who);
    } catch (e) {
      throw toAppError(e);
    }
    set((s) => ({ ...s, session: { ...s.session, locked: false } }));
  },
  async logout(): Promise<void> {
    if (LIVE) await remote.signOut().catch(() => {});
    set((s) => ({ ...s, ...(LIVE ? { ...EMPTY_DB, fullLoans: {} } : {}), session: { ...DEFAULT_SESSION } }));
  },
  /** LIVE: end this person's sign-in on every other device. */
  async logoutOthers(): Promise<void> {
    if (LIVE) await remote.signOutOthers();
  },
  /** LIVE: read everything again ("Try again" after a failed start). */
  async reload(): Promise<void> {
    if (LIVE) await boot();
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
    if (LIVE) return; // the role comes from the signed-in user
    set((s) => ({ ...s, session: { ...s.session, viewAs } }));
  },
  updateSettings(patch: Partial<Settings>) {
    set((s) => ({ ...s, settings: { ...s.settings, ...patch } }));
  },
  resetDemo() {
    if (LIVE) return;
    const s = getState();
    state = fresh(s.session, s.settings);
    persist();
    listeners.forEach((l) => l());
  },

  /** LIVE: make sure the full history of these loans is loaded (loan and customer pages). */
  async ensureLoans(loanIds: string[]): Promise<void> {
    if (!LIVE) return;
    const missing = loanIds.filter((id) => !getState().fullLoans[id]);
    if (missing.length) await reloadLoans(missing);
  },

  /** LIVE: make sure collections and payments back to `from` are loaded (older reports). */
  async ensureHistory(from: ISODate): Promise<void> {
    if (!LIVE) return;
    const have = getState().historyFrom;
    if (from >= have) return;
    const got = await remote.loadHistory(from, have);
    set((s) => ({ ...s, dues: byId(s.dues, got.dues), payments: byId(s.payments, got.payments), historyFrom: from < s.historyFrom ? from : s.historyFrom }));
  },

  // -------------------------------------------------------------------------
  // Business actions. Each rejects with an error whose `message` can be shown.
  // -------------------------------------------------------------------------

  /**
   * Record money received. `key` identifies this one press of Confirm: pressing twice,
   * or retrying after a lost connection, with the same key saves the payment once.
   */
  receivePayment(input: PaymentInput, key: string): Promise<PaymentResult> {
    const running = inFlight.get(key);
    if (running) return running;
    const p = receive(input, key).finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  },

  /** Move a collection to another date. */
  async reschedule(dueId: string, newDate: ISODate, reason: string): Promise<void> {
    const due = getState().dues.find((d) => d.id === dueId);
    if (!due) throw new AppError("NOT_FOUND", "This collection was not found.");
    if (LIVE) {
      await remote.rescheduleDue(dueId, newDate, reason);
      await reloadLoans([due.loanId]);
      refreshActivity();
      return;
    }
    set((s) => {
      const loan = s.loans.find((l) => l.id === due.loanId);
      const customer = s.customers.find((c) => c.id === loan?.customerId);
      const updated: Due = { ...due, dueDate: newDate, rescheduled: { originalDate: due.rescheduled?.originalDate ?? due.dueDate, reason } };
      return {
        ...s,
        dues: s.dues.map((d) => (d.id === dueId ? updated : d)),
        activity: log(s, `Moved ${customer?.name}'s payment (${loan?.id}) to ${newDate}`, "reschedule"),
      };
    });
  },

  async addCustomer(data: Omit<Customer, "id" | "createdAt">): Promise<Customer> {
    if (LIVE) {
      const customer = await remote.addCustomer(data);
      set((s) => ({ ...s, customers: [customer, ...s.customers] }));
      refreshActivity();
      return customer;
    }
    const s = getState();
    const customer: Customer = { ...data, id: nextCustomerId(s.customers), createdAt: todayISO() };
    set((st) => ({ ...st, customers: [customer, ...st.customers], activity: log(st, `Added customer ${customer.name}`, "customer") }));
    return customer;
  },

  async updateCustomer(id: string, patch: Partial<Omit<Customer, "id">>): Promise<void> {
    if (LIVE) {
      const customer = await remote.updateCustomer(id, patch);
      set((s) => ({ ...s, customers: s.customers.map((c) => (c.id === id ? customer : c)) }));
      return;
    }
    set((s) => ({ ...s, customers: s.customers.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  },

  /** Give a new loan. `key` identifies this one press of Create Loan (see receivePayment). */
  async createLoan(data: Omit<Loan, "id" | "principalLeft" | "status">, key: string): Promise<Loan> {
    const draft: Loan = { ...data, id: "", principalLeft: data.amount, status: "active" };
    if (LIVE) {
      const firstDue = buildDue(draft, nextDueDate(draft.startDate, draft.frequency, 1, draft.startDate), newKey());
      const loanId = await remote.createLoan(key, draft, firstDue, draft.security);
      await reloadLoans([loanId]);
      refreshActivity();
      const saved = getState().loans.find((l) => l.id === loanId);
      if (!saved) throw new AppError("REJECTED", "The loan was saved but could not be read back. Reload the page.");
      return saved;
    }
    const s = getState();
    const loan: Loan = { ...draft, id: nextLoanId(s.loans) };
    const firstDue = buildDue(loan, nextDueDate(loan.startDate, loan.frequency, 1, loan.startDate), uid("D"));
    // a loan entered with an earlier date: every period since then is pending
    const loanDues = accrueDues(loan, [firstDue], todayISO(), () => uid("D"));
    const customer = s.customers.find((c) => c.id === loan.customerId);
    set((st) => ({
      ...st,
      loans: [...st.loans, loan],
      dues: [...st.dues, ...loanDues],
      activity: log(st, `New loan ${loan.id} · ${money(loan.amount)} given to ${customer?.name}`, "loan"),
    }));
    return loan;
  },

  async updateLoan(loanId: string, patch: Partial<Pick<Loan, "interest" | "reference" | "frequency">>): Promise<void> {
    if (LIVE) {
      const loan = getState().loans.find((l) => l.id === loanId);
      if (!loan) throw new AppError("NOT_FOUND", "This loan was not found.");
      await remote.updateLoan(loanId, loan.version ?? 0, patch).catch(async (e) => {
        if (toAppError(e).code === "CONFLICT") await reloadLoans([loanId]).catch(() => {});
        throw e;
      });
      await reloadLoans([loanId]);
      refreshActivity();
      return;
    }
    set((s) => ({
      ...s,
      loans: s.loans.map((l) => (l.id === loanId ? { ...l, ...patch } : l)),
      activity: log(s, `Edited loan ${loanId}`, "loan"),
    }));
  },

  async releaseSecurity(loanId: string): Promise<void> {
    if (LIVE) {
      await remote.releaseCollateral(loanId);
      await reloadLoans([loanId]);
      refreshActivity();
      return;
    }
    set((s) => ({
      ...s,
      loans: s.loans.map((l) => (l.id === loanId && l.security ? { ...l, security: { ...l.security, status: "released" } } : l)),
      activity: log(s, `Security released for ${loanId}`, "security"),
    }));
  },

  /** Owner: write off pending interest without receiving money. A reason is required. */
  async waiveInterest(loanId: string, waive: InterestPick[], reason: string): Promise<void> {
    const s0 = getState();
    const loan = s0.loans.find((l) => l.id === loanId);
    if (!loan) throw new AppError("NOT_FOUND", "This loan was not found.");
    if (s0.session.viewAs !== "owner") throw new AppError("NOT_ALLOWED", "Only the owner can waive interest.");
    const today = todayISO();
    // the engine checks it (reason given, nothing waived beyond what is pending) ...
    const result = applyWaiver(loan, s0.dues.filter((d) => d.loanId === loanId), { waive, reason, date: today }, today);
    if (LIVE) {
      // ... and the database checks it again and saves it
      await remote.waiveInterest(loanId, loan.version ?? 0, waive, reason).catch(async (e) => {
        if (toAppError(e).code === "CONFLICT") await reloadLoans([loanId]).catch(() => {});
        throw e;
      });
      await reloadLoans([loanId]);
      refreshActivity();
      return;
    }
    set((s) => ({
      ...s,
      loans: s.loans.map((l) => (l.id === loanId ? result.loan : l)),
      dues: [...s.dues.filter((d) => d.loanId !== loanId), ...result.dues],
      activity: log(s, `Waived ${money(result.waived)} interest on ${loanId} · ${reason}${result.closed ? " · Loan closed" : ""}`, "payment"),
    }));
  },

  /**
   * LIVE, owner: "Delete Payment". The latest payment on a loan is taken back: the loan and
   * its collections return to how they were, and the payment leaves every total. The
   * database keeps the entry, marked as taken back, with who did it and why.
   */
  async reversePayment(paymentId: string, reason: string): Promise<void> {
    if (!LIVE) throw new AppError("NOT_ALLOWED", "Payments can be deleted only in the live app.");
    const { loan_id } = await remote.reversePayment(paymentId, reason);
    // it is deleted; if reading the loan back fails, that must not be reported as "not saved"
    await reloadLoans([loan_id]).catch(() => {});
    refreshActivity();
  },

  /**
   * LIVE: save the photos chosen while a loan was being created. Returns how many could
   * not be saved (the loan itself is already saved, so this never throws).
   */
  async saveLoanPhotos(loanId: string, photos: Record<string, File>): Promise<number> {
    if (!LIVE) return 0;
    let failed = 0;
    for (const [slot, file] of Object.entries(photos)) await remote.uploadLoanFile(loanId, slot, file).catch(() => failed++);
    return failed;
  },

  /**
   * LIVE: change the signed-in person's own password. Throws AppError with words to show.
   * Resolves to false when the password was changed but other devices could not be signed out.
   */
  async changePassword(current: string, next: string): Promise<boolean> {
    if (!LIVE) throw new AppError("NOT_ALLOWED", "Passwords can be changed only in the live app.");
    return remote.changePassword(current, next);
  },

  /** LIVE, owner: change a team member's role, or switch a login on or off. */
  async updateUser(id: string, patch: Partial<Pick<AppUser, "name" | "phone" | "role" | "area" | "active">>): Promise<void> {
    if (!LIVE) return;
    const user = await remote.updateUser(id, patch);
    set((s) => ({ ...s, users: s.users.map((u) => (u.id === id ? user : u)) }));
  },
};

async function receive(input: PaymentInput, key: string): Promise<PaymentResult> {
  const today = todayISO();
  // The app was left open overnight: a new period may have started. Read everything again first.
  if (LIVE && getState().seedDate !== today) await boot();
  const s = getState();
  const loan = s.loans.find((l) => l.id === input.loanId);
  if (!loan) throw new AppError("NOT_FOUND", "This loan was not found.");
  const loanDues = s.dues.filter((d) => d.loanId === loan.id);

  if (!LIVE) {
    const result = applyPayment(loan, loanDues, { ...input, recordedOn: today }, { paymentId: uid("P"), nextDueId: uid("D") }, today);
    set((st) => {
      const customer = st.customers.find((c) => c.id === loan.customerId);
      const total = input.interest + input.principal + input.other;
      return {
        ...st,
        loans: st.loans.map((l) => (l.id === loan.id ? result.loan : l)),
        dues: [...st.dues.filter((d) => d.loanId !== loan.id), ...result.dues],
        payments: [...st.payments, result.payment],
        activity: log(
          st,
          `Received ${money(total)} from ${customer?.name} · ${loan.id}${result.closed ? " · Loan closed" : ""}${input.date < today ? ` · backdated to ${input.date}` : ""}`,
          "payment",
        ),
      };
    });
    return result;
  }

  // The engine works the payment out (and refuses it if it is not valid) ...
  const result = applyPayment(loan, loanDues, { ...input, recordedOn: today }, { paymentId: newKey(), nextDueId: newKey() }, today);
  // ... only collections the database already has are sent; it opens new ones itself.
  const before = new Map(loanDues.map((d) => [d.id, JSON.stringify(d)]));
  const changed = result.dues.filter((d) => before.has(d.id) && before.get(d.id) !== JSON.stringify(d));

  // The database checks it again and saves all of it, or none of it.
  let saved: remote.SavedPayment;
  try {
    saved = await remote.recordPayment(key, loan.version ?? 0, result, changed, input.waiveReason);
  } catch (e) {
    // Someone else changed this loan, or a new period began: show its real state before the user tries again.
    if (["CONFLICT", "MISMATCH"].includes(toAppError(e).code)) await reloadLoans([loan.id]).catch(() => {});
    throw e;
  }

  // Read the loan back: the database is the record of what is now pending.
  await reloadLoans([loan.id]);
  refreshActivity();
  const now = getState();
  const dues = now.dues.filter((d) => d.loanId === loan.id);
  return {
    ...result,
    loan: now.loans.find((l) => l.id === loan.id) ?? result.loan,
    dues,
    nextDue: openDue(dues),
    payment: { ...result.payment, recordedOn: saved.recordedOn },
  };
}
