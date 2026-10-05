import { defineConfig } from "@playwright/test";

// Browser tests for the LIVE app, run against the local Supabase stack.
//   npx supabase start        (once)
//   npm run test:e2e          (resets + seeds the local database, builds, runs)
// Locally the installed Edge is used; CI uses Playwright's Chromium.

const PORT = 4330;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // One browser at a time: the tests share one database and build on each other.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // CI machines are slow to start: allow one retry there. Locally a failure is a failure.
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: process.env.CI ? undefined : "msedge",
    viewport: { width: 390, height: 844 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
  },
  webServer: {
    // E2E_CLOUDFLARE=1 serves the build with Cloudflare Pages' own runtime, so its routing
    // and the security headers in out/_headers are tested too.
    // The server is started before global setup builds the app. On a fresh checkout there is
    // no out/ folder yet, and without one the server never answers: make it first.
    command: `node -e "require('fs').mkdirSync('out',{recursive:true})" && ${process.env.E2E_CLOUDFLARE ? `npx wrangler@4 pages dev out --port ${PORT} --ip 127.0.0.1` : `npx serve out -l ${PORT} --no-clipboard`}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
