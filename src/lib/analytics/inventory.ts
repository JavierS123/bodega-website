import "server-only";

import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/db";
import { products } from "@/db/schema";

export interface InventoryKpis {
  activeSkus: number;
  archivedSkus: number;
  /** Σ max(stock, 0) × unit_cost over active products (numeric string). */
  inventoryValue: string;
  /** 0 < stock ≤ low_stock_threshold. */
  lowStockCount: number;
  /** stock ≤ 0 — negative or empty shelves that need a physical count. */
  auditCount: number;
}

/** Inventory KPI strip. Negative stock is excluded from value (it's a data error, not a liability). */
export async function getInventoryKpis(): Promise<InventoryKpis> {
  await connection();
  const [row] = await db
    .select({
      activeSkus: sql<number>`count(*) filter (where ${products.isActive})::int`,
      archivedSkus: sql<number>`count(*) filter (where not ${products.isActive})::int`,
      inventoryValue: sql<string>`coalesce(sum(greatest(${products.currentStock}, 0) * ${products.unitCost}) filter (where ${products.isActive}), 0)::numeric(14, 2)`,
      lowStockCount: sql<number>`count(*) filter (where ${products.isActive} and ${products.currentStock} > 0 and ${products.currentStock} <= ${products.lowStockThreshold})::int`,
      auditCount: sql<number>`count(*) filter (where ${products.isActive} and ${products.currentStock} <= 0)::int`,
    })
    .from(products);
  return row;
}
