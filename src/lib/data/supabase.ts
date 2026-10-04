// The one Supabase client. Only the public URL and the public (anon) key are used in
// the browser; what a signed-in user may read or change is enforced by the database
// (Row Level Security), never by this file.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** true when the app is connected to a database; false = the built-in demo data. */
export const LIVE = !!(url && anonKey);

const REMEMBER_KEY = "ledgerpro-remember";

/** "Remember this device" off = the sign-in is forgotten when the browser is closed. */
export function setRemember(remember: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
  } catch {
    // storage blocked: the sign-in simply lasts for this tab
  }
}

const authStorage = {
  getItem(key: string) {
    try {
      return sessionStorage.getItem(key) ?? localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      const keep = localStorage.getItem(REMEMBER_KEY) !== "0";
      (keep ? localStorage : sessionStorage).setItem(key, value);
      (keep ? sessionStorage : localStorage).removeItem(key);
    } catch {
      // ignore
    }
  },
  removeItem(key: string) {
    try {
      sessionStorage.removeItem(key);
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!url || !anonKey) throw new Error("Supabase is not configured");
  client ??= createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStorage },
  });
  return client;
}

/**
 * People sign in with a mobile number. Supabase Auth needs an e-mail address, so a
 * number becomes "<number>@<login domain>". Anything with an @ is used as typed.
 */
export function loginEmail(user: string): string {
  const t = user.trim();
  if (t.includes("@")) return t.toLowerCase();
  const domain = process.env.NEXT_PUBLIC_LOGIN_EMAIL_DOMAIN || "ledgerpro.app";
  return `${t.replace(/\D/g, "")}@${domain}`;
}
