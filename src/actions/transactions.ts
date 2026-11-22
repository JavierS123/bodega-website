"use server";

import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { clients, debtPayments, products, transactionItems, transactions } from "@/db/schema";
import type { ActionResult as BaseResult } from "@/lib/action-result";
import { ActionError as BaseActionError, runAdminAction, zId, zNote, zOccurredAt } from "@/lib/server/action";
import { commitSale } from "@/lib/server/ledger";
import { MONEY_METHODS, PAYMENT_METHODS, SALE_METHODS } from "@/lib/transactions/shared";

export type TransactionErrorCode =
  | "unauthorized"
  | "validation"
  | "notFound"
  | "alreadyVoided"
  | "clientRequired"
  | "notEditable"
  | "emptySale"
  | "inactiveProduct"
  | "unknown";

export type ActionResult<T = undefined> = BaseResult<T, TransactionErrorCode>;

class ActionError extends BaseActionError<TransactionErrorCode> {}

function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAdminAction<S, T, TransactionErrorCode>({ schema, input, label: "transactions" }, fn);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Schemas
 * ──────────────────────────────────────────────────────────────────────────── */

const saleSchema = z
  .object({
    items: z
      .array(z.object({ productId: zId, qty: z.number().int().min(1).max(10_000) }))
      .min(1)
      .max(50),
    paymentMethod: z.enum(SALE_METHODS),
    clientId: zId.nullish(),
    notes: zNote(300),
    occurredAt: zOccurredAt,
  })
  .refine((v) => v.paymentMethod !== "FIADO" || v.clientId, {
    path: ["clientId"],
    message: "Fiado requires a client",
  });

const updateSchema = z.object({
  id: zId,
  notes: zNote(500),
  paymentMethod: z.enum(PAYMENT_METHODS),
  clientId: zId.nullish(),
});

const voidSchema = z.object({
  id: zId,
  reason: z.string().trim().min(3).max(200),
});

export type ManualSaleInput = z.input<typeof saleSchema>;
export type UpdateTransactionInput = z.input<typeof updateSchema>;
export type VoidTransactionInput = z.input<typeof voidSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Actions
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Manual (non-AI) sale, one or many products. Atomically: locks the products,
 * snapshots price / cost / owner on each line, decrements stock and inserts
 * the SALE. Stock may go negative (the shelf count wins; /inventory flags it
 * for audit) — the UI warns before submitting.
 */
export async function createManualSale(
  input: ManualSaleInput,
): Promise<ActionResult<{ id: number; total: string }>> {
  return run(saleSchema, input, async (v) =>
    db.transaction((tx) =>
      commitSale(tx, {
        items: v.items,
        paymentMethod: v.paymentMethod,
        clientId: v.clientId ?? null,
        notes: v.notes,
        occurredAt: v.occurredAt,
        source: "WEB_MANUAL",
      }),
    ),
  );
}

/**
 * Edit the non-financial fields of a transaction. Amounts and items are never
 * edited — void and re-enter instead, so the audit trail stays honest.
 * - SALE: notes, payment method (CASH / PAGO_MOVIL / FIADO), client (FIADO ⇒ required).
 * - DEBT_PAYMENT: notes, method (CASH / PAGO_MOVIL; mirrored onto its debt_payments).
 * - RESTOCK / STOCK_ADJUSTMENT: notes only.
 */
export async function updateTransaction(input: UpdateTransactionInput): Promise<ActionResult> {
  return run(updateSchema, input, async (v) =>
    db.transaction(async (tx) => {
      const [txn] = await tx
        .select({
          type: transactions.type,
          paymentMethod: transactions.paymentMethod,
          clientId: transactions.clientId,
          isVoided: transactions.isVoided,
        })
        .from(transactions)
        .where(eq(transactions.id, v.id))
        .for("update");
      if (!txn) throw new ActionError("notFound");
      if (txn.isVoided) throw new ActionError("alreadyVoided");

      const clientId = v.clientId ?? null;
      const methodChanged = v.paymentMethod !== txn.paymentMethod;
      const clientChanged = clientId !== txn.clientId;

      if (txn.type === "SALE") {
        if (!(SALE_METHODS as readonly string[]).includes(v.paymentMethod)) throw new ActionError("notEditable");
        if (v.paymentMethod === "FIADO" && !clientId) throw new ActionError("clientRequired");
        if (clientId && clientChanged) {
          const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, clientId));
          if (!client) throw new ActionError("notFound");
        }
      } else if (txn.type === "DEBT_PAYMENT") {
        // The debt belongs to the client: re-assigning it would silently move debt between people.
        if (clientChanged) throw new ActionError("notEditable");
        if (!(MONEY_METHODS as readonly string[]).includes(v.paymentMethod)) throw new ActionError("notEditable");
        if (methodChanged) {
          await tx
            .update(debtPayments)
            .set({ paymentMethod: v.paymentMethod as (typeof MONEY_METHODS)[number] })
            .where(eq(debtPayments.transactionId, v.id));
        }
      } else if (methodChanged || clientChanged) {
        throw new ActionError("notEditable");
      }

      await tx
        .update(transactions)
        .set({ notes: v.notes, paymentMethod: v.paymentMethod, clientId })
        .where(eq(transactions.id, v.id));
      return undefined;
    }),
  );
}

/**
 * Void (never delete). Atomically marks the transaction voided and reverses
 * every stock delta it caused. Debt needs no write: client_debt_balances
 * excludes voided transactions, so a voided Fiado sale stops counting as debt
 * and a voided abono restores the debt it paid.
 * Note: prices/costs set by a voided RESTOCK are not rolled back.
 */
export async function voidTransaction(input: VoidTransactionInput): Promise<ActionResult<{ id: number }>> {
  return run(voidSchema, input, async ({ id, reason }) =>
    db.transaction(async (tx) => {
      const [txn] = await tx
        .select({ isVoided: transactions.isVoided })
        .from(transactions)
        .where(eq(transactions.id, id))
        .for("update");
      if (!txn) throw new ActionError("notFound");
      if (txn.isVoided) throw new ActionError("alreadyVoided");

      const deltas = await tx
        .select({
          productId: transactionItems.productId,
          delta: sql<number>`sum(${transactionItems.quantityDelta})::int`,
        })
        .from(transactionItems)
        .where(eq(transactionItems.transactionId, id))
        .groupBy(transactionItems.productId)
        .orderBy(asc(transactionItems.productId));

      for (const { productId, delta } of deltas) {
        if (delta === 0) continue;
        await tx
          .update(products)
          .set({ currentStock: sql`${products.currentStock} - ${delta}`, updatedAt: new Date() })
          .where(eq(products.id, productId));
      }

      await tx
        .update(transactions)
        .set({ isVoided: true, voidedAt: new Date(), voidReason: reason })
        .where(eq(transactions.id, id));

      return { id };
    }),
  );
}
