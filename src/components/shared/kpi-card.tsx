import type { LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type KpiTone = "default" | "positive" | "warning" | "danger";

/** Compact metric tile used in KPI strips across pages. */
export function KpiCard({
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
  tone?: KpiTone;
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
            tone === "positive" && "text-emerald-600",
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
          tone === "positive" && "text-emerald-700 dark:text-emerald-400",
        )}
      >
        {value}
      </p>
      <p className="truncate text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

export function KpiStripSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <Card key={i} size="sm" className="gap-2 px-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-3 w-32" />
        </Card>
      ))}
    </div>
  );
}

/** Generic table skeleton: toolbar placeholders + N rows. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <Card className="gap-0 p-0">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-0">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-5 w-16 rounded-full md:block" />
          <Skeleton className="hidden h-4 w-24 md:block" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </Card>
  );
}
