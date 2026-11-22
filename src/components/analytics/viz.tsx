"use client";

import { BarChart3, Info, Table2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Pill, PillGroup } from "@/components/shared/filter-pills";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/* ── Formatting ───────────────────────────────────────────────────────────── */

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Axis ticks: "Bs. 12K" (compact, one style per axis). */
export const formatBsCompact = (n: number) => `Bs. ${compact.format(n)}`;
export const formatInt = (n: number) => Math.round(n).toLocaleString("en-US");

/** Shop-local day key "2026-11-20" → "Nov 20" / "20 nov" (no time-zone shift). */
export function formatDayKey(day: string, locale: "en" | "es", withYear = false): string {
  return new Intl.DateTimeFormat(locale === "es" ? "es-VE" : "en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    ...(withYear ? { year: "numeric" } : {}),
  }).format(new Date(`${day}T12:00:00Z`));
}

/** 19 → "7 PM" / "19:00". */
export function formatHour(h: number, locale: "en" | "es"): string {
  if (locale === "es") return `${String(h).padStart(2, "0")}:00`;
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}

/* ── Chart card (Chart ⇄ Table) ───────────────────────────────────────────── */

export interface TableView {
  columns: { label: string; align?: "right" }[];
  rows: ReactNode[][];
}

/**
 * Every chart ships a table-view twin (accessibility + the contrast relief the
 * palette's lighter slots require). Toggles stay inside the card header; the
 * global slicers live in one row above everything.
 */
export function ChartCard({
  title,
  subtitle,
  actions,
  note,
  table,
  empty,
  children,
  className,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Small "this slicer doesn't apply" note. */
  note?: string;
  table: TableView;
  empty?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const [view, setView] = useState<"chart" | "table">("chart");
  const c = t.analytics.charts;

  return (
    <Card size="sm" className={cn("gap-3 px-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid min-w-0 gap-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          {!empty && (
            <PillGroup label={`${title}: ${c.chart} / ${c.table}`} className="rounded-lg bg-muted p-0.5" segmented>
              <Pill active={view === "chart"} onClick={() => setView("chart")} segmented>
                <BarChart3 className="mr-1 inline size-3.5 align-[-3px]" aria-hidden />
                {c.chart}
              </Pill>
              <Pill active={view === "table"} onClick={() => setView("table")} segmented>
                <Table2 className="mr-1 inline size-3.5 align-[-3px]" aria-hidden />
                {c.table}
              </Pill>
            </PillGroup>
          )}
        </div>
      </div>

      {empty ? (
        <div className="grid place-items-center gap-1 py-12 text-center">
          <p className="text-sm font-medium">{c.empty}</p>
          <p className="text-xs text-muted-foreground">{c.emptyHint}</p>
        </div>
      ) : view === "chart" ? (
        children
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg border">
          <Table>
            <TableHeader className="sticky top-0 bg-muted/80 backdrop-blur">
              <TableRow className="hover:bg-transparent">
                {table.columns.map((col) => (
                  <TableHead key={col.label} className={cn("h-8 px-3 text-xs", col.align === "right" && "text-right")}>
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {table.rows.map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell
                      key={j}
                      className={cn("px-3 py-1.5 text-xs tabular-nums", table.columns[j]?.align === "right" && "text-right")}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {note && (
        <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Info className="size-3 shrink-0" aria-hidden />
          {note}
        </p>
      )}
    </Card>
  );
}

/* ── Tooltip ──────────────────────────────────────────────────────────────── */

interface TooltipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
  payload?: Record<string, unknown>;
}

/**
 * One readout for every series at the hovered X. Values lead (strong), series
 * names follow (muted); each row is keyed by a short line in the series color.
 */
export function VizTooltip({
  active,
  payload,
  label,
  labelFormat,
  valueFormat = (v) => formatCurrency(v),
  names,
}: {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  label?: unknown;
  labelFormat?: (label: string) => string;
  valueFormat?: (value: number, key: string) => string;
  /** dataKey → display name. */
  names?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  const heading = label === undefined || label === null ? null : labelFormat ? labelFormat(String(label)) : String(label);
  return (
    <div className="grid min-w-36 gap-1.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      {heading && <p className="font-medium text-muted-foreground">{heading}</p>}
      {payload.map((p, i) => {
        const key = String(p.dataKey ?? p.name ?? i);
        return (
          <div key={key} className="flex items-center gap-2">
            <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: p.color }} aria-hidden />
            <span className="font-semibold tabular-nums">{valueFormat(Number(p.value ?? 0), key)}</span>
            <span className="text-muted-foreground">{names?.[key] ?? p.name}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Shared axis/grid styling: hairline, solid, recessive. */
export const AXIS_PROPS = {
  tickLine: false,
  axisLine: false,
  tickMargin: 8,
  fontSize: 11,
} as const;
