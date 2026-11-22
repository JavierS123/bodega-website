"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { aiChatMessages, clients } from "@/db/schema";
import { listChatMessages } from "@/lib/ai/history";
import { CashierDraft, isActionIntent, type ChatPage, type ChatPayload } from "@/lib/ai/shared";
import type { ActionResult as BaseResult } from "@/lib/action-result";
import { ActionError as BaseActionError, runAdminAction, zId } from "@/lib/server/action";
import { commitDebtPayment, commitRestock, commitSale } from "@/lib/server/ledger";

export type ChatErrorCode =
  | "unauthorized"
  | "validation"
  | "notFound"
  | "alreadyHandled"
  | "notActionable"
  | "clientRequired"
  | "emptySale"
  | "inactiveProduct"
  | "noDebt"
  | "exceedsDebt"
  | "duplicateName"
  | "unknown";

export type ActionResult<T = undefined> = BaseResult<T, ChatErrorCode>;

class ActionError extends BaseActionError<ChatErrorCode> {}

function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  return runAdminAction<S, T, ChatErrorCode>({ schema, input, label: "chat", onUniqueViolation: "duplicateName" }, fn);
}

const confirmSchema = z.object({ messageId: zId, draft: CashierDraft });
const cancelSchema = z.object({ messageId: zId });

export type ConfirmDraftInput = z.input<typeof confirmSchema>;

/**
 * "Confirm & Save" on an AI Confirmation Card — ONE Postgres transaction:
 * lock the chat message (must still be PENDING_CONFIRMATION), create the
 * client if the card says it's new, write the ledger rows through the shared
 * commit functions (prices/costs re-read from Postgres, never from the card),
 * then mark the message CONFIRMED with its linked transaction and the final
 * (possibly edited) draft for the audit trail.
 */
export async function confirmChatDraft(input: ConfirmDraftInput): Promise<ActionResult<{ transactionId: number }>> {
  return run(confirmSchema, input, async ({ messageId, draft }) =>
    db.transaction(async (tx) => {
      const [msg] = await tx
        .select({
          role: aiChatMessages.role,
          status: aiChatMessages.status,
          payload: aiChatMessages.parsedPayload,
        })
        .from(aiChatMessages)
        .where(eq(aiChatMessages.id, messageId))
        .for("update");
      if (!msg || msg.role !== "ASSISTANT") throw new ActionError("notFound");
      if (msg.status !== "PENDING_CONFIRMATION") throw new ActionError("alreadyHandled");
      const stored = msg.payload as ChatPayload | null;
      // The card may edit fields, never the kind of operation.
      if (!stored || !isActionIntent(draft.intent) || stored.draft.intent !== draft.intent) {
        throw new ActionError("notActionable");
      }

      const items = draft.items
        .filter((i) => i.quantity > 0)
        .map((i) => {
          if (!i.product_id) throw new ActionError("validation");
          return { productId: i.product_id, qty: i.quantity };
        });
      const notes = `AI: ${draft.reply}`.slice(0, 300);

      // Client: existing id, or create the new one named on the card (reusing a same-name client if it exists).
      let clientId = draft.client_id;
      if (!clientId && draft.is_new_client && draft.client_name?.trim()) {
        const name = draft.client_name.trim().replace(/\s+/g, " ");
        const [existing] = await tx
          .select({ id: clients.id })
          .from(clients)
          .where(sql`lower(${clients.name}) = lower(${name})`);
        clientId = existing?.id ?? (await tx.insert(clients).values({ name }).returning({ id: clients.id }))[0].id;
      }

      let transactionId: number;
      let total: string;
      if (draft.intent === "SALE") {
        if (!draft.payment_method) throw new ActionError("validation");
        const r = await commitSale(tx, {
          items,
          paymentMethod: draft.payment_method,
          clientId,
          notes,
          occurredAt: null,
          source: "WEB_AI",
        });
        transactionId = r.id;
        total = r.total;
      } else if (draft.intent === "DEBT_PAYMENT") {
        const method = draft.payment_method;
        if (!clientId) throw new ActionError("clientRequired");
        if (method !== "CASH" && method !== "PAGO_MOVIL") throw new ActionError("validation");
        let mode: Parameters<typeof commitDebtPayment>[1]["mode"];
        if (items.length > 0) {
          mode = { kind: "units", items };
        } else {
          if (!draft.owner_id || !draft.amount) throw new ActionError("validation");
          mode = { kind: "amount", ownerId: draft.owner_id, amount: draft.amount };
        }
        const r = await commitDebtPayment(tx, {
          clientId,
          paymentMethod: method,
          mode,
          notes,
          occurredAt: null,
          source: "WEB_AI",
        });
        transactionId = r.transactionId;
        total = r.amount;
      } else {
        // RESTOCK: one product per card (quantity = packs).
        if (items.length !== 1 || !draft.pack_cost) throw new ActionError("validation");
        const r = await commitRestock(tx, {
          productId: items[0].productId,
          packs: items[0].qty,
          packCost: draft.pack_cost,
          newSalePrice: null,
          notes: "AI",
          source: "WEB_AI",
        });
        transactionId = r.transactionId;
        total = r.total;
      }

      // Totals in the audit copy are what Postgres actually committed (today's prices).
      const final: CashierDraft = { ...draft, client_id: clientId, is_new_client: false, total_amount: total };
      await tx
        .update(aiChatMessages)
        .set({
          status: "CONFIRMED",
          linkedTransactionId: transactionId,
          parsedPayload: { v: 1, draft: stored.draft, final } satisfies ChatPayload as unknown as Record<string, unknown>,
        })
        .where(eq(aiChatMessages.id, messageId));

      return { transactionId };
    }),
  );
}

/** "Cancel" on a pending card. Only a still-pending draft can be cancelled. */
export async function cancelChatDraft(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  return run(cancelSchema, input, async ({ messageId }) => {
    const rows = await db
      .update(aiChatMessages)
      .set({ status: "CANCELLED" })
      .where(and(eq(aiChatMessages.id, messageId), eq(aiChatMessages.status, "PENDING_CONFIRMATION")))
      .returning({ id: aiChatMessages.id });
    if (rows.length === 0) throw new ActionError("alreadyHandled");
    return undefined;
  });
}

/**
 * "Load older messages". Read-only and public: the chat feed is part of the
 * read-only portfolio showcase like every other page.
 */
export async function loadOlderMessages(input: { beforeId: number }): Promise<ChatPage> {
  const { beforeId } = z.object({ beforeId: zId }).parse(input);
  return listChatMessages({ beforeId });
}
