/**
 * Owner finance types + settlement rules shared by server and client code.
 */
import type { OwnerSettlementType } from "@/db/schema";
import type { MoneyMethod } from "@/lib/transactions/shared";

export const SETTLEMENT_TYPES = [
  "PAYOUT_TRANSFER",
  "CAPITAL_INJECTION",
  "CASH_DEPOSIT",
  "PROFIT_WITHDRAWAL",
] as const satisfies readonly OwnerSettlementType[];

/**
 * Valid payment methods per settlement type (first = default):
 * - PAYOUT_TRANSFER / PROFIT_WITHDRAWAL: by transfer (Pago Móvil).
 * - CASH_DEPOSIT: the source is register cash.
 * - CAPITAL_INJECTION: either.
 */
export const SETTLEMENT_METHODS: Record<OwnerSettlementType, readonly MoneyMethod[]> = {
  PAYOUT_TRANSFER: ["PAGO_MOVIL"],
  CAPITAL_INJECTION: ["PAGO_MOVIL", "CASH"],
  CASH_DEPOSIT: ["CASH"],
  PROFIT_WITHDRAWAL: ["PAGO_MOVIL"],
};

/** All money fields are numeric strings ("1200.00"). */
export interface OwnerSummary {
  ownerId: number;
  ownerName: string;
  /** CAPITAL_INJECTION + Σ RESTOCK line totals. */
  invested: string;
  capitalInjections: string;
  restocks: string;
  /** Cash + Pago Móvil sales + collected abonos. */
  revenue: string;
  salesCash: string;
  salesPagoMovil: string;
  abonosCash: string;
  abonosPagoMovil: string;
  /** revenue − invested (cash basis). */
  netProfit: string;
  /** netProfit / invested × 100; null when nothing invested. */
  roiPct: number | null;
  /** Σ client_debt_balances.balance for this owner. */
  pendingFiado: string;
  /** Cash sales + cash abonos − CASH_DEPOSIT. */
  cashOnHand: string;
  /** PM sales + PM abonos (all-time). */
  pagoMovilCollected: string;
  /** PM collected + CASH_DEPOSIT + CAPITAL_INJECTION − PAYOUT_TRANSFER. */
  porTransferir: string;
  paidOut: string;
  cashDeposits: string;
  withdrawals: string;
}

export interface SettlementRow {
  id: number;
  ownerId: number;
  ownerName: string;
  type: OwnerSettlementType;
  amount: string;
  method: MoneyMethod;
  occurredAt: Date;
  notes: string | null;
}
