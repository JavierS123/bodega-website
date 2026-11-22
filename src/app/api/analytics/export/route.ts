import { checkRateLimit, clientIp } from "@/lib/ai/rate-limit";
import { toCsv, type CsvCell } from "@/lib/analytics/csv";
import { EXPORT_DATASETS, type ExportDataset } from "@/lib/analytics/export-datasets";
import { parseAnalyticsFilters, resolvePeriod } from "@/lib/analytics/filters";
import {
  getOwnerPerformance,
  getPaymentBreakdown,
  getProductPerformance,
  getRevenueProfitSeries,
  getSaleLines,
  getSalesVelocity,
  getStockWatchlist,
} from "@/lib/analytics/queries";
import { toShopDateKey } from "@/lib/format";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * GET /api/analytics/export?dataset=<name>&<the page's slicers>
 *
 * Downloads exactly the slice the /analytics page shows (same parser, same
 * queries). Read-only and public like the page itself; lightly rate-limited.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const dataset = url.searchParams.get("dataset") as ExportDataset | null;
  if (!dataset || !(EXPORT_DATASETS as readonly string[]).includes(dataset)) {
    return Response.json({ error: "Unknown dataset", datasets: EXPORT_DATASETS }, { status: 400 });
  }
  const limit = checkRateLimit(`export:${clientIp(request.headers)}`, 60);
  if (!limit.ok) {
    return Response.json({ error: "Too many exports" }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } });
  }

  const f = parseAnalyticsFilters(Object.fromEntries(url.searchParams));
  const today = toShopDateKey(new Date());
  const period = resolvePeriod(f, today);

  let headers: string[];
  let rows: CsvCell[][];
  switch (dataset) {
    case "sales": {
      headers = ["occurred_at", "transaction_id", "sku", "product", "category", "owner", "payment_method", "client", "source", "units", "unit_price", "unit_cost", "revenue", "cost", "gross_profit"];
      rows = (await getSaleLines(f, period)).map((r) => [
        r.occurred_at, r.transaction_id, r.sku, r.product, r.category, r.owner, r.payment_method, r.client, r.source,
        Number(r.units), Number(r.unit_price), Number(r.unit_cost), Number(r.revenue), Number(r.cost), Number(r.profit),
      ]);
      break;
    }
    case "daily": {
      headers = ["day", "revenue", "gross_profit", "units"];
      rows = (await getRevenueProfitSeries(f, period)).map((p) => [p.day, p.revenue, p.profit, p.units]);
      break;
    }
    case "products": {
      headers = ["sku", "product", "owner", "units", "revenue", "gross_profit"];
      rows = (await getProductPerformance(f, period)).map((p) => [p.sku, p.name, p.ownerName, p.units, p.revenue, p.profit]);
      break;
    }
    case "owners": {
      headers = ["owner", "invested", "revenue", "profit", "roi_pct"];
      rows = (await getOwnerPerformance(f, period)).map((o) => [o.ownerName, o.invested, o.revenue, o.profit, o.roiPct]);
      break;
    }
    case "payments": {
      headers = ["payment_method", "sales", "revenue"];
      rows = (await getPaymentBreakdown(f, period)).map((p) => [p.method, p.count, p.revenue]);
      break;
    }
    case "velocity": {
      headers = ["weekday", "hour", "sales", "units", "revenue"];
      rows = (await getSalesVelocity(f, period))
        .sort((a, b) => a.dow - b.dow || a.hour - b.hour)
        .map((c) => [DAYS[c.dow], c.hour, c.count, c.units, c.revenue]);
      break;
    }
    case "watchlist": {
      const w = await getStockWatchlist(f, period, today);
      headers = ["sku", "product", "owner", "stock", "low_stock_threshold", `sold_last_${w.windowDays}d`, "avg_daily", "days_left", "status"];
      rows = w.rows.map((r) => [r.sku, r.name, r.ownerName, r.stock, r.threshold, r.sold, r.avgDaily, r.daysLeft, r.status]);
      break;
    }
  }

  const span = period.current.start ? `${period.current.start}_to_${today < (period.current.endExclusive ?? today) ? today : period.current.endExclusive}` : "all-time";
  const filename = `bodega-${dataset}-${span}.csv`;
  // BOM so Excel opens UTF-8 (ñ, á) correctly.
  return new Response(`﻿${toCsv(headers, rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
