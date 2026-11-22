import "server-only";

import { dictionaries, interpolate } from "@/lib/i18n/config";
import { centsToDecimal } from "@/lib/money";

import type { Catalog, CatalogProduct } from "./context";
import { applyStockWarnings, computeTotal } from "./draft";
import type { CashierDraft, DraftItem, LlmOutput } from "./shared";

/** Accent/case-insensitive key: "Mamá" ≡ "mama", "Piña" ≡ "pina". */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Rough singular for Spanish/English plurals: "platanitos" → "platanito", "refrescos negros" → "refresco negro". */
const singular = (s: string) =>
  s
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");

/** SKU from the model first (validated against the catalog), then name/alias matching as a fallback. */
export function matchProduct(catalog: CatalogProduct[], sku: string | null, text: string): CatalogProduct | null {
  if (sku) {
    const bySku = catalog.find((p) => p.sku.toUpperCase() === sku.trim().toUpperCase());
    if (bySku) return bySku;
  }
  const q = singular(fold(text));
  if (!q) return null;
  const keys = (p: CatalogProduct) => [p.name, ...p.aliases].map((k) => singular(fold(k)));
  return (
    catalog.find((p) => keys(p).includes(q)) ??
    // Unique partial match ("chinoto" ⊂ "refresco chinoto").
    unique(catalog.filter((p) => keys(p).some((k) => k.includes(q) || q.includes(k))))
  );
}

export function matchByName<T extends { name: string }>(list: T[], name: string | null): T | null {
  if (!name) return null;
  const q = fold(name);
  if (!q) return null;
  // Exact, else the typed name is the start of exactly one known name ("Jonathan" → "Jonathan Pérez").
  // NOT the reverse: "Katiuska Nueva" is more likely a different person than "Katiuska".
  return list.find((x) => fold(x.name) === q) ?? unique(list.filter((x) => fold(x.name).startsWith(q)));
}

function unique<T>(list: T[]): T | null {
  return list.length === 1 ? list[0] : null;
}

/**
 * LLM references → a draft built ONLY from live Postgres data: ids, today's
 * prices, stock warnings and totals are computed here, never taken from the model.
 */
export function resolveDraft(llm: LlmOutput, catalog: Catalog): CashierDraft {
  const lang = llm.language;
  const n = dictionaries[lang].cashier.notes;
  const notes: string[] = [];
  if (llm.confidence_notes.trim()) notes.push(llm.confidence_notes.trim());

  /* ── Items ── */
  const items: DraftItem[] = llm.items.map((it) => {
    const p = matchProduct(catalog.products, it.sku, it.product_text);
    // No note for an unmatched product: the card flags it on the line itself, and the model usually explains it.
    const quantity = llm.intent === "STOCK_QUERY" ? 0 : Math.max(1, Math.min(10_000, Math.round(it.quantity) || 1));
    return {
      product_id: p?.id ?? null,
      sku: p?.sku ?? null,
      name: p?.name ?? null,
      query: it.product_text,
      quantity,
      unit_price: p?.salePrice ?? null,
      current_stock: p?.currentStock ?? null,
      owner_id: p?.ownerId ?? null,
      owner_name: p?.ownerName ?? null,
      stock_warning: false,
    };
  });
  const draftBase = { items };
  if (llm.intent === "SALE") applyStockWarnings(draftBase.items);

  /* ── Client ── */
  const needsClient =
    llm.intent === "DEBT_PAYMENT" || llm.intent === "DEBT_QUERY" || (llm.intent === "SALE" && llm.payment_method === "FIADO");
  const client = matchByName(catalog.clients, llm.client_name);
  let isNewClient = false;
  if (llm.client_name && !client) {
    // Only a Fiado sale can introduce a new client; you can't pay or ask about debt that doesn't exist.
    if (llm.intent === "SALE") {
      isNewClient = true;
      notes.push(interpolate(n.newClient, { client: llm.client_name }));
    } else if (needsClient) {
      notes.push(interpolate(n.clientNotFound, { client: llm.client_name }));
    }
  }
  if (needsClient && !llm.client_name && llm.intent !== "DEBT_QUERY") notes.push(n.clientMissing);

  /* ── Owner ── */
  const owner = matchByName(catalog.owners, llm.owner_name);
  if (llm.intent === "RESTOCK" && owner) {
    for (const it of items) {
      if (it.owner_id && it.owner_id !== owner.id) {
        notes.push(interpolate(n.ownerMismatch, { product: it.name ?? it.query, owner: it.owner_name ?? "" }));
      }
    }
  }

  /* ── Payment method ── */
  let method = llm.payment_method;
  if (llm.intent === "SALE" && !method) method = "CASH";
  if (llm.intent === "DEBT_PAYMENT" && method === "FIADO") method = null;
  if (llm.intent === "DEBT_PAYMENT" && !method) notes.push(n.methodMissing);
  if (!["SALE", "DEBT_PAYMENT"].includes(llm.intent)) method = null;

  const draft: CashierDraft = {
    intent: llm.intent,
    language: lang,
    payment_method: method,
    client_name: client?.name ?? llm.client_name,
    client_id: client?.id ?? null,
    is_new_client: isNewClient,
    owner_name: owner?.name ?? llm.owner_name,
    owner_id: owner?.id ?? null,
    items,
    pack_cost: llm.intent === "RESTOCK" && llm.pack_cost && llm.pack_cost > 0 ? centsToDecimal(Math.round(llm.pack_cost * 100)) : null,
    amount:
      llm.intent === "DEBT_PAYMENT" && items.length === 0 && llm.amount && llm.amount > 0
        ? centsToDecimal(Math.round(llm.amount * 100))
        : null,
    total_amount: "0.00",
    confidence_notes: [...new Set(notes)].join(" "),
    reply: llm.reply,
  };
  // A DEBT_PAYMENT by amount for a single owner: infer the owner when not stated but items name one.
  if (draft.intent === "DEBT_PAYMENT" && !draft.owner_id && items.length > 0) {
    const ownersInItems = [...new Set(items.map((i) => i.owner_id).filter(Boolean))];
    if (ownersInItems.length === 1) {
      draft.owner_id = ownersInItems[0];
      draft.owner_name = items.find((i) => i.owner_id === ownersInItems[0])?.owner_name ?? null;
    }
  }
  draft.total_amount = computeTotal(draft);
  return draft;
}
