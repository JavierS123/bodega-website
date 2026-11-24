import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { SHOP_TIME_ZONE } from "@/lib/format";

import { addDays, type AnalyticsFilters, type DayWindow, type ResolvedPeriod } from "./filters";
import type {
  AnalyticsOptions,
  KpiSummary,
  OwnerPerformance,
  PaymentSlice,
  ProductPerformance,
  SeriesPoint,
  VelocityCell,
  WatchlistRow,
} from "./types";

/**
 * Analytics SQL — one self-contained function per metric.
 *
 * To add a metric: write `getX(f, period)` here (reuse `saleLines` / `inWindow`),
 * add its type to ./types.ts, call it from the page and drop a chart on it.
 *
 * Rules every query follows:
 *  - voided transactions are always excluded (`not t.is_voided`);
 *  - days are shop-local (America/Caracas);
 *  - each function documents which slicers it honors.
 */

const TZ = SHOP_TIME_ZONE;
const dayStart = (day: string) => sql`((${day})::date)::timestamp at time zone ${TZ}`;
const localDay = (col: SQL) => sql`(${col} at time zone ${TZ})::date`;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** `col` inside a day window (unbounded sides are skipped). */
function inWindow(col: SQL, w: DayWindow): SQL {
  return sql.join(
    [
      sql`true`,
      ...(w.start ? [sql`${col} >= ${dayStart(w.start)}`] : []),
      ...(w.endExclusive ? [sql`${col} < ${dayStart(w.endExclusive)}`] : []),
    ],
    sql` and `,
  );
}

interface SaleSlicers {
  owner?: boolean;
  method?: boolean;
  category?: boolean;
}

/**
 * The shared base for every sales metric: non-voided SALE line items
 * (aliases t = transactions, ti = transaction_items, p = products) inside a
 * window, with the requested slicers applied. Exposes per line:
 * revenue (line_total), units, cost and profit.
 */
function saleLines(f: AnalyticsFilters, w: DayWindow, use: SaleSlicers = { owner: true, method: true, category: true }): SQL {
  const conds: SQL[] = [sql`t.type = 'SALE'`, sql`not t.is_voided`, inWindow(sql`t.occurred_at`, w)];
  if (use.owner && f.ownerId) conds.push(sql`ti.owner_id = ${f.ownerId}`);
  if (use.method && f.paymentMethod) conds.push(sql`t.payment_method = ${f.paymentMethod}`);
  if (use.category && f.category) conds.push(sql`p.category = ${f.category}`);
  return sql`(
    select t.id as tx_id, t.occurred_at, t.payment_method, t.client_id, t.source,
           ti.product_id, ti.owner_id, p.sku, p.name, p.category,
           (-ti.quantity_delta) as units,
           ti.unit_price_snapshot as unit_price,
           ti.unit_cost_snapshot as unit_cost,
           ti.line_total as revenue,
           ((-ti.quantity_delta) * ti.unit_cost_snapshot) as cost,
           (ti.line_total - (-ti.quantity_delta) * ti.unit_cost_snapshot) as profit
    from transaction_items ti
    join transactions t on t.id = ti.transaction_id
    join products p on p.id = ti.product_id
    where ${sql.join(conds, sql` and `)}
  )`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * KPIs — honors: range (+ previous period), owner, method, category.
 * Pending Fiado is a current snapshot: honors owner only.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function getKpis(f: AnalyticsFilters, period: ResolvedPeriod): Promise<KpiSummary> {
  const agg = async (w: DayWindow) => {
    const [r] = await db.execute<{ revenue: string; profit: string; units: string; sales: number }>(sql`
      select coalesce(sum(revenue), 0) as revenue, coalesce(sum(profit), 0) as profit,
             coalesce(sum(units), 0) as units, count(distinct tx_id)::int as sales
      from ${saleLines(f, w)} s`);
    return { revenue: num(r.revenue), profit: num(r.profit), units: num(r.units), sales: r.sales };
  };
  const cur = await agg(period.current);
  const prev = period.previous ? await agg(period.previous) : null;
  const [fiado] = await db.execute<{ pending: string }>(sql`
    select coalesce(sum(balance), 0) as pending from client_debt_balances
    where ${f.ownerId ? sql`owner_id = ${f.ownerId}` : sql`true`}`);

  const margin = (p: number, r: number) => (r > 0 ? (p / r) * 100 : null);
  return {
    revenue: cur.revenue,
    prevRevenue: prev?.revenue ?? null,
    grossProfit: cur.profit,
    prevGrossProfit: prev?.profit ?? null,
    marginPct: margin(cur.profit, cur.revenue),
    prevMarginPct: prev ? margin(prev.profit, prev.revenue) : null,
    units: cur.units,
    prevUnits: prev?.units ?? null,
    saleCount: cur.sales,
    pendingFiado: num(fiado?.pending),
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Owner performance (cash basis, same definitions as /owners) — honors: range, owner.
 * Method / category don't apply: capital injections have neither.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function getOwnerPerformance(f: AnalyticsFilters, period: ResolvedPeriod): Promise<OwnerPerformance[]> {
  const w = period.current;
  const rows = await db.execute<{
    owner_id: number;
    owner_name: string;
    sales: string;
    abonos: string;
    restocks: string;
    injections: string;
  }>(sql`
    with sales as (
      select ti.owner_id, sum(ti.line_total) v
      from transaction_items ti join transactions t on t.id = ti.transaction_id
      where t.type = 'SALE' and t.payment_method in ('CASH', 'PAGO_MOVIL') and not t.is_voided
        and ${inWindow(sql`t.occurred_at`, w)}
      group by ti.owner_id
    ), abonos as (
      select dp.owner_id, sum(dp.amount) v
      from debt_payments dp join transactions t on t.id = dp.transaction_id
      where not t.is_voided and ${inWindow(sql`t.occurred_at`, w)}
      group by dp.owner_id
    ), restocks as (
      select ti.owner_id, sum(ti.line_total) v
      from transaction_items ti join transactions t on t.id = ti.transaction_id
      where t.type = 'RESTOCK' and not t.is_voided and ${inWindow(sql`t.occurred_at`, w)}
      group by ti.owner_id
    ), injections as (
      select owner_id, sum(amount) v from owner_settlements s
      where s.type = 'CAPITAL_INJECTION' and not s.is_voided and ${inWindow(sql`s.occurred_at`, w)}
      group by owner_id
    )
    select o.id as owner_id, o.name as owner_name,
           coalesce(sa.v, 0) as sales, coalesce(ab.v, 0) as abonos,
           coalesce(re.v, 0) as restocks, coalesce(inj.v, 0) as injections
    from owners o
    left join sales sa on sa.owner_id = o.id
    left join abonos ab on ab.owner_id = o.id
    left join restocks re on re.owner_id = o.id
    left join injections inj on inj.owner_id = o.id
    where ${f.ownerId ? sql`o.id = ${f.ownerId}` : sql`true`}
    order by o.id`);

  return [...rows].map((r) => {
    const invested = num(r.restocks) + num(r.injections);
    const revenue = num(r.sales) + num(r.abonos);
    const profit = revenue - invested;
    return {
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      invested,
      revenue,
      profit,
      roiPct: invested > 0 ? (profit / invested) * 100 : null,
    };
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * Revenue & gross profit per day (zero-filled) — honors: range, owner, method, category.
 * "all" spans first sale day → today.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function getRevenueProfitSeries(f: AnalyticsFilters, period: ResolvedPeriod): Promise<SeriesPoint[]> {
  const w = period.current;
  const rows = await db.execute<{ day: string; revenue: string; profit: string; units: string }>(sql`
    with bounds as (
      select coalesce(${w.start}::date, (select min(${localDay(sql`occurred_at`)}) from transactions where type = 'SALE' and not is_voided)) as s,
             coalesce((${w.endExclusive}::date - 1), (now() at time zone ${TZ})::date) as e
    ), days as (
      select generate_series(b.s, b.e, interval '1 day')::date as d from bounds b where b.s is not null
    ), agg as (
      select ${localDay(sql`occurred_at`)} as d, sum(revenue) revenue, sum(profit) profit, sum(units) units
      from ${saleLines(f, w)} s group by 1
    )
    select to_char(days.d, 'YYYY-MM-DD') as day,
           coalesce(agg.revenue, 0) as revenue, coalesce(agg.profit, 0) as profit, coalesce(agg.units, 0) as units
    from days left join agg on agg.d = days.d
    order by days.d`);
  return [...rows].map((r) => ({ day: r.day, revenue: num(r.revenue), profit: num(r.profit), units: num(r.units) }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Product performance (all products that sold) — honors: range, owner, method, category.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function getProductPerformance(f: AnalyticsFilters, period: ResolvedPeriod): Promise<ProductPerformance[]> {
  const rows = await db.execute<{
    product_id: number;
    sku: string;
    name: string;
    owner_id: number;
    owner_name: string;
    units: string;
    revenue: string;
    profit: string;
  }>(sql`
    select s.product_id, s.sku, s.name, p.owner_id, o.name as owner_name,
           sum(s.units) as units, sum(s.revenue) as revenue, sum(s.profit) as profit
    from ${saleLines(f, period.current)} s
    join products p on p.id = s.product_id
    join owners o on o.id = p.owner_id
    group by s.product_id, s.sku, s.name, p.owner_id, o.name
    order by sum(s.revenue) desc`);
  return [...rows].map((r) => ({
    productId: r.product_id,
    sku: r.sku,
    name: r.name,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    units: num(r.units),
    revenue: num(r.revenue),
    profit: num(r.profit),
  }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Payment-method split — honors: range, owner, category (NOT method: it IS the breakdown).
 * ──────────────────────────────────────────────────────────────────────────── */
export async function getPaymentBreakdown(f: AnalyticsFilters, period: ResolvedPeriod): Promise<PaymentSlice[]> {
  const rows = await db.execute<{ method: PaymentSlice["method"]; revenue: string; count: number }>(sql`
    select payment_method::text as method, sum(revenue) as revenue, count(distinct tx_id)::int as count
    from ${saleLines(f, period.current, { owner: true, category: true })} s
    group by payment_method`);
  return [...rows].map((r) => ({ method: r.method, revenue: num(r.revenue), count: r.count }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Sales velocity by weekday × hour (shop-local) — honors: range, owner, method, category.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function getSalesVelocity(f: AnalyticsFilters, period: ResolvedPeriod): Promise<VelocityCell[]> {
  const rows = await db.execute<{ dow: number; hour: number; units: string; revenue: string; count: number }>(sql`
    select (extract(isodow from occurred_at at time zone ${TZ})::int - 1) as dow,
           extract(hour from occurred_at at time zone ${TZ})::int as hour,
           sum(units) as units, sum(revenue) as revenue, count(distinct tx_id)::int as count
    from ${saleLines(f, period.current)} s
    group by 1, 2`);
  return [...rows].map((r) => ({ dow: r.dow, hour: r.hour, units: num(r.units), revenue: num(r.revenue), count: r.count }));
}

/* ────────────────────────────────────────────────────────────────────────────
 * Restock & stockout watchlist — honors: owner, category.
 * Sell-through uses a trailing window ending today (the selected range length,
 * clamped to 7–90 days; 30 for "all"), so the forecast reflects recent demand.
 * ──────────────────────────────────────────────────────────────────────────── */
export async function getStockWatchlist(
  f: AnalyticsFilters,
  period: ResolvedPeriod,
  today: string,
): Promise<{ rows: WatchlistRow[]; windowDays: number }> {
  const windowDays = Math.min(90, Math.max(7, period.days ?? 30));
  const w: DayWindow = { start: addDays(today, 1 - windowDays), endExclusive: addDays(today, 1) };
  const rows = await db.execute<{
    product_id: number;
    sku: string;
    name: string;
    owner_id: number;
    owner_name: string;
    stock: number;
    threshold: number;
    sold: string;
  }>(sql`
    select p.id as product_id, p.sku, p.name, p.owner_id, o.name as owner_name,
           p.current_stock as stock, p.low_stock_threshold as threshold,
           coalesce(s.sold, 0) as sold
    from products p
    join owners o on o.id = p.owner_id
    left join (
      select product_id, sum(units) as sold
      from ${saleLines(f, w, { owner: false, method: false, category: false })} x
      group by product_id
    ) s on s.product_id = p.id
    where p.is_active
      and ${f.ownerId ? sql`p.owner_id = ${f.ownerId}` : sql`true`}
      and ${f.category ? sql`p.category = ${f.category}` : sql`true`}`);

  const out: WatchlistRow[] = [];
  for (const r of rows) {
    const sold = num(r.sold);
    const avgDaily = sold / windowDays;
    const daysLeft = avgDaily > 0 ? Math.max(0, r.stock) / avgDaily : null;
    const status: WatchlistRow["status"] | null =
      r.stock <= 0
        ? "OUT"
        : daysLeft !== null && daysLeft <= 3
          ? "CRITICAL"
          : r.stock <= r.threshold
            ? "LOW"
            : daysLeft !== null && daysLeft <= 14
              ? "WATCH"
              : null;
    if (!status) continue;
    out.push({
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      stock: r.stock,
      threshold: r.threshold,
      sold,
      avgDaily,
      daysLeft,
      status,
    });
  }
  const rank = { OUT: 0, CRITICAL: 1, LOW: 2, WATCH: 3 } as const;
  out.sort((a, b) => rank[a.status] - rank[b.status] || (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) || a.stock - b.stock);
  return { rows: out, windowDays };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Line-level sales for CSV export — honors: range, owner, method, category.
 * ──────────────────────────────────────────────────────────────────────────── */
export type SaleLineRow = {
  occurred_at: string;
  transaction_id: number;
  sku: string;
  product: string;
  category: string | null;
  owner: string;
  payment_method: string;
  client: string | null;
  source: string;
  units: string;
  unit_price: string;
  unit_cost: string;
  revenue: string;
  cost: string;
  profit: string;
}

export async function getSaleLines(f: AnalyticsFilters, period: ResolvedPeriod, limit = 50_000): Promise<SaleLineRow[]> {
  const rows = await db.execute<SaleLineRow>(sql`
    select to_char(s.occurred_at at time zone ${TZ}, 'YYYY-MM-DD HH24:MI') as occurred_at,
           s.tx_id as transaction_id, s.sku, s.name as product, s.category, o.name as owner,
           s.payment_method::text as payment_method, c.name as client, s.source::text as source,
           s.units::text as units, s.unit_price::text as unit_price, s.unit_cost::text as unit_cost,
           s.revenue::text as revenue, s.cost::numeric(14, 2)::text as cost, s.profit::numeric(14, 2)::text as profit
    from ${saleLines(f, period.current)} s
    join owners o on o.id = s.owner_id
    left join clients c on c.id = s.client_id
    order by s.occurred_at desc, s.tx_id desc
    limit ${limit}`);
  return [...rows];
}

/* ── Filter options ───────────────────────────────────────────────────────── */
export async function getAnalyticsOptions(): Promise<AnalyticsOptions> {
  const owners = await db.execute<{ id: number; name: string }>(sql`select id, name from owners order by id`);
  const cats = await db.execute<{ category: string }>(
    sql`select distinct category from products where category is not null order by category`,
  );
  return { owners: [...owners], categories: [...cats].map((c) => c.category) };
}
