import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/** A value still holding its `.env.example` placeholder counts as unset. */
const real = (v: string | undefined) => (v && !v.includes("<") ? v.trim() : "");

export function telegramConfig() {
  return {
    token: real(process.env.TELEGRAM_BOT_TOKEN),
    secret: real(process.env.TELEGRAM_WEBHOOK_SECRET),
    allowed: new Set(
      (process.env.TELEGRAM_ALLOWED_USER_IDS ?? "")
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isSafeInteger(n) && n > 0),
    ),
  };
}

/** Constant-time check of the X-Telegram-Bot-Api-Secret-Token header (hashing equalizes lengths). */
export function verifyWebhookSecret(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const a = createHash("sha256").update(header).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b);
}

export function isAllowedUser(userId: number | undefined): boolean {
  return userId !== undefined && telegramConfig().allowed.has(userId);
}
