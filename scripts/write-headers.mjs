// Postbuild: writes out/_headers (read by Cloudflare Pages) with security headers.
// The Content-Security-Policy lets the page talk to this build's Supabase project
// and nothing else, so it is generated from NEXT_PUBLIC_SUPABASE_URL.

import nextEnv from "@next/env";
import { writeFileSync } from "node:fs";

// Read the same .env files the build itself reads (.env.local, .env.production.local, ...).
nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error: console.error });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!url) {
  console.log("write-headers: no Supabase URL (demo build), skipped");
  process.exit(0);
}

const api = new URL(url).origin;
const csp = [
  "default-src 'self'",
  // Next.js puts small inline scripts and styles in every page
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${api}`,
  `img-src 'self' data: blob: ${api}`,
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const headers = `/*
  Content-Security-Policy: ${csp}
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  X-Robots-Tag: noindex, nofollow

/_next/static/*
  Cache-Control: public, max-age=31536000, immutable
`;

writeFileSync("out/_headers", headers);
console.log("write-headers: wrote out/_headers");
