"use client";

import { ArrowDownRight, ArrowUpRight, Boxes, Coins, Crown, HandCoins, Percent, TrendingUp, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { OwnerBadge } from "@/components/inventory/badges";
import { Card } from "@/components/ui/card";
import type { KpiSummary, OwnerPerformance } from "@/lib/analytics/types";
import { formatCurrency, formatPercent } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

import { formatInt } from "./viz";

type Delta = { kind: "pct" | "pp"; value: number } | null;

/** % change vs previous period (null when there is nothing comparable). */
function pctDelta(cur: number, prev: number | null): Delta {
  if (prev === null || prev === 0) return null;
  return { kind: "pct", value: ((cur - prev) / Math.abs(prev)) * 100 };
}

/**
 * Stat tiles: label · value (proportional figures) · signed delta vs the named
 * previous period, colored by direction × "up is good" and always with an arrow.
 */
export function KpiRow({
  kpis,
  owners,
  periodDays,
}: {
  kpis: KpiSummary;
  owners: OwnerPerformance[];
  periodDays: number | null;
}) {
  const { t } = useI18n();
  const k = t.analytics.kpis;
  const vs =
    periodDays === null ? t.analytics.period.noCompare : periodDays === 1 ? t.analytics.period.vsPrevOne : interpolate(t.analytics.period.vsPrev, { days: periodDays });

  const investor = owners.filter((o) => o.invested > 0).sort((a, b) => b.invested - a.invested)[0];
  const roiOwner = owners.filter((o) => o.roiPct !== null).sort((a, b) => (b.roiPct ?? 0) - (a.roiPct ?? 0))[0];
  const marginDelta: Delta =
    kpis.marginPct !== null && kpis.prevMarginPct !== null ? { kind: "pp", value: kpis.marginPct - kpis.prevMarginPct } : null;

  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6" aria-label={t.analytics.title}>
      <Tile icon={Coins} label={k.revenue} value={formatCurrency(kpis.revenue)} delta={pctDelta(kpis.revenue, kpis.prevRevenue)} vs={vs} hint={k.revenueHint} />
      <Tile
        icon={TrendingUp}
        label={k.grossProfit}
        value={formatCurrency(kpis.grossProfit)}
        delta={pctDelta(kpis.grossProfit, kpis.prevGrossProfit)}
        vs={vs}
        hint={
          <span className="inline-flex items-center gap-1">
            <Percent className="size-3" aria-hidden />
            {interpolate(k.margin, { margin: kpis.marginPct === null ? "—" : formatPercent(kpis.marginPct, 1) })}
            {marginDelta && <DeltaText delta={marginDelta} />}
          </span>
        }
      />
      <Tile
        icon={Boxes}
        label={k.units}
        value={formatInt(kpis.units)}
        delta={pctDelta(kpis.units, kpis.prevUnits)}
        vs={vs}
        hint={interpolate(k.unitsHint, { count: formatInt(kpis.saleCount) })}
      />
      <Tile icon={HandCoins} label={k.fiado} value={formatCurrency(kpis.pendingFiado)} hint={k.fiadoHint} />
      <Tile
        icon={Crown}
        label={k.topInvestor}
        value={investor ? <OwnerBadge ownerId={investor.ownerId} name={investor.ownerName} /> : k.none}
        hint={investor ? interpolate(k.topInvestorHint, { amount: formatCurrency(investor.invested) }) : k.noneHint}
      />
      <Tile
        icon={TrendingUp}
        label={k.topRoi}
        value={roiOwner ? <OwnerBadge ownerId={roiOwner.ownerId} name={roiOwner.ownerName} /> : k.none}
        hint={
          roiOwner
            ? interpolate(k.topRoiHint, { roi: formatPercent(roiOwner.roiPct ?? 0, 1), amount: formatCurrency(roiOwner.invested) })
            : k.noneHint
        }
      />
    </section>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  delta,
  vs,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  delta?: Delta;
  vs?: string;
  hint: ReactNode;
}) {
  return (
    <Card size="sm" className="gap-1 px-4">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        <Icon className="size-4 shrink-0" aria-hidden />
      </div>
      {/* Proportional figures for a standalone value (tabular-nums only where numbers align in columns). */}
      <div className="flex min-h-8 items-center truncate text-xl font-semibold tracking-tight sm:text-2xl [&_span]:text-sm">
        {value}
      </div>
      {vs !== undefined && (
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          {delta ? <DeltaText delta={delta} /> : null}
          <span className="truncate">{vs}</span>
        </p>
      )}
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

function DeltaText({ delta }: { delta: NonNullable<Delta> }) {
  const { t } = useI18n();
  const up = delta.value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const text =
    delta.kind === "pp"
      ? interpolate(t.analytics.kpis.pp, { value: `${up ? "+" : ""}${delta.value.toFixed(1)}` })
      : `${up ? "+" : ""}${delta.value.toFixed(1)}%`;
  return (
    <span className={cn("inline-flex items-center font-medium tabular-nums", up ? "text-success" : "text-destructive")}>
      <Icon className="size-3.5" aria-hidden />
      {text}
    </span>
  );
}
