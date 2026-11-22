/**
 * BodegaOS — Google Sheets → Postgres ETL core.
 *
 * Pipeline:  read CSVs → build an in-memory ImportPlan (pure, no DB) →
 *            write the plan inside ONE db.transaction → print the audit report.
 *
 * Shared by scripts/import-sheets.ts (real data) and scripts/seed-sample.ts.
 */
import fs from "node:fs";
import path from "node:path";

import { loadEnvConfig } from "@next/env";
import { and, eq, inArray, like, notExists, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../src/db/schema";
import {
  centsToNumeric,
  formatBs,
  normKey,
  normalizePersonName,
  parseCsv,
  parseSheetDate,
  readTable,
  toCents,
  toInt,
} from "./parse";

type PaymentMethod = schema.PaymentMethod;
type SettlementMethod = schema.SettlementMethod;
type SettlementType = (typeof schema.ownerSettlementTypeEnum.enumValues)[number];

/** Marks every owner_settlements row this script writes, so --reset can scope to them. */
export const SETTLEMENT_NOTE_PREFIX = "[CSV_IMPORT]";
/** Placeholder client for FIADO rows with an empty Cliente_Fiado (DB requires a client). */
export const UNKNOWN_CLIENT = "Desconocido (Legacy)";

/* ────────────────────────────────────────────────────────────────────────────
 * Tipo_Operacion mapping — the single place to change how legacy ops land.
 * Keys are normKey()'d (lowercase, no accents).
 * ──────────────────────────────────────────────────────────────────────────── */

type OpMapping =
  | { kind: "SALE"; method: Exclude<PaymentMethod, "NONE"> }
  | { kind: "DEBT_PAYMENT"; method: SettlementMethod }
  | { kind: "RESTOCK" }
  | { kind: "SETTLEMENT"; type: SettlementType; method: SettlementMethod }
  | { kind: "SKIP" };

const OPERATION_MAP: Record<string, OpMapping> = {
  "pago movil": { kind: "SALE", method: "PAGO_MOVIL" },
  efectivo: { kind: "SALE", method: "CASH" },
  fiado: { kind: "SALE", method: "FIADO" },
  "abono pago movil": { kind: "DEBT_PAYMENT", method: "PAGO_MOVIL" },
  "abono efectivo": { kind: "DEBT_PAYMENT", method: "CASH" },
  // Bulk purchase of stock. Cantidad = units, Monto = total cost.
  "compra bulto": { kind: "RESTOCK" },
  // Shop → owner's account by Pago Móvil.
  transferencia: { kind: "SETTLEMENT", type: "PAYOUT_TRANSFER", method: "PAGO_MOVIL" },
  // Register cash deposited into the bank, joining the Pago Móvil flow.
  "cambio efectivo": { kind: "SETTLEMENT", type: "CASH_DEPOSIT", method: "CASH" },
  // Owner puts money in; the sheet adds it to the bank ("Por Transferir") pot.
  aporte: { kind: "SETTLEMENT", type: "CAPITAL_INJECTION", method: "PAGO_MOVIL" },
  // Owner takes profit out of money already paid out — moves no shop balance.
  retiro: { kind: "SETTLEMENT", type: "PROFIT_WITHDRAWAL", method: "PAGO_MOVIL" },
  // Visual separator rows ("--- CICLO ---") between restock cycles.
  "--- ciclo ---": { kind: "SKIP" },
};

function mapOperation(raw: string): OpMapping | undefined {
  const key = normKey(raw);
  return OPERATION_MAP[key] ?? (/ciclo/.test(key) ? { kind: "SKIP" } : undefined);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Category inference
 * ──────────────────────────────────────────────────────────────────────────── */

const CATEGORY_RULES: { test: RegExp; category: string }[] = [
  { test: /^REF_|refresco/i, category: "Bebidas" },
  { test: /^JUSTY_|jugo/i, category: "Jugos" },
  { test: /oreo|galleta|rikas/i, category: "Galletas" },
  { test: /gomita|chupeta|barrilete|maxcoco|coco.?crunch|trululu|caramelo|chocolate/i, category: "Golosinas" },
  { test: /^TOM_|pigsy|pepito|platanito|aros|tostón|chips/i, category: "Snacks" },
];

export function inferCategory(sku: string, name: string): string {
  const haystack = `${sku} ${name}`;
  return CATEGORY_RULES.find((r) => r.test.test(haystack))?.category ?? "Otros";
}

/* ────────────────────────────────────────────────────────────────────────────
 * Plan types
 * ──────────────────────────────────────────────────────────────────────────── */

export interface PlannedProduct {
  sku: string;
  name: string;
  category: string;
  owner: string;
  unitsPerPack: number;
  packCostCents: number;
  unitCostCents: number;
  marginPct: string;
  salePriceCents: number;
  stockInitial: number;
  stockActual: number;
}

export interface PlannedItem {
  sku: string;
  owner: string;
  quantityDelta: number;
  unitPriceCents: number;
  unitCostCents: number;
  lineTotalCents: number;
}

export interface PlannedTransaction {
  legacyId: number | null;
  sourceLegacyId: number;
  occurredAt: Date;
  type: schema.TransactionType;
  paymentMethod: PaymentMethod;
  client: string | null;
  totalCents: number;
  notes: string;
  items: PlannedItem[];
  debtPayments: PlannedDebtPayment[];
}

export interface PlannedDebtPayment {
  owner: string;
  amountCents: number;
  method: SettlementMethod;
  /** Units of Fiado debt settled. Abono rows with Cantidad 0 are cash credit (no item). */
  items: { sku: string; quantity: number; lineTotalCents: number }[];
}

/** A Cantidad-0 sale row merged into a line paid by another method (see warnings). */
export interface SplitPaymentShift {
  owner: string;
  recordedAs: PaymentMethod;
  paidWith: PaymentMethod;
  cents: number;
}

export interface PlannedSettlement {
  sourceLegacyId: number;
  owner: string;
  type: SettlementType;
  method: SettlementMethod;
  amountCents: number;
  occurredAt: Date;
  notes: string;
}

export interface ImportPlan {
  owners: string[];
  products: PlannedProduct[];
  clients: string[];
  transactions: PlannedTransaction[];
  settlements: PlannedSettlement[];
  warnings: string[];
  splitPaymentShifts: SplitPaymentShift[];
  stats: {
    csvRows: number;
    legacyIds: number;
    skippedMarkers: number;
    byOperation: Record<string, { rows: number; cents: number }>;
    sheetSummaryTotal: string | null;
  };
  /** Optional per-client "Total pendiente" from dashboard.csv, for reconciliation. */
  dashboardDebts: DashboardDebts | null;
  /** Optional per-owner "TOTALES ACTUALES" (Efectivo / Por Transferir) from dashboard.csv. */
  dashboardOwners: Map<string, { cashCents: number; bankCents: number }> | null;
}

export type DashboardDebts = Map<string, { cents: number; units: Map<string, number> }>;

/* ────────────────────────────────────────────────────────────────────────────
 * Build the plan (pure — no DB access)
 * ──────────────────────────────────────────────────────────────────────────── */

export function buildPlan(dataDir: string): ImportPlan {
  const inventoryPath = path.join(dataDir, "inventario.csv");
  const txPath = path.join(dataDir, "transacciones.csv");
  for (const p of [inventoryPath, txPath]) {
    if (!fs.existsSync(p)) throw new Error(`Missing ${p}`);
  }

  const warnings: string[] = [];
  const errors: string[] = [];

  /* ── Inventory ── */
  const inv = readTable(fs.readFileSync(inventoryPath, "utf8"), "ID_Producto");
  const products: PlannedProduct[] = [];
  const productBySku = new Map<string, PlannedProduct>();

  for (const r of inv.rows) {
    try {
      const sku = r.get("ID_Producto").toUpperCase();
      if (!sku) continue;
      if (productBySku.has(sku)) {
        errors.push(`inventario.csv:${r.line} duplicate SKU ${sku}`);
        continue;
      }
      const name = r.get("Nombre Descriptivo") || sku;
      const unitCostCents = toCents(r.get("Costo_Unidad")) ?? 0;
      const suggestedCents = toCents(r.get("Precio_Sugerido"));
      // Recover the sheet's margin from Precio_Sugerido = Costo_Unidad × (1 + margin).
      const marginPct =
        unitCostCents > 0 && suggestedCents !== null
          ? (Math.round((suggestedCents * 10000) / unitCostCents - 10000) / 100).toFixed(2)
          : "30.00";
      const p: PlannedProduct = {
        sku,
        name,
        category: inferCategory(sku, name),
        owner: normalizePersonName(r.get("Dueño")),
        unitsPerPack: toInt(r.get("Unidades_por_Bulto")) ?? 1,
        packCostCents: toCents(r.get("Costo_Bulto")) ?? 0,
        unitCostCents,
        marginPct,
        salePriceCents: toCents(r.get("Precio_Venta")) ?? 0,
        stockInitial: toInt(r.get("Stock_Inicial")) ?? 0,
        stockActual: toInt(r.get("Stock_Actual")) ?? 0,
      };
      if (!p.owner) errors.push(`inventario.csv:${r.line} ${sku} has no Dueño`);
      if (p.unitsPerPack <= 0) errors.push(`inventario.csv:${r.line} ${sku} Unidades_por_Bulto must be > 0`);
      products.push(p);
      productBySku.set(sku, p);
    } catch (e) {
      errors.push(`inventario.csv:${r.line} ${(e as Error).message}`);
    }
  }

  /* ── Transactions: parse rows ── */
  const txText = fs.readFileSync(txPath, "utf8");
  const tx = readTable(txText, "ID_Transaccion");

  // Row 1 metadata ("z, …, $3,632,330.00") — keep the sheet's own total for the report.
  const firstLine = txText.replace(/^﻿/, "").split(/\r?\n/, 1)[0];
  const summaryMatch = /"?(\$[\d,]+\.\d{2})"?\s*$/.exec(firstLine);

  interface Row {
    line: number;
    legacyId: number;
    dateRaw: string;
    occurredAt: Date;
    opRaw: string;
    op: OpMapping;
    sku: string | null;
    qty: number;
    cents: number;
    client: string | null;
    owner: string | null;
  }

  const rows: Row[] = [];
  const byOperation: ImportPlan["stats"]["byOperation"] = {};
  let skippedMarkers = 0;

  for (const r of tx.rows) {
    try {
      const opRaw = r.get("Tipo_Operacion");
      const op = mapOperation(opRaw);
      if (!op) {
        errors.push(`transacciones.csv:${r.line} unknown Tipo_Operacion "${opRaw}" — add it to OPERATION_MAP`);
        continue;
      }
      const stat = (byOperation[opRaw] ??= { rows: 0, cents: 0 });
      stat.rows++;
      if (op.kind === "SKIP") {
        skippedMarkers++;
        continue;
      }
      const legacyId = toInt(r.get("ID_Transaccion"));
      if (legacyId === null) throw new Error("missing ID_Transaccion");
      const skuRaw = r.get("ID_Producto").toUpperCase();
      const clientRaw = r.get("Cliente_Fiado");
      const ownerRaw = r.get("Dueño");
      const cents = toCents(r.get("Monto_Operacion")) ?? 0;
      stat.cents += cents;
      const qty = toInt(r.get("Cantidad")) ?? 0;
      if (qty < 0) throw new Error(`negative Cantidad ${qty}`);
      const dateRaw = r.get("Fecha");
      rows.push({
        line: r.line,
        legacyId,
        dateRaw,
        occurredAt: parseSheetDate(dateRaw),
        opRaw,
        op,
        sku: skuRaw && skuRaw !== "-" ? skuRaw : null,
        qty,
        cents,
        client: clientRaw ? normalizePersonName(clientRaw) : null,
        owner: ownerRaw ? normalizePersonName(ownerRaw) : null,
      });
    } catch (e) {
      errors.push(`transacciones.csv:${r.line} ${(e as Error).message}`);
    }
  }

  /* ── Group by ID_Transaccion, then split mixed groups ──
   * One sheet ID can hold several logical operations (e.g. #24 = a Fiado sale
   * plus a later Abono). Sub-group by (Fecha, Tipo, Cliente); the first
   * sub-group keeps legacy_id, the rest get legacy_id = NULL + a note. */
  const groups = new Map<number, Row[]>();
  for (const row of rows) {
    const g = groups.get(row.legacyId);
    if (g) g.push(row);
    else groups.set(row.legacyId, [row]);
  }

  const transactions: PlannedTransaction[] = [];
  const settlements: PlannedSettlement[] = [];
  const splitPaymentShifts: SplitPaymentShift[] = [];
  const clientNames = new Set<string>();
  let ownerSnapshotMismatches = 0;

  const resolveProduct = (row: Row): PlannedProduct | null => {
    if (!row.sku) {
      errors.push(`transacciones.csv:${row.line} #${row.legacyId} ${row.opRaw} has no ID_Producto`);
      return null;
    }
    const p = productBySku.get(row.sku);
    if (!p) errors.push(`transacciones.csv:${row.line} unknown product ${row.sku} (not in inventario.csv)`);
    return p ?? null;
  };

  const resolveOwner = (row: Row, product: PlannedProduct | null): string | null => {
    const owner = row.owner ?? product?.owner ?? null;
    if (!owner) errors.push(`transacciones.csv:${row.line} #${row.legacyId} has no Dueño`);
    if (owner && product && owner !== product.owner) ownerSnapshotMismatches++;
    return owner;
  };

  for (const [legacyId, groupRows] of groups) {
    const subgroups = new Map<string, Row[]>();
    for (const row of groupRows) {
      const key = `${row.dateRaw}|${normKey(row.opRaw)}|${row.client ?? ""}`;
      const sg = subgroups.get(key);
      if (sg) sg.push(row);
      else subgroups.set(key, [row]);
    }
    const groupTxs: PlannedTransaction[] = [];
    /** Sale rows with Cantidad = 0: extra payment for an item sold in a sibling row. */
    const zeroQtySales: Row[] = [];

    for (const sg of subgroups.values()) {
      const head = sg[0];
      const op = head.op;
      const baseNote = `Legacy #${legacyId} · ${head.opRaw}`;

      if (op.kind === "SKIP") continue;

      if (op.kind === "SETTLEMENT") {
        for (const row of sg) {
          const owner = resolveOwner(row, null);
          if (!owner) continue;
          if (row.cents <= 0) {
            warnings.push(`#${legacyId} ${row.opRaw} for ${owner} has amount ${formatBs(row.cents)} — skipped`);
            continue;
          }
          settlements.push({
            sourceLegacyId: legacyId,
            owner,
            type: op.type,
            method: op.method,
            amountCents: row.cents,
            occurredAt: row.occurredAt,
            notes: `${SETTLEMENT_NOTE_PREFIX} ${baseNote}`,
          });
        }
        continue;
      }

      const planned: PlannedTransaction = {
        legacyId: null,
        sourceLegacyId: legacyId,
        occurredAt: head.occurredAt,
        type: "SALE",
        paymentMethod: "NONE",
        client: null,
        totalCents: 0,
        notes: baseNote,
        items: [],
        debtPayments: [],
      };

      if (op.kind === "SALE") {
        planned.type = "SALE";
        planned.paymentMethod = op.method;
        planned.client = head.client;
        if (op.method === "FIADO" && !planned.client) {
          planned.client = UNKNOWN_CLIENT;
          warnings.push(`#${legacyId} is Fiado with no Cliente_Fiado → assigned to "${UNKNOWN_CLIENT}"`);
        }
        for (const row of sg) {
          const product = resolveProduct(row);
          const owner = resolveOwner(row, product);
          if (!product || !owner) continue;
          if (row.qty === 0) {
            zeroQtySales.push(row);
            continue;
          }
          planned.items.push({
            sku: product.sku,
            owner,
            quantityDelta: -row.qty,
            unitPriceCents: Math.round(row.cents / row.qty),
            unitCostCents: product.unitCostCents,
            lineTotalCents: row.cents,
          });
          planned.totalCents += row.cents;
        }
      } else if (op.kind === "DEBT_PAYMENT") {
        planned.type = "DEBT_PAYMENT";
        planned.paymentMethod = op.method;
        planned.client = head.client;
        if (!planned.client) {
          errors.push(`transacciones.csv:${head.line} #${legacyId} ${head.opRaw} has no Cliente_Fiado`);
          continue;
        }
        // An abono moves no stock (it left at the Fiado sale). It settles UNITS of
        // debt (SKU + Cantidad → debt_payment_items); Cantidad 0 = cash credit.
        // One debt_payments row per owner.
        const perOwner = new Map<string, PlannedDebtPayment>();
        for (const row of sg) {
          const product = row.sku ? resolveProduct(row) : null;
          const owner = resolveOwner(row, product);
          if (!owner) continue;
          let dp = perOwner.get(owner);
          if (!dp) {
            dp = { owner, amountCents: 0, method: op.method, items: [] };
            perOwner.set(owner, dp);
          }
          dp.amountCents += row.cents;
          if (product && row.qty > 0) {
            const existing = dp.items.find((i) => i.sku === product.sku);
            if (existing) {
              existing.quantity += row.qty;
              existing.lineTotalCents += row.cents;
            } else {
              dp.items.push({ sku: product.sku, quantity: row.qty, lineTotalCents: row.cents });
            }
          }
        }
        for (const dp of perOwner.values()) {
          if (dp.amountCents <= 0) {
            warnings.push(`#${legacyId} abono for ${dp.owner} totals ${formatBs(dp.amountCents)} — skipped`);
            continue;
          }
          planned.debtPayments.push(dp);
          planned.totalCents += dp.amountCents;
        }
      } else if (op.kind === "RESTOCK") {
        planned.type = "RESTOCK";
        planned.paymentMethod = "NONE";
        for (const row of sg) {
          const product = resolveProduct(row);
          const owner = resolveOwner(row, product);
          if (!product || !owner) continue;
          if (row.qty === 0) {
            warnings.push(`#${legacyId} Compra Bulto of ${product.sku} has Cantidad 0 — skipped`);
            continue;
          }
          planned.items.push({
            sku: product.sku,
            owner,
            quantityDelta: row.qty,
            unitPriceCents: product.salePriceCents,
            unitCostCents: Math.round(row.cents / row.qty),
            lineTotalCents: row.cents,
          });
          planned.totalCents += row.cents;
        }
      }

      groupTxs.push(planned);
    }

    // Fold zero-quantity sale rows into the sibling line for the same product
    // (split payment, e.g. #63: 1 Kolita paid Bs. 800 Pago Móvil + Bs. 300 cash).
    for (const row of zeroQtySales) {
      const target = groupTxs.find((t) => t.type === "SALE" && t.items.some((i) => i.sku === row.sku));
      const item = target?.items.find((i) => i.sku === row.sku);
      if (target && item) {
        item.lineTotalCents += row.cents;
        item.unitPriceCents = Math.round(item.lineTotalCents / -item.quantityDelta);
        target.totalCents += row.cents;
        target.notes += ` · +${formatBs(row.cents)} paid via ${row.opRaw}`;
        const paidWith = row.op.kind === "SALE" ? row.op.method : target.paymentMethod;
        if (paidWith !== target.paymentMethod) {
          splitPaymentShifts.push({ owner: item.owner, recordedAs: target.paymentMethod, paidWith, cents: row.cents });
        }
        warnings.push(
          `#${legacyId} split payment: ${formatBs(row.cents)} (${row.opRaw}, Cantidad 0) merged into the ${row.sku} line`,
        );
      } else {
        errors.push(`transacciones.csv:${row.line} #${legacyId} sale with Cantidad 0 and no matching line to merge into`);
      }
    }

    // Drop records left empty (fully merged split payments, all-zero abonos), then
    // label parts: the first keeps legacy_id (unique); the rest get NULL + a note.
    const kept = groupTxs.filter((t) => {
      const isMergedPayment = t.type === "SALE" && t.items.length === 0;
      const isEmptyRestock = t.type === "RESTOCK" && t.items.length === 0;
      if (isEmptyRestock) warnings.push(`#${legacyId} Compra Bulto has no usable lines — skipped`);
      return !isMergedPayment && !isEmptyRestock && !(t.type === "DEBT_PAYMENT" && t.debtPayments.length === 0);
    });
    kept.forEach((t, i) => {
      if (i === 0) t.legacyId = legacyId;
      if (kept.length > 1) t.notes = t.notes.replace(`#${legacyId}`, `#${legacyId} (part ${i + 1}/${kept.length})`);
      if (t.client) clientNames.add(t.client);
      transactions.push(t);
    });
    if (kept.length > 1) {
      warnings.push(
        `#${legacyId} mixes ${kept.length} operations (${kept.map((t) => t.notes.split(" · ")[1]).join(" + ")}) → split into separate transactions`,
      );
    }
  }

  if (ownerSnapshotMismatches > 0) {
    warnings.push(
      `${ownerSnapshotMismatches} line(s) have a Dueño different from the product's current owner — kept the row's Dueño as the historical owner snapshot`,
    );
  }

  if (errors.length > 0) {
    throw new Error(`Import aborted — fix these ${errors.length} problem(s) in the CSVs:\n  - ${errors.join("\n  - ")}`);
  }

  /* ── Owners: from inventory + every transaction/settlement ── */
  const owners = new Set<string>(products.map((p) => p.owner));
  for (const t of transactions) {
    t.items.forEach((i) => owners.add(i.owner));
    t.debtPayments.forEach((d) => owners.add(d.owner));
  }
  settlements.forEach((s) => owners.add(s.owner));

  // Clients listed on the dashboard but with no transactions yet still exist.
  const dashboardDebts = readDashboardDebts(path.join(dataDir, "dashboard.csv"));
  dashboardDebts?.forEach((_, name) => clientNames.add(name));

  return {
    owners: [...owners].sort((a, b) => a.localeCompare(b, "es")),
    products,
    clients: [...clientNames].sort((a, b) => a.localeCompare(b, "es")),
    transactions: transactions.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
    settlements,
    warnings,
    splitPaymentShifts,
    stats: {
      csvRows: tx.rows.length,
      legacyIds: groups.size,
      skippedMarkers,
      byOperation,
      sheetSummaryTotal: summaryMatch ? summaryMatch[1] : null,
    },
    dashboardDebts,
    dashboardOwners: readDashboardOwners(path.join(dataDir, "dashboard.csv")),
  };
}

/**
 * dashboard.csv client block → Map<client, { cents, units by SKU }>, or null if
 * the file is absent. The file has further sections below the client block
 * ("HISTÓRICO TOTAL", per-owner cash…); parsing stops at the first row whose
 * "Total pendiente" isn't money.
 */
function readDashboardDebts(file: string): DashboardDebts | null {
  if (!fs.existsSync(file)) return null;
  const t = readTable(fs.readFileSync(file, "utf8"), "CLIENTE");
  const skuHeaders = t.headers.filter((h) => h !== "cliente" && h !== "total pendiente" && h !== "");
  const m: DashboardDebts = new Map();
  for (const r of t.rows) {
    const name = r.get("CLIENTE");
    let cents: number | null;
    try {
      cents = toCents(r.get("Total pendiente"));
    } catch {
      break;
    }
    if (!name || cents === null) break;
    const units = new Map<string, number>();
    for (const h of skuHeaders) {
      const n = Number(r.get(h) || "0");
      // Headers were normKey()'d ("ref neg"); map back to SKU form ("REF_NEG").
      if (n) units.set(h.toUpperCase().replace(/ /g, "_"), n);
    }
    m.set(normalizePersonName(name), { cents, units });
  }
  return m;
}

/** dashboard.csv "TOTALES ACTUALES" block → per-owner cash / bank ("Por Transferir"). */
function readDashboardOwners(file: string): ImportPlan["dashboardOwners"] {
  if (!fs.existsSync(file)) return null;
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const start = rows.findIndex((r) => normKey(r[0] ?? "") === "totales actuales");
  if (start === -1 || !rows[start + 1]) return null;
  const headers = rows[start + 1].map(normKey);
  const cashCol = headers.indexOf("efectivo");
  const bankCol = headers.indexOf("por transferir");
  if (cashCol === -1 || bankCol === -1) return null;
  const m = new Map<string, { cashCents: number; bankCents: number }>();
  for (const r of rows.slice(start + 2)) {
    const name = (r[0] ?? "").trim();
    if (!name) break;
    try {
      m.set(normalizePersonName(name), {
        cashCents: toCents(r[cashCol] ?? "") ?? 0,
        bankCents: toCents(r[bankCol] ?? "") ?? 0,
      });
    } catch {
      break;
    }
  }
  return m.size > 0 ? m : null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Database
 * ──────────────────────────────────────────────────────────────────────────── */

export function findProjectRoot(start = process.cwd()): string {
  let dir = path.resolve(start);
  while (!fs.existsSync(path.join(dir, "drizzle.config.ts"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not locate the project root (drizzle.config.ts).");
    dir = parent;
  }
  return dir;
}

function connect() {
  loadEnvConfig(findProjectRoot(), false, { info: () => {}, error: console.error });
  // Prefer the session pooler for a long-running script; fall back to the app URL.
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) throw new Error("Set DIRECT_URL or DATABASE_URL in .env / .env.local.");
  const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  return { client, db: drizzle(client, { schema }) };
}

type Db = ReturnType<typeof connect>["db"];
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export interface WriteResult {
  status: "imported" | "already-imported" | "rolled-back";
  reset: { transactions: number; settlements: number; orphanClients: number } | null;
  inserted: {
    owners: number;
    products: number;
    clients: number;
    transactions: number;
    items: number;
    debtPayments: number;
    debtPaymentItems: number;
    settlements: number;
  };
  /** Per-client balance read back from the client_debt_balances view. */
  viewBalances: Map<string, number> | null;
}

/** Deletes only what a previous CSV import wrote. App-entered data is untouched. */
async function resetImported(tx: Tx): Promise<NonNullable<WriteResult["reset"]>> {
  // transaction_items + debt_payments go with ON DELETE CASCADE.
  const delTx = await tx
    .delete(schema.transactions)
    .where(eq(schema.transactions.source, "CSV_IMPORT"))
    .returning({ id: schema.transactions.id });
  const delSettlements = await tx
    .delete(schema.ownerSettlements)
    .where(like(schema.ownerSettlements.notes, `${SETTLEMENT_NOTE_PREFIX}%`))
    .returning({ id: schema.ownerSettlements.id });
  // Clients nothing points at any more (e.g. names fixed in the sheet since last run).
  const delClients = await tx
    .delete(schema.clients)
    .where(
      and(
        notExists(
          tx.select({ x: sql`1` }).from(schema.transactions).where(eq(schema.transactions.clientId, schema.clients.id)),
        ),
        notExists(
          tx.select({ x: sql`1` }).from(schema.debtPayments).where(eq(schema.debtPayments.clientId, schema.clients.id)),
        ),
      ),
    )
    .returning({ id: schema.clients.id });
  return { transactions: delTx.length, settlements: delSettlements.length, orphanClients: delClients.length };
}

/** Thrown at the end of a rehearsal to make Postgres roll everything back. */
class Rollback extends Error {
  constructor(readonly result: WriteResult) {
    super("rollback");
  }
}

/**
 * Writes the plan in ONE Postgres transaction. With `rollback: true` it performs
 * every insert (so constraints, FKs and enums are all exercised), verifies the
 * row counts, then rolls back — a full rehearsal that leaves the DB untouched.
 */
export async function writePlan(
  plan: ImportPlan,
  opts: { reset: boolean; rollback?: boolean },
): Promise<WriteResult> {
  const { client, db } = connect();
  try {
    return await db.transaction(async (tx) => {
      // Serialize concurrent runs of this script.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('bodega:import-sheets'))`);

      let reset: WriteResult["reset"] = null;
      if (opts.reset) {
        reset = await resetImported(tx);
      } else {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.transactions)
          .where(eq(schema.transactions.source, "CSV_IMPORT"));
        if (n > 0) {
          return {
            status: "already-imported" as const,
            reset: null,
            inserted: {
              owners: 0,
              products: 0,
              clients: 0,
              transactions: 0,
              items: 0,
              debtPayments: 0,
              debtPaymentItems: 0,
              settlements: 0,
            },
            viewBalances: null,
          };
        }
      }

      /* Owners (upsert by unique name) */
      await tx
        .insert(schema.owners)
        .values(plan.owners.map((name) => ({ name })))
        .onConflictDoNothing({ target: schema.owners.name });
      const ownerRows = await tx
        .select({ id: schema.owners.id, name: schema.owners.name })
        .from(schema.owners)
        .where(inArray(schema.owners.name, plan.owners));
      const ownerId = new Map(ownerRows.map((o) => [o.name, o.id]));

      /* Products (upsert by SKU; current_stock = sheet's Stock_Actual) */
      await tx
        .insert(schema.products)
        .values(
          plan.products.map((p) => ({
            sku: p.sku,
            name: p.name,
            category: p.category,
            ownerId: ownerId.get(p.owner)!,
            unitsPerPack: p.unitsPerPack,
            packCost: centsToNumeric(p.packCostCents),
            unitCost: centsToNumeric(p.unitCostCents),
            marginPct: p.marginPct,
            salePrice: centsToNumeric(p.salePriceCents),
            currentStock: p.stockActual,
            isActive: true,
          })),
        )
        .onConflictDoUpdate({
          target: schema.products.sku,
          set: {
            name: sql`excluded.name`,
            category: sql`excluded.category`,
            ownerId: sql`excluded.owner_id`,
            unitsPerPack: sql`excluded.units_per_pack`,
            packCost: sql`excluded.pack_cost`,
            unitCost: sql`excluded.unit_cost`,
            marginPct: sql`excluded.margin_pct`,
            salePrice: sql`excluded.sale_price`,
            currentStock: sql`excluded.current_stock`,
            isActive: sql`excluded.is_active`,
            updatedAt: sql`now()`,
          },
        });
      const productRows = await tx
        .select({ id: schema.products.id, sku: schema.products.sku })
        .from(schema.products)
        .where(
          inArray(
            schema.products.sku,
            plan.products.map((p) => p.sku),
          ),
        );
      const productId = new Map(productRows.map((p) => [p.sku, p.id]));

      /* Clients (upsert by unique name) */
      if (plan.clients.length > 0) {
        await tx
          .insert(schema.clients)
          .values(plan.clients.map((name) => ({ name })))
          .onConflictDoNothing({ target: schema.clients.name });
      }
      const clientRows =
        plan.clients.length > 0
          ? await tx
              .select({ id: schema.clients.id, name: schema.clients.name })
              .from(schema.clients)
              .where(inArray(schema.clients.name, plan.clients))
          : [];
      const clientId = new Map(clientRows.map((c) => [c.name, c.id]));

      /* Transactions — multi-row inserts; RETURNING order is verified row by row. */
      const txIds: number[] = [];
      for (const batch of chunk(plan.transactions, 500)) {
        const returned = await tx
          .insert(schema.transactions)
          .values(
            batch.map((t) => ({
              legacyId: t.legacyId,
              occurredAt: t.occurredAt,
              type: t.type,
              paymentMethod: t.paymentMethod,
              clientId: t.client ? clientId.get(t.client)! : null,
              totalAmount: centsToNumeric(t.totalCents),
              notes: t.notes,
              source: "CSV_IMPORT" as const,
            })),
          )
          .returning({
            id: schema.transactions.id,
            legacyId: schema.transactions.legacyId,
            notes: schema.transactions.notes,
          });
        returned.forEach((r, i) => {
          if (r.legacyId !== batch[i].legacyId || r.notes !== batch[i].notes) {
            throw new Error("RETURNING order mismatch while inserting transactions — aborting.");
          }
          txIds.push(r.id);
        });
      }

      const items = plan.transactions.flatMap((t, i) =>
        t.items.map((it) => ({
          transactionId: txIds[i],
          productId: productId.get(it.sku)!,
          ownerId: ownerId.get(it.owner)!,
          quantityDelta: it.quantityDelta,
          unitPriceSnapshot: centsToNumeric(it.unitPriceCents),
          unitCostSnapshot: centsToNumeric(it.unitCostCents),
          lineTotal: centsToNumeric(it.lineTotalCents),
        })),
      );
      for (const batch of chunk(items, 1000)) {
        await tx.insert(schema.transactionItems).values(batch);
      }

      const debts = plan.transactions.flatMap((t, i) =>
        t.debtPayments.map((d) => ({
          plan: d,
          row: {
            transactionId: txIds[i],
            clientId: clientId.get(t.client!)!,
            ownerId: ownerId.get(d.owner)!,
            amount: centsToNumeric(d.amountCents),
            paymentMethod: d.method,
            occurredAt: t.occurredAt,
            notes: t.notes,
          },
        })),
      );
      const debtItems: (typeof schema.debtPaymentItems.$inferInsert)[] = [];
      for (const batch of chunk(debts, 500)) {
        const returned = await tx
          .insert(schema.debtPayments)
          .values(batch.map((d) => d.row))
          .returning({
            id: schema.debtPayments.id,
            transactionId: schema.debtPayments.transactionId,
            ownerId: schema.debtPayments.ownerId,
          });
        returned.forEach((r, i) => {
          const { plan: d, row } = batch[i];
          if (r.transactionId !== row.transactionId || r.ownerId !== row.ownerId) {
            throw new Error("RETURNING order mismatch while inserting debt_payments — aborting.");
          }
          for (const it of d.items) {
            debtItems.push({
              debtPaymentId: r.id,
              productId: productId.get(it.sku)!,
              quantity: it.quantity,
              unitPriceSnapshot: centsToNumeric(Math.round(it.lineTotalCents / it.quantity)),
              lineTotal: centsToNumeric(it.lineTotalCents),
            });
          }
        });
      }
      for (const batch of chunk(debtItems, 1000)) {
        await tx.insert(schema.debtPaymentItems).values(batch);
      }

      const settlementRows = plan.settlements.map((s) => ({
        ownerId: ownerId.get(s.owner)!,
        type: s.type,
        amount: centsToNumeric(s.amountCents),
        paymentMethod: s.method,
        occurredAt: s.occurredAt,
        notes: s.notes,
      }));
      for (const batch of chunk(settlementRows, 1000)) {
        await tx.insert(schema.ownerSettlements).values(batch);
      }

      // Read back what this transaction can see, so the report reflects the DB, not the plan.
      const count = async (where: ReturnType<typeof sql>) =>
        (await tx.execute<{ n: number }>(sql`select count(*)::int as n from ${where}`))[0].n;
      const imported = sql`${schema.transactions} t where t.source = 'CSV_IMPORT'`;
      const verified = {
        transactions: await count(imported),
        items: await count(
          sql`${schema.transactionItems} i join ${schema.transactions} t on t.id = i.transaction_id where t.source = 'CSV_IMPORT'`,
        ),
        debtPayments: await count(
          sql`${schema.debtPayments} d join ${schema.transactions} t on t.id = d.transaction_id where t.source = 'CSV_IMPORT'`,
        ),
        debtPaymentItems: await count(
          sql`${schema.debtPaymentItems} di join ${schema.debtPayments} d on d.id = di.debt_payment_id
              join ${schema.transactions} t on t.id = d.transaction_id where t.source = 'CSV_IMPORT'`,
        ),
        settlements: await count(
          sql`${schema.ownerSettlements} s where s.notes like ${`${SETTLEMENT_NOTE_PREFIX}%`}`,
        ),
      };
      const expected = {
        transactions: plan.transactions.length,
        items: items.length,
        debtPayments: debts.length,
        debtPaymentItems: debtItems.length,
        settlements: settlementRows.length,
      };
      for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
        if (verified[k] !== expected[k]) {
          throw new Error(`Verification failed: ${k} = ${verified[k]} in DB, expected ${expected[k]}. Rolled back.`);
        }
      }

      // Debt as the app will see it: read straight from the client_debt_balances view.
      const viewRows = await tx
        .select({
          name: schema.clients.name,
          balance: sql<string>`sum(${schema.clientDebtBalances.balance})`,
        })
        .from(schema.clientDebtBalances)
        .innerJoin(schema.clients, eq(schema.clients.id, schema.clientDebtBalances.clientId))
        .groupBy(schema.clients.name);
      const viewBalances = new Map(viewRows.map((r) => [r.name, toCents(r.balance) ?? 0]));

      const result: WriteResult = {
        status: opts.rollback ? "rolled-back" : "imported",
        reset,
        inserted: {
          owners: plan.owners.length,
          products: plan.products.length,
          clients: plan.clients.length,
          ...verified,
        },
        viewBalances,
      };
      if (opts.rollback) throw new Rollback(result);
      return result;
    });
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  } finally {
    await client.end({ timeout: 5 });
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Audit report
 * ──────────────────────────────────────────────────────────────────────────── */

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint("1");
const yellow = paint("33");
const red = paint("31");
const green = paint("32");
const dim = paint("2");

function table(headers: string[], rows: (string | number)[][], rightAlign: number[] = []): string {
  const widths = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => String(r[c]).length)));
  const fmt = (cells: (string | number)[]) =>
    "  " +
    cells
      .map((v, c) => (rightAlign.includes(c) ? String(v).padStart(widths[c]) : String(v).padEnd(widths[c])))
      .join("  ");
  return [fmt(headers), "  " + widths.map((w) => "─".repeat(w)).join("  "), ...rows.map(fmt)].join("\n");
}

export function printReport(plan: ImportPlan, result: WriteResult | null, mode: "dry-run" | "write"): void {
  const line = "═".repeat(72);
  const out: string[] = [];
  out.push("", bold(line), bold("  BodegaOS · Google Sheets → Postgres migration audit"), bold(line));

  if (mode === "dry-run") {
    out.push(yellow("  DRY RUN — nothing was written to the database."));
  } else if (result?.status === "already-imported") {
    out.push(
      yellow("  Already imported: CSV_IMPORT transactions exist, so nothing was written."),
      yellow("  Re-run with --reset to replace the previous import."),
    );
  } else if (result?.status === "rolled-back") {
    out.push(
      yellow("  REHEARSAL — every row was inserted and verified inside a transaction, then rolled back."),
      yellow("  The database is unchanged. Run without --rehearse to import for real."),
    );
  } else if (result?.reset) {
    out.push(
      dim(
        `  --reset removed ${result.reset.transactions} imported transactions, ` +
          `${result.reset.settlements} settlements, ${result.reset.orphanClients} orphan clients.`,
      ),
    );
  }

  /* Totals */
  const sum = (f: (t: PlannedTransaction) => number) => plan.transactions.reduce((a, t) => a + f(t), 0);
  const counts = {
    owners: plan.owners.length,
    products: plan.products.length,
    clients: plan.clients.length,
    transactions: plan.transactions.length,
    items: sum((t) => t.items.length),
    debtPayments: sum((t) => t.debtPayments.length),
    debtPaymentItems: sum((t) => t.debtPayments.reduce((a, d) => a + d.items.length, 0)),
    settlements: plan.settlements.length,
  };
  const written = result && result.status !== "already-imported" ? result.inserted : null;
  if (written) Object.assign(counts, written);
  const label =
    mode === "dry-run"
      ? "Would import"
      : result?.status === "rolled-back"
        ? "Verified in DB (then rolled back)"
        : written
          ? "Imported (verified in DB)"
          : "Planned";
  out.push("", bold(`  ${label}`));
  out.push(
    table(
      ["Table", "Rows"],
      [
        ["owners", counts.owners],
        ["products", counts.products],
        ["clients", counts.clients],
        ["transactions", counts.transactions],
        ["transaction_items", counts.items],
        ["debt_payments", counts.debtPayments],
        ["debt_payment_items", counts.debtPaymentItems],
        ["owner_settlements", counts.settlements],
      ],
      [1],
    ),
  );
  out.push(dim(`  Owners: ${plan.owners.join(", ")}`));
  out.push(
    dim(
      `  Source: ${plan.stats.csvRows} CSV rows, ${plan.stats.legacyIds} distinct ID_Transaccion, ` +
        `${plan.stats.skippedMarkers} "--- CICLO ---" markers skipped`,
    ),
  );

  /* Transactions by type */
  const byType = new Map<string, { n: number; cents: number }>();
  for (const t of plan.transactions) {
    const k = t.type === "SALE" ? `SALE · ${t.paymentMethod}` : t.type;
    const e = byType.get(k) ?? { n: 0, cents: 0 };
    e.n++;
    e.cents += t.totalCents;
    byType.set(k, e);
  }
  for (const s of plan.settlements) {
    const k = `SETTLEMENT · ${s.type} · ${s.method}`;
    const e = byType.get(k) ?? { n: 0, cents: 0 };
    e.n++;
    e.cents += s.amountCents;
    byType.set(k, e);
  }
  out.push("", bold("  Breakdown"));
  out.push(
    table(
      ["Kind", "Count", "Amount"],
      [...byType.entries()].map(([k, v]) => [k, v.n, formatBs(v.cents)]),
      [1, 2],
    ),
  );
  const csvTotal = Object.values(plan.stats.byOperation).reduce((a, v) => a + v.cents, 0);
  out.push(
    dim(
      `  Sum of every Monto_Operacion in the CSV: ${formatBs(csvTotal)}` +
        (plan.stats.sheetSummaryTotal ? `  (sheet's row-1 total: ${plan.stats.sheetSummaryTotal})` : ""),
    ),
  );

  /* Stock anomalies */
  const anomalies = plan.products
    .filter((p) => p.stockActual <= 0)
    .sort((a, b) => a.stockActual - b.stockActual);
  out.push("", yellow(bold("  ⚠  STOCK ANOMALY REPORT — products with Stock_Actual ≤ 0")));
  if (anomalies.length === 0) {
    out.push(green("  None. Every product has positive stock."));
  } else {
    out.push(
      table(
        ["SKU", "Product", "Owner", "Stock_Actual", "Issue"],
        anomalies.map((p) => [
          p.sku,
          p.name,
          p.owner,
          p.stockActual < 0 ? red(String(p.stockActual)) : String(p.stockActual),
          p.stockActual < 0 ? "Negative: sold more than recorded → missing restock?" : "Out of stock",
        ]),
      ),
    );
    out.push(yellow("  → Reconcile these in /inventory with a STOCK_ADJUSTMENT after a physical count."));
  }

  /* Client debt, re-priced at today's price (same formula as the
   * client_debt_balances view):
   *   Σ (units sold on Fiado − units settled by abonos) × current sale_price
   *   − cash-only abono credit (abono money not tied to units). */
  const priceBySku = new Map(plan.products.map((p) => [p.sku, p.salePriceCents]));
  const repriced = new Map<string, number>();
  const add = (client: string, cents: number) => repriced.set(client, (repriced.get(client) ?? 0) + cents);
  for (const t of plan.transactions) {
    if (!t.client) continue;
    if (t.type === "SALE" && t.paymentMethod === "FIADO") {
      t.items.forEach((i) => add(t.client!, -i.quantityDelta * (priceBySku.get(i.sku) ?? 0)));
    } else if (t.type === "DEBT_PAYMENT") {
      for (const d of t.debtPayments) {
        const itemsTotal = d.items.reduce((a, i) => a + i.lineTotalCents, 0);
        d.items.forEach((i) => add(t.client!, -i.quantity * (priceBySku.get(i.sku) ?? 0)));
        add(t.client, -(d.amountCents - itemsTotal));
      }
    }
  }

  const view = result?.viewBalances ?? null;
  const dash = plan.dashboardDebts;
  out.push("", bold("  Fiado debt per client (re-priced at today's Precio_Venta)"));
  const names = [...new Set([...repriced.keys(), ...(dash?.keys() ?? [])])].sort((a, b) => a.localeCompare(b, "es"));
  let debtMismatches = 0;
  const headers = ["Client", "Computed"];
  if (view) headers.push("DB view");
  if (dash) headers.push("dashboard.csv");
  headers.push("");
  out.push(
    table(
      headers,
      names.map((n) => {
        const computed = repriced.get(n) ?? 0;
        const row: string[] = [n, formatBs(computed)];
        let ok = true;
        if (view) {
          const v = view.get(n) ?? 0;
          row.push(formatBs(v));
          ok &&= v === computed;
        }
        let note = "";
        if (dash) {
          const sheet = dash.get(n);
          row.push(sheet === undefined ? "—" : formatBs(sheet.cents));
          if (sheet === undefined) note = dim("not on dashboard");
          else ok &&= sheet.cents === computed;
        }
        if (!ok) debtMismatches++;
        row.push(note || (ok ? green("✓") : red("✗")));
        return row;
      }),
      view && dash ? [1, 2, 3] : [1, 2],
    ),
  );
  out.push(
    debtMismatches === 0
      ? green(`  Every client reconciles exactly${view ? " (computed = DB view" + (dash ? " = dashboard.csv)" : ")") : dash ? " with dashboard.csv" : ""}.`)
      : yellow(`  ${debtMismatches} client(s) don't reconcile — review before go-live.`),
  );

  /* Owner cash / bank vs dashboard.csv "TOTALES ACTUALES"
   *   Efectivo       = cash sales + cash abonos − CASH_DEPOSIT
   *   Por Transferir = Pago Móvil sales + Pago Móvil abonos + CASH_DEPOSIT
   *                    + CAPITAL_INJECTION − PAYOUT_TRANSFER   (PROFIT_WITHDRAWAL: no effect) */
  if (plan.dashboardOwners) {
    const flows = new Map<string, { cash: number; bank: number }>();
    const f = (o: string) => {
      let e = flows.get(o);
      if (!e) flows.set(o, (e = { cash: 0, bank: 0 }));
      return e;
    };
    const credit = (o: string, method: PaymentMethod, cents: number) => {
      if (method === "CASH") f(o).cash += cents;
      else if (method === "PAGO_MOVIL") f(o).bank += cents;
    };
    for (const t of plan.transactions) {
      if (t.type === "SALE") t.items.forEach((i) => credit(i.owner, t.paymentMethod, i.lineTotalCents));
      if (t.type === "DEBT_PAYMENT") t.debtPayments.forEach((d) => credit(d.owner, d.method, d.amountCents));
    }
    for (const s of plan.settlements) {
      if (s.type === "CASH_DEPOSIT") {
        f(s.owner).cash -= s.amountCents;
        f(s.owner).bank += s.amountCents;
      } else if (s.type === "CAPITAL_INJECTION") f(s.owner).bank += s.amountCents;
      else if (s.type === "PAYOUT_TRANSFER") f(s.owner).bank -= s.amountCents;
    }
    // Split payments recorded under the larger part's method (see notes) — shift back to compare.
    for (const s of plan.splitPaymentShifts) {
      credit(s.owner, s.recordedAs, -s.cents);
      credit(s.owner, s.paidWith, s.cents);
    }
    out.push("", bold("  Owner balances vs dashboard.csv (TOTALES ACTUALES)"));
    let ownerMismatches = 0;
    out.push(
      table(
        ["Owner", "Cash", "Sheet cash", "Bank (por transferir)", "Sheet bank", ""],
        plan.owners.map((o) => {
          const c = flows.get(o) ?? { cash: 0, bank: 0 };
          const s = plan.dashboardOwners!.get(o);
          const ok = !!s && s.cashCents === c.cash && s.bankCents === c.bank;
          if (!ok) ownerMismatches++;
          return [
            o,
            formatBs(c.cash),
            s ? formatBs(s.cashCents) : "—",
            formatBs(c.bank),
            s ? formatBs(s.bankCents) : "—",
            ok ? green("✓") : red("✗"),
          ];
        }),
        [1, 2, 3, 4],
      ),
    );
    out.push(
      ownerMismatches === 0
        ? green("  Every owner's cash and bank balance reconciles exactly with the sheet.")
        : yellow(`  ${ownerMismatches} owner(s) don't reconcile — review the settlement mapping.`),
    );
  }

  /* Data-quality notes */
  if (plan.warnings.length > 0) {
    out.push("", bold(`  Data-quality notes (${plan.warnings.length})`));
    for (const w of plan.warnings) out.push(dim(`  • ${w}`));
  }

  out.push(bold(line), "");
  console.log(out.join("\n"));
}
