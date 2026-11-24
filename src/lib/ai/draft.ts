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

/**
 * Did the human change what the AI proposed? (Totals are ignored: prices may
 * move between parse and confirm.) An edited confirm is implicit feedback.
 */
export function wasEdited(a: CashierDraft, b: CashierDraft): boolean {
  const key = (d: CashierDraft) =>
    JSON.stringify([
      d.payment_method,
      d.settlement_type ?? null,
      d.settlement_method ?? null,
      d.client_name?.trim().toLowerCase() ?? null,
      d.owner_id,
      d.pack_cost,
      d.amount,
      d.items.map((i) => [i.product_id, i.quantity]),
    ]);
  return key(a) !== key(b);
}

/** One-line, language-neutral description of a draft ("SALE · PAGO_MOVIL · REF_NEG×2 · cliente Mariana"). */
export function summarizeDraft(d: CashierDraft): string {
  return [
    d.intent,
    d.settlement_type,
    d.payment_method ?? d.settlement_method,
    d.items.length ? d.items.map((i) => `${i.sku ?? `¿${i.query}?`}×${i.quantity}`).join(", ") : null,
    d.client_name ? `cliente ${d.client_name}` : null,
    d.owner_name && (d.intent !== "SALE") ? `dueño ${d.owner_name}` : null,
    d.pack_cost ? `costo/bulto ${d.pack_cost}` : null,
    d.amount ? `monto ${d.amount}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Total shown on the card (the server recomputes from Postgres on confirm). Client-safe math. */
export function computeTotal(d: Pick<CashierDraft, "intent" | "items" | "pack_cost" | "amount">): string {
  if (d.intent === "SALE" || (d.intent === "DEBT_PAYMENT" && d.items.length > 0)) {
    return centsToDecimal(d.items.reduce((s, i) => s + (i.unit_price ? i.quantity * toCents(i.unit_price) : 0), 0));
  }
  if (d.intent === "DEBT_PAYMENT" || d.intent === "SETTLEMENT") return d.amount ?? "0.00";
  if (d.intent === "RESTOCK") {
    const packs = d.items[0]?.quantity ?? 0;
    return d.pack_cost ? centsToDecimal(packs * toCents(d.pack_cost)) : "0.00";
  }
  return "0.00";
}
