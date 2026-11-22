import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { AnalyticsDashboard } from "@/components/analytics/analytics-dashboard";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { KpiStripSkeleton, TableSkeleton } from "@/components/shared/kpi-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { parseAnalyticsFilters, resolvePeriod } from "@/lib/analytics/filters";
import {
  getAnalyticsOptions,
  getKpis,
  getOwnerPerformance,
  getPaymentBreakdown,
  getProductPerformance,
  getRevenueProfitSeries,
  getSalesVelocity,
  getStockWatchlist,
} from "@/lib/analytics/queries";
import { toShopDateKey } from "@/lib/format";
import { getDictionary } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "Analytics · BodegaOS",
};

export default async function AnalyticsPage({ searchParams }: PageProps<"/analytics">) {
  const t = await getDictionary();
  return (
    <PageContainer>
      <PageHeader title={t.analytics.title} description={t.analytics.subtitle} />
      {/* Slicers are URL data: read them only inside the Suspense boundary. */}
      <Suspense fallback={<AnalyticsSkeleton />}>
        <AnalyticsContent searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function AnalyticsContent({ searchParams }: { searchParams: PageProps<"/analytics">["searchParams"] }) {
  await connection(); // live data + "today" is request-time
  const filters = parseAnalyticsFilters(await searchParams);
  const today = toShopDateKey(new Date());
  const period = resolvePeriod(filters, today);

  // Independent, self-contained metric queries (see src/lib/analytics/queries.ts).
  const [kpis, owners, series, products, payments, velocity, watchlist, options] = await Promise.all([
    getKpis(filters, period),
    getOwnerPerformance(filters, period),
    getRevenueProfitSeries(filters, period),
    getProductPerformance(filters, period),
    getPaymentBreakdown(filters, period),
    getSalesVelocity(filters, period),
    getStockWatchlist(filters, period, today),
    getAnalyticsOptions(),
  ]);

  return (
    <AnalyticsDashboard
      data={{ kpis, owners, series, products, payments, velocity, watchlist }}
      filters={filters}
      options={options}
      shownWindow={period.current}
      periodDays={period.days}
    />
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <Card size="sm" className="flex-row flex-wrap gap-3 px-3">
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36" />
      </Card>
      <KpiStripSkeleton count={6} />
      <Card size="sm" className="gap-3 px-4">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-72 w-full" />
      </Card>
      <TableSkeleton rows={6} />
    </div>
  );
}
