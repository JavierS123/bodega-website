"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { owners, ownerSettlements } from "@/db/schema";
import type { ActionResult as BaseResult } from "@/lib/action-result";
import { toCents } from "@/lib/money";
import { SETTLEMENT_METHODS, SETTLEMENT_TYPES } from "@/lib/owners/shared";
import {
  ActionError as BaseActionError,
  runAdminAction,
  zId,
  zMoney,
  zNote,
  zOccurredAt,
} from "@/lib/server/action";
import { MONEY_METHODS } from "@/lib/transactions/shared";

export type OwnerErrorCode = "unauthorized" | "validation" | "notFound" | "invalidMethod" | "alreadyVoided" | "unknown";

export type ActionResult<T = undefined> = BaseResult<T, OwnerErrorCode>;

class ActionError extends BaseActionError<OwnerErrorCode> {}

const settlementSchema = z.object({
  ownerId: zId,
  type: z.enum(SETTLEMENT_TYPES),
  amount: zMoney.refine((v) => toCents(v) > 0, "Must be greater than 0"),
  paymentMethod: z.enum(MONEY_METHODS),
  occurredAt: zOccurredAt,
  notes: zNote(300),
});

export type SettlementInput = z.input<typeof settlementSchema>;

/**
 * Record an owner money movement: payout transfer, capital injection, cash
 * deposit or (informational) profit withdrawal. A single insert, so it is
 * atomic on its own. Balances are always derived, never stored.
 */
export async function recordSettlement(input: SettlementInput): Promise<ActionResult<{ id: number }>> {
  return runAdminAction<typeof settlementSchema, { id: number }, OwnerErrorCode>(
    { schema: settlementSchema, input, label: "owners" },
    async (v) => {
      if (!SETTLEMENT_METHODS[v.type].includes(v.paymentMethod)) throw new ActionError("invalidMethod");
      const [owner] = await db.select({ id: owners.id }).from(owners).where(eq(owners.id, v.ownerId));
      if (!owner) throw new ActionError("notFound");

      const [row] = await db
        .insert(ownerSettlements)
        .values({
          ownerId: v.ownerId,
          type: v.type,
          amount: v.amount,
          paymentMethod: v.paymentMethod,
          occurredAt: v.occurredAt ?? new Date(),
          notes: v.notes,
        })
        .returning({ id: ownerSettlements.id });
      return { id: row.id };
    },
  );
}

const voidSettlementSchema = z.object({ id: zId, reason: z.string().trim().min(3).max(200) });

/**
 * Void an owner money movement (from the ledger). Balances are derived, so
 * flagging the row is the whole reversal; the row stays for the audit trail.
 */
export async function voidSettlement(
  input: z.input<typeof voidSettlementSchema>,
): Promise<ActionResult<{ id: number }>> {
  return runAdminAction<typeof voidSettlementSchema, { id: number }, OwnerErrorCode>(
    { schema: voidSettlementSchema, input, label: "owners" },
    async ({ id, reason }) =>
      db.transaction(async (tx) => {
        const [row] = await tx
          .select({ isVoided: ownerSettlements.isVoided })
          .from(ownerSettlements)
          .where(eq(ownerSettlements.id, id))
          .for("update");
        if (!row) throw new ActionError("notFound");
        if (row.isVoided) throw new ActionError("alreadyVoided");
        await tx
          .update(ownerSettlements)
          .set({ isVoided: true, voidedAt: new Date(), voidReason: reason })
          .where(eq(ownerSettlements.id, id));
        return { id };
      }),
  );
}
