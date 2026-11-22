"use client";

import { AlertTriangle, CircleAlert, Eye, PackageCheck, TrendingDown, type LucideIcon } from "lucide-react";

import { OwnerBadge, StockPill } from "@/components/inventory/badges";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WatchlistRow, WatchStatus } from "@/lib/analytics/types";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/** Status = reserved meaning: status tokens, always icon + label (never color alone). */
const STATUS: Record<WatchStatus, { icon: LucideIcon; className: string }> = {
  OUT: { icon: AlertTriangle, className: "bg-destructive text-destructive-foreground ring-destructive" },
  CRITICAL: { icon: CircleAlert, className: "bg-destructive/10 text-destructive ring-destructive/30" },
  LOW: { icon: TrendingDown, className: "bg-warning/10 text-warning ring-warning/30" },
  WATCH: { icon: Eye, className: "bg-info/10 text-info ring-info/30" },
};

function StatusBadge({ status }: { status: WatchStatus }) {
  const { t } = useI18n();
  const { icon: Icon, className } = STATUS[status];
  return (
    <span className={cn("inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium whitespace-nowrap ring-1 ring-inset", className)}>
      <Icon className="size-3" aria-hidden />
      {t.analytics.charts.watchlist.statuses[status]}
    </span>
  );
}

/** Restock & stockout watchlist: days left = stock ÷ average daily sell-through. */
export function WatchlistTable({ rows, windowDays }: { rows: WatchlistRow[]; windowDays: number }) {
  const { t } = useI18n();
  const w = t.analytics.charts.watchlist;
  const daysLeft = (r: WatchlistRow) =>
    r.stock <= 0 ? "0" : r.daysLeft === null ? w.noSales : r.daysLeft < 10 ? r.daysLeft.toFixed(1) : String(Math.round(r.daysLeft));

  return (
    <Card size="sm" className="gap-3 px-4">
      <div className="grid gap-0.5">
        <h2 className="text-sm font-semibold">{w.title}</h2>
        <p className="text-xs text-muted-foreground">{interpolate(w.subtitle, { days: windowDays })}</p>
      </div>

      {rows.length === 0 ? (
        <div className="grid place-items-center gap-1 py-10 text-center">
          <PackageCheck className="size-6 text-success" aria-hidden />
          <p className="text-sm font-medium">{w.empty}</p>
          <p className="text-xs text-muted-foreground">{w.emptyHint}</p>
        </div>
      ) : (
        <>
          {/* md+: table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableHead className="h-8 px-3 text-xs">{w.product}</TableHead>
                  <TableHead className="h-8 px-3 text-xs">{w.owner}</TableHead>
                  <TableHead className="h-8 px-3 text-right text-xs">{w.stock}</TableHead>
                  <TableHead className="h-8 px-3 text-right text-xs">{interpolate(w.sold, { days: windowDays })}</TableHead>
                  <TableHead className="h-8 px-3 text-right text-xs">{w.perDay}</TableHead>
                  <TableHead className="h-8 px-3 text-right text-xs">{w.daysLeft}</TableHead>
                  <TableHead className="h-8 px-3 text-xs">{w.status}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.productId}>
                    <TableCell className="px-3 py-2">
                      <span className="font-medium">{r.name}</span>{" "}
                      <span className="font-mono text-[11px] text-muted-foreground">{r.sku}</span>
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <OwnerBadge ownerId={r.ownerId} name={r.ownerName} />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right">
                      <StockPill stock={r.stock} threshold={r.threshold} />
                    </TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">{r.sold}</TableCell>
                    <TableCell className="px-3 py-2 text-right tabular-nums">{r.avgDaily.toFixed(2)}</TableCell>
                    <TableCell className={cn("px-3 py-2 text-right font-medium tabular-nums", r.daysLeft === null && r.stock > 0 && "font-normal text-muted-foreground")}>
                      {daysLeft(r)}
                    </TableCell>
                    <TableCell className="px-3 py-2">
                      <StatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <ul className="grid gap-2 md:hidden">
            {rows.map((r) => (
              <li key={r.productId} className="grid gap-1.5 rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="grid min-w-0 gap-1">
                    <span className="truncate font-medium">{r.name}</span>
                    <OwnerBadge ownerId={r.ownerId} name={r.ownerName} />
                  </div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <StockPill stock={r.stock} threshold={r.threshold} />
                  <span className="tabular-nums">
                    {w.daysLeft}: <span className="font-medium text-foreground">{daysLeft(r)}</span> · {w.perDay}: {r.avgDaily.toFixed(2)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
