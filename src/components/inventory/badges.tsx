"use client";

import { AlertTriangle, CircleCheck, TrendingDown } from "lucide-react";

import { formatPercent } from "@/lib/format";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { ownerColorClass, stockStatus } from "@/lib/inventory/shared";
import { cn } from "@/lib/utils";

export function OwnerBadge({ ownerId, name }: { ownerId: number; name: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        ownerColorClass(ownerId),
      )}
    >
      {name}
    </span>
  );
}

/** Green = healthy, amber = at/below threshold, red alert = zero or negative (audit). */
export function StockPill({ stock, threshold }: { stock: number; threshold: number }) {
  const { t } = useI18n();
  const status = stockStatus(stock, threshold);
  const styles = {
    IN_STOCK:
      "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900",
    LOW: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
    AUDIT:
      "bg-red-600 text-white ring-red-700 dark:bg-red-600 dark:ring-red-500",
  }[status];
  const Icon = status === "AUDIT" ? AlertTriangle : status === "LOW" ? TrendingDown : CircleCheck;
  const label = status === "AUDIT" ? t.inventory.stock.audit : status === "LOW" ? t.inventory.stock.low : null;

  return (
    <span
      title={interpolate(t.inventory.stock.thresholdHint, { threshold })}
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full px-2 text-xs font-semibold whitespace-nowrap tabular-nums ring-1 ring-inset",
        styles,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {interpolate(t.inventory.stock.units, { count: stock })}
      {label && <span className="font-medium opacity-90">· {label}</span>}
    </span>
  );
}

/** Actual markup on the sale price vs. the product's target margin. */
export function MarginBadge({ actual, target }: { actual: number | null; target: number }) {
  const { t } = useI18n();
  if (actual === null) return <span className="text-xs text-muted-foreground">—</span>;
  const tone =
    actual < 0
      ? "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900"
      : actual + 0.005 < target
        ? "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900"
        : "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-900";
  return (
    <span
      title={interpolate(t.inventory.marginTitle, { target: formatPercent(target, 0) })}
      className={cn(
        "inline-flex h-5 items-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset",
        tone,
      )}
    >
      {actual >= 0 ? "+" : ""}
      {formatPercent(actual, 0)}
    </span>
  );
}
