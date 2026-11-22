"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { OwnerPerformance } from "@/lib/analytics/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { ownerChartColor } from "@/lib/inventory/shared";

import { AXIS_PROPS, ChartCard, formatBsCompact, VizTooltip } from "./viz";

/**
 * Grouped bars: Invested / Revenue / Profit (one Bs. axis), one series per
 * owner in that owner's site-wide color. ROI % has a different unit, so it is
 * its own small chart beside it — never a second y-axis.
 */
export function OwnerComparisonChart({ owners }: { owners: OwnerPerformance[] }) {
  const { t } = useI18n();
  const c = t.analytics.charts.owners;
  const key = (id: number) => `o${id}`;

  const config = Object.fromEntries(
    owners.map((o) => [key(o.ownerId), { label: o.ownerName, color: ownerChartColor(o.ownerId) }]),
  ) satisfies ChartConfig;
  const metrics = [
    { id: "invested", label: c.invested },
    { id: "revenue", label: c.revenue },
    { id: "profit", label: c.profit },
  ] as const;
  const grouped = metrics.map((m) => ({
    metric: m.label,
    ...Object.fromEntries(owners.map((o) => [key(o.ownerId), o[m.id]])),
  }));
  const names = Object.fromEntries(owners.map((o) => [key(o.ownerId), o.ownerName]));
  const roi = owners.map((o) => ({ name: o.ownerName, ownerId: o.ownerId, roi: o.roiPct }));
  const empty = owners.every((o) => o.invested === 0 && o.revenue === 0);

  return (
    <ChartCard
      title={c.title}
      subtitle={c.subtitle}
      note={c.ignores}
      empty={empty}
      table={{
        columns: [
          { label: c.owner },
          { label: c.invested, align: "right" },
          { label: c.revenue, align: "right" },
          { label: c.profit, align: "right" },
          { label: c.roi, align: "right" },
        ],
        rows: owners.map((o) => [
          o.ownerName,
          formatCurrency(o.invested),
          formatCurrency(o.revenue),
          formatCurrency(o.profit),
          o.roiPct === null ? "—" : formatPercent(o.roiPct, 1),
        ]),
      }}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <BarChart data={grouped} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={2} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="metric" {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} width={76} tickFormatter={formatBsCompact} />
            <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.6 }}
              content={(props) => (
                <VizTooltip active={props.active} payload={props.payload} label={props.label} names={names} />
              )}
            />
            {owners.map((o) => (
              <Bar
                key={o.ownerId}
                dataKey={key(o.ownerId)}
                fill={`var(--color-${key(o.ownerId)})`}
                radius={[4, 4, 0, 0]}
                maxBarSize={24}
                isAnimationActive={false}
              />
            ))}
            <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
          </BarChart>
        </ChartContainer>

        <div className="grid content-start gap-2">
          <p className="text-xs font-medium text-muted-foreground">{c.roiTitle}</p>
          <ChartContainer config={config} className="aspect-auto w-full" style={{ height: roi.length * 40 + 16 }}>
            <BarChart data={roi} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }}>
              <XAxis type="number" hide domain={[(min: number) => Math.min(0, min), "auto"]} />
              <YAxis type="category" dataKey="name" {...AXIS_PROPS} width={72} />
              <ReferenceLine x={0} stroke="var(--muted-foreground)" strokeOpacity={0.4} />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.6 }}
                content={(props) => (
                  <VizTooltip
                    active={props.active}
                    payload={props.payload}
                    label={props.label}
                    valueFormat={(v) => formatPercent(v, 1)}
                    names={{ roi: c.roi }}
                  />
                )}
              />
              <Bar dataKey="roi" radius={4} maxBarSize={20} isAnimationActive={false}>
                {roi.map((r) => (
                  <Cell key={r.ownerId} fill={ownerChartColor(r.ownerId)} />
                ))}
                <LabelList
                  dataKey="roi"
                  position="right"
                  offset={6}
                  className="fill-foreground"
                  fontSize={11}
                  formatter={(v: unknown) => (v === null || v === undefined ? "—" : formatPercent(Number(v), 1))}
                />
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </ChartCard>
  );
}
