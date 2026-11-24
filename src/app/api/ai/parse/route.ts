import { z } from "zod";

import { db } from "@/db";
import { aiChatMessages } from "@/db/schema";
import { AiNotConfiguredError } from "@/lib/ai/gemini";
import { toChatView } from "@/lib/ai/history";
import { runCashierParse, type CashierParseResult } from "@/lib/ai/pipeline";
import { checkRateLimit, clientIp } from "@/lib/ai/rate-limit";
import { MAX_MESSAGE_LENGTH, type ChatMessageView, type ChatPayload, type ParseResponse } from "@/lib/ai/shared";
import { getHelpText } from "@/lib/ai/skill";
import { HELP_COMMAND } from "@/lib/ai/skill-shared";
import { getCurrentUser, isAdmin } from "@/lib/auth/guards";
import { dictionaries } from "@/lib/i18n/config";
import { getLocale } from "@/lib/i18n/server";

const bodySchema = z.object({ message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });

const json = (body: ParseResponse, status = 200) => Response.json(body, { status });

/**
 * POST /api/ai/parse — parse one cashier message with Gemini.
 *
 * - Admin: the USER message and the ASSISTANT reply (draft in parsed_payload,
 *   status PENDING_CONFIRMATION / INFO / ERROR) are persisted to ai_chat_messages.
 *   Nothing touches the ledger here — that only happens on confirm.
 * - Visitor (portfolio sandbox): rate-limited per IP, real parsing, NO writes;
 *   the pair is returned for the browser to keep in React state.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: "invalid" }, 400);
  const message = parsed.data.message;

  const user = await getCurrentUser();
  const admin = isAdmin(user);

  // /help, /ayuda: answered from the skill's help document — no Gemini call, no rate limit, not persisted.
  if (HELP_COMMAND.test(message)) {
    const now = new Date();
    const base = { source: "WEB" as const, linkedTransactionId: null, ephemeral: true, payload: null, createdAt: now };
    return json({
      ok: true,
      persisted: false,
      user: { ...base, id: 0, role: "USER", senderName: user?.email ?? null, content: message, status: "INFO" },
      assistant: { ...base, id: 0, role: "ASSISTANT", senderName: null, content: await getHelpText(await getLocale()), status: "INFO" },
    });
  }

  if (!admin) {
    const limit = checkRateLimit(`ai:${clientIp(request.headers)}`);
    if (!limit.ok) {
      return Response.json({ ok: false, error: "rateLimited", retryAfterSec: limit.retryAfterSec } satisfies ParseResponse, {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSec) },
      });
    }
  }

  let result: CashierParseResult | null = null;
  try {
    result = await runCashierParse(message);
  } catch (error) {
    if (error instanceof AiNotConfiguredError) return json({ ok: false, error: "notConfigured" }, 503);
    console.error("[ai/parse]", error);
  }

  const errorReply = dictionaries[await getLocale()].cashier.errorReply;
  const assistant = {
    content: result?.reply ?? errorReply,
    status: result?.status ?? ("ERROR" as const),
    payload: result ? ({ v: 1, draft: result.draft } satisfies ChatPayload) : null,
  };

  if (!admin) {
    const now = new Date();
    const base = { source: "WEB" as const, linkedTransactionId: null, sandbox: true };
    return json({
      ok: true,
      persisted: false,
      // Ids are assigned client-side for sandbox messages.
      user: { ...base, id: 0, role: "USER", senderName: null, content: message, status: "INFO", payload: null, createdAt: now },
      assistant: {
        ...base,
        id: 0,
        role: "ASSISTANT",
        senderName: null,
        content: assistant.content,
        status: assistant.status,
        payload: assistant.payload,
        createdAt: now,
      } satisfies ChatMessageView,
    });
  }

  // Identity ids are assigned in insert order; sort so we never depend on RETURNING order.
  const [userRow, assistantRow] = (
    await db
    .insert(aiChatMessages)
    .values([
      { role: "USER", source: "WEB", senderName: user.email ?? null, content: message, status: "INFO" },
      {
        role: "ASSISTANT",
        source: "WEB",
        senderName: null,
        content: assistant.content,
        status: assistant.status,
        parsedPayload: assistant.payload as unknown as Record<string, unknown> | null,
      },
    ])
    .returning()
  ).sort((a, b) => a.id - b.id);

  return json({ ok: true, persisted: true, user: toChatView(userRow), assistant: toChatView(assistantRow) });
}
