"use client";

import { useMemo, useState } from "react";

import type { VelocityCell } from "@/lib/analytics/types";
import { formatCurrency } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

import { ChartCard, formatHour, formatInt } from "./viz";

/**
 * Weekday × hour heatmap of units sold. Sequential encoding: ONE hue (slot 1)
 * mixed toward the card surface — light→dark in light mode, and the anchor
 * flips naturally in dark mode. Zero cells stay neutral. Hover/focus a cell
 * for its exact numbers; the table view lists every non-empty cell.
 */
export function VelocityHeatmap({ cells }: { cells: VelocityCell[] }) {
  const { t, locale } = useI18n();
  const c = t.analytics.charts.velocity;

  const { grid, hours, max, peak } = useMemo(() => {
    const grid = new Map(cells.map((x) => [`${x.dow}-${x.hour}`, x]));
    const present = cells.filter((x) => x.units > 0).map((x) => x.hour);
    const lo = present.length ? Math.min(...present) : 0;
    const hi = present.length ? Math.max(...present) : 23;
    const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
    const max = Math.max(0, ...cells.map((x) => x.units));
    const peak = cells.reduce<VelocityCell | null>((best, x) => (!best || x.units > best.units ? x : best), null);
    return { grid, hours, max, peak };
  }, [cells]);

  const [hover, setHover] = useState<VelocityCell | null>(null);
  const describe = (x: VelocityCell) =>
    interpolate(c.cell, {
      day: c.days[x.dow],
      hour: formatHour(x.hour, locale),
      units: formatInt(x.units),
      revenue: formatCurrency(x.revenue),
    });
  const shade = (units: number) =>
    units <= 0 || max === 0
      ? undefined
      : `color-mix(in oklab, var(--chart-1) ${Math.round(28 + 72 * (units / max))}%, var(--card))`;

  const readout = hover ?? peak;

  return (
    <ChartCard
      title={c.title}
      subtitle={c.subtitle}
      empty={max === 0}
      table={{
        columns: [{ label: c.day }, { label: c.hour }, { label: t.analytics.charts.units, align: "right" }, { label: t.analytics.charts.revenue, align: "right" }],
        rows: [...cells]
          .filter((x) => x.units > 0)
          .sort((a, b) => b.units - a.units)
          .map((x) => [c.days[x.dow], formatHour(x.hour, locale), formatInt(x.units), formatCurrency(x.revenue)]),
      }}
    >
      <div className="overflow-x-auto pb-1">
        <div
          className="grid min-w-max gap-0.5"
          style={{ gridTemplateColumns: `2.5rem repeat(${hours.length}, minmax(1.25rem, 1fr))` }}
          onMouseLeave={() => setHover(null)}
        >
          <span />
          {hours.map((h) => (
            <span key={h} className="text-center text-[10px] text-muted-foreground tabular-nums">
              {h % 3 === 0 ? formatHour(h, locale).replace(":00", "") : ""}
            </span>
          ))}
          {c.days.map((day, dow) => (
            <div key={day} className="contents">
              <span className="self-center pr-1 text-[11px] text-muted-foreground">{day}</span>
              {hours.map((h) => {
                const x = grid.get(`${dow}-${h}`) ?? { dow, hour: h, units: 0, revenue: 0, count: 0 };
                return (
                  <span
                    key={h}
                    tabIndex={0}
                    role="img"
                    aria-label={describe(x)}
                    title={describe(x)}
                    onMouseEnter={() => setHover(x)}
                    onFocus={() => setHover(x)}
                    onBlur={() => setHover(null)}
                    className="h-6 rounded-[3px] bg-muted/40 outline-none transition-[filter] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring"
                    style={{ backgroundColor: shade(x.units) }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <p className="text-muted-foreground" aria-live="polite">
          {readout &&
            (hover
              ? describe(hover)
              : interpolate(c.peak, { day: c.days[readout.dow], hour: formatHour(readout.hour, locale) }))}
        </p>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {c.less}
          {[0.28, 0.46, 0.64, 0.82, 1].map((p) => (
            <span
              key={p}
              className="size-3 rounded-[3px]"
              style={{ backgroundColor: `color-mix(in oklab, var(--chart-1) ${Math.round(p * 100)}%, var(--card))` }}
              aria-hidden
            />
          ))}
          {c.more}
        </div>
      </div>
    </ChartCard>
  );
}
