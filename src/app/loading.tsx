import { KpiStripSkeleton, TableSkeleton } from "@/components/shared/kpi-card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level fallback while a section's server render starts (instant
 * navigation feedback). Each page then streams its own, more specific
 * skeleton from its <Suspense> boundary.
 */
export default function Loading() {
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 sm:px-6 lg:py-8" aria-busy="true">
      <div className="grid gap-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <KpiStripSkeleton />
      <TableSkeleton rows={6} />
    </div>
  );
}
