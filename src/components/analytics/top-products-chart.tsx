"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import { Pill, PillGroup } from "@/components/shared/filter-pills";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { ProductPerformance } from "@/lib/analytics/types";
import { formatCurrency } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

import { AXIS_PROPS, ChartCard, formatBsCompact, formatInt, VizTooltip } from "./viz";

type Metric = "units" | "revenue" | "profit";
const TOP_N = 10;

/**
 * Ranked horizontal bars — one series (products are nominal), so every bar
 * takes the same hue and no legend box; the title + toggle name the measure.
 */
export function TopProductsChart({ products }: { products: ProductPerformance[] }) {
  const { t } = useI18n();
  const c = t.analytics.charts.products;
  const [metric, setMetric] = useState<Metric>("units");

  const ranked = useMemo(
    () => [...products].sort((a, b) => b[metric] - a[metric]).slice(0, TOP_N),
    [products, metric],
  );
  const fmt = (v: number) => (metric === "units" ? formatInt(v) : formatCurrency(v));
  const labels: Record<Metric, string> = { units: c.units, revenue: c.revenue, profit: c.profit };
  const config = { [metric]: { label: labels[metric], color: "var(--chart-7)" } } satisfies ChartConfig;

  return (
    <ChartCard
      title={c.title}
      subtitle={interpolate(c.subtitle, { n: Math.min(TOP_N, products.length) })}
      empty={products.length === 0}
      actions={
        <PillGroup label={c.title} className="rounded-lg bg-muted p-0.5" segmented>
          {(["units", "revenue", "profit"] as const).map((m) => (
            <Pill key={m} active={metric === m} onClick={() => setMetric(m)} segmented>
              {labels[m]}
            </Pill>
          ))}
        </PillGroup>
      }
      table={{
        columns: [
          { label: c.product },
          { label: c.units, align: "right" },
          { label: c.revenue, align: "right" },
          { label: c.profit, align: "right" },
        ],
        rows: [...products]
          .sort((a, b) => b[metric] - a[metric])
          .map((p) => [p.name, formatInt(p.units), formatCurrency(p.revenue), formatCurrency(p.profit)]),
      }}
    >
      <ChartContainer config={config} className="aspect-auto w-full" style={{ height: ranked.length * 34 + 16 }}>
        <BarChart data={ranked} layout="vertical" margin={{ top: 0, right: 88, left: 0, bottom: 0 }} barCategoryGap={6}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" hide domain={[(min: number) => Math.min(0, min), "auto"]} />
          <YAxis
            type="category"
            dataKey="name"
            {...AXIS_PROPS}
            width={128}
            tickFormatter={(n: string) => (n.length > 18 ? `${n.slice(0, 17)}…` : n)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.6 }}
            content={(props) => (
              <VizTooltip
                active={props.active}
                payload={props.payload}
                label={props.label}
                valueFormat={fmt}
                names={{ [metric]: labels[metric] }}
              />
            )}
          />
          <Bar dataKey={metric} fill={`var(--color-${metric})`} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive={false}>
            <LabelList
              dataKey={metric}
              position="right"
              offset={6}
              className="fill-foreground"
              fontSize={11}
              formatter={(v: unknown) => (metric === "units" ? formatInt(Number(v)) : formatBsCompact(Number(v)))}
            />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ChartCard>
  );
}
