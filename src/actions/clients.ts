"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { clients } from "@/db/schema";
import type { ActionResult as BaseResult } from "@/lib/action-result";
import { toCents } from "@/lib/money";
import {
  ActionError as BaseActionError,
  runAdminAction,
  zId,
  zMoney,
  zNote,
  zOccurredAt,
} from "@/lib/server/action";
import { commitDebtPayment } from "@/lib/server/ledger";
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
      const r = await commitDebtPayment(tx, {
        clientId: v.clientId,
        paymentMethod: v.paymentMethod,
        mode: { kind: "amount", ownerId: v.ownerId, amount: v.amount },
        notes: v.notes,
        occurredAt: v.occurredAt,
        source: "WEB_MANUAL",
      });
      return { transactionId: r.transactionId, unitsSettled: r.unitsSettled, remaining: r.remaining ?? "0.00" };
    }),
  );
}
