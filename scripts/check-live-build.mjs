// Runs after the build, before Cloudflare publishes it. Refuses to publish a build that
// is not connected to the database (it would come up as the demo, with fake data and a
// pre-filled login), or one that contains anything that looks like a server-side secret.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const fail = (msg) => {
  console.error(`check-live-build: ${msg}`);
  process.exit(1);
};

if (!existsSync("out/index.html")) fail("no build found in ./out");
// write-headers.mjs only writes this file when NEXT_PUBLIC_SUPABASE_URL was set at build time
if (!existsSync("out/_headers"))
  fail("this build is not connected to Supabase. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as BUILD variables in Cloudflare.");

const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|html|txt|json|css|map)$/.test(name)) files.push(p);
  }
};
walk("out");

let publishable = false;
const patterns = [
  [/sb_secret_[A-Za-z0-9_-]{12,}/, "a Supabase secret key"],
  [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, "a JWT (possibly a service-role key)"],
  [/postgres(ql)?:\/\/[^\s"'`]*:[^\s"'`@]+@/, "a database connection string with a password"],
  [/github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}/, "a GitHub token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  if (/sb_publishable_[A-Za-z0-9_-]{12,}/.test(text)) publishable = true;
  for (const [re, what] of patterns) if (re.test(text)) fail(`${f} contains ${what}. Not publishing.`);
}
if (!publishable) fail("the build does not contain the Supabase publishable key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as a BUILD variable in Cloudflare.");

console.log(`check-live-build: ok (${files.length} files checked; connected to Supabase; no server-side secrets found)`);
