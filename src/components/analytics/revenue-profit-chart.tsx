"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Pill, PillGroup } from "@/components/shared/filter-pills";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { SeriesPoint } from "@/lib/analytics/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

import { AXIS_PROPS, ChartCard, formatBsCompact, formatDayKey, VizTooltip } from "./viz";

type Grain = "daily" | "weekly";

/** Monday of the ISO week for a day key. */
function weekStart(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

/** Revenue vs gross profit over time — one Bs. axis (same unit, no dual axis). */
export function RevenueProfitChart({ series }: { series: SeriesPoint[] }) {
  const { t, locale } = useI18n();
  const c = t.analytics.charts;
  // Long ranges default to weekly so ~90 daily points don't turn into noise.
  const [grain, setGrain] = useState<Grain>(series.length > 45 ? "weekly" : "daily");

  const data = useMemo(() => {
    if (grain === "daily") return series;
    const weeks = new Map<string, SeriesPoint>();
    for (const p of series) {
      const key = weekStart(p.day);
      const w = weeks.get(key) ?? { day: key, revenue: 0, profit: 0, units: 0 };
      w.revenue += p.revenue;
      w.profit += p.profit;
      w.units += p.units;
      weeks.set(key, w);
    }
    return [...weeks.values()];
  }, [series, grain]);

  const config = {
    revenue: { label: c.revenue, color: "var(--chart-7)" },
    profit: { label: c.profit, color: "var(--chart-6)" },
  } satisfies ChartConfig;

  const label = (day: string) =>
    grain === "weekly"
      ? interpolate(c.trend.weekOf, { date: formatDayKey(day, locale) })
      : formatDayKey(day, locale, true);
  const empty = series.every((p) => p.revenue === 0);

  return (
    <ChartCard
      title={c.trend.title}
      subtitle={c.trend.subtitle}
      empty={empty}
      actions={
        <PillGroup label={c.trend.period} className="rounded-lg bg-muted p-0.5" segmented>
          {(["daily", "weekly"] as const).map((g) => (
            <Pill key={g} active={grain === g} onClick={() => setGrain(g)} segmented>
              {c.trend[g]}
            </Pill>
          ))}
        </PillGroup>
      }
      table={{
        columns: [{ label: c.trend.period }, { label: c.revenue, align: "right" }, { label: c.profit, align: "right" }, { label: "%", align: "right" }],
        rows: data.map((p) => [
          label(p.day),
          formatCurrency(p.revenue),
          formatCurrency(p.profit),
          p.revenue > 0 ? formatPercent((p.profit / p.revenue) * 100, 1) : "—",
        ]),
      }}
    >
      <ChartContainer config={config} className="aspect-auto h-72 w-full">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="day" {...AXIS_PROPS} minTickGap={24} tickFormatter={(d: string) => formatDayKey(d, locale)} />
          <YAxis {...AXIS_PROPS} width={76} tickFormatter={formatBsCompact} />
          <ChartTooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            content={(props) => (
              <VizTooltip
                active={props.active}
                payload={props.payload}
                label={props.label}
                labelFormat={label}
                names={{ revenue: c.revenue, profit: c.profit }}
              />
            )}
          />
          {(["revenue", "profit"] as const).map((key) => (
            <Area
              key={key}
              dataKey={key}
              type="monotone"
              stroke={`var(--color-${key})`}
              strokeWidth={2}
              fill={`var(--color-${key})`}
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
          <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
        </AreaChart>
      </ChartContainer>
    </ChartCard>
  );
}
