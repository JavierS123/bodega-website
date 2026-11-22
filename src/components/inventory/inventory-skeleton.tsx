import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { InventoryKpisSkeleton } from "./inventory-kpis";

/** Suspense fallback for /inventory: KPI strip + toolbar + table rows. */
export function InventorySkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <InventoryKpisSkeleton />
      <div className="grid gap-3">
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-7 w-16 rounded-full" />
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Skeleton className="h-8 flex-1" />
          <Skeleton className="h-8 w-full sm:w-80" />
        </div>
      </div>
      <Card className="gap-0 p-0">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
            <Skeleton className="hidden h-4 w-24 md:block" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </Card>
    </div>
  );
}
