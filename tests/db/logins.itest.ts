// Who manages logins: only an ADMIN (an owner with the admin mark). A plain owner (the
// client), staff and collectors cannot add, change, switch off or reset anyone, through
// the app or around it.

import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { admin, ANON, makeUser, URL, type TestUser } from "./helpers";

let adminUser: TestUser;
let owner: TestUser;
let staff: TestUser;
let collector: TestUser;

const phone = () => `9${String(Math.floor(100000000 + Math.random() * 899999999))}`;
const call = async (who: TestUser | null, body: Record<string, unknown>) => {
  const token = who ? (await who.db.auth.getSession()).data.session!.access_token : null;
  const res = await fetch(`${URL}/functions/v1/manage-users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { id?: string; ok?: boolean; error?: string } };
};
const code = (r: { body: { error?: string } }) => r.body.error?.split(":")[0] ?? "ok";
const signIn = async (p: string, password: string) => {
  const db = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  return db.auth.signInWithPassword({ email: `${p}@ledgerpro.invalid`, password });
};

beforeAll(async () => {
  adminUser = await makeUser("owner", "Test Admin");
  expect((await admin.from("profiles").update({ is_admin: true }).eq("id", adminUser.id)).error).toBeNull();
  owner = await makeUser("owner", "Test Client Owner");
  staff = await makeUser("staff", "Test Staff");
  collector = await makeUser("collector", "Test Collector");
}, 60_000);

describe("adding a login", () => {
  it("an admin adds a login that can sign in at once, with the role chosen, and it is logged", async () => {
    const p = phone();
    const r = await call(adminUser, { action: "create", name: "  New Collector ", phone: `${p.slice(0, 5)} ${p.slice(5)}`, role: "collector", password: "start-pass-1", area: "Erode" });
    expect(r.status).toBe(200);
    const prof = (await admin.from("profiles").select("name,phone,role,area,active,is_admin").eq("id", r.body.id!).single()).data;
    expect(prof).toEqual({ name: "New Collector", phone: p, role: "collector", area: "Erode", active: true, is_admin: false });
    const s = await signIn(p, "start-pass-1");
    expect(s.error).toBeNull();
    const log = (await adminUser.db.from("activity").select("text,by_name").order("id", { ascending: false }).limit(1).single()).data!;
    expect(log).toEqual({ text: "Added login New Collector (collector)", by_name: "Test Admin" });
  });

  it("the client (a plain owner), staff and collectors cannot add a login; nothing is created", async () => {
    for (const who of [owner, staff, collector]) {
      const p = phone();
      const r = await call(who, { action: "create", name: "Sneaky", phone: p, role: "owner", password: "start-pass-1" });
      expect(r.status).toBe(403);
      expect(code(r)).toBe("NOT_ALLOWED");
      expect((await signIn(p, "start-pass-1")).error).not.toBeNull();
    }
    const nobody = await call(null, { action: "create", name: "Sneaky", phone: phone(), role: "owner", password: "start-pass-1" });
    expect(nobody.status).toBe(401);
    // nor straight to the database
    expect(codeOf(await owner.db.rpc("admin_add_profile", { p_user: owner.id, p_name: "x", p_phone: "1", p_role: "owner" }))).toBe("NOT_ALLOWED");
  });

  it("refuses a short password, a wrong number, an unknown role and a number that already has a login", async () => {
    const p = phone();
    expect(code(await call(adminUser, { action: "create", name: "A", phone: p, role: "staff", password: "short" }))).toBe("WEAK_PASSWORD");
    expect(code(await call(adminUser, { action: "create", name: "A", phone: "12345", role: "staff", password: "start-pass-1" }))).toBe("INVALID_PHONE");
    expect(code(await call(adminUser, { action: "create", name: "A", phone: p, role: "boss", password: "start-pass-1" }))).toBe("INVALID_ROLE");
    expect(code(await call(adminUser, { action: "create", name: " ", phone: p, role: "staff", password: "start-pass-1" }))).toBe("NAME_NEEDED");
    expect((await call(adminUser, { action: "create", name: "First", phone: p, role: "staff", password: "start-pass-1" })).status).toBe(200);
    const again = await call(adminUser, { action: "create", name: "Second", phone: p, role: "staff", password: "start-pass-1" });
    expect(code(again)).toBe("PHONE_TAKEN");
    expect((await admin.from("profiles").select("name").eq("phone", p)).data).toEqual([{ name: "First" }]);
  });
});

describe("changing a login", () => {
  const made = async (role = "staff") => {
    const p = phone();
    const r = await call(adminUser, { action: "create", name: `Person ${randomUUID().slice(0, 4)}`, phone: p, role, password: "start-pass-1" });
    return { id: r.body.id!, phone: p };
  };

  it("an admin renames, changes the role, switches a login off (it then sees nothing) and on again", async () => {
    const u = await made();
    expect((await adminUser.db.rpc("admin_set_login", { p_user: u.id, p_patch: { name: "Renamed", role: "collector", area: "Bhavani" } })).error).toBeNull();
    expect((await admin.from("profiles").select("name,role,area").eq("id", u.id).single()).data).toEqual({ name: "Renamed", role: "collector", area: "Bhavani" });
    expect((await adminUser.db.rpc("admin_set_login", { p_user: u.id, p_patch: { active: false } })).error).toBeNull();
    const s = await signIn(u.phone, "start-pass-1");
    const db = createClient(URL, ANON, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.data.session!.access_token}` } } });
    expect((await db.rpc("app_role")).data).toBeNull();
    expect((await db.from("customers").select("id")).data).toEqual([]);
    expect((await adminUser.db.rpc("admin_set_login", { p_user: u.id, p_patch: { active: true } })).error).toBeNull();
    expect((await db.rpc("app_role")).data).toBe("collector");
    const log = (await adminUser.db.from("activity").select("text").order("id", { ascending: false }).limit(3)).data!.map((a) => a.text);
    expect(log).toEqual(["Switched on login Renamed", "Switched off login Renamed", "Changed Renamed from staff to collector"]);
  });

  it("an admin resets a forgotten password: the new one works, the old one does not", async () => {
    const u = await made();
    expect((await call(adminUser, { action: "reset_password", userId: u.id, password: "new-pass-2026" })).status).toBe(200);
    expect((await signIn(u.phone, "start-pass-1")).error).not.toBeNull();
    expect((await signIn(u.phone, "new-pass-2026")).error).toBeNull();
    expect(code(await call(adminUser, { action: "reset_password", userId: u.id, password: "short" }))).toBe("WEAK_PASSWORD");
    expect(code(await call(adminUser, { action: "reset_password", userId: randomUUID(), password: "new-pass-2026" }))).toBe("NOT_FOUND");
  });

  it("the client (plain owner), staff and collectors cannot rename, change, switch off or reset anyone", async () => {
    const u = await made();
    for (const who of [owner, staff, collector]) {
      expect(codeOf(await who.db.rpc("admin_set_login", { p_user: u.id, p_patch: { active: false } }))).toBe("NOT_ALLOWED");
      expect(codeOf(await who.db.rpc("admin_set_login", { p_user: who.id, p_patch: { role: "owner" } }))).toBe("NOT_ALLOWED");
      expect(code(await call(who, { action: "reset_password", userId: u.id, password: "new-pass-2026" }))).toBe("NOT_ALLOWED");
      // and not by writing to the table
      await who.db.from("profiles").update({ active: false, role: "owner", is_admin: true }).eq("id", who.id === owner.id ? u.id : who.id);
    }
    expect((await admin.from("profiles").select("active,role,is_admin").eq("id", u.id).single()).data).toEqual({ active: true, role: "staff", is_admin: false });
    expect((await admin.from("profiles").select("role,is_admin").eq("id", staff.id).single()).data).toEqual({ role: "staff", is_admin: false });
    expect((await signIn(u.phone, "start-pass-1")).error).toBeNull();
  });

  it("nobody can make themselves an admin, and an admin cannot lock themselves out", async () => {
    await owner.db.from("profiles").update({ is_admin: true }).eq("id", owner.id);
    expect((await owner.db.rpc("is_admin")).data).toBe(false);
    expect(codeOf(await adminUser.db.rpc("admin_set_login", { p_user: adminUser.id, p_patch: { active: false } }))).toBe("NOT_ALLOWED");
    expect(codeOf(await adminUser.db.rpc("admin_set_login", { p_user: adminUser.id, p_patch: { role: "staff" } }))).toBe("NOT_ALLOWED");
    expect((await adminUser.db.rpc("admin_set_login", { p_user: adminUser.id, p_patch: { name: "Test Admin" } })).error).toBeNull();
  });

  it("everyone can still see the list of logins", async () => {
    expect((await owner.db.from("profiles").select("id")).data!.length).toBeGreaterThanOrEqual(4);
    expect((await owner.db.from("profiles").select("is_admin").eq("id", adminUser.id).single()).data).toEqual({ is_admin: true });
  });
});

/** The 'CODE' at the start of an error raised by a database function. */
function codeOf(res: { error: { message: string } | null }) {
  return res.error?.message.split(":")[0] ?? "ok";
}
