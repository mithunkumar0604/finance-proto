// manage-users: the two login jobs that need the server's key, for ADMINS only.
//
//   { action: "create", name, phone, role, password, area? }   add a login
//   { action: "reset_password", userId, password }             set a new password
//
// The caller's own sign-in is checked first (public.is_admin()). The profile row and the
// activity entry are then written with the CALLER's sign-in, through the admin_* database
// functions, so the log shows which admin did it. The server key never leaves this function.
// Changing a role or name, or switching a login off, needs no key: the app calls
// admin_set_login itself.

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
/** Errors are 'CODE: words for the user', like the database functions. */
const refuse = (status: number, code: string, message: string) => reply(status, { error: `${code}: ${message}` });

const URL_ = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOMAIN = Deno.env.get("LOGIN_EMAIL_DOMAIN") || "ledgerpro.invalid";
const opts = { auth: { persistSession: false, autoRefreshToken: false } };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return refuse(405, "NOT_ALLOWED", "use POST");

  const auth = req.headers.get("Authorization") ?? "";
  if (!/^Bearer .+/.test(auth)) return refuse(401, "SIGNED_OUT", "sign in first");
  // the caller, as themselves: every check and every row they write goes through their own sign-in
  const caller = createClient(URL_, ANON, { ...opts, global: { headers: { Authorization: auth } } });
  const { data: isAdmin, error: whoErr } = await caller.rpc("is_admin");
  if (whoErr) return refuse(401, "SIGNED_OUT", "sign in again");
  if (isAdmin !== true) return refuse(403, "NOT_ALLOWED", "only an admin can manage logins");

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return refuse(400, "BAD_REQUEST", "nothing was sent");
  }
  const server = createClient(URL_, SERVICE, opts);
  const password = String(body.password ?? "");
  if (password.length < 8) return refuse(400, "WEAK_PASSWORD", "the password needs at least 8 characters");
  if (password.length > 72) return refuse(400, "WEAK_PASSWORD", "keep the password under 72 characters");

  if (body.action === "create") {
    const name = String(body.name ?? "").trim();
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    const role = String(body.role ?? "");
    if (!name) return refuse(400, "NAME_NEEDED", "enter the person's name");
    if (!/^\d{10}$/.test(phone)) return refuse(400, "INVALID_PHONE", "enter a 10-digit mobile number");
    if (!["owner", "staff", "collector"].includes(role)) return refuse(400, "INVALID_ROLE", "choose owner, staff or collector");

    const made = await server.auth.admin.createUser({ email: `${phone}@${DOMAIN}`, password, email_confirm: true });
    if (made.error || !made.data.user) {
      if (/already|registered|exists/i.test(made.error?.message ?? "")) return refuse(409, "PHONE_TAKEN", "this mobile number already has a login");
      if (/password/i.test(made.error?.message ?? "")) return refuse(400, "WEAK_PASSWORD", "this password is not accepted; try a longer one");
      return refuse(500, "REJECTED", "the login could not be created");
    }
    const id = made.data.user.id;
    const prof = await caller.rpc("admin_add_profile", { p_user: id, p_name: name, p_phone: phone, p_role: role, p_area: body.area ? String(body.area) : null });
    if (prof.error) {
      // nothing half-made is left behind
      await server.auth.admin.deleteUser(id);
      return refuse(400, prof.error.message.split(":")[0] || "REJECTED", prof.error.message.split(": ").slice(1).join(": ") || "the login could not be created");
    }
    return reply(200, { id });
  }

  if (body.action === "reset_password") {
    const userId = String(body.userId ?? "");
    const { data: target } = await server.from("profiles").select("id").eq("id", userId).maybeSingle();
    if (!target) return refuse(404, "NOT_FOUND", "login not found");
    const done = await server.auth.admin.updateUserById(userId, { password });
    if (done.error) return refuse(400, "WEAK_PASSWORD", "this password is not accepted; try a longer one");
    await caller.rpc("admin_log_password_reset", { p_user: userId });
    return reply(200, { ok: true });
  }

  return refuse(400, "BAD_REQUEST", "unknown action");
});
