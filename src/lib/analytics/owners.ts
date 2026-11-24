import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/db";
import { owners, ownerSettlements } from "@/db/schema";
import { centsToDecimal, toCents } from "@/lib/money";
import type { OwnerSummary, SettlementRow } from "@/lib/owners/shared";

type RawOwnerRow = {
  owner_id: number;
  owner_name: string;
  sales_cash: string;
  sales_pm: string;
  restocks: string;
  abonos_cash: string;
  abonos_pm: string;
  injections: string;
  injections_cash: string;
  payouts: string;
  deposits: string;
  withdrawals: string;
  pending_fiado: string;
}

/**
 * Per-owner investment, revenue, profit and balances, computed live from the
 * ledger. Voided transactions are excluded everywhere.
 *
 * HISTORICAL (all-time): invested, revenue (cash / Pago Móvil), net profit, ROI.
 *
 * CURRENT ("TOTALES ACTUALES" of the Google Sheet — reconciled against it):
 *   Efectivo        = cash sales + cash abonos + cash aportes − CASH_DEPOSIT        (register, to be deposited)
 *   Por Transferir  = PM sales + PM abonos + CASH_DEPOSIT + PM aportes − PAYOUT_TRANSFER  (owner's share of the shared account)
 *   Total Corriente = PAYOUT_TRANSFER − RESTOCK − PROFIT_WITHDRAWAL                 (owner's personal account; restocks are
 *                                                                                    paid by bank transfer from here; may be
 *                                                                                    negative = borrowed, repaid by sales)
 *   Pago Móvil      = Total Corriente + Por Transferir                              (all of the owner's bank money)
 */
export async function getOwnerSummaries(): Promise<OwnerSummary[]> {
  await connection();
  const rows = await db.execute<RawOwnerRow>(sql`
    with sales as (
      select ti.owner_id,
             sum(ti.line_total) filter (where t.payment_method = 'CASH') as cash,
             sum(ti.line_total) filter (where t.payment_method = 'PAGO_MOVIL') as pm
      from transaction_items ti
      join transactions t on t.id = ti.transaction_id
      where t.type = 'SALE' and not t.is_voided
      group by ti.owner_id
    ),
    restocks as (
      select ti.owner_id, sum(ti.line_total) as total
      from transaction_items ti
      join transactions t on t.id = ti.transaction_id
      where t.type = 'RESTOCK' and not t.is_voided
      group by ti.owner_id
    ),
    abonos as (
      select dp.owner_id,
             sum(dp.amount) filter (where dp.payment_method = 'CASH') as cash,
             sum(dp.amount) filter (where dp.payment_method = 'PAGO_MOVIL') as pm
      from debt_payments dp
      join transactions t on t.id = dp.transaction_id
      where not t.is_voided
      group by dp.owner_id
    ),
    settle as (
      select owner_id,
             sum(amount) filter (where type = 'CAPITAL_INJECTION') as injections,
             sum(amount) filter (where type = 'CAPITAL_INJECTION' and payment_method = 'CASH') as injections_cash,
             sum(amount) filter (where type = 'PAYOUT_TRANSFER') as payouts,
             sum(amount) filter (where type = 'CASH_DEPOSIT') as deposits,
             sum(amount) filter (where type = 'PROFIT_WITHDRAWAL') as withdrawals
      from owner_settlements
      where not is_voided
      group by owner_id
    ),
    fiado as (
      select owner_id, sum(balance) as pending
      from client_debt_balances
      group by owner_id
    )
    select o.id as owner_id, o.name as owner_name,
           coalesce(s.cash, 0)::text as sales_cash,
           coalesce(s.pm, 0)::text as sales_pm,
           coalesce(r.total, 0)::text as restocks,
           coalesce(a.cash, 0)::text as abonos_cash,
           coalesce(a.pm, 0)::text as abonos_pm,
           coalesce(st.injections, 0)::text as injections,
           coalesce(st.injections_cash, 0)::text as injections_cash,
           coalesce(st.payouts, 0)::text as payouts,
           coalesce(st.deposits, 0)::text as deposits,
           coalesce(st.withdrawals, 0)::text as withdrawals,
           coalesce(f.pending, 0)::text as pending_fiado
    from owners o
    left join sales s on s.owner_id = o.id
    left join restocks r on r.owner_id = o.id
    left join abonos a on a.owner_id = o.id
    left join settle st on st.owner_id = o.id
    left join fiado f on f.owner_id = o.id
    order by o.id
  `);

  return [...rows].map((r) => {
    const c = (v: string) => toCents(v);
    const invested = c(r.injections) + c(r.restocks);
    const revenue = c(r.sales_cash) + c(r.sales_pm) + c(r.abonos_cash) + c(r.abonos_pm);
    const net = revenue - invested;
    const cashCollected = c(r.sales_cash) + c(r.abonos_cash);
    const pmCollected = c(r.sales_pm) + c(r.abonos_pm);
    const injectionsCash = c(r.injections_cash);
    const injectionsPm = c(r.injections) - injectionsCash;
    const porTransferir = pmCollected + c(r.deposits) + injectionsPm - c(r.payouts);
    const totalCorriente = c(r.payouts) - c(r.restocks) - c(r.withdrawals);
    return {
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      invested: centsToDecimal(invested),
      capitalInjections: centsToDecimal(c(r.injections)),
      restocks: centsToDecimal(c(r.restocks)),
      revenue: centsToDecimal(revenue),
      salesCash: centsToDecimal(c(r.sales_cash)),
      salesPagoMovil: centsToDecimal(c(r.sales_pm)),
      abonosCash: centsToDecimal(c(r.abonos_cash)),
      abonosPagoMovil: centsToDecimal(c(r.abonos_pm)),
      netProfit: centsToDecimal(net),
      roiPct: invested > 0 ? (net / invested) * 100 : null,
      pendingFiado: centsToDecimal(c(r.pending_fiado)),
      cashCollected: centsToDecimal(cashCollected),
      pagoMovilCollected: centsToDecimal(pmCollected),
      cashOnHand: centsToDecimal(cashCollected + injectionsCash - c(r.deposits)),
      porTransferir: centsToDecimal(porTransferir),
      totalCorriente: centsToDecimal(totalCorriente),
      pagoMovilBalance: centsToDecimal(totalCorriente + porTransferir),
      injectionsCash: centsToDecimal(injectionsCash),
      injectionsPagoMovil: centsToDecimal(injectionsPm),
      paidOut: centsToDecimal(c(r.payouts)),
      cashDeposits: centsToDecimal(c(r.deposits)),
      withdrawals: centsToDecimal(c(r.withdrawals)),
    };
  });
}

/** Full settlement history, newest first (hundreds of rows — paginated client-side). */
export async function listSettlements(): Promise<SettlementRow[]> {
  await connection();
  return db
    .select({
      id: ownerSettlements.id,
      ownerId: ownerSettlements.ownerId,
      ownerName: owners.name,
      type: ownerSettlements.type,
      amount: ownerSettlements.amount,
      method: ownerSettlements.paymentMethod,
      occurredAt: ownerSettlements.occurredAt,
      notes: ownerSettlements.notes,
    })
    .from(ownerSettlements)
    .innerJoin(owners, eq(owners.id, ownerSettlements.ownerId))
    .where(eq(ownerSettlements.isVoided, false))
    .orderBy(desc(ownerSettlements.occurredAt), desc(ownerSettlements.id));
}
