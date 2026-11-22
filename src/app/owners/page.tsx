import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { OwnersView } from "@/components/owners/owners-view";
import { TableSkeleton } from "@/components/shared/kpi-card";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getOwnerSummaries, listSettlements } from "@/lib/analytics/owners";
import { getDictionary } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "Owners & Cash Flow · BodegaOS",
};

export default async function OwnersPage() {
  const t = await getDictionary();
  return (
    <PageContainer>
      <PageHeader title={t.owners.title} description={t.owners.subtitle} />
      <Suspense fallback={<OwnersSkeleton />}>
        <OwnersContent />
      </Suspense>
    </PageContainer>
  );
}

async function OwnersContent() {
  const [summaries, settlements] = await Promise.all([getOwnerSummaries(), listSettlements()]);
  return <OwnersView summaries={summaries} settlements={settlements} />;
}

function OwnersSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true">
      <div className="flex justify-between gap-3">
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="hidden h-8 w-40 sm:block" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} size="sm" className="gap-3 px-4">
            <div className="flex justify-between">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-8 w-36" />
            {Array.from({ length: 6 }, (_, j) => (
              <Skeleton key={j} className="h-3 w-full" />
            ))}
          </Card>
        ))}
      </div>
      <TableSkeleton rows={6} />
    </div>
  );
}
