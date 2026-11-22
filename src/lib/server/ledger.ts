import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { Database } from "@/db";
import {
  clientDebtBalances,
  clients,
  debtPaymentItems,
  debtPayments,
  owners,
  products,
  transactionItems,
  transactions,
  type TransactionSource,
} from "@/db/schema";
import { allocateAbono } from "@/lib/clients/allocation";
import { getOutstandingUnits } from "@/lib/clients/debt";
import { centsToDecimal, toCents } from "@/lib/money";
import type { MoneyMethod, SaleMethod } from "@/lib/transactions/shared";

import { ActionError } from "./action";

/**
 * The ONE implementation of every ledger write. Each function runs inside a
 * caller-owned `db.transaction(...)` (so callers can add more writes — e.g.
 * the AI Cashier links its chat message — atomically) and throws
 * `ActionError(code)` for business failures. Used by the manual Server Actions
 * (inventory / transactions / clients) and by the AI Cashier confirm action.
 */
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface LineInput {
  productId: number;
  qty: number;
}

/** Merge duplicate product lines; returned ids are sorted (consistent lock order avoids deadlocks). */
function mergeLines(lines: LineInput[]): Map<number, number> {
  const merged = new Map<number, number>();
  for (const { productId, qty } of lines) merged.set(productId, (merged.get(productId) ?? 0) + qty);
  return new Map([...merged].sort(([a], [b]) => a - b));
}

async function assertClient(tx: Tx, clientId: number, lock = false) {
  const q = tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
  const [client] = lock ? await q.for("update") : await q;
  if (!client) throw new ActionError("notFound");
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sale
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Locks the products, snapshots price / cost / owner per line, decrements
 * stock and inserts the SALE. Stock may go negative (the shelf count wins;
 * /inventory flags it for audit).
 */
export async function commitSale(
  tx: Tx,
  input: {
    items: LineInput[];
    paymentMethod: SaleMethod;
    clientId: number | null;
    notes: string | null;
    occurredAt: Date | null;
    source: TransactionSource;
  },
): Promise<{ id: number; total: string }> {
  const qtyByProduct = mergeLines(input.items);
  if (qtyByProduct.size === 0) throw new ActionError("emptySale");
  if (input.paymentMethod === "FIADO" && !input.clientId) throw new ActionError("clientRequired");
  if (input.clientId) await assertClient(tx, input.clientId);

  const rows = await tx
    .select({
      id: products.id,
      ownerId: products.ownerId,
      salePrice: products.salePrice,
      unitCost: products.unitCost,
      isActive: products.isActive,
    })
    .from(products)
    .where(inArray(products.id, [...qtyByProduct.keys()]))
    .orderBy(asc(products.id))
    .for("update");
  if (rows.length !== qtyByProduct.size || rows.some((p) => !p.isActive)) {
    throw new ActionError("inactiveProduct");
  }

  const lines = rows.map((p) => {
    const qty = qtyByProduct.get(p.id)!;
    return { product: p, qty, lineCents: qty * toCents(p.salePrice) };
  });
  const totalCents = lines.reduce((sum, l) => sum + l.lineCents, 0);

  const [txn] = await tx
    .insert(transactions)
    .values({
      occurredAt: input.occurredAt ?? new Date(),
      type: "SALE",
      paymentMethod: input.paymentMethod,
      clientId: input.clientId,
      totalAmount: centsToDecimal(totalCents),
      notes: input.notes,
      source: input.source,
    })
    .returning({ id: transactions.id });

  await tx.insert(transactionItems).values(
    lines.map((l) => ({
      transactionId: txn.id,
      productId: l.product.id,
      ownerId: l.product.ownerId,
      quantityDelta: -l.qty,
      unitPriceSnapshot: l.product.salePrice,
      unitCostSnapshot: l.product.unitCost,
      lineTotal: centsToDecimal(l.lineCents),
    })),
  );

  for (const l of lines) {
    await tx
      .update(products)
      .set({ currentStock: sql`${products.currentStock} - ${l.qty}`, updatedAt: new Date() })
      .where(eq(products.id, l.product.id));
  }

  return { id: txn.id, total: centsToDecimal(totalCents) };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Debt payment (abono)
 * ──────────────────────────────────────────────────────────────────────────── */

export type DebtPaymentMode =
  /** Pay an amount to one owner: see allocateAbono() (strict oldest-first whole units, remainder = cash credit). */
  | { kind: "amount"; ownerId: number; amount: string }
  /** Pay explicit units ("abonó 3 refresco negro"): amount = Σ qty × today's price, one split per owner. */
  | { kind: "units"; items: LineInput[] };

export async function commitDebtPayment(
  tx: Tx,
  input: {
    clientId: number;
    paymentMethod: MoneyMethod;
    mode: DebtPaymentMode;
    notes: string | null;
    occurredAt: Date | null;
    source: TransactionSource;
  },
): Promise<{ transactionId: number; amount: string; unitsSettled: number; remaining: string | null }> {
  // Serialize abonos per client so two concurrent payments can't both pass the balance check.
  await assertClient(tx, input.clientId, true);
  const occurredAt = input.occurredAt ?? new Date();

  /** One debt_payments row (+ its settled units) per owner. */
  type Split = {
    ownerId: number;
    amountCents: number;
    items: { productId: number; quantity: number; price: string; lineCents: number }[];
  };
  const splits: Split[] = [];
  let remaining: string | null = null;

  if (input.mode.kind === "amount") {
    const { ownerId, amount } = input.mode;
    const [owner] = await tx.select({ id: owners.id }).from(owners).where(eq(owners.id, ownerId));
    if (!owner) throw new ActionError("notFound");

    const [debt] = await tx
      .select({ balance: clientDebtBalances.balance })
      .from(clientDebtBalances)
      .where(and(eq(clientDebtBalances.clientId, input.clientId), eq(clientDebtBalances.ownerId, ownerId)));
    const balanceCents = debt ? toCents(debt.balance) : 0;
    const amountCents = toCents(amount);
    if (balanceCents <= 0) throw new ActionError("noDebt");
    if (amountCents <= 0 || amountCents > balanceCents) throw new ActionError("exceedsDebt");

    // Same allocation the previews use (strict oldest-first, whole units, remainder = cash credit).
    const outstanding = await getOutstandingUnits(tx, { clientId: input.clientId, ownerId });
    const { items } = allocateAbono(
      outstanding.map((u) => ({ productId: u.product_id, qty: u.qty, price: u.price })),
      amountCents,
    );
    splits.push({ ownerId, amountCents, items });
    remaining = centsToDecimal(balanceCents - amountCents);
  } else {
    const qtyByProduct = mergeLines(input.mode.items);
    if (qtyByProduct.size === 0) throw new ActionError("emptySale");

    const outstanding = await getOutstandingUnits(tx, { clientId: input.clientId });
    const byOwner = new Map<number, Split>();
    for (const [productId, qty] of qtyByProduct) {
      // Units owed for this product (across owners — normally exactly one: the product's owner).
      const rows = outstanding.filter((u) => u.product_id === productId && u.qty > 0);
      const owed = rows.reduce((s, u) => s + u.qty, 0);
      if (owed === 0) throw new ActionError("noDebt");
      if (qty > owed) throw new ActionError("exceedsDebt");
      let left = qty;
      for (const u of rows) {
        const quantity = Math.min(left, u.qty);
        if (quantity <= 0) continue;
        const lineCents = quantity * toCents(u.price);
        const split = byOwner.get(u.owner_id) ?? { ownerId: u.owner_id, amountCents: 0, items: [] };
        split.items.push({ productId, quantity, price: u.price, lineCents });
        split.amountCents += lineCents;
        byOwner.set(u.owner_id, split);
        left -= quantity;
      }
    }
    splits.push(...byOwner.values());
    if (splits.every((s) => s.amountCents <= 0)) throw new ActionError("noDebt");
  }

  const totalCents = splits.reduce((s, x) => s + x.amountCents, 0);
  const [txn] = await tx
    .insert(transactions)
    .values({
      occurredAt,
      type: "DEBT_PAYMENT",
      paymentMethod: input.paymentMethod,
      clientId: input.clientId,
      totalAmount: centsToDecimal(totalCents),
      notes: input.notes,
      source: input.source,
    })
    .returning({ id: transactions.id });

  for (const s of splits) {
    const [dp] = await tx
      .insert(debtPayments)
      .values({
        transactionId: txn.id,
        clientId: input.clientId,
        ownerId: s.ownerId,
        amount: centsToDecimal(s.amountCents),
        paymentMethod: input.paymentMethod,
        occurredAt,
        notes: input.notes,
      })
      .returning({ id: debtPayments.id });
    if (s.items.length > 0) {
      await tx.insert(debtPaymentItems).values(
        s.items.map((i) => ({
          debtPaymentId: dp.id,
          productId: i.productId,
          quantity: i.quantity,
          unitPriceSnapshot: i.price,
          lineTotal: centsToDecimal(i.lineCents),
        })),
      );
    }
  }

  return {
    transactionId: txn.id,
    amount: centsToDecimal(totalCents),
    unitsSettled: splits.reduce((s, x) => s + x.items.reduce((a, i) => a + i.quantity, 0), 0),
    remaining,
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Restock ("Registrar Bulto")
 * ──────────────────────────────────────────────────────────────────────────── */

/** round(pack_cost / units_per_pack, 2) computed by Postgres on exact numerics. */
export const unitCostSql = (packCost: string, unitsPerPack: number) =>
  sql`round(${packCost}::numeric / ${unitsPerPack}, 2)`;

/**
 * Adds N packs: increases stock, updates pack/unit cost (and optionally the
 * sale price), and records a RESTOCK attributed to the product's owner.
 */
export async function commitRestock(
  tx: Tx,
  input: {
    productId: number;
    packs: number;
    packCost: string;
    newSalePrice: string | null;
    notes?: string | null;
    source: TransactionSource;
  },
): Promise<{ transactionId: number; unitsAdded: number; newStock: number; total: string }> {
  const [product] = await tx
    .select({
      ownerId: products.ownerId,
      unitsPerPack: products.unitsPerPack,
      salePrice: products.salePrice,
      isActive: products.isActive,
    })
    .from(products)
    .where(eq(products.id, input.productId))
    .for("update");
  if (!product) throw new ActionError("notFound");
  if (!product.isActive) throw new ActionError("inactiveProduct");

  const unitsAdded = input.packs * product.unitsPerPack;
  const totalCents = input.packs * toCents(input.packCost);
  const salePrice = input.newSalePrice ?? product.salePrice;

  const [updated] = await tx
    .update(products)
    .set({
      currentStock: sql`${products.currentStock} + ${unitsAdded}`,
      packCost: input.packCost,
      unitCost: unitCostSql(input.packCost, product.unitsPerPack),
      salePrice,
      updatedAt: new Date(),
    })
    .where(eq(products.id, input.productId))
    .returning({ currentStock: products.currentStock, unitCost: products.unitCost });

  const baseNote = `${input.packs} × ${product.unitsPerPack}u`;
  const [txn] = await tx
    .insert(transactions)
    .values({
      type: "RESTOCK",
      paymentMethod: "NONE",
      totalAmount: centsToDecimal(totalCents),
      notes: input.notes ? `${baseNote} · ${input.notes}` : baseNote,
      source: input.source,
    })
    .returning({ id: transactions.id });

  await tx.insert(transactionItems).values({
    transactionId: txn.id,
    productId: input.productId,
    ownerId: product.ownerId,
    quantityDelta: unitsAdded,
    unitPriceSnapshot: salePrice,
    unitCostSnapshot: updated.unitCost,
    lineTotal: centsToDecimal(totalCents),
  });

  return {
    transactionId: txn.id,
    unitsAdded,
    newStock: updated.currentStock,
    total: centsToDecimal(totalCents),
  };
}
