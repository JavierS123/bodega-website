import "server-only";

import { and, desc, lt, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { aiChatMessages, type AiChatMessage } from "@/db/schema";

import type { ChatMessageView, ChatPage, ChatPayload } from "./shared";

export const CHAT_PAGE_SIZE = 30;

export function toChatView(m: AiChatMessage): ChatMessageView {
  return {
    id: m.id,
    role: m.role,
    source: m.source,
    senderName: m.senderName,
    content: m.content,
    status: m.status,
    payload: (m.parsedPayload as ChatPayload | null) ?? null,
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
