/**
 * Ledger domain types and URL-filter parsing, shared by Server Components,
 * Server Actions and Client Components (no server-only imports here).
 */
import type { OwnerSettlementType, PaymentMethod, TransactionSource, TransactionType } from "@/db/schema";

export const TRANSACTION_TYPES = [
  "SALE",
  "DEBT_PAYMENT",
  "RESTOCK",
  "STOCK_ADJUSTMENT",
] as const satisfies readonly TransactionType[];

/**
 * Ledger row types: every transaction type plus owner money movements
 * (owner_settlements), so the ledger logs everything that moves.
 */
export const LEDGER_TYPES = [...TRANSACTION_TYPES, "SETTLEMENT"] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const PAYMENT_METHODS = ["CASH", "PAGO_MOVIL", "FIADO", "NONE"] as const satisfies readonly PaymentMethod[];

/** Methods a manual sale can use. */
export const SALE_METHODS = ["CASH", "PAGO_MOVIL", "FIADO"] as const satisfies readonly PaymentMethod[];
export type SaleMethod = (typeof SALE_METHODS)[number];

/** Methods that move real money (abonos, settlements). */
export const MONEY_METHODS = ["CASH", "PAGO_MOVIL"] as const;
export type MoneyMethod = (typeof MONEY_METHODS)[number];

export const TRANSACTION_SOURCES = [
  "WEB_AI",
  "WEB_MANUAL",
  "TELEGRAM",
  "CSV_IMPORT",
] as const satisfies readonly TransactionSource[];

export const LEDGER_STATUSES = ["all", "active", "voided"] as const;
export type LedgerStatus = (typeof LEDGER_STATUSES)[number];

export const LEDGER_PAGE_SIZE = 25;

/* ── Filters (URL search params ⇄ typed object) ──────────────────────────── */

export interface LedgerFilters {
  /** Shop-local calendar days, "YYYY-MM-DD" (inclusive). */
  from: string | null;
  to: string | null;
  type: LedgerType | null;
  method: PaymentMethod | null;
  source: TransactionSource | null;
  ownerId: number | null;
  clientId: number | null;
  status: LedgerStatus;
  /** 1-based. */
  page: number;
}

export const EMPTY_LEDGER_FILTERS: LedgerFilters = {
  from: null,
  to: null,
  type: null,
  method: null,
  source: null,
  ownerId: null,
  clientId: null,
  status: "all",
  page: 1,
};

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function oneOf<T extends string>(values: readonly T[], v: string | undefined): T | null {
  return v && (values as readonly string[]).includes(v) ? (v as T) : null;
}

function positiveInt(v: string | undefined): number | null {
  if (!v || !/^\d{1,9}$/.test(v)) return null;
  const n = Number(v);
  return n > 0 ? n : null;
}

function isoDay(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Lenient: an invalid param is ignored rather than erroring the page. */
export function parseLedgerFilters(params: RawParams): LedgerFilters {
  return {
    from: isoDay(first(params.from)),
    to: isoDay(first(params.to)),
    type: oneOf(LEDGER_TYPES, first(params.type)),
    method: oneOf(PAYMENT_METHODS, first(params.method)),
    source: oneOf(TRANSACTION_SOURCES, first(params.source)),
    ownerId: positiveInt(first(params.owner)),
    clientId: positiveInt(first(params.client)),
    status: oneOf(LEDGER_STATUSES, first(params.status)) ?? "all",
    page: positiveInt(first(params.page)) ?? 1,
  };
}

/** Inverse of parseLedgerFilters — defaults are omitted to keep URLs short. */
export function ledgerFiltersToSearch(f: LedgerFilters): string {
  const p = new URLSearchParams();
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.type) p.set("type", f.type);
  if (f.method) p.set("method", f.method);
  if (f.source) p.set("source", f.source);
  if (f.ownerId) p.set("owner", String(f.ownerId));
  if (f.clientId) p.set("client", String(f.clientId));
  if (f.status !== "all") p.set("status", f.status);
  if (f.page > 1) p.set("page", String(f.page));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasActiveLedgerFilters(f: LedgerFilters): boolean {
  return Boolean(
    f.from || f.to || f.type || f.method || f.source || f.ownerId || f.clientId || f.status !== "all",
  );
}

/* ── Rows sent to the client ─────────────────────────────────────────────── */

export interface LedgerItem {
  id: number;
  productId: number;
  sku: string;
  productName: string;
  ownerId: number;
  ownerName: string;
  quantityDelta: number;
  unitPrice: string;
  unitCost: string;
  lineTotal: string;
}

export interface LedgerDebtPaymentItem {
  sku: string;
  productName: string;
  quantity: number;
  lineTotal: string;
}

export interface LedgerDebtPayment {
  id: number;
  ownerId: number;
  ownerName: string;
  amount: string;
  method: MoneyMethod;
  items: LedgerDebtPaymentItem[];
}

export interface LedgerSettlement {
  ownerId: number;
  ownerName: string;
  type: OwnerSettlementType;
}

export interface LedgerRow {
  /** TX = transactions row; SETTLEMENT = owner_settlements row (ids are per table). */
  kind: "TX" | "SETTLEMENT";
  id: number;
  legacyId: number | null;
  occurredAt: Date;
  type: LedgerType;
  paymentMethod: PaymentMethod;
  source: TransactionSource;
  clientId: number | null;
  clientName: string | null;
  totalAmount: string;
  notes: string | null;
  isVoided: boolean;
  voidedAt: Date | null;
  voidReason: string | null;
  items: LedgerItem[];
  debtPayments: LedgerDebtPayment[];
  /** Owner money movement details (kind = SETTLEMENT only). */
  settlement: LedgerSettlement | null;
}

/** Stable key across both tables. */
export const ledgerRowKey = (r: Pick<LedgerRow, "kind" | "id">) => `${r.kind}-${r.id}`;

export interface LedgerPage {
  rows: LedgerRow[];
  total: number;
  page: number;
  pageCount: number;
}

/** Active product as offered in the manual-sale picker. */
export interface SaleProductOption {
  id: number;
  sku: string;
  name: string;
  ownerId: number;
  ownerName: string;
  salePrice: string;
  currentStock: number;
}

export interface ClientOption {
  id: number;
  name: string;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

/** "2026-11-22T14:30" (datetime-local value, browser time) → ISO string, or null. */
export function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
