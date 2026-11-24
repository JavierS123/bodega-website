import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { aiChatMessages } from "@/db/schema";
import type { ChatPayload } from "@/lib/ai/shared";

import { editMessage } from "./api";
import { renderCard } from "./render";

/**
 * After a card is confirmed/cancelled (from the web, or from Telegram itself),
 * rewrite its Telegram message with the final state and remove the buttons.
 * Best-effort: never throws, does nothing for web-only cards.
 */
export async function syncTelegramCard(messageId: number): Promise<void> {
  try {
    const [m] = await db
      .select({ status: aiChatMessages.status, payload: aiChatMessages.parsedPayload, txId: aiChatMessages.linkedTransactionId })
      .from(aiChatMessages)
      .where(eq(aiChatMessages.id, messageId));
    const payload = m?.payload as ChatPayload | null;
    if (!m || !payload?.telegram) return;
    const draft = payload.final ?? payload.draft;
    const status =
      m.status === "CONFIRMED"
        ? ({ kind: "confirmed", transactionId: m.txId, settlementId: payload.settlementId ?? null } as const)
        : m.status === "CANCELLED"
          ? ({ kind: "cancelled" } as const)
          : undefined;
    if (!status) return;
    await editMessage(payload.telegram.chatId, payload.telegram.messageId, renderCard(draft, status));
  } catch (error) {
    console.warn("[telegram] sync failed:", error instanceof Error ? error.message : error);
  }
}
