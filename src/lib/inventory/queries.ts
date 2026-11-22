import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/db";
import { owners, products } from "@/db/schema";

import type { InventoryProduct, OwnerOption } from "./shared";

/**
 * Live product list (request-time: inventory changes constantly, so it is
 * never served from a cache). Active products first, then by SKU.
 */
export async function listInventoryProducts(): Promise<InventoryProduct[]> {
  await connection();
  return db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      category: products.category,
      aliases: products.aliases,
      ownerId: products.ownerId,
      ownerName: owners.name,
      unitsPerPack: products.unitsPerPack,
      packCost: products.packCost,
      unitCost: products.unitCost,
      marginPct: products.marginPct,
      salePrice: products.salePrice,
      currentStock: products.currentStock,
      lowStockThreshold: products.lowStockThreshold,
      isActive: products.isActive,
    })
    .from(products)
    .innerJoin(owners, eq(owners.id, products.ownerId))
    .orderBy(desc(products.isActive), asc(products.sku));
}

export async function listOwners(): Promise<OwnerOption[]> {
  await connection();
  return db.select({ id: owners.id, name: owners.name }).from(owners).orderBy(asc(owners.id));
}
