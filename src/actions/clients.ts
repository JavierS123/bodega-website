"use server";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  clientDebtBalances,
  clients,
  debtPaymentItems,
  debtPayments,
  owners,
  transactions,
} from "@/db/schema";
import type { ActionResult as BaseResult } from "@/lib/action-result";
import { getOutstandingUnits } from "@/lib/clients/debt";
import { centsToDecimal, toCents } from "@/lib/money";
import {
  ActionError as BaseActionError,
  runAdminAction,
  zId,
  zMoney,
  zNote,
  zOccurredAt,
} from "@/lib/server/action";
import { MONEY_METHODS } from "@/lib/transactions/shared";

export type ClientErrorCode =
  | "unauthorized"
  | "validation"
  | "duplicateName"
  | "notFound"
  | "exceedsDebt"
  | "noDebt"
  | "unknown";

export type ActionResult<T = undefined> = BaseResult<T, ClientErrorCode>;

class ActionError extends BaseActionError<ClientErrorCode> {}

function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAdminAction<S, T, ClientErrorCode>(
    { schema, input, label: "clients", onUniqueViolation: "duplicateName" },
    fn,
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Schemas
 * ──────────────────────────────────────────────────────────────────────────── */

const clientSchema = z.object({
  id: zId.optional(),
  // Same normalization as the CSV import: trimmed, inner whitespace collapsed.
  name: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .transform((s) => s.replace(/\s+/g, " ")),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[\d\s()+-]*$/, "Digits, spaces, + ( ) - only")
    .nullish()
    .transform((v) => v || null),
  notes: zNote(300),
});

const debtPaymentSchema = z.object({
  clientId: zId,
  ownerId: zId,
  amount: zMoney.refine((v) => toCents(v) > 0, "Must be greater than 0"),
  paymentMethod: z.enum(MONEY_METHODS),
  notes: zNote(300),
  occurredAt: zOccurredAt,
});

export type ClientInput = z.input<typeof clientSchema>;
export type DebtPaymentInput = z.input<typeof debtPaymentSchema>;

/* ────────────────────────────────────────────────────────────────────────────
 * Actions
 * ──────────────────────────────────────────────────────────────────────────── */

/** Create (no id) or update (id) a client. Names are unique. */
export async function saveClient(input: ClientInput): Promise<ActionResult<{ id: number }>> {
  return run(clientSchema, input, async ({ id, ...values }) => {
    if (id) {
      const [row] = await db.update(clients).set(values).where(eq(clients.id, id)).returning({ id: clients.id });
      if (!row) throw new ActionError("notFound");
      return { id: row.id };
    }
    const [row] = await db.insert(clients).values(values).returning({ id: clients.id });
    return { id: row.id };
  });
}

/**
 * "Registrar Abono". Atomically inserts a DEBT_PAYMENT transaction + its
 * debt_payments row, settling whole outstanding Fiado UNITS first (oldest
 * Fiado first, at today's sale price → debt_payment_items) and keeping any
 * remainder as cash credit (amount − items). Rejects amounts above what the
 * client currently owes that owner.
 */
export async function registerDebtPayment(
  input: DebtPaymentInput,
): Promise<ActionResult<{ transactionId: number; unitsSettled: number; remaining: string }>> {
  return run(debtPaymentSchema, input, async (v) =>
    db.transaction(async (tx) => {
      // Serialize abonos per client so two concurrent payments can't both pass the balance check.
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, v.clientId))
        .for("update");
      if (!client) throw new ActionError("notFound");
      const [owner] = await tx.select({ id: owners.id }).from(owners).where(eq(owners.id, v.ownerId));
      if (!owner) throw new ActionError("notFound");

      const [debt] = await tx
        .select({ balance: clientDebtBalances.balance })
        .from(clientDebtBalances)
        .where(and(eq(clientDebtBalances.clientId, v.clientId), eq(clientDebtBalances.ownerId, v.ownerId)));
      const balanceCents = debt ? toCents(debt.balance) : 0;
      const amountCents = toCents(v.amount);
      if (balanceCents <= 0) throw new ActionError("noDebt");
      if (amountCents > balanceCents) throw new ActionError("exceedsDebt");

      // Allocate to whole units, oldest Fiado first.
      const outstanding = await getOutstandingUnits(tx, { clientId: v.clientId, ownerId: v.ownerId });
      let remaining = amountCents;
      const settled: { productId: number; quantity: number; price: string; lineCents: number }[] = [];
      for (const u of outstanding) {
        const priceCents = toCents(u.price);
        if (u.qty <= 0 || priceCents <= 0) continue;
        const quantity = Math.min(u.qty, Math.floor(remaining / priceCents));
        if (quantity <= 0) continue;
        settled.push({ productId: u.product_id, quantity, price: u.price, lineCents: quantity * priceCents });
        remaining -= quantity * priceCents;
      }

      const occurredAt = v.occurredAt ?? new Date();
      const [txn] = await tx
        .insert(transactions)
        .values({
          occurredAt,
          type: "DEBT_PAYMENT",
          paymentMethod: v.paymentMethod,
          clientId: v.clientId,
          totalAmount: v.amount,
          notes: v.notes,
          source: "WEB_MANUAL",
        })
        .returning({ id: transactions.id });

      const [dp] = await tx
        .insert(debtPayments)
        .values({
          transactionId: txn.id,
          clientId: v.clientId,
          ownerId: v.ownerId,
          amount: v.amount,
          paymentMethod: v.paymentMethod,
          occurredAt,
          notes: v.notes,
        })
        .returning({ id: debtPayments.id });

      if (settled.length > 0) {
        await tx.insert(debtPaymentItems).values(
          settled.map((s) => ({
            debtPaymentId: dp.id,
            productId: s.productId,
            quantity: s.quantity,
            unitPriceSnapshot: s.price,
            lineTotal: centsToDecimal(s.lineCents),
          })),
        );
      }

      return {
        transactionId: txn.id,
        unitsSettled: settled.reduce((sum, s) => sum + s.quantity, 0),
        remaining: centsToDecimal(balanceCents - amountCents),
      };
    }),
  );
}
