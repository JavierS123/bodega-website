/**
 * Clients & Fiado types shared by server and client code.
 * Debt is tracked in UNITS and re-priced at today's sale price (see the
 * `client_debt_balances` view in src/db/schema.ts).
 */
import type { MoneyMethod } from "@/lib/transactions/shared";

export interface OutstandingUnit {
  productId: number;
  sku: string;
  productName: string;
  /** Units still owed (can be negative if over-settled — shown as credit). */
  qty: number;
  /** Today's sale price. */
  price: string;
  /** qty × price. */
  value: string;
}

export interface ClientOwnerDebt {
  ownerId: number;
  ownerName: string;
  /** units value − cash credit. */
  balance: string;
  unitsValue: string;
  cashCredit: string;
  units: OutstandingUnit[];
}

export interface ClientHistoryEntry {
  transactionId: number;
  occurredAt: Date;
  kind: "FIADO" | "ABONO";
  amount: string;
  /** ABONO only. */
  method: MoneyMethod | null;
  /** FIADO: "2 × Coca-Cola, 1 × Oreo"; ABONO: owner names. */
  summary: string;
  isVoided: boolean;
}

export interface ClientDebtSummary {
  id: number;
  name: string;
  phone: string | null;
  notes: string | null;
  /** Σ balance over owners (numeric string). */
  totalPending: string;
  owners: ClientOwnerDebt[];
  lastActivity: Date | null;
  history: ClientHistoryEntry[];
}

export interface ClientsKpis {
  totalPending: string;
  debtorCount: number;
  clientCount: number;
  largest: { name: string; amount: string } | null;
  collected30: string;
  collected30Count: number;
}

/** Balances at or below half a cent are treated as settled. */
export function isSettled(balance: string | number): boolean {
  return Math.abs(Number(balance)) < 0.005;
}
