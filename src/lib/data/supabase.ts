// The one Supabase client. Only the project URL and the PUBLISHABLE key are used in
// the browser; what a signed-in user may read or change is enforced by the database
// (Row Level Security), never by this file. The secret key is never used by the app.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (sb_publishable_...) is Supabase's current name.
// The older NEXT_PUBLIC_SUPABASE_ANON_KEY is still read so an existing setup keeps working.
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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

const wait = (ms: number) => new Promise<null>((done) => setTimeout(() => done(null), ms));

/**
 * Ends the sign-in on THIS device, at once, whatever the connection is like.
 *
 * The library's own sign-out asks the server first and only then forgets the sign-in, so
 * on a weak signal "Logout" seemed to do nothing. Here the device forgets first; the
 * server is told in the background (so the sign-in cannot be renewed), and if that
 * message is lost the forgotten sign-in simply runs out on its own.
 *
 * The caller reloads the page afterwards: that drops the copy this tab holds in memory.
 */
export async function forgetSignIn(): Promise<void> {
  if (!url || !anonKey) return;
  const auth = supabase().auth;
  // reading the saved sign-in is local and normally instant; never wait long for it
  const got = await Promise.race([auth.getSession().then((r) => r.data.session, () => null), wait(800)]);
  await Promise.race([auth.stopAutoRefresh().catch(() => {}), wait(300)]);
  const key = (auth as unknown as { storageKey: string }).storageKey;
  for (const k of [key, `${key}-user`, `${key}-code-verifier`]) authStorage.removeItem(k);
  if (got?.access_token) {
    // keepalive: the request is finished by the browser even though the page reloads
    void fetch(`${url}/auth/v1/logout?scope=local`, { method: "POST", keepalive: true, headers: { apikey: anonKey, Authorization: `Bearer ${got.access_token}` } }).catch(() => {});
  }
}

/**
 * A second, throwaway client that remembers nothing. Used only to check a password
 * (Change Password) without touching this device's sign-in.
 */
export function throwawayClient(): SupabaseClient {
  if (!url || !anonKey) throw new Error("Supabase is not configured");
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "ledgerpro-password-check" },
  });
}

/**
 * People sign in with a mobile number. Supabase Auth needs an e-mail address, so a
 * number becomes "<number>@<login domain>". Anything with an @ is used as typed.
 *
 * The default domain ends in ".invalid", which by internet standard can never receive
 * mail: nobody can have a password-reset link for these logins sent anywhere. Only use
 * another domain (NEXT_PUBLIC_LOGIN_EMAIL_DOMAIN) if the business owns it.
 */
export const LOGIN_DOMAIN = process.env.NEXT_PUBLIC_LOGIN_EMAIL_DOMAIN || "ledgerpro.invalid";

export function loginEmail(user: string): string {
  const t = user.trim();
  if (t.includes("@")) return t.toLowerCase();
  return `${t.replace(/\D/g, "")}@${LOGIN_DOMAIN}`;
}
