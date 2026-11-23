import "server-only";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { aiChatMessages } from "@/db/schema";
import { AiNotConfiguredError } from "@/lib/ai/gemini";
import { runCashierParse, type CashierParseResult } from "@/lib/ai/pipeline";
import { MAX_MESSAGE_LENGTH, type ChatPayload } from "@/lib/ai/shared";
import { dictionaries, interpolate } from "@/lib/i18n/config";
import { ActionError } from "@/lib/server/action";
import { cancelChatDraftCore, commitChatDraft } from "@/lib/server/chat-commit";

import { answerCallback, sendMessage } from "./api";
import { isAllowedUser } from "./config";
import { CALLBACK, cardKeyboard, esc, renderCard } from "./render";
import { syncTelegramCard } from "./sync";

/* ── The slice of the Telegram Update we use (unknown fields are ignored) ── */
const User = z.object({ id: z.number(), first_name: z.string().optional(), username: z.string().optional(), language_code: z.string().optional() });
const Chat = z.object({ id: z.number(), type: z.string() });
export const TelegramUpdate = z.object({
  update_id: z.number(),
  message: z
    .object({ message_id: z.number(), chat: Chat, from: User.optional(), text: z.string().optional() })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: User,
      data: z.string().optional(),
      message: z.object({ message_id: z.number(), chat: Chat }).optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdate>;

type Lang = "es" | "en";
const langOf = (code?: string): Lang => (code?.toLowerCase().startsWith("en") ? "en" : "es");
const senderName = (u: z.infer<typeof User>) => (u.username ? `@${u.username}` : (u.first_name ?? `tg:${u.id}`));

/**
 * Handle one webhook update. Authorization = the webhook secret (checked by
 * the route) + the sender's id in TELEGRAM_ALLOWED_USER_IDS (checked here for
 * every message AND every button tap). Only private chats are served.
 */
export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query);
  if (update.message) return handleMessage(update.update_id, update.message);
}

/* ── Text messages → parse → card ─────────────────────────────────────── */

async function handleMessage(updateId: number, msg: NonNullable<TelegramUpdate["message"]>) {
  if (msg.chat.type !== "private" || !msg.from) return;
  const lang = langOf(msg.from.language_code);
  const t = dictionaries[lang].telegram;
  const chatId = msg.chat.id;

  if (!isAllowedUser(msg.from.id)) {
    await sendMessage(chatId, interpolate(t.notAuthorized, { id: msg.from.id }));
    return;
  }
  const text = msg.text?.trim();
  if (!text) {
    await sendMessage(chatId, esc(t.textOnly));
    return;
  }
  if (/^\/(start|help)\b/i.test(text)) {
    await sendMessage(chatId, t.help);
    return;
  }

  // Telegram re-delivers an update if a previous attempt timed out: process each update_id once.
  const [seen] = await db
    .select({ id: aiChatMessages.id })
    .from(aiChatMessages)
    .where(sql`${aiChatMessages.parsedPayload} -> 'telegram' ->> 'updateId' = ${String(updateId)}`)
    .limit(1);
  if (seen) return;

  const message = text.slice(0, MAX_MESSAGE_LENGTH);
  await db.insert(aiChatMessages).values({
    role: "USER",
    source: "TELEGRAM",
    senderName: senderName(msg.from),
    content: message,
    status: "INFO",
    parsedPayload: { telegram: { updateId, chatId, messageId: msg.message_id, userId: msg.from.id } },
  });

  // EXACTLY the same parser as the web console.
  let result: CashierParseResult | null = null;
  try {
    result = await runCashierParse(message);
  } catch (error) {
    if (!(error instanceof AiNotConfiguredError)) console.error("[telegram] parse failed", error);
  }
  const replyLang = result?.draft.language ?? lang;
  const content = result?.reply ?? dictionaries[replyLang].cashier.errorReply;
  const status = result?.status ?? "ERROR";
  const payload: ChatPayload | null = result ? { v: 1, draft: result.draft } : null;

  const [assistant] = await db
    .insert(aiChatMessages)
    .values({
      role: "ASSISTANT",
      source: "TELEGRAM",
      content,
      status,
      parsedPayload: payload as unknown as Record<string, unknown> | null,
    })
    .returning({ id: aiChatMessages.id });

  if (status === "PENDING_CONFIRMATION" && payload) {
    const sent = await sendMessage(
      chatId,
      `${esc(content)}\n\n${renderCard(payload.draft)}`,
      cardKeyboard(assistant.id, payload.draft.language),
    );
    if (sent.ok && sent.result) {
      // Remember where the card lives so a confirm from the WEB can update it too.
      const linked: ChatPayload = { ...payload, telegram: { chatId, messageId: sent.result.message_id } };
      await db
        .update(aiChatMessages)
        .set({ parsedPayload: linked as unknown as Record<string, unknown> })
        .where(eq(aiChatMessages.id, assistant.id));
    }
  } else {
    await sendMessage(chatId, esc(content));
  }
}

/* ── Inline keyboard: ✅ Confirm / ❌ Cancel ───────────────────────────── */

async function handleCallback(cb: NonNullable<TelegramUpdate["callback_query"]>) {
  const lang = langOf(cb.from.language_code);
  const t = dictionaries[lang].telegram;

  if (!isAllowedUser(cb.from.id)) {
    await answerCallback(cb.id, interpolate(t.notAuthorized, { id: cb.from.id }).replace(/<[^>]+>/g, ""), true);
    return;
  }
  const match = /^(cf|cx):(\d{1,9})$/.exec(cb.data ?? "");
  if (!match) {
    await answerCallback(cb.id, "?");
    return;
  }
  const messageId = Number(match[2]);

  try {
    if (match[1] === CALLBACK.confirm) {
      const [m] = await db
        .select({ payload: aiChatMessages.parsedPayload })
        .from(aiChatMessages)
        .where(eq(aiChatMessages.id, messageId));
      const payload = m?.payload as ChatPayload | null;
      if (!payload) throw new ActionError("notFound");
      // Same atomic commit as the web card; Telegram confirms the draft as parsed.
      const r = await db.transaction((tx) =>
        commitChatDraft(tx, { messageId, draft: payload.draft, source: "TELEGRAM" }),
      );
      await answerCallback(cb.id, interpolate(t.saved, { id: r.transactionId }));
    } else {
      await cancelChatDraftCore(db, messageId);
      await answerCallback(cb.id, t.cancelledToast);
    }
  } catch (error) {
    const code = error instanceof ActionError ? error.code : "unknown";
    if (code === "alreadyHandled") {
      await answerCallback(cb.id, t.alreadyHandled);
    } else if (code === "validation" || code === "clientRequired" || code === "emptySale") {
      await answerCallback(cb.id, t.incomplete, true);
      return;
    } else {
      if (!(error instanceof ActionError)) console.error("[telegram] callback failed", error);
      const errors = dictionaries[lang].cashier.errors as Record<string, string>;
      await answerCallback(cb.id, errors[code] ?? errors.unknown, true);
      return;
    }
  }
  // Rewrite the card with its final state and remove the buttons.
  await syncTelegramCard(messageId);
}
