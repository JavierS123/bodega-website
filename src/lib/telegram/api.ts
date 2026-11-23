import "server-only";

import { telegramConfig } from "./config";

export interface TgResult<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

export interface TgInlineKeyboard {
  inline_keyboard: { text: string; callback_data: string }[][];
}

/**
 * Minimal Telegram Bot API client. Never throws: a failed reply must not
 * fail the webhook (Telegram would retry and re-deliver the update). The bot
 * token is only ever placed in the request URL — never logged.
 */
export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<TgResult<T>> {
  const { token } = telegramConfig();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN not configured" };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json()) as TgResult<T>;
    if (!json.ok) console.warn(`[telegram] ${method} failed: ${json.description ?? res.status}`);
    return json;
  } catch (error) {
    console.warn(`[telegram] ${method} error:`, error instanceof Error ? error.message : error);
    return { ok: false };
  }
}

export const sendMessage = (chatId: number, html: string, replyMarkup?: TgInlineKeyboard) =>
  tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });

/** Replace a card's text and drop its buttons (final state). */
export const editMessage = (chatId: number, messageId: number, html: string) =>
  tg("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: { inline_keyboard: [] },
  });

export const answerCallback = (callbackId: string, text: string, alert = false) =>
  tg("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190), show_alert: alert });
