import { AlertTriangle, Boxes, Coins, TrendingDown, type LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { InventoryKpis as Kpis } from "@/lib/analytics/inventory";
import { formatCurrency } from "@/lib/format";
import { interpolate, type Dictionary } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

export function InventoryKpis({ kpis, t }: { kpis: Kpis; t: Dictionary }) {
  const k = t.inventory.kpis;
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t.inventory.title}>
      <KpiCard
        icon={Boxes}
        label={k.totalSkus}
        value={String(kpis.activeSkus)}
        hint={interpolate(k.totalSkusHint, { count: kpis.archivedSkus })}
      />
      <KpiCard icon={Coins} label={k.inventoryValue} value={formatCurrency(kpis.inventoryValue)} hint={k.inventoryValueHint} />
      <KpiCard
        icon={TrendingDown}
        label={k.lowStock}
        value={String(kpis.lowStockCount)}
        hint={k.lowStockHint}
        tone={kpis.lowStockCount > 0 ? "warning" : "default"}
      />
      <KpiCard
        icon={AlertTriangle}
        label={k.audit}
        value={String(kpis.auditCount)}
        hint={k.auditHint}
        tone={kpis.auditCount > 0 ? "danger" : "default"}
      />
    </section>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <Card
      size="sm"
      className={cn(
        "gap-1 px-4",
        tone === "warning" && "ring-amber-300 dark:ring-amber-800",
        tone === "danger" && "bg-red-50/60 ring-red-300 dark:bg-red-950/30 dark:ring-red-900",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="truncate">{label}</span>
        <Icon
          className={cn(
            "size-4 shrink-0",
            tone === "warning" && "text-amber-600",
            tone === "danger" && "text-red-600",
          )}
          aria-hidden
        />
      </div>
      <p
        className={cn(
          "truncate text-xl font-semibold tracking-tight tabular-nums sm:text-2xl",
          tone === "danger" && "text-red-700 dark:text-red-400",
        )}
      >
        {value}
      </p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

export function InventoryKpisSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i} size="sm" className="gap-2 px-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-32" />
        </Card>
      ))}
    </div>
  );
}
