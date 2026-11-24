import "server-only";

import { and, asc, eq, exists, inArray, or, sql, type SQL } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/db";
import {
  clients,
  debtPaymentItems,
  debtPayments,
  owners,
  ownerSettlements,
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
  type LedgerRow,
  type SaleProductOption,
} from "./shared";

/** Start of a shop-local calendar day as timestamptz. */
const dayStart = (day: string) => sql`(${day}::date)::timestamp at time zone ${SHOP_TIME_ZONE}`;

const NONE = sql`false`;

/** WHERE for `transactions`, or NONE when the filters exclude every transaction. */
function ledgerWhere(f: LedgerFilters): SQL {
  if (f.type === "SETTLEMENT") return NONE;
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
  return and(...conds) ?? sql`true`;
}

/** WHERE for `owner_settlements` (owner money movements), or NONE when filtered out. */
function settlementWhere(f: LedgerFilters): SQL {
  // Movements have no client, and only move cash or Pago Móvil.
  if ((f.type && f.type !== "SETTLEMENT") || f.clientId) return NONE;
  if (f.method && f.method !== "CASH" && f.method !== "PAGO_MOVIL") return NONE;
  const s = ownerSettlements;
  return (
    and(
      f.from ? sql`${s.occurredAt} >= ${dayStart(f.from)}` : undefined,
      f.to ? sql`${s.occurredAt} < ${dayStart(f.to)} + interval '1 day'` : undefined,
      f.method === "CASH" || f.method === "PAGO_MOVIL" ? eq(s.paymentMethod, f.method) : undefined,
      f.source ? eq(s.source, f.source) : undefined,
      f.ownerId ? eq(s.ownerId, f.ownerId) : undefined,
      f.status === "active" ? eq(s.isVoided, false) : undefined,
      f.status === "voided" ? eq(s.isVoided, true) : undefined,
    ) ?? sql`true`
  );
}

/**
 * One page of the ledger plus everything needed to expand each row
 * (line items, debt-payment splits), so expanding needs no round trip.
 */
export async function listLedger(filters: LedgerFilters): Promise<LedgerPage> {
  await connection();
  // One timeline over both tables: ledger transactions + owner money movements.
  const union = sql`
    select 'TX' as kind, ${transactions.id} as id, ${transactions.occurredAt} as occurred_at
    from ${transactions} where ${ledgerWhere(filters)}
    union all
    select 'SETTLEMENT', ${ownerSettlements.id}, ${ownerSettlements.occurredAt}
    from ${ownerSettlements} where ${settlementWhere(filters)}`;

  const [{ total }] = await db.execute<{ total: number }>(sql`select count(*)::int as total from (${union}) u`);
  const pageCount = Math.max(1, Math.ceil(total / LEDGER_PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);

  const keys = await db.execute<{ kind: "TX" | "SETTLEMENT"; id: number }>(sql`
    select kind, id from (${union}) u
    order by occurred_at desc, kind desc, id desc
    limit ${LEDGER_PAGE_SIZE} offset ${(page - 1) * LEDGER_PAGE_SIZE}`);
  const txIds = keys.filter((k) => k.kind === "TX").map((k) => k.id);
  const stIds = keys.filter((k) => k.kind === "SETTLEMENT").map((k) => k.id);

  const [txRows, stRows, [items, payments]] = await Promise.all([
    txIds.length
      ? db
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
          .where(inArray(transactions.id, txIds))
      : [],
    stIds.length
      ? db
          .select({
            id: ownerSettlements.id,
            legacyId: ownerSettlements.legacyId,
            occurredAt: ownerSettlements.occurredAt,
            settlementType: ownerSettlements.type,
            paymentMethod: ownerSettlements.paymentMethod,
            source: ownerSettlements.source,
            ownerId: ownerSettlements.ownerId,
            ownerName: owners.name,
            amount: ownerSettlements.amount,
            notes: ownerSettlements.notes,
            isVoided: ownerSettlements.isVoided,
            voidedAt: ownerSettlements.voidedAt,
            voidReason: ownerSettlements.voidReason,
          })
          .from(ownerSettlements)
          .innerJoin(owners, eq(owners.id, ownerSettlements.ownerId))
          .where(inArray(ownerSettlements.id, stIds))
      : [],
    txIds.length ? getLedgerDetails(txIds) : ([new Map(), new Map()] as const),
  ]);

  const byKey = new Map<string, LedgerRow>();
  for (const r of txRows) {
    byKey.set(`TX-${r.id}`, {
      ...r,
      kind: "TX",
      items: items.get(r.id) ?? [],
      debtPayments: payments.get(r.id) ?? [],
      settlement: null,
    });
  }
  for (const r of stRows) {
    byKey.set(`SETTLEMENT-${r.id}`, {
      kind: "SETTLEMENT",
      id: r.id,
      legacyId: r.legacyId,
      occurredAt: r.occurredAt,
      type: "SETTLEMENT",
      paymentMethod: r.paymentMethod,
      source: r.source,
      clientId: null,
      clientName: null,
      totalAmount: r.amount,
      notes: r.notes,
      isVoided: r.isVoided,
      voidedAt: r.voidedAt,
      voidReason: r.voidReason,
      items: [],
      debtPayments: [],
      settlement: { ownerId: r.ownerId, ownerName: r.ownerName, type: r.settlementType },
    });
  }

  return {
    rows: keys.flatMap((k) => byKey.get(`${k.kind}-${k.id}`) ?? []),
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
