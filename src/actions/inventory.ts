"use server";

import { eq, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { products, transactionItems, transactions } from "@/db/schema";
import { isAuthError, requireAdmin } from "@/lib/auth/guards";
import { ADJUSTMENT_REASONS } from "@/lib/inventory/shared";
import { centsToDecimal, toCents } from "@/lib/money";

/* ────────────────────────────────────────────────────────────────────────────
 * Result contract (serializable; the client maps `error` to an i18n message)
 * ──────────────────────────────────────────────────────────────────────────── */

export type InventoryErrorCode =
  | "unauthorized"
  | "validation"
  | "duplicateSku"
  | "notFound"
  | "stale"
  | "noChange"
  | "unknown";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: InventoryErrorCode; fieldErrors?: Record<string, string[]> };

class ActionError extends Error {
  constructor(readonly code: InventoryErrorCode) {
    super(code);
  }
}

/** Shared wrapper: admin check → validate → run → refresh the router. */
async function run<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  fn: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    await requireAdmin();
  } catch (error) {
    if (isAuthError(error)) return { ok: false, error: "unauthorized" };
    throw error;
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const data = await fn(parsed.data);
    refresh(); // re-render the current route (table + KPIs) with fresh data
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.code };
    if (pgErrorCode(error) === "23505") return { ok: false, error: "duplicateSku" };
    console.error("[inventory action]", error);
    return { ok: false, error: "unknown" };
  }
}

/** Postgres SQLSTATE from a postgres-js error (possibly wrapped by Drizzle). */
function pgErrorCode(error: unknown): string | undefined {
  for (let e: unknown = error, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Schemas
 * ──────────────────────────────────────────────────────────────────────────── */

const money = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Invalid amount");
const id = z.number().int().positive();
const count = (max: number) => z.number().int().min(0).max(max);

const productSchema = z.object({
  id: id.optional(),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_]{2,32}$/, "2–32 characters: A–Z, 0–9, _"),
  name: z.string().trim().min(1).max(120),
  category: z
    .string()
    .trim()
    .max(60)
    .nullish()
    .transform((v) => v || null),
  ownerId: id,
  unitsPerPack: z.number().int().min(1).max(10_000),
  packCost: money,
  marginPct: z.number().min(0).max(999.99),
  salePrice: money,
  lowStockThreshold: count(100_000),
  /** Create only: logged as a STOCK_ADJUSTMENT so the opening stock is auditable. */
  initialStock: count(100_000).optional(),
});

const archiveSchema = z.object({ id, active: z.boolean() });

const restockSchema = z.object({
  productId: id,
  packs: z.number().int().min(1).max(10_000),
  packCost: money,
  /** Optional new sale price; omitted/null keeps the current one. */
  newSalePrice: money.nullish(),
});

const adjustSchema = z
  .object({
    productId: id,
    /** What's physically on the shelf. */
    actualCount: count(1_000_000),
    /** The system stock the user saw — rejects the write if it changed meanwhile. */
    expectedStock: z.number().int(),
    reason: z.enum(ADJUSTMENT_REASONS),
    details: z.string().trim().max(200).optional().default(""),
  })
  .refine((v) => v.reason !== "OTHER" || v.details.length >= 3, {
    path: ["details"],
    message: "Required for OTHER",
  });

export type ProductInput = z.input<typeof productSchema>;
export type RestockInput = z.input<typeof restockSchema>;
export type AdjustStockInput = z.input<typeof adjustSchema>;

/** round(pack_cost / units_per_pack, 2) computed by Postgres on exact numerics. */
const unitCostSql = (packCost: string, unitsPerPack: number) =>
  sql`round(${packCost}::numeric / ${unitsPerPack}, 2)`;

/* ────────────────────────────────────────────────────────────────────────────
 * Actions
 * ──────────────────────────────────────────────────────────────────────────── */

/** Create (no id) or update (id) a product. Stock is never edited here. */
export async function saveProduct(input: ProductInput): Promise<ActionResult<{ id: number }>> {
  return run(productSchema, input, async (p) => {
    const values = {
      sku: p.sku,
      name: p.name,
      category: p.category,
      ownerId: p.ownerId,
      unitsPerPack: p.unitsPerPack,
      packCost: p.packCost,
      unitCost: unitCostSql(p.packCost, p.unitsPerPack),
      marginPct: p.marginPct.toFixed(2),
      salePrice: p.salePrice,
      lowStockThreshold: p.lowStockThreshold,
    };

    return db.transaction(async (tx) => {
      if (p.id) {
        const [row] = await tx
          .update(products)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(products.id, p.id))
          .returning({ id: products.id });
        if (!row) throw new ActionError("notFound");
        return { id: row.id };
      }

      const opening = p.initialStock ?? 0;
      const [row] = await tx
        .insert(products)
        .values({ ...values, currentStock: opening })
        .returning({ id: products.id, unitCost: products.unitCost });

      if (opening > 0) {
        const [txn] = await tx
          .insert(transactions)
          .values({
            type: "STOCK_ADJUSTMENT",
            paymentMethod: "NONE",
            totalAmount: "0",
            notes: "INITIAL_STOCK",
            source: "WEB_MANUAL",
          })
          .returning({ id: transactions.id });
        await tx.insert(transactionItems).values({
          transactionId: txn.id,
          productId: row.id,
          ownerId: p.ownerId,
          quantityDelta: opening,
          unitPriceSnapshot: p.salePrice,
          unitCostSnapshot: row.unitCost,
          lineTotal: "0",
        });
      }
      return { id: row.id };
    });
  });
}

/** Archive (soft delete — history is preserved) or restore a product. */
export async function setProductActive(input: z.input<typeof archiveSchema>): Promise<ActionResult> {
  return run(archiveSchema, input, async ({ id: productId, active }) => {
    const [row] = await db
      .update(products)
      .set({ isActive: active, updatedAt: new Date() })
      .where(eq(products.id, productId))
      .returning({ id: products.id });
    if (!row) throw new ActionError("notFound");
    return undefined;
  });
}

/**
 * "Registrar Bulto": add N packs. Atomically increases stock, updates
 * pack/unit cost (and optionally the sale price), and records a RESTOCK
 * transaction attributed to the product's owner (their investment).
 */
export async function restockProduct(
  input: RestockInput,
): Promise<ActionResult<{ unitsAdded: number; newStock: number }>> {
  return run(restockSchema, input, async ({ productId, packs, packCost, newSalePrice }) =>
    db.transaction(async (tx) => {
      const [product] = await tx
        .select({
          ownerId: products.ownerId,
          unitsPerPack: products.unitsPerPack,
          salePrice: products.salePrice,
        })
        .from(products)
        .where(eq(products.id, productId))
        .for("update");
      if (!product) throw new ActionError("notFound");

      const unitsAdded = packs * product.unitsPerPack;
      const totalCents = packs * toCents(packCost);
      const salePrice = newSalePrice ?? product.salePrice;

      const [updated] = await tx
        .update(products)
        .set({
          currentStock: sql`${products.currentStock} + ${unitsAdded}`,
          packCost,
          unitCost: unitCostSql(packCost, product.unitsPerPack),
          salePrice,
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId))
        .returning({ currentStock: products.currentStock, unitCost: products.unitCost });

      const [txn] = await tx
        .insert(transactions)
        .values({
          type: "RESTOCK",
          paymentMethod: "NONE",
          totalAmount: centsToDecimal(totalCents),
          notes: `${packs} × ${product.unitsPerPack}u`,
          source: "WEB_MANUAL",
        })
        .returning({ id: transactions.id });

      await tx.insert(transactionItems).values({
        transactionId: txn.id,
        productId,
        ownerId: product.ownerId,
        quantityDelta: unitsAdded,
        unitPriceSnapshot: salePrice,
        unitCostSnapshot: updated.unitCost,
        lineTotal: centsToDecimal(totalCents),
      });

      return { unitsAdded, newStock: updated.currentStock };
    }),
  );
}

/**
 * "Ajustar Stock": set stock to the physical shelf count. Logs the delta as a
 * STOCK_ADJUSTMENT (no money moves; line_total = 0, snapshots keep the cost so
 * shrinkage can be valued later). Rejects if stock changed since the user looked.
 */
export async function adjustStock(
  input: AdjustStockInput,
): Promise<ActionResult<{ delta: number; newStock: number }>> {
  return run(adjustSchema, input, async ({ productId, actualCount, expectedStock, reason, details }) =>
    db.transaction(async (tx) => {
      const [product] = await tx
        .select({
          ownerId: products.ownerId,
          currentStock: products.currentStock,
          unitCost: products.unitCost,
          salePrice: products.salePrice,
        })
        .from(products)
        .where(eq(products.id, productId))
        .for("update");
      if (!product) throw new ActionError("notFound");
      if (product.currentStock !== expectedStock) throw new ActionError("stale");

      const delta = actualCount - product.currentStock;
      if (delta === 0) throw new ActionError("noChange");

      await tx
        .update(products)
        .set({ currentStock: actualCount, updatedAt: new Date() })
        .where(eq(products.id, productId));

      const [txn] = await tx
        .insert(transactions)
        .values({
          type: "STOCK_ADJUSTMENT",
          paymentMethod: "NONE",
          totalAmount: "0",
          // Reason code first (translated at display time), then the free-text note.
          notes: details ? `${reason}: ${details}` : reason,
          source: "WEB_MANUAL",
        })
        .returning({ id: transactions.id });

      await tx.insert(transactionItems).values({
        transactionId: txn.id,
        productId,
        ownerId: product.ownerId,
        quantityDelta: delta,
        unitPriceSnapshot: product.salePrice,
        unitCostSnapshot: product.unitCost,
        lineTotal: "0",
      });

      return { delta, newStock: actualCount };
    }),
  );
}
