"use client";

import { Cell, Label, Pie, PieChart } from "recharts";

import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import type { PaymentSlice } from "@/lib/analytics/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import type { SaleMethod } from "@/lib/transactions/shared";

import { ChartCard, formatBsCompact, formatInt, VizTooltip } from "./viz";

/** Fixed slot per method (validated as a set, all pairs — every ring segment can touch). */
const METHOD_COLOR: Record<SaleMethod, string> = {
  CASH: "var(--chart-6)",
  PAGO_MOVIL: "var(--chart-7)",
  FIADO: "var(--chart-5)",
};
const ORDER: SaleMethod[] = ["PAGO_MOVIL", "CASH", "FIADO"];

/**
 * Donut (3 parts at most): 2px surface gap between segments, the total in the
 * centre, and a legend that carries names, amounts and shares in text ink —
 * so no value depends on reading a color.
 */
export function PaymentDonut({ payments }: { payments: PaymentSlice[] }) {
  const { t } = useI18n();
  const c = t.analytics.charts.payments;
  const data = ORDER.map((m) => payments.find((p) => p.method === m)).filter((p): p is PaymentSlice => Boolean(p && p.revenue > 0));
  const total = data.reduce((s, p) => s + p.revenue, 0);
  const share = (v: number) => (total > 0 ? (v / total) * 100 : 0);
  const config = Object.fromEntries(
    ORDER.map((m) => [m, { label: t.enums.method[m], color: METHOD_COLOR[m] }]),
  ) satisfies ChartConfig;

  return (
    <ChartCard
      title={c.title}
      subtitle={c.subtitle}
      note={c.ignores}
      empty={total === 0}
      table={{
        columns: [{ label: c.method }, { label: c.sales, align: "right" }, { label: t.analytics.charts.revenue, align: "right" }, { label: c.share, align: "right" }],
        rows: data.map((p) => [t.enums.method[p.method], formatInt(p.count), formatCurrency(p.revenue), formatPercent(share(p.revenue), 1)]),
      }}
    >
      <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ChartContainer config={config} className="aspect-square max-h-56 w-full">
          <PieChart>
            <ChartTooltip
              content={(props) => (
                <VizTooltip
                  active={props.active}
                  payload={props.payload?.map((p) => ({ ...p, color: METHOD_COLOR[p.name as SaleMethod] }))}
                  valueFormat={(v) => `${formatCurrency(v)} · ${formatPercent(share(v), 1)}`}
                  names={Object.fromEntries(ORDER.map((m) => [m, t.enums.method[m]]))}
                />
              )}
            />
            <Pie
              data={data}
              dataKey="revenue"
              nameKey="method"
              innerRadius="62%"
              outerRadius="92%"
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {data.map((p) => (
                <Cell key={p.method} fill={METHOD_COLOR[p.method]} />
              ))}
              <Label
                position="center"
                content={({ viewBox }) => {
                  const vb = viewBox as { cx?: number; cy?: number } | undefined;
                  if (!vb?.cx || !vb.cy) return null;
                  return (
                    <text x={vb.cx} y={vb.cy} textAnchor="middle" dominantBaseline="middle">
                      <tspan x={vb.cx} dy="-0.4em" className="fill-foreground text-base font-semibold">
                        {formatBsCompact(total)}
                      </tspan>
                      <tspan x={vb.cx} dy="1.5em" className="fill-muted-foreground text-[11px]">
                        {t.analytics.charts.revenue}
                      </tspan>
                    </text>
                  );
                }}
              />
            </Pie>
          </PieChart>
        </ChartContainer>

        <ul className="grid gap-2 text-sm">
          {data.map((p) => (
            <li key={p.method} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2">
              <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: METHOD_COLOR[p.method] }} aria-hidden />
              <span>{t.enums.method[p.method]}</span>
              <span className="font-semibold tabular-nums">{formatPercent(share(p.revenue), 0)}</span>
              <span />
              <span className="col-span-2 text-xs text-muted-foreground tabular-nums">
                {formatCurrency(p.revenue)} · {formatInt(p.count)} {c.sales.toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
