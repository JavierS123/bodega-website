/**
 * Register / inspect / remove the Telegram webhook for the deployed app.
 *
 *   npm run telegram:webhook -- set https://<your-app>.vercel.app   # register (+ bot commands)
 *   npm run telegram:webhook -- info                                  # current webhook status
 *   npm run telegram:webhook -- delete                                # stop delivering updates
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET from .env / .env.local
 * (the same values must be set on Vercel). Telegram then sends every update to
 * <url>/api/webhooks/telegram with the secret in X-Telegram-Bot-Api-Secret-Token,
 * which the route verifies. The token is never printed.
 */
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
const [command, arg] = process.argv.slice(2);

async function call(method: string, payload: Record<string, unknown> = {}) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description ?? res.status}`);
  return json.result;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

async function main() {
  if (!token || token.includes("<")) fail("TELEGRAM_BOT_TOKEN is not set (see .env.example).");

  switch (command) {
    case "set": {
      if (!secret || secret.includes("<") || !/^[A-Za-z0-9_-]{16,256}$/.test(secret)) {
        fail("TELEGRAM_WEBHOOK_SECRET must be 16–256 chars of A–Z a–z 0–9 _ - (e.g. `openssl rand -hex 32`).");
      }
      let base: URL;
      try {
        base = new URL(arg ?? "");
      } catch {
        fail("Usage: npm run telegram:webhook -- set https://<your-app>.vercel.app");
      }
      if (base.protocol !== "https:") fail("Telegram requires an https:// URL.");
      const url = new URL("/api/webhooks/telegram", base).toString();
      await call("setWebhook", {
        url,
        secret_token: secret,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: true,
      });
      await call("setMyCommands", {
        commands: [
          { command: "help", description: "How to log sales, Fiado, abonos and restocks" },
          { command: "ayuda", description: "Cómo registrar ventas, fiados, abonos y compras" },
          { command: "start", description: "Start the BodegaOS cashier bot" },
        ],
      });
      console.log(`✓ Webhook set → ${url}`);
      break;
    }
    case "info": {
      const info = (await call("getWebhookInfo")) as Record<string, unknown>;
      const me = (await call("getMe")) as { username?: string };
      console.log(`Bot: @${me.username ?? "?"}`);
      for (const key of ["url", "pending_update_count", "last_error_date", "last_error_message", "allowed_updates"]) {
        if (info[key] !== undefined) console.log(`  ${key}: ${JSON.stringify(info[key])}`);
      }
      break;
    }
    case "delete": {
      await call("deleteWebhook", { drop_pending_updates: false });
      console.log("✓ Webhook removed (updates are no longer delivered).");
      break;
    }
    default:
      fail("Usage: npm run telegram:webhook -- <set <https-url> | info | delete>");
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
