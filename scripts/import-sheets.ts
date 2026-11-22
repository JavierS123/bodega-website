/**
 * One-time ETL: Google Sheets CSV exports → Supabase Postgres.
 *
 *   npx tsx scripts/import-sheets.ts --dry-run   # parse + audit report, no DB connection
 *   npx tsx scripts/import-sheets.ts --rehearse  # full write + verify, then ROLLBACK
 *   npx tsx scripts/import-sheets.ts             # import (no-op if already imported)
 *   npx tsx scripts/import-sheets.ts --reset     # replace a previous import
 *   npx tsx scripts/import-sheets.ts --dir path/to/csvs
 *
 * Flags combine, e.g. `--reset --rehearse` previews a re-import safely.
 *
 * Reads scripts/data/inventario.csv + transacciones.csv (+ optional dashboard.csv
 * for debt reconciliation). Everything is written inside one Postgres transaction:
 * either the whole history lands, or nothing does.
 */
import path from "node:path";

import { buildPlan, findProjectRoot, printReport, writePlan } from "./lib/import-core";

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(["--dry-run", "--rehearse", "--reset", "--dir", "--help", "-h"]);
  const unknown = args.filter((a, i) => a.startsWith("-") && !known.has(a) && args[i - 1] !== "--dir");
  if (args.includes("--help") || args.includes("-h") || unknown.length > 0) {
    if (unknown.length > 0) console.error(`Unknown option(s): ${unknown.join(", ")}\n`);
    console.log("Usage: npx tsx scripts/import-sheets.ts [--dry-run | --rehearse] [--reset] [--dir <folder>]");
    process.exit(unknown.length > 0 ? 1 : 0);
  }

  const dirIdx = args.indexOf("--dir");
  const dataDir =
    dirIdx >= 0 && args[dirIdx + 1]
      ? path.resolve(args[dirIdx + 1])
      : path.join(findProjectRoot(), "scripts", "data");
  const dryRun = args.includes("--dry-run");
  const reset = args.includes("--reset");

  console.log(`Reading CSVs from ${dataDir}`);
  const plan = buildPlan(dataDir);

  if (dryRun) {
    printReport(plan, null, "dry-run");
    return;
  }

  const rehearse = args.includes("--rehearse");
  console.log(
    `${rehearse ? "[rehearsal] " : ""}${reset ? "Resetting previous import and writing…" : "Writing to database…"}`,
  );
  const result = await writePlan(plan, { reset, rollback: rehearse });
  printReport(plan, result, "write");
}

main().catch((err: unknown) => {
  console.error(`\n✖ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
