/**
 * Live smoke test for the AI Cashier parser (real Gemini + live catalog; read-only, writes nothing).
 *
 *   npx tsx --conditions=react-server scripts/ai-smoke.ts            # default spec prompts
 *   npx tsx --conditions=react-server scripts/ai-smoke.ts "Vendí 2 pepitos"
 *
 * `--conditions=react-server` lets the `server-only` modules load outside Next.js.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const DEFAULT_PROMPTS = [
  "Fiado para Mariana: 2 platanitos y 1 chinoto",
  "Vendí 3 refrescos negros pago movil",
  "Jonathan abonó 3 refresco negro por pago movil a Frank",
  "Frank compra 2 bultos de refresco negro a 6200 cada uno",
  "Cuanto debe Jonathan?",
  "¿Cuánto queda de pepito?",
  "Sale: 3 barriletes cash",
];

async function main() {
  const { runCashierParse } = await import("../src/lib/ai/pipeline");
  const prompts = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PROMPTS;
  for (const prompt of prompts) {
    const started = Date.now();
    try {
      const r = await runCashierParse(prompt);
      const d = r.draft;
      console.log(`\n▶ ${prompt}  (${Date.now() - started} ms)`);
      console.log(
        `  ${d.intent} · ${d.payment_method ?? "-"} · client=${d.client_name ?? "-"}${d.is_new_client ? " (NEW)" : d.client_id ? ` #${d.client_id}` : ""} · owner=${d.owner_name ?? "-"} · total=${d.total_amount}`,
      );
      for (const i of d.items) {
        console.log(
          `    - ${i.sku ?? `?? "${i.query}"`} ×${i.quantity} @ ${i.unit_price ?? "-"} (stock ${i.current_stock ?? "-"})${i.stock_warning ? " ⚠ stock" : ""}`,
        );
      }
      if (d.pack_cost) console.log(`    pack_cost=${d.pack_cost}`);
      if (d.settlement_type) console.log(`    settlement=${d.settlement_type} via ${d.settlement_method}`);
      if (d.amount) console.log(`    amount=${d.amount}`);
      if (d.confidence_notes) console.log(`  notes: ${d.confidence_notes}`);
      console.log(`  [${r.status}] ${r.reply}`);
    } catch (error) {
      console.log(`\n▶ ${prompt}\n  ERROR`, error);
    }
  }
  process.exit(0);
}

void main();
