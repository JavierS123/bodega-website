"use server";

import { z } from "zod";

import { db } from "@/db";
import { listChatMessages, pollChatUpdates } from "@/lib/ai/history";
import { CashierDraft, type ChatPage, type ChatPoll } from "@/lib/ai/shared";
import type { ActionResult as BaseResult } from "@/lib/action-result";
import { runAdminAction, zId } from "@/lib/server/action";
import { cancelChatDraftCore, commitChatDraft } from "@/lib/server/chat-commit";
import { syncTelegramCard } from "@/lib/telegram/sync";

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
 * "Confirm & Save" on an AI Confirmation Card (admin only). One Postgres
 * transaction via the shared commitChatDraft(); if the draft came from
 * Telegram, its Telegram card is updated too (best-effort, after commit).
 */
export async function confirmChatDraft(input: ConfirmDraftInput): Promise<ActionResult<{ transactionId: number }>> {
  return run(confirmSchema, input, async ({ messageId, draft }) => {
    const r = await db.transaction((tx) => commitChatDraft(tx, { messageId, draft, source: "WEB_AI" }));
    await syncTelegramCard(messageId);
    return { transactionId: r.transactionId };
  });
}

/** "Cancel" on a pending card (admin only). */
export async function cancelChatDraft(input: z.input<typeof cancelSchema>): Promise<ActionResult> {
  return run(cancelSchema, input, async ({ messageId }) => {
    await cancelChatDraftCore(db, messageId);
    await syncTelegramCard(messageId);
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

/**
 * Live feed refresh (public, read-only): messages newer than `afterId` (e.g.
 * from Telegram) plus the current state of cards the browser still shows as
 * pending (confirmed/cancelled elsewhere).
 */
export async function pollChat(input: { afterId: number; pendingIds: number[] }): Promise<ChatPoll> {
  const v = z
    .object({ afterId: z.number().int().min(0), pendingIds: z.array(zId).max(100) })
    .parse(input);
  return pollChatUpdates(v.afterId, v.pendingIds);
}
