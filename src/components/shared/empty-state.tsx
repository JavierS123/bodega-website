import { PackageSearch, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";

export function EmptyState({
  title,
  hint,
  action,
  icon: Icon = PackageSearch,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Card className="items-center gap-2 border-dashed px-4 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <Icon className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <p className="font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{hint}</p>
      {action && <div className="mt-2">{action}</div>}
    </Card>
  );
}
