import { telegramConfig, verifyWebhookSecret } from "@/lib/telegram/config";
import { handleTelegramUpdate, TelegramUpdate } from "@/lib/telegram/handler";

/**
 * POST /api/webhooks/telegram — Telegram Bot webhook.
 *
 * 1. Rejects any request whose X-Telegram-Bot-Api-Secret-Token header doesn't
 *    match TELEGRAM_WEBHOOK_SECRET (set via setWebhook's `secret_token` —
 *    see scripts/telegram-webhook.ts). Constant-time comparison.
 * 2. The handler then checks the sender against TELEGRAM_ALLOWED_USER_IDS for
 *    every message and every button tap.
 *
 * Once authenticated, always answers 200: Telegram retries non-2xx responses,
 * and a retry storm would re-run work. Failures are logged instead.
 */
export async function POST(request: Request) {
  const { secret, token } = telegramConfig();
  if (!secret || !token) {
    return Response.json({ ok: false, error: "Telegram webhook not configured" }, { status: 503 });
  }
  if (!verifyWebhookSecret(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const parsed = TelegramUpdate.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: true, ignored: true });

  try {
    await handleTelegramUpdate(parsed.data);
  } catch (error) {
    console.error("[telegram webhook]", error);
  }
  return Response.json({ ok: true });
}
