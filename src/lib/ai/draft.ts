/**
 * Draft math shared by the resolver (server) and the editable Confirmation Card
 * (client). Display only — confirm re-derives prices and totals from Postgres.
 */
import { centsToDecimal, toCents } from "@/lib/money";

import type { CashierDraft, DraftItem } from "./shared";

/** SALE: flag lines whose (summed) quantity exceeds current stock. Mutates and returns items. */
export function applyStockWarnings(items: DraftItem[]): DraftItem[] {
  const want = new Map<number, number>();
  for (const i of items) if (i.product_id) want.set(i.product_id, (want.get(i.product_id) ?? 0) + i.quantity);
  for (const i of items) {
    i.stock_warning = Boolean(i.product_id && i.current_stock !== null && (want.get(i.product_id) ?? 0) > i.current_stock);
  }
  return items;
}

/** Total shown on the card (the server recomputes from Postgres on confirm). Client-safe math. */
export function computeTotal(d: Pick<CashierDraft, "intent" | "items" | "pack_cost" | "amount">): string {
  if (d.intent === "SALE" || (d.intent === "DEBT_PAYMENT" && d.items.length > 0)) {
    return centsToDecimal(d.items.reduce((s, i) => s + (i.unit_price ? i.quantity * toCents(i.unit_price) : 0), 0));
  }
  if (d.intent === "DEBT_PAYMENT") return d.amount ?? "0.00";
  if (d.intent === "RESTOCK") {
    const packs = d.items[0]?.quantity ?? 0;
    return d.pack_cost ? centsToDecimal(packs * toCents(d.pack_cost)) : "0.00";
  }
  return "0.00";
}
