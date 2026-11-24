import "server-only";

import { and, eq, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { aiChatMessages, clients, owners, ownerSettlements, type TransactionSource } from "@/db/schema";
import { wasEdited } from "@/lib/ai/draft";
import { isActionIntent, type CashierDraft, type ChatPayload } from "@/lib/ai/shared";
import { toCents } from "@/lib/money";
import { SETTLEMENT_METHODS } from "@/lib/owners/shared";

import { ActionError } from "./action";
import { proposeLesson } from "./ai-feedback";
import { commitDebtPayment, commitRestock, commitSale } from "./ledger";

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * The ONE implementation of "confirm an AI draft", shared by the web console
 * (admin Server Action) and the Telegram bot (allow-listed user). Runs inside
 * the caller's `db.transaction`. Authorization is the CALLER's job.
 *
 * Locks the chat message (must still be PENDING_CONFIRMATION), creates the
 * client if the draft says it's new, writes the ledger rows through the shared
 * commit functions (prices/costs re-read from Postgres, never from the draft),
 * then marks the message CONFIRMED with its linked transaction and the final
 * draft for the audit trail. Throws ActionError(code) on business failures.
 */
export async function commitChatDraft(
  tx: Tx,
  { messageId, draft, source }: { messageId: number; draft: CashierDraft; source: TransactionSource },
): Promise<{ transactionId: number | null; settlementId: number | null; total: string }> {
  const [msg] = await tx
    .select({ role: aiChatMessages.role, status: aiChatMessages.status, payload: aiChatMessages.parsedPayload })
    .from(aiChatMessages)
    .where(eq(aiChatMessages.id, messageId))
    .for("update");
  if (!msg || msg.role !== "ASSISTANT") throw new ActionError("notFound");
  if (msg.status !== "PENDING_CONFIRMATION") throw new ActionError("alreadyHandled");
  const stored = msg.payload as ChatPayload | null;
  // Edits may change fields, never the kind of operation.
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

  // Client: existing id, or create the new one named on the draft (reusing a same-name client if it exists).
  let clientId = draft.client_id;
  if (!clientId && draft.is_new_client && draft.client_name?.trim()) {
    const name = draft.client_name.trim().replace(/\s+/g, " ");
    const [existing] = await tx.select({ id: clients.id }).from(clients).where(sql`lower(${clients.name}) = lower(${name})`);
    clientId = existing?.id ?? (await tx.insert(clients).values({ name }).returning({ id: clients.id }))[0].id;
  }

  let transactionId: number | null = null;
  let settlementId: number | null = null;
  let total: string;
  if (draft.intent === "SETTLEMENT") {
    // Owner money movement: one owner_settlements row (not a ledger transaction).
    const type = draft.settlement_type;
    const method = draft.settlement_method ?? (type ? SETTLEMENT_METHODS[type][0] : null);
    if (!type || !method || !SETTLEMENT_METHODS[type].includes(method)) throw new ActionError("validation");
    if (!draft.owner_id || !draft.amount || toCents(draft.amount) <= 0) throw new ActionError("validation");
    const [owner] = await tx.select({ id: owners.id }).from(owners).where(eq(owners.id, draft.owner_id));
    if (!owner) throw new ActionError("notFound");
    const [row] = await tx
      .insert(ownerSettlements)
      .values({ ownerId: owner.id, type, amount: draft.amount, paymentMethod: method, notes, source })
      .returning({ id: ownerSettlements.id, amount: ownerSettlements.amount });
    settlementId = row.id;
    total = row.amount;
  } else if (draft.intent === "SALE") {
    if (!draft.payment_method) throw new ActionError("validation");
    const r = await commitSale(tx, { items, paymentMethod: draft.payment_method, clientId, notes, occurredAt: null, source });
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
    const r = await commitDebtPayment(tx, { clientId, paymentMethod: method, mode, notes, occurredAt: null, source });
    transactionId = r.transactionId;
    total = r.amount;
  } else {
    // RESTOCK: one product per draft (quantity = packs).
    if (items.length !== 1 || !draft.pack_cost) throw new ActionError("validation");
    const r = await commitRestock(tx, {
      productId: items[0].productId,
      packs: items[0].qty,
      packCost: draft.pack_cost,
      newSalePrice: null,
      notes: "AI",
      source,
    });
    transactionId = r.transactionId;
    total = r.total;
  }

  // Totals in the audit copy are what Postgres actually committed (today's prices).
  const final: CashierDraft = { ...draft, client_id: clientId, is_new_client: false, total_amount: total };
  // Implicit feedback: a human correction of the AI's reading becomes a lesson proposal (reviewed on /skill).
  const edited = wasEdited(stored.draft, final);
  const payload: ChatPayload = {
    ...stored,
    v: 1,
    draft: stored.draft,
    final,
    edited,
    ...(settlementId ? { settlementId } : {}),
  };
  if (edited) await proposeLesson(tx, { messageId, origin: "EDITED_CONFIRM", draft: stored.draft, final });
  await tx
    .update(aiChatMessages)
    .set({
      status: "CONFIRMED",
      linkedTransactionId: transactionId,
      parsedPayload: payload as unknown as Record<string, unknown>,
    })
    .where(eq(aiChatMessages.id, messageId));

  return { transactionId, settlementId, total };
}

/** Cancel a still-pending draft. Authorization is the caller's job. */
export async function cancelChatDraftCore(executor: Pick<Database, "update">, messageId: number): Promise<void> {
  const rows = await executor
    .update(aiChatMessages)
    .set({ status: "CANCELLED" })
    .where(and(eq(aiChatMessages.id, messageId), eq(aiChatMessages.status, "PENDING_CONFIRMATION")))
    .returning({ id: aiChatMessages.id });
  if (rows.length === 0) throw new ActionError("alreadyHandled");
}
