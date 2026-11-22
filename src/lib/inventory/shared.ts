/**
 * Inventory domain logic shared by Server Components, Server Actions and
 * Client Components (no server-only imports here).
 */
import { tryCents } from "@/lib/money";

/** Serializable product row as sent to the client table. Money is numeric strings. */
export interface InventoryProduct {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  ownerId: number;
  ownerName: string;
  unitsPerPack: number;
  packCost: string;
  unitCost: string;
  marginPct: string;
  salePrice: string;
  currentStock: number;
  lowStockThreshold: number;
  isActive: boolean;
}

export interface OwnerOption {
  id: number;
  name: string;
}

/* ── Stock status ─────────────────────────────────────────────────────────── */

export type StockStatus = "IN_STOCK" | "LOW" | "AUDIT";

/** AUDIT: stock ≤ 0 (negative = unrecorded restock / sale error). LOW: 0 < stock ≤ threshold. */
export function stockStatus(stock: number, threshold: number): StockStatus {
  if (stock <= 0) return "AUDIT";
  if (stock <= threshold) return "LOW";
  return "IN_STOCK";
}

/* ── Pricing (integer cents) ──────────────────────────────────────────────── */

/** unit_cost = pack_cost / units_per_pack, rounded to the cent (matches SQL round(…, 2)). */
export function unitCostCents(packCostCents: number, unitsPerPack: number): number {
  return unitsPerPack > 0 ? Math.round(packCostCents / unitsPerPack) : 0;
}

/** suggested_price = unit_cost × (1 + margin_pct / 100). */
export function suggestedPriceCents(unitCost: number, marginPct: number): number {
  return Math.round((unitCost * (100 + marginPct)) / 100);
}

/** Markup actually achieved by the sale price over unit cost, in %. null if cost is 0. */
export function actualMarginPct(salePrice: number, unitCost: number): number | null {
  return unitCost > 0 ? ((salePrice - unitCost) / unitCost) * 100 : null;
}

/** Convenience for table rows (strings from Postgres). */
export function productPricing(p: Pick<InventoryProduct, "unitCost" | "marginPct" | "salePrice">) {
  const unit = tryCents(p.unitCost) ?? 0;
  const margin = Number(p.marginPct) || 0;
  const sale = tryCents(p.salePrice) ?? 0;
  return {
    unitCostCents: unit,
    suggestedCents: suggestedPriceCents(unit, margin),
    saleCents: sale,
    targetMargin: margin,
    actualMargin: actualMarginPct(sale, unit),
  };
}

/* ── Stock adjustment reasons ─────────────────────────────────────────────── */

export const ADJUSTMENT_REASONS = [
  "UNRECORDED_RESTOCK",
  "PHYSICAL_COUNT",
  "DAMAGED",
  "LOSS",
  "OTHER",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/* ── Owner colors ─────────────────────────────────────────────────────────── */

const OWNER_PALETTE = [
  "bg-sky-100 text-sky-800 ring-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:ring-sky-900",
  "bg-violet-100 text-violet-800 ring-violet-200 dark:bg-violet-950/50 dark:text-violet-300 dark:ring-violet-900",
  "bg-orange-100 text-orange-800 ring-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:ring-orange-900",
  "bg-pink-100 text-pink-800 ring-pink-200 dark:bg-pink-950/50 dark:text-pink-300 dark:ring-pink-900",
  "bg-teal-100 text-teal-800 ring-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:ring-teal-900",
  "bg-lime-100 text-lime-800 ring-lime-200 dark:bg-lime-950/50 dark:text-lime-300 dark:ring-lime-900",
];

/** Stable color per owner id, so an owner looks the same on every page. */
export function ownerColorClass(ownerId: number): string {
  return OWNER_PALETTE[(ownerId - 1 + OWNER_PALETTE.length) % OWNER_PALETTE.length];
}
