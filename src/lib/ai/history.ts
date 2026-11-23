import "server-only";

import { and, asc, desc, gt, inArray, lt, ne, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { aiChatMessages, type AiChatMessage } from "@/db/schema";

import type { ChatMessageView, ChatPage, ChatPayload, ChatPoll } from "./shared";

export const CHAT_PAGE_SIZE = 30;

export function toChatView(m: AiChatMessage): ChatMessageView {
  return {
    id: m.id,
    role: m.role,
    source: m.source,
    senderName: m.senderName,
    content: m.content,
    status: m.status,
    // USER rows may carry transport metadata (e.g. Telegram ids) — only ASSISTANT rows hold a card payload.
    payload: m.role === "ASSISTANT" ? ((m.parsedPayload as ChatPayload | null) ?? null) : null,
    linkedTransactionId: m.linkedTransactionId,
    createdAt: m.createdAt,
  };
}

/**
 * One page of the chat, chronological (oldest → newest). `beforeId` pages
 * backwards for "Load older messages". Ordered by id (monotonic insert order,
 * so a USER message always precedes its ASSISTANT reply).
 */
export async function listChatMessages({
  beforeId,
  limit = CHAT_PAGE_SIZE,
}: { beforeId?: number; limit?: number } = {}): Promise<ChatPage> {
  const where: SQL | undefined = beforeId ? and(lt(aiChatMessages.id, beforeId)) : undefined;
  const rows = await db
    .select()
    .from(aiChatMessages)
    .where(where)
    .orderBy(desc(aiChatMessages.id))
    .limit(limit + 1);
  const hasMore = rows.length > limit;
  return { messages: rows.slice(0, limit).reverse().map(toChatView), hasMore };
}

/** New messages after `afterId` (capped) + state changes of the given still-pending cards. */
export async function pollChatUpdates(afterId: number, pendingIds: number[]): Promise<ChatPoll> {
  const fresh = await db
    .select()
    .from(aiChatMessages)
    .where(gt(aiChatMessages.id, afterId))
    .orderBy(asc(aiChatMessages.id))
    .limit(50);
  const changed = pendingIds.length
    ? await db
        .select()
        .from(aiChatMessages)
        .where(and(inArray(aiChatMessages.id, pendingIds), ne(aiChatMessages.status, "PENDING_CONFIRMATION")))
    : [];
  return {
    messages: fresh.map(toChatView),
    updates: changed.map((m) => {
      const v = toChatView(m);
      return { id: v.id, status: v.status, linkedTransactionId: v.linkedTransactionId, payload: v.payload };
    }),
  };
}
