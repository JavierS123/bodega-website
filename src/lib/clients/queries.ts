import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/db";
import { clientDebtBalances, clients, owners } from "@/db/schema";
import { centsToDecimal, toCents } from "@/lib/money";
import type { ClientOption, MoneyMethod } from "@/lib/transactions/shared";

import { getOutstandingUnits } from "./debt";
import {
  isSettled,
  type ClientDebtSummary,
  type ClientHistoryEntry,
  type ClientOwnerDebt,
  type ClientsKpis,
  type OpenDebt,
} from "./shared";

/** Recent Fiado sales / abonos kept per client for the expandable history. */
const HISTORY_PER_CLIENT = 25;

export async function listClientOptions(): Promise<ClientOption[]> {
  await connection();
  return db.select({ id: clients.id, name: clients.name }).from(clients).orderBy(asc(clients.name));
}

type HistoryRow = {
  client_id: number;
  transaction_id: number;
  occurred_at: string | Date;
  type: "SALE" | "DEBT_PAYMENT";
  payment_method: string;
  amount: string;
  summary: string | null;
  is_voided: boolean;
}

type ActivityRow = {
  client_id: number;
  last_at: string | Date | null;
}

/**
 * Every client with their debt per owner (balance + outstanding units at
 * today's price), last activity and recent Fiado/Abono history, ranked by
 * total pending debt (desc). Client count is small (tens), so the page gets
 * everything in one pass and expands rows without extra requests.
 */
export async function listClientsWithDebt(): Promise<ClientDebtSummary[]> {
  await connection();

  // Sequential on purpose: one pooled connection per lambda in production.
  const clientRows = await db
    .select({ id: clients.id, name: clients.name, phone: clients.phone, notes: clients.notes })
    .from(clients);

  const balances = await db
    .select({
      clientId: clientDebtBalances.clientId,
      ownerId: clientDebtBalances.ownerId,
      ownerName: owners.name,
      balance: clientDebtBalances.balance,
      unitsValue: clientDebtBalances.unitsValue,
      cashCredit: clientDebtBalances.cashCredit,
    })
    .from(clientDebtBalances)
    .innerJoin(owners, eq(owners.id, clientDebtBalances.ownerId))
    .orderBy(asc(owners.id));

  const units = await getOutstandingUnits(db);

  const activity = await db.execute<ActivityRow>(sql`
    select client_id, max(occurred_at) as last_at
    from transactions
    where client_id is not null and not is_voided
    group by client_id
  `);

  const history = await db.execute<HistoryRow>(sql`
    with ranked as (
      select t.id, t.client_id, t.occurred_at, t.type, t.payment_method, t.total_amount, t.is_voided,
             row_number() over (partition by t.client_id order by t.occurred_at desc, t.id desc) as rn
      from transactions t
      where t.client_id is not null
        and ((t.type = 'SALE' and t.payment_method = 'FIADO') or t.type = 'DEBT_PAYMENT')
    )
    select r.client_id, r.id as transaction_id, r.occurred_at, r.type, r.payment_method::text,
           r.total_amount::text as amount, r.is_voided,
           case when r.type = 'SALE' then (
             select string_agg((-ti.quantity_delta) || ' × ' || p.name, ', ' order by ti.id)
             from transaction_items ti join products p on p.id = ti.product_id
             where ti.transaction_id = r.id
           ) else (
             select string_agg(o.name || ' ' || to_char(dp.amount, 'FM999G999G990D00'), ', ' order by dp.id)
             from debt_payments dp join owners o on o.id = dp.owner_id
             where dp.transaction_id = r.id
           ) end as summary
    from ranked r
    where r.rn <= ${HISTORY_PER_CLIENT}
    order by r.client_id, r.occurred_at desc, r.id desc
  `);

  /* ── Assemble ── */
  const ownerDebts = new Map<number, Map<number, ClientOwnerDebt>>();
  const ownerDebt = (clientId: number, ownerId: number, ownerName: string) => {
    let byOwner = ownerDebts.get(clientId);
    if (!byOwner) ownerDebts.set(clientId, (byOwner = new Map()));
    let d = byOwner.get(ownerId);
    if (!d) {
      d = { ownerId, ownerName, balance: "0.00", unitsValue: "0.00", cashCredit: "0.00", units: [] };
      byOwner.set(ownerId, d);
    }
    return d;
  };

  for (const b of balances) {
    Object.assign(ownerDebt(b.clientId, b.ownerId, b.ownerName), {
      balance: b.balance,
      unitsValue: b.unitsValue,
      cashCredit: b.cashCredit,
    });
  }
  for (const u of units) {
    const d = ownerDebts.get(u.client_id)?.get(u.owner_id);
    // Every unit row has a matching balance row (same source data as the view).
    d?.units.push({
      productId: u.product_id,
      sku: u.sku,
      productName: u.product_name,
      qty: u.qty,
      price: u.price,
      value: u.value,
    });
  }

  const lastActivity = new Map([...activity].map((a) => [a.client_id, a.last_at ? new Date(a.last_at) : null]));
  const historyBy = new Map<number, ClientHistoryEntry[]>();
  for (const h of history) {
    const list = historyBy.get(h.client_id) ?? [];
    list.push({
      transactionId: h.transaction_id,
      occurredAt: new Date(h.occurred_at),
      kind: h.type === "SALE" ? "FIADO" : "ABONO",
      amount: h.amount,
      method: h.type === "DEBT_PAYMENT" ? (h.payment_method as MoneyMethod) : null,
      summary: h.summary ?? "",
      isVoided: h.is_voided,
    });
    historyBy.set(h.client_id, list);
  }

  const result: ClientDebtSummary[] = clientRows.map((c) => {
    const owed = [...(ownerDebts.get(c.id)?.values() ?? [])].filter(
      (d) => !isSettled(d.balance) || d.units.length > 0,
    );
    const totalCents = owed.reduce((sum, d) => sum + toCents(d.balance), 0);
    return {
      ...c,
      totalPending: centsToDecimal(totalCents),
      owners: owed.sort((a, b) => toCents(b.balance) - toCents(a.balance)),
      lastActivity: lastActivity.get(c.id) ?? null,
      history: historyBy.get(c.id) ?? [],
    };
  });

  return result.sort(
    (a, b) => toCents(b.totalPending) - toCents(a.totalPending) || a.name.localeCompare(b.name, "es"),
  );
}

/**
 * Every non-zero (client, owner) debt with its owed units in allocation order
 * (oldest Fiado first). Light: no history. Used by the AI Cashier card to
 * preview abonos exactly as allocateAbono() will settle them.
 */
export async function listOpenDebts(): Promise<OpenDebt[]> {
  await connection();
  const balances = await db
    .select({
      clientId: clientDebtBalances.clientId,
      ownerId: clientDebtBalances.ownerId,
      ownerName: owners.name,
      balance: clientDebtBalances.balance,
      unitsValue: clientDebtBalances.unitsValue,
      cashCredit: clientDebtBalances.cashCredit,
    })
    .from(clientDebtBalances)
    .innerJoin(owners, eq(owners.id, clientDebtBalances.ownerId));
  const units = await getOutstandingUnits(db);

  return balances
    .map((b) => ({
      ...b,
      units: units
        .filter((u) => u.client_id === b.clientId && u.owner_id === b.ownerId)
        .map((u) => ({ productId: u.product_id, sku: u.sku, productName: u.product_name, qty: u.qty, price: u.price, value: u.value })),
    }))
    .filter((d) => !isSettled(d.balance) || d.units.length > 0);
}

/** KPI strip for /clients (derived from the list + one query for recent abonos). */
export async function getClientsKpis(list: ClientDebtSummary[]): Promise<ClientsKpis> {
  await connection();
  const [recent] = await db.execute<{ total: string; n: number }>(sql`
    select coalesce(sum(dp.amount), 0)::numeric(14, 2)::text as total, count(*)::int as n
    from debt_payments dp
    join transactions t on t.id = dp.transaction_id
    where not t.is_voided and dp.occurred_at >= now() - interval '30 days'
  `);

  const debtors = list.filter((c) => toCents(c.totalPending) > 0);
  const totalCents = debtors.reduce((sum, c) => sum + toCents(c.totalPending), 0);
  const top = debtors[0];
  return {
    totalPending: centsToDecimal(totalCents),
    debtorCount: debtors.length,
    clientCount: list.length,
    largest: top ? { name: top.name, amount: top.totalPending } : null,
    collected30: recent?.total ?? "0.00",
    collected30Count: recent?.n ?? 0,
  };
}
