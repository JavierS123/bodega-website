"use client";

import { CircleCheck, Coins, Hourglass } from "lucide-react";

import { allocateAbono } from "@/lib/clients/allocation";
import type { OutstandingUnit } from "@/lib/clients/shared";
import { formatCurrency } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { centsToDecimal } from "@/lib/money";

/**
 * Exactly which Fiado units an abono-by-amount will clear, and what is left as
 * cash credit — computed with the same allocateAbono() the ledger write uses.
 */
export function AbonoPreview({ units, amountCents }: { units: OutstandingUnit[]; amountCents: number | null }) {
  const { t } = useI18n();
  const p = t.clients.abono.preview;
  if (amountCents === null || amountCents <= 0) return null;

  const owed = units.filter((u) => u.qty > 0);
  const { items, creditCents } = allocateAbono(owed, amountCents);
  const byId = new Map(owed.map((u) => [u.productId, u]));
  // First product still (partly) pending after this payment — explains where the rule stopped.
  const next = owed.find((u) => (items.find((i) => i.productId === u.productId)?.quantity ?? 0) < u.qty);

  return (
    <div className="grid gap-1 rounded-lg border border-dashed px-3 py-2 text-xs" aria-live="polite">
      <span className="font-medium text-muted-foreground">{p.title}</span>
      {items.length === 0 ? (
        <span className="text-muted-foreground">{p.none}</span>
      ) : (
        <ul className="grid gap-0.5 tabular-nums">
          {items.map((i) => (
            <li key={i.productId} className="flex justify-between gap-2">
              <span className="flex items-center gap-1">
                <CircleCheck className="size-3 shrink-0 text-success" aria-hidden />
                {i.quantity} × {byId.get(i.productId)?.productName ?? `#${i.productId}`}
              </span>
              <span>{formatCurrency(centsToDecimal(i.lineCents))}</span>
            </li>
          ))}
        </ul>
      )}
      {creditCents > 0 && (
        <span className="flex justify-between gap-2 tabular-nums">
          <span className="flex items-center gap-1">
            <Coins className="size-3 shrink-0 text-warning" aria-hidden />
            {p.credit}
          </span>
          <span>{formatCurrency(centsToDecimal(creditCents))}</span>
        </span>
      )}
      {next && creditCents > 0 && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Hourglass className="size-3 shrink-0" aria-hidden />
          {interpolate(p.next, { product: next.productName, price: formatCurrency(next.price) })}
        </span>
      )}
    </div>
  );
}
