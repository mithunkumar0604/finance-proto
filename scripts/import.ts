// Imports existing customers and loans from a CSV file. See IMPORT.md.
//
//   npm run import -- <file.csv>            check the file and print a report (saves nothing)
//   npm run import -- <file.csv> --apply    save it (only if the file has no errors)
//   npm run import -- --undo <batch id>     take an import back (only before any payment)
//
// --apply and --undo need IMPORT_SUPABASE_URL and IMPORT_SUPABASE_SECRET_KEY (the
// project's secret key, sb_secret_...) in the environment. Run it from an administrator's computer; never put that key in the app.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { batchId, importPayload } from "../src/lib/import/payload";
import { validateImport } from "../src/lib/import/validate";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const undo = args.includes("--undo") ? args[args.indexOf("--undo") + 1] : null;
const file = args.find((a) => !a.startsWith("--") && a !== undo);
const rupees = (p: number) => `Rs. ${new Intl.NumberFormat("en-IN").format(p / 100)}`;

function admin() {
  const url = process.env.IMPORT_SUPABASE_URL;
  const key = process.env.IMPORT_SUPABASE_SECRET_KEY || process.env.IMPORT_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Set IMPORT_SUPABASE_URL and IMPORT_SUPABASE_SECRET_KEY to save or undo an import.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  if (undo) {
    const { data, error } = await admin().rpc("undo_import", { p_batch: undo });
    if (error) throw new Error(error.message);
    console.log(`Taken back: ${data.customers} customers and ${data.loans} loans removed.`);
    return;
  }
  if (!file) throw new Error("Usage: npm run import -- <file.csv> [--apply]");

  const text = readFileSync(file, "utf8");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST
  const result = validateImport(text, today);

  console.log(`\nFile: ${basename(file)}`);
  console.log(`Rows that are fine: ${result.customers.length} customers, ${result.loans.length} loans`);
  const active = result.loans.filter((l) => l.status === "active");
  console.log(`  running loans: ${active.length}, closed: ${result.loans.length - active.length}`);
  console.log(`  principal still out: ${rupees(active.reduce((a, l) => a + l.principalLeft, 0))}`);
  console.log(`  loans already behind (next collection before today): ${active.filter((l) => l.nextDueDate! < today).length}`);

  if (!result.ok) {
    console.log(`\n${result.errors.length} problem(s). NOTHING will be imported until these are fixed:\n`);
    for (const e of result.errors) console.log(`  row ${e.row}, ${e.column}: ${e.message}`);
    process.exit(1);
  }
  console.log("\nNo problems found.");

  if (!apply) {
    console.log("This was a check only. Nothing was saved. Add --apply to import.");
    return;
  }
  const batch = batchId(text);
  const { data, error } = await admin().rpc("import_book", { p_batch: batch, p_file: basename(file), ...importPayload(result) });
  if (error) throw new Error(`Import failed and nothing was saved: ${error.message}`);
  if (data.duplicate) console.log(`This exact file was already imported (batch ${batch}). Nothing was saved again.`);
  else console.log(`Imported ${data.customers} new customers and ${data.loans} loans. Batch id (keep it, to undo): ${batch}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
