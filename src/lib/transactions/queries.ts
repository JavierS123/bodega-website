import "server-only";

import { and, asc, count, desc, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/db";
import {
  clients,
  debtPaymentItems,
  debtPayments,
  owners,
  products,
  transactionItems,
  transactions,
} from "@/db/schema";
import { SHOP_TIME_ZONE } from "@/lib/format";

import {
  LEDGER_PAGE_SIZE,
  type LedgerDebtPayment,
  type LedgerFilters,
  type LedgerItem,
  type LedgerPage,
  type SaleProductOption,
} from "./shared";

/** Start of a shop-local calendar day as timestamptz. */
const dayStart = (day: string) => sql`(${day}::date)::timestamp at time zone ${SHOP_TIME_ZONE}`;

function ledgerWhere(f: LedgerFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [
    f.from ? sql`${transactions.occurredAt} >= ${dayStart(f.from)}` : undefined,
    // `to` is inclusive: everything before the start of the following day.
    f.to ? sql`${transactions.occurredAt} < ${dayStart(f.to)} + interval '1 day'` : undefined,
    f.type ? eq(transactions.type, f.type) : undefined,
    f.method ? eq(transactions.paymentMethod, f.method) : undefined,
    f.source ? eq(transactions.source, f.source) : undefined,
    f.clientId ? eq(transactions.clientId, f.clientId) : undefined,
    f.status === "active" ? eq(transactions.isVoided, false) : undefined,
    f.status === "voided" ? eq(transactions.isVoided, true) : undefined,
    // Owner: any line item OR debt-payment split attributed to that owner.
    f.ownerId
      ? or(
          exists(
            db
              .select({ one: sql`1` })
              .from(transactionItems)
              .where(
                and(
                  eq(transactionItems.transactionId, transactions.id),
                  eq(transactionItems.ownerId, f.ownerId),
                ),
              ),
          ),
          exists(
            db
              .select({ one: sql`1` })
              .from(debtPayments)
              .where(
                and(eq(debtPayments.transactionId, transactions.id), eq(debtPayments.ownerId, f.ownerId)),
              ),
          ),
        )
      : undefined,
  ];
  return and(...conds);
}

/**
 * One page of the ledger plus everything needed to expand each row
 * (line items, debt-payment splits), so expanding needs no round trip.
 */
export async function listLedger(filters: LedgerFilters): Promise<LedgerPage> {
  await connection();
  const where = ledgerWhere(filters);

  const [{ total }] = await db.select({ total: count() }).from(transactions).where(where);
  const pageCount = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);

  const base = await db
    .select({
      id: transactions.id,
      legacyId: transactions.legacyId,
      occurredAt: transactions.occurredAt,
      type: transactions.type,
      paymentMethod: transactions.paymentMethod,
      source: transactions.source,
      clientId: transactions.clientId,
      clientName: clients.name,
      totalAmount: transactions.totalAmount,
      notes: transactions.notes,
      isVoided: transactions.isVoided,
      voidedAt: transactions.voidedAt,
      voidReason: transactions.voidReason,
    })
    .from(transactions)
    .leftJoin(clients, eq(clients.id, transactions.clientId))
    .where(where)
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(LEDGER_PAGE_SIZE)
    .offset((page - 1) * LEDGER_PAGE_SIZE);

  const ids = base.map((r) => r.id);
  const [items, payments] = ids.length ? await getLedgerDetails(ids) : [new Map(), new Map()];

  return {
    rows: base.map((r) => ({
      ...r,
      items: items.get(r.id) ?? [],
      debtPayments: payments.get(r.id) ?? [],
    })),
    total,
    page,
    pageCount,
  };
}

async function getLedgerDetails(
  ids: number[],
): Promise<[Map<number, LedgerItem[]>, Map<number, LedgerDebtPayment[]>]> {
  const itemRows = await db
    .select({
      transactionId: transactionItems.transactionId,
      id: transactionItems.id,
      productId: transactionItems.productId,
      sku: products.sku,
      productName: products.name,
      ownerId: transactionItems.ownerId,
      ownerName: owners.name,
      quantityDelta: transactionItems.quantityDelta,
      unitPrice: transactionItems.unitPriceSnapshot,
      unitCost: transactionItems.unitCostSnapshot,
      lineTotal: transactionItems.lineTotal,
    })
    .from(transactionItems)
    .innerJoin(products, eq(products.id, transactionItems.productId))
    .innerJoin(owners, eq(owners.id, transactionItems.ownerId))
    .where(inArray(transactionItems.transactionId, ids))
    .orderBy(asc(transactionItems.id));

  const dpRows = await db
    .select({
      transactionId: debtPayments.transactionId,
      id: debtPayments.id,
      ownerId: debtPayments.ownerId,
      ownerName: owners.name,
      amount: debtPayments.amount,
      method: debtPayments.paymentMethod,
      itemSku: products.sku,
      itemName: products.name,
      itemQty: debtPaymentItems.quantity,
      itemTotal: debtPaymentItems.lineTotal,
    })
    .from(debtPayments)
    .innerJoin(owners, eq(owners.id, debtPayments.ownerId))
    .leftJoin(debtPaymentItems, eq(debtPaymentItems.debtPaymentId, debtPayments.id))
    .leftJoin(products, eq(products.id, debtPaymentItems.productId))
    .where(inArray(debtPayments.transactionId, ids))
    .orderBy(asc(debtPayments.id), asc(debtPaymentItems.id));

  const items = new Map<number, LedgerItem[]>();
  for (const { transactionId, ...item } of itemRows) {
    const list = items.get(transactionId) ?? [];
    list.push(item);
    items.set(transactionId, list);
  }

  const payments = new Map<number, LedgerDebtPayment[]>();
  const byId = new Map<number, LedgerDebtPayment>();
  for (const r of dpRows) {
    let dp = byId.get(r.id);
    if (!dp) {
      dp = { id: r.id, ownerId: r.ownerId, ownerName: r.ownerName, amount: r.amount, method: r.method, items: [] };
      byId.set(r.id, dp);
      const list = payments.get(r.transactionId) ?? [];
      list.push(dp);
      payments.set(r.transactionId, list);
    }
    if (r.itemSku && r.itemName && r.itemQty !== null && r.itemTotal !== null) {
      dp.items.push({ sku: r.itemSku, productName: r.itemName, quantity: r.itemQty, lineTotal: r.itemTotal });
    }
  }
  return [items, payments];
}

/** Active products for the manual-sale picker. */
export async function listSaleProducts(): Promise<SaleProductOption[]> {
  await connection();
  return db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      ownerId: products.ownerId,
      ownerName: owners.name,
      salePrice: products.salePrice,
      currentStock: products.currentStock,
    })
    .from(products)
    .innerJoin(owners, eq(owners.id, products.ownerId))
    .where(eq(products.isActive, true))
    .orderBy(asc(products.name));
}
