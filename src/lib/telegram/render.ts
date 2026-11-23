import "server-only";

import type { CashierDraft } from "@/lib/ai/shared";
import { formatCurrency } from "@/lib/format";
import { dictionaries, interpolate } from "@/lib/i18n/config";
import { centsToDecimal, toCents } from "@/lib/money";

import type { TgInlineKeyboard } from "./api";

/** Telegram HTML parse mode: only &, < and > need escaping in text nodes. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** callback_data (≤ 64 bytes): "cf:<assistantMessageId>" / "cx:<assistantMessageId>". */
export const CALLBACK = { confirm: "cf", cancel: "cx" } as const;

export function cardKeyboard(messageId: number, lang: "es" | "en"): TgInlineKeyboard {
  const t = dictionaries[lang].telegram;
  return {
    inline_keyboard: [
      [
        { text: t.confirm, callback_data: `${CALLBACK.confirm}:${messageId}` },
        { text: t.cancel, callback_data: `${CALLBACK.cancel}:${messageId}` },
      ],
    ],
  };
}

/**
 * The Confirmation Card as Telegram HTML — same draft the web card renders.
 * `status` appends the final line ("✅ Confirmed — TX #…" / "❌ Cancelled").
 */
export function renderCard(
  draft: CashierDraft,
  status?: { kind: "confirmed"; transactionId: number | null } | { kind: "cancelled" },
): string {
  const lang = draft.language;
  const d = dictionaries[lang];
  const t = d.telegram;
  const intent = draft.intent as "SALE" | "DEBT_PAYMENT" | "RESTOCK";

  const head = [d.enums.type[intent], draft.payment_method ? d.enums.method[draft.payment_method] : null]
    .filter(Boolean)
    .join(" · ");
  const lines: string[] = [`🧾 <b>${esc(head)}</b>`];

  for (const i of draft.items) {
    const name = i.name ?? i.query;
    if (!i.product_id) {
      lines.push(`• ${i.quantity} × ${esc(name)} — ❓ <i>${esc(t.unmatched)}</i>`);
    } else if (intent === "RESTOCK") {
      const cost = draft.pack_cost ? ` @ ${formatCurrency(draft.pack_cost)} ${esc(t.packCost)}` : "";
      lines.push(`• ${i.quantity} × ${esc(name)}${cost}`);
    } else {
      const line = i.unit_price ? ` — ${formatCurrency(centsToDecimal(i.quantity * toCents(i.unit_price)))}` : "";
      const warn = i.stock_warning && i.current_stock !== null ? `  ⚠️ <i>${esc(interpolate(t.stock, { stock: i.current_stock }))}</i>` : "";
      lines.push(`• ${i.quantity} × ${esc(name)}${line}${warn}`);
    }
  }
  if (draft.client_name) {
    lines.push(`${esc(t.client)}: ${esc(draft.client_name)}${draft.is_new_client ? ` <i>(${esc(t.newClient)})</i>` : ""}`);
  }
  if (intent === "DEBT_PAYMENT" && draft.items.length === 0 && draft.owner_name) {
    lines.push(`${esc(t.owner)}: ${esc(draft.owner_name)}`);
  }
  lines.push(`<b>${esc(t.total)}: ${formatCurrency(draft.total_amount)}</b>`);
  if (draft.confidence_notes) lines.push(`<i>${esc(t.notes)}: ${esc(draft.confidence_notes)}</i>`);

  if (status?.kind === "confirmed") {
    lines.push("", status.transactionId ? `<b>${esc(interpolate(t.confirmed, { id: status.transactionId }))}</b>` : `<b>✅</b>`);
  } else if (status?.kind === "cancelled") {
    lines.push("", `<b>${esc(t.cancelled)}</b>`);
  }
  return lines.join("\n");
}
