import { execSync } from "node:child_process";
import { ANON, URL } from "../db/helpers";

// Fresh database, fresh demo book, and a build of the app pointed at the local stack.
// Set E2E_SKIP_SETUP=1 to reuse the last build and database while writing tests.
export default function globalSetup() {
  if (process.env.E2E_SKIP_SETUP) return;
  const run = (cmd: string, env: Record<string, string> = {}) => execSync(cmd, { stdio: "inherit", env: { ...process.env, ...env } });
  run("npx supabase db reset");
  run("npm run seed:local");
  run("npm run build", { NEXT_PUBLIC_SUPABASE_URL: URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, NEXT_PUBLIC_BASE_PATH: "" });
}
