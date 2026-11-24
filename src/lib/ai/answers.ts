import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { clientDebtBalances, owners } from "@/db/schema";
import { getOutstandingUnits } from "@/lib/clients/debt";
import { formatCurrency } from "@/lib/format";
import { dictionaries, interpolate } from "@/lib/i18n/config";
import { centsToDecimal, toCents } from "@/lib/money";

import type { CashierDraft } from "./shared";

/**
 * Live answers for the INFO intents — computed from Postgres, never by the
 * model, so "¿Cuánto debe Jonathan?" is always exact and current.
 */
export async function answerDebtQuery(draft: CashierDraft): Promise<string> {
  const a = dictionaries[draft.language].cashier.answers;
  if (!draft.client_id) {
    return draft.client_name ? interpolate(a.clientNotFound, { client: draft.client_name }) : a.clientMissing;
  }
  const [rows, units] = await Promise.all([
    db
      .select({
        owner: owners.name,
        unitsValue: clientDebtBalances.unitsValue,
        cashCredit: clientDebtBalances.cashCredit,
        balance: clientDebtBalances.balance,
      })
      .from(clientDebtBalances)
      .innerJoin(owners, eq(owners.id, clientDebtBalances.ownerId))
      .where(eq(clientDebtBalances.clientId, draft.client_id))
      .orderBy(asc(owners.id)),
    getOutstandingUnits(db, { clientId: draft.client_id }),
  ]);

  const owed = rows.filter((r) => toCents(r.balance) !== 0);
  const totalCents = owed.reduce((s, r) => s + toCents(r.balance), 0);
  const client = draft.client_name ?? "";
  if (totalCents === 0) return interpolate(a.debtNone, { client });
  if (totalCents < 0) return interpolate(a.debtCredit, { client, amount: formatCurrency(centsToDecimal(-totalCents)) });

  // Same product can be owed to more than one owner — merge into one line.
  const products = new Map<number, { name: string; qty: number }>();
  for (const u of units) {
    const p = products.get(u.product_id) ?? { name: u.product_name, qty: 0 };
    p.qty += Number(u.qty);
    products.set(u.product_id, p);
  }
  const productsCents = rows.reduce((s, r) => s + toCents(r.unitsValue), 0);
  const creditCents = rows.reduce((s, r) => s + toCents(r.cashCredit), 0);
  const money = (cents: number) => formatCurrency(centsToDecimal(cents));

  const lines = [interpolate(a.debtClient, { client })];
  const itemLines = [...products.values()]
    .filter((p) => p.qty > 0)
    .map((p) => interpolate(a.debtItemLine, { qty: p.qty, product: p.name }));
  if (itemLines.length > 0) lines.push("", a.debtItemsTitle, ...itemLines);

  lines.push("", a.debtSummaryTitle, interpolate(a.debtProductsTotal, { amount: money(productsCents) }));
  if (creditCents !== 0) lines.push(interpolate(a.debtPartialPayments, { amount: money(creditCents) }));
  lines.push(interpolate(a.debtGrandTotal, { amount: money(totalCents) }));

  if (owed.length > 1) {
    lines.push(
      "",
      a.debtByOwnerTitle,
      ...owed.map((r) => interpolate(a.debtOwnerLine, { owner: r.owner, amount: formatCurrency(r.balance) })),
    );
  }
  return lines.join("\n");
}

export function answerStockQuery(draft: CashierDraft): string {
  const a = dictionaries[draft.language].cashier.answers;
  if (draft.items.length === 0) return a.stockMissing;
  return draft.items
    .map((i) =>
      i.product_id === null || i.current_stock === null
        ? interpolate(a.productNotFound, { product: i.query })
        : interpolate(i.current_stock <= 0 ? a.stockAudit : a.stockLine, { product: i.name ?? i.query, count: i.current_stock }),
    )
    .join(" ");
}
