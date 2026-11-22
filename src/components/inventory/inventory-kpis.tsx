import { AlertTriangle, Boxes, Coins, TrendingDown } from "lucide-react";

import { KpiCard, KpiStripSkeleton } from "@/components/shared/kpi-card";
import type { InventoryKpis as Kpis } from "@/lib/analytics/inventory";
import { formatCurrency } from "@/lib/format";
import { interpolate, type Dictionary } from "@/lib/i18n/config";

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

export function InventoryKpisSkeleton() {
  return <KpiStripSkeleton />;
}
