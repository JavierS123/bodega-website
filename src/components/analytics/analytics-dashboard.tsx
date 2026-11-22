"use client";

import { Download, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useOptimistic, useTransition } from "react";

import { Pill, PillGroup } from "@/components/shared/filter-pills";
import { OptionSelect } from "@/components/shared/option-select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  analyticsFiltersToSearch,
  ANALYTICS_METHODS,
  DEFAULT_ANALYTICS_FILTERS,
  hasActiveSlicers,
  RANGE_PRESETS,
  type AnalyticsFilters,
  type DayWindow,
} from "@/lib/analytics/filters";
import { EXPORT_DATASETS } from "@/lib/analytics/export-datasets";
import type { AnalyticsData, AnalyticsOptions } from "@/lib/analytics/types";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

import { KpiRow } from "./kpi-row";
import { OwnerComparisonChart } from "./owner-comparison-chart";
import { PaymentDonut } from "./payment-donut";
import { RevenueProfitChart } from "./revenue-profit-chart";
import { TopProductsChart } from "./top-products-chart";
import { VelocityHeatmap } from "./velocity-heatmap";
import { WatchlistTable } from "./watchlist-table";

/**
 * The Power BI-style page: ONE slicer row above everything (synced to the URL),
 * then KPIs and visuals that all render the same slice. While the next slice
 * loads, the current render stays visible at reduced opacity (no skeleton flash).
 */
export function AnalyticsDashboard({
  data,
  filters,
  options,
  shownWindow,
  periodDays,
}: {
  data: AnalyticsData;
  filters: AnalyticsFilters;
  options: AnalyticsOptions;
  shownWindow: DayWindow;
  periodDays: number | null;
}) {
  const { t } = useI18n();
  const f = t.analytics.filters;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [current, setOptimistic] = useOptimistic(filters);

  const navigate = (next: AnalyticsFilters) =>
    startTransition(() => {
      setOptimistic(next);
      router.push(`/analytics${analyticsFiltersToSearch(next)}`, { scroll: false });
    });
  const set = <K extends keyof AnalyticsFilters>(key: K, value: AnalyticsFilters[K]) => navigate({ ...current, [key]: value });

  // Custom range starts from the window currently shown (inclusive end).
  const shownTo = shownWindow.endExclusive
    ? new Date(Date.parse(`${shownWindow.endExclusive}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    : null;
  const exportQuery = analyticsFiltersToSearch(current).replace(/^\?/, "");

  return (
    <div className="grid gap-6">
      {/* ── Slicers (one row, above everything they scope) ── */}
      <section aria-label={f.label} className="grid gap-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1">
            <span className="text-xs text-muted-foreground">{f.range}</span>
            <PillGroup label={f.range} className="rounded-lg bg-muted p-0.5" segmented>
              {RANGE_PRESETS.map((r) => (
                <Pill key={r} active={current.range === r} onClick={() => set("range", r)} segmented>
                  {f.ranges[r]}
                </Pill>
              ))}
              <Pill
                active={current.range === "custom"}
                onClick={() =>
                  navigate({ ...current, range: "custom", from: current.from ?? shownWindow.start ?? shownTo, to: current.to ?? shownTo })
                }
                segmented
              >
                {f.ranges.custom}
              </Pill>
            </PillGroup>
          </div>

          {current.range === "custom" && (
            <div className="flex items-end gap-2">
              <div className="grid gap-1">
                <Label htmlFor="a-from" className="text-xs text-muted-foreground">
                  {f.from}
                </Label>
                <Input id="a-from" type="date" className="h-8 w-38" value={current.from ?? ""} max={current.to ?? undefined} onChange={(e) => set("from", e.target.value || null)} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="a-to" className="text-xs text-muted-foreground">
                  {f.to}
                </Label>
                <Input id="a-to" type="date" className="h-8 w-38" value={current.to ?? ""} min={current.from ?? undefined} onChange={(e) => set("to", e.target.value || null)} />
              </div>
            </div>
          )}

          <div className="grid min-w-32 flex-1 gap-1 sm:max-w-44">
            <Label htmlFor="a-owner" className="text-xs text-muted-foreground">
              {f.owner}
            </Label>
            <OptionSelect id="a-owner" value={current.ownerId} onChange={(v) => set("ownerId", v)} allLabel={f.all} options={options.owners.map((o) => ({ value: o.id, label: o.name }))} />
          </div>
          <div className="grid min-w-32 flex-1 gap-1 sm:max-w-44">
            <Label htmlFor="a-method" className="text-xs text-muted-foreground">
              {f.method}
            </Label>
            <OptionSelect id="a-method" value={current.paymentMethod} onChange={(v) => set("paymentMethod", v)} allLabel={f.all} options={ANALYTICS_METHODS.map((m) => ({ value: m, label: t.enums.method[m] }))} />
          </div>
          <div className="grid min-w-32 flex-1 gap-1 sm:max-w-44">
            <Label htmlFor="a-category" className="text-xs text-muted-foreground">
              {f.category}
            </Label>
            <OptionSelect id="a-category" value={current.category} onChange={(v) => set("category", v)} allLabel={f.all} options={options.categories.map((c) => ({ value: c, label: c }))} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {hasActiveSlicers(current) && (
              <Button variant="ghost" size="sm" onClick={() => navigate(DEFAULT_ANALYTICS_FILTERS)}>
                <RotateCcw aria-hidden />
                {f.clear}
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Download aria-hidden />
                  {f.export}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{f.exportHint}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {EXPORT_DATASETS.map((d) => (
                  <DropdownMenuItem key={d} asChild>
                    <a href={`/api/analytics/export?dataset=${d}${exportQuery ? `&${exportQuery}` : ""}`} download>
                      {f.datasets[d]}
                    </a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </section>

      {/* ── Everything below renders the same slice ── */}
      <div className={cn("grid gap-6 transition-opacity", pending && "pointer-events-none opacity-60")} aria-busy={pending}>
        <KpiRow kpis={data.kpis} owners={data.owners} periodDays={periodDays} />
        <RevenueProfitChart key={`trend-${analyticsFiltersToSearch(filters)}`} series={data.series} />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <TopProductsChart products={data.products} />
          <PaymentDonut payments={data.payments} />
        </div>
        <OwnerComparisonChart owners={data.owners} />
        <VelocityHeatmap cells={data.velocity} />
        <WatchlistTable rows={data.watchlist.rows} windowDays={data.watchlist.windowDays} />
      </div>
    </div>
  );
}
