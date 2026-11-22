/**
 * How an abono paid as an AMOUNT turns into settled Fiado units.
 * Client-safe: the ledger write (src/lib/server/ledger.ts), the Registrar Abono
 * dialog and the AI Confirmation Card all use this one function, so the
 * preview always matches what is saved.
 *
 * Rule — strict oldest-first, whole units only:
 *   walk the owed units oldest Fiado first; clear as many whole units of each
 *   product as the money covers; STOP at the first product the money can't
 *   fully clear. Whatever is left becomes cash credit on the client's account.
 *
 * Why stop instead of skipping ahead: a newer, cheaper item is never paid off
 * while an older one is still pending, so the order is predictable for the
 * client. (Debt is re-priced at today's price; cash credit is a fixed Bs.
 * amount, so only the leftover — less than one unit — is exposed to inflation.)
 */
import { toCents } from "@/lib/money";

export interface OwedUnit {
  productId: number;
  /** Units still owed (≤ 0 is ignored). */
  qty: number;
  /** Today's sale price (numeric string). */
  price: string;
}

export interface AbonoAllocation {
  items: { productId: number; quantity: number; price: string; lineCents: number }[];
  /** Money not tied to any unit (becomes cash credit). */
  creditCents: number;
}

/** `units` must be ordered oldest Fiado first (as getOutstandingUnits returns them). */
export function allocateAbono(units: readonly OwedUnit[], amountCents: number): AbonoAllocation {
  let left = Math.max(0, amountCents);
  const items: AbonoAllocation["items"] = [];
  for (const u of units) {
    const priceCents = toCents(u.price);
    if (u.qty <= 0 || priceCents <= 0) continue;
    const quantity = Math.min(u.qty, Math.floor(left / priceCents));
    if (quantity > 0) {
      items.push({ productId: u.productId, quantity, price: u.price, lineCents: quantity * priceCents });
      left -= quantity * priceCents;
    }
    if (quantity < u.qty) break; // strict oldest-first: don't skip ahead to newer products
  }
  return { items, creditCents: left };
}
