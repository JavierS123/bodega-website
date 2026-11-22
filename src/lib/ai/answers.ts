import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { clientDebtBalances, owners } from "@/db/schema";
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
  const rows = await db
    .select({ owner: owners.name, balance: clientDebtBalances.balance })
    .from(clientDebtBalances)
    .innerJoin(owners, eq(owners.id, clientDebtBalances.ownerId))
    .where(eq(clientDebtBalances.clientId, draft.client_id))
    .orderBy(asc(owners.id));

  const owed = rows.filter((r) => toCents(r.balance) !== 0);
  const totalCents = owed.reduce((s, r) => s + toCents(r.balance), 0);
  const client = draft.client_name ?? "";
  if (totalCents === 0) return interpolate(a.debtNone, { client });
  if (totalCents < 0) return interpolate(a.debtCredit, { client, amount: formatCurrency(centsToDecimal(-totalCents)) });
  const breakdown = owed.map((r) => `${r.owner} ${formatCurrency(r.balance)}`).join(", ");
  return interpolate(a.debtTotal, { client, total: formatCurrency(centsToDecimal(totalCents)), breakdown });
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
