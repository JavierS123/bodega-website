/**
 * Analytics result shapes (client-safe). Money values are plain numbers in Bs.
 * (2-decimal values from Postgres numerics — display/aggregation only; the
 * ledger itself stays in numeric/cents).
 */
import type { SaleMethod } from "@/lib/transactions/shared";

export interface KpiSummary {
  /** Sales revenue in the period, Fiado included (accrual). */
  revenue: number;
  prevRevenue: number | null;
  /** Revenue − cost of goods sold (unit_cost_snapshot × units). */
  grossProfit: number;
  prevGrossProfit: number | null;
  marginPct: number | null;
  prevMarginPct: number | null;
  units: number;
  prevUnits: number | null;
  saleCount: number;
  /** Current outstanding Fiado (snapshot — not period-bound). */
  pendingFiado: number;
}

/** Cash-basis owner economics in the period (same definitions as /owners). */
export interface OwnerPerformance {
  ownerId: number;
  ownerName: string;
  /** Capital injections + restock spend. */
  invested: number;
  /** Cash + Pago Móvil sales + collected abonos. */
  revenue: number;
  /** revenue − invested. */
  profit: number;
  /** profit / invested × 100; null when nothing was invested. */
  roiPct: number | null;
}

export interface SeriesPoint {
  /** Shop-local day "YYYY-MM-DD". */
  day: string;
  revenue: number;
  profit: number;
  units: number;
}

export interface ProductPerformance {
  productId: number;
  sku: string;
  name: string;
  ownerId: number;
  ownerName: string;
  units: number;
  revenue: number;
  /** Gross profit (revenue − cost). */
  profit: number;
}

export interface PaymentSlice {
  method: SaleMethod;
  revenue: number;
  count: number;
}

export interface VelocityCell {
  /** 0 = Monday … 6 = Sunday (shop-local). */
  dow: number;
  hour: number;
  units: number;
  revenue: number;
  count: number;
}

export type WatchStatus = "OUT" | "CRITICAL" | "LOW" | "WATCH";

export interface WatchlistRow {
  productId: number;
  sku: string;
  name: string;
  ownerId: number;
  ownerName: string;
  stock: number;
  threshold: number;
  /** Units sold in the trailing sell-through window (ending today). */
  sold: number;
  avgDaily: number;
  /** stock / avgDaily; null when nothing sold in the window. */
  daysLeft: number | null;
  status: WatchStatus;
}

export interface AnalyticsData {
  kpis: KpiSummary;
  owners: OwnerPerformance[];
  series: SeriesPoint[];
  products: ProductPerformance[];
  payments: PaymentSlice[];
  velocity: VelocityCell[];
  watchlist: { rows: WatchlistRow[]; windowDays: number };
}

/** Filter-bar options. */
export interface AnalyticsOptions {
  owners: { id: number; name: string }[];
  categories: string[];
}
