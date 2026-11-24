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
  /** Σ client_debt_balances.balance for this owner (current). */
  pendingFiado: string;
  /** Historical: cash sales + cash abonos (all-time). */
  cashCollected: string;
  /** Historical: PM sales + PM abonos (all-time). */
  pagoMovilCollected: string;
  /** Current — register cash still to be deposited: cash collected + cash aportes − CASH_DEPOSIT. */
  cashOnHand: string;
  /** Current — owner's share of the shared bank account: PM collected + CASH_DEPOSIT + PM aportes − PAYOUT_TRANSFER. */
  porTransferir: string;
  /** Current — owner's personal account: PAYOUT_TRANSFER − RESTOCK − PROFIT_WITHDRAWAL (may be negative). */
  totalCorriente: string;
  /** Current — all of the owner's bank money: totalCorriente + porTransferir. */
  pagoMovilBalance: string;
  injectionsCash: string;
  injectionsPagoMovil: string;
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
