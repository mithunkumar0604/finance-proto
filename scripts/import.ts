// Imports existing customers and loans from a CSV file, as OPENING POSITIONS. See IMPORT.md.
//
//   npm run import -- <file.csv>            check the file and print a report (saves nothing)
//   npm run import -- <file.csv> --apply    save it (only if nothing in the report blocks it)
//   npm run import -- --undo <batch id>     take an import back (only before any payment)
//
// --apply and --undo need IMPORT_SUPABASE_URL and IMPORT_SUPABASE_SECRET_KEY (the
// project's secret key, sb_secret_...) in the environment. With them set, the plain check
// also looks (read-only) at what is already in LedgerPro.
// Run it from an administrator's computer; never put that key in the app.
// Real client files are personal data: keep them outside this repository.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { batchId, importPayload } from "../src/lib/import/payload";
import { validateImport, type ImportResult } from "../src/lib/import/validate";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const undo = args.includes("--undo") ? args[args.indexOf("--undo") + 1] : null;
const file = args.find((a) => !a.startsWith("--") && a !== undo);
const rupees = (p: number) => `Rs. ${new Intl.NumberFormat("en-IN").format(p / 100)}`;

function admin(required: boolean): SupabaseClient | null {
  const url = process.env.IMPORT_SUPABASE_URL;
  const key = process.env.IMPORT_SUPABASE_SECRET_KEY || process.env.IMPORT_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (required) throw new Error("Set IMPORT_SUPABASE_URL and IMPORT_SUPABASE_SECRET_KEY to save or undo an import.");
    return null;
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Read-only: what in this file is already in LedgerPro. Returns the things that must stop the import. */
async function compareWithLedger(db: SupabaseClient, result: ImportResult, batch: string): Promise<string[]> {
  const blocking: string[] = [];
  const done = await db.from("import_batches").select("at,undone_at").eq("id", batch).maybeSingle();
  if (done.data && !done.data.undone_at) console.log(`\nThis exact file was already imported on ${String(done.data.at).slice(0, 10)}. Importing it again will save nothing.`);

  const refs = result.loans.map((l) => l.ref).filter((r): r is string => !!r);
  if (refs.length) {
    const have = await db.from("loans").select("id,import_ref").in("import_ref", refs);
    if (have.error) throw new Error(have.error.message);
    for (const l of have.data ?? []) blocking.push(`loan_ref ${l.import_ref} is already in LedgerPro as ${l.id}.`);
  }
  let reuse = 0;
  for (const c of result.customers) {
    const byRef = c.ref ? await db.from("customers").select("id,name").ilike("import_ref", c.ref).maybeSingle() : { data: null };
    const byBoth = !byRef.data && c.phone ? await db.from("customers").select("id,name").eq("phone", c.phone).ilike("name", c.name).is("import_ref", null).limit(1).maybeSingle() : { data: null };
    const found = byRef.data ?? byBoth.data;
    if (found) {
      reuse++;
      console.log(`  row ${c.row}: "${c.name}" is already in LedgerPro as ${found.id}; the loan(s) will be added to that customer.`);
    } else if (c.phone) {
      const share = await db.from("customers").select("id,name").eq("phone", c.phone).limit(3);
      for (const o of share.data ?? []) console.log(`  row ${c.row}: "${c.name}" has the same phone as ${o.id} "${o.name}" already in LedgerPro. A NEW customer will be created (a shared phone does not merge people).`);
    }
  }
  console.log(`Customers already in LedgerPro that will be reused: ${reuse}. New customers: ${result.customers.length - reuse}.`);
  return blocking;
}

async function main() {
  if (undo) {
    const { data, error } = await admin(true)!.rpc("undo_import", { p_batch: undo });
    if (error) throw new Error(error.message);
    console.log(`Taken back: ${data.customers} customers and ${data.loans} loans removed.`);
    return;
  }
  if (!file) throw new Error("Usage: npm run import -- <file.csv> [--apply]");
  const inRepo = resolve(file).startsWith(resolve("import") + sep) && !/^(template|sample-\d+)\.csv$/.test(basename(file));
  if (inRepo) console.log("NOTE: this file is inside the repository folder. Git ignores it, but keep real client files elsewhere.");

  const text = readFileSync(file, "utf8");
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10); // IST
  const result = validateImport(text, today);
  const batch = batchId(text);

  console.log(`\nFile: ${basename(file)}   (checked against ${today})`);
  console.log(`Rows that are fine: ${result.customers.length} customers, ${result.loans.length} loans`);
  const active = result.loans.filter((l) => l.status === "active");
  console.log(`  running loans: ${active.length}, closed: ${result.loans.length - active.length}`);
  console.log(`  principal still out: ${rupees(active.reduce((a, l) => a + l.principalLeft, 0))}`);
  console.log(`  interest pending today (already due, unpaid): ${rupees(active.reduce((a, l) => a + l.pendingToday, 0))} on ${active.filter((l) => l.periodsPending > 0).length} loan(s)`);

  if (result.datesReadAs.length) {
    console.log("\nDates are read day first (DD/MM/YYYY). The first ones in this file were read as:");
    for (const d of result.datesReadAs) console.log(`  row ${d.row}, ${d.column}: "${d.written}" = ${d.readAs}`);
    console.log("  If any of these is wrong, the sheet's dates are in another format: stop and fix the sheet.");
  }

  if (!result.ok) {
    console.log(`\n${result.errors.length} problem(s). NOTHING will be imported until these are fixed:\n`);
    for (const e of result.errors) console.log(`  row ${e.row}, ${e.column}: ${e.message}`);
    process.exit(1);
  }

  const blocking = result.warnings.filter((w) => w.affectsBalance).map((w) => `row ${w.row}, ${w.column}: ${w.message}`);
  const notes = result.warnings.filter((w) => !w.affectsBalance);
  if (notes.length) {
    console.log(`\n${notes.length} thing(s) to read before importing (they do not stop the import):`);
    for (const w of notes) console.log(`  ${w.row ? `row ${w.row}` : "whole file"}${w.column ? `, ${w.column}` : ""}: ${w.message}`);
  }

  console.log("\nWhat each running loan will show on day one:");
  for (const l of active)
    console.log(`  row ${l.row}${l.ref ? ` (${l.ref})` : ""}: principal left ${rupees(l.principalLeft)}; pending ${rupees(l.pendingToday)} over ${l.periodsPending} period(s); oldest unpaid ${l.nextDueDate}${l.interestAlreadyPaid ? `; ${rupees(l.interestAlreadyPaid)} of it already paid` : ""}`);
  console.log("  Payments made before the import are not brought in. \"Collected\" on these loans counts from the import day.");

  const db = admin(apply);
  if (db) {
    console.log("\nCompared with what is already in LedgerPro (read-only):");
    blocking.push(...(await compareWithLedger(db, result, batch)));
  } else console.log("\n(Not compared with what is already in LedgerPro: the project URL and secret key are not set.)");

  if (blocking.length) {
    console.log(`\n${blocking.length} issue(s) that could change a balance or duplicate a loan. NOTHING will be imported until they are settled:\n`);
    for (const b of blocking) console.log(`  ${b}`);
    process.exit(1);
  }
  console.log("\nNo problems found.");

  if (!apply) {
    console.log("This was a check only. Nothing was saved. Add --apply to import.");
    return;
  }
  const { data, error } = await db!.rpc("import_book", { p_batch: batch, p_file: basename(file), ...importPayload(result) });
  if (error) throw new Error(`Import failed and nothing was saved: ${error.message}`);
  if (data.duplicate) console.log(`This exact file was already imported (batch ${batch}). Nothing was saved again.`);
  else console.log(`Imported ${data.customers} new customers and ${data.loans} loans. Batch id (keep it, to undo): ${batch}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
