import "server-only";

import { asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { clients, owners, products } from "@/db/schema";

export interface CatalogProduct {
  id: number;
  sku: string;
  name: string;
  aliases: string[];
  salePrice: string;
  currentStock: number;
  ownerId: number;
  ownerName: string;
}

export interface Catalog {
  products: CatalogProduct[];
  clients: { id: number; name: string }[];
  owners: { id: number; name: string }[];
}

/**
 * Live catalog for one parse: active products, client and owner names.
 * Read fresh on every request so prices / stock / new clients are current.
 * Sequential queries: one pooled connection per lambda in production.
 */
export async function loadCatalog(): Promise<Catalog> {
  const productRows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      aliases: products.aliases,
      salePrice: products.salePrice,
      currentStock: products.currentStock,
      ownerId: products.ownerId,
      ownerName: owners.name,
    })
    .from(products)
    .innerJoin(owners, eq(owners.id, products.ownerId))
    .where(eq(products.isActive, true))
    .orderBy(asc(products.sku));
  const clientRows = await db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name));
  const ownerRows = await db.select({ id: owners.id, name: owners.name }).from(owners).orderBy(asc(owners.id));
  return { products: productRows, clients: clientRows, owners: ownerRows };
}

/** Compact, token-cheap text block injected into the prompt. */
export function renderCatalog(c: Catalog): string {
  const lines = c.products.map((p) =>
    [p.sku, p.name, p.aliases.join(", ") || "-", p.salePrice, p.currentStock, p.ownerName].join(" | "),
  );
  return [
    "PRODUCTS (sku | name | aliases | sale price Bs | stock | owner):",
    ...lines,
    "",
    `CLIENTS: ${c.clients.map((x) => x.name).join(", ") || "(none)"}`,
    `OWNERS: ${c.owners.map((x) => x.name).join(", ")}`,
  ].join("\n");
}
