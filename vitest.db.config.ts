import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests. Need the local Supabase stack: `npx supabase start`.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["tests/db/**/*.itest.ts"], environment: "node", testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
});
