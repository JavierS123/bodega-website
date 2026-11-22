import "server-only";

import { sql } from "drizzle-orm";

import type { Database } from "@/db";

/** A Drizzle client or an open transaction. */
type Executor = Pick<Database, "execute">;

export type OutstandingUnitRow = {
  client_id: number;
  owner_id: number;
  product_id: number;
  sku: string;
  product_name: string;
  qty: number;
  price: string;
  value: string;
  /** Earliest non-voided Fiado sale of this product to this client (allocation order). */
  first_fiado_at: string | Date | null;
}

/**
 * Units of Fiado debt still owed, per (client, owner, product), at today's
 * sale price. Same unit math as the `client_debt_balances` view (Fiado units
 * sold − units settled by abonos; voided transactions excluded). Rows with
 * zero units are omitted.
 */
export async function getOutstandingUnits(
  executor: Executor,
  scope: { clientId?: number; ownerId?: number } = {},
): Promise<OutstandingUnitRow[]> {
  const clientFilter = scope.clientId ? sql`and m.client_id = ${scope.clientId}` : sql``;
  const ownerFilter = scope.ownerId ? sql`and m.owner_id = ${scope.ownerId}` : sql``;

  const rows = await executor.execute<OutstandingUnitRow>(sql`
    with moves as (
      select t.client_id, ti.owner_id, ti.product_id, -ti.quantity_delta as units, t.occurred_at as fiado_at
      from transaction_items ti
      join transactions t on t.id = ti.transaction_id
      where t.type = 'SALE' and t.payment_method = 'FIADO'
        and not t.is_voided and t.client_id is not null
      union all
      select dp.client_id, dp.owner_id, dpi.product_id, -dpi.quantity, null
      from debt_payment_items dpi
      join debt_payments dp on dp.id = dpi.debt_payment_id
      join transactions t on t.id = dp.transaction_id
      where not t.is_voided
    )
    select m.client_id, m.owner_id, m.product_id, p.sku, p.name as product_name,
           sum(m.units)::int as qty,
           p.sale_price::text as price,
           (sum(m.units) * p.sale_price)::numeric(12, 2)::text as value,
           min(m.fiado_at) as first_fiado_at
    from moves m
    join products p on p.id = m.product_id
    where true ${clientFilter} ${ownerFilter}
    group by m.client_id, m.owner_id, m.product_id, p.sku, p.name, p.sale_price
    having sum(m.units) <> 0
    order by min(m.fiado_at) asc nulls last, m.product_id asc
  `);
  return [...rows];
}
