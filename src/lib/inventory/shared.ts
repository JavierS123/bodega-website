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
  /** Alternate names for the AI Cashier (lower-case). */
  aliases: string[];
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

/**
 * Owners use the categorical --chart-1…8 tokens (globals.css; slot = (id − 1) mod 8), so a badge and
 * a chart series for the same owner share one color. Class strings are written
 * out in full so Tailwind can detect them. Text stays text-foreground on the
 * tint for contrast in both themes.
 */
const OWNER_PALETTE = [
  "bg-chart-1/15 text-foreground ring-chart-1/50",
  "bg-chart-2/15 text-foreground ring-chart-2/50",
  "bg-chart-3/15 text-foreground ring-chart-3/50",
  "bg-chart-4/15 text-foreground ring-chart-4/50",
  "bg-chart-5/15 text-foreground ring-chart-5/50",
  "bg-chart-6/15 text-foreground ring-chart-6/50",
  "bg-chart-7/15 text-foreground ring-chart-7/50",
  "bg-chart-8/15 text-foreground ring-chart-8/50",
];

const ownerIndex = (ownerId: number) => (ownerId - 1 + OWNER_PALETTE.length) % OWNER_PALETTE.length;

/** Stable color per owner id, so an owner looks the same on every page. */
export function ownerColorClass(ownerId: number): string {
  return OWNER_PALETTE[ownerIndex(ownerId)];
}

/** The owner's chart color as a CSS value (for Recharts fills/strokes): "var(--chart-3)". */
export function ownerChartColor(ownerId: number): string {
  return `var(--chart-${ownerIndex(ownerId) + 1})`;
}
