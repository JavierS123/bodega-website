import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { TableSkeleton } from "@/components/shared/kpi-card";
import { LedgerView } from "@/components/transactions/ledger-view";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listClientOptions } from "@/lib/clients/queries";
import { getDictionary } from "@/lib/i18n/server";
import { listOwners } from "@/lib/inventory/queries";
import { listLedger, listSaleProducts } from "@/lib/transactions/queries";
import { parseLedgerFilters } from "@/lib/transactions/shared";

export const metadata: Metadata = {
  title: "Ledger",
  description: "Every sale, restock, debt payment and stock adjustment, with filters and auditable voiding.",
};

export default async function TransactionsPage({ searchParams }: PageProps<"/transactions">) {
  const t = await getDictionary();
  return (
    <PageContainer>
      <PageHeader title={t.transactions.title} description={t.transactions.subtitle} />
      {/* searchParams are URL data: read them only inside the Suspense boundary. */}
      <Suspense fallback={<LedgerSkeleton />}>
        <LedgerContent searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function LedgerContent({ searchParams }: { searchParams: PageProps<"/transactions">["searchParams"] }) {
  const filters = parseLedgerFilters(await searchParams);
  const data = await listLedger(filters);
  const [owners, clients, products] = await Promise.all([listOwners(), listClientOptions(), listSaleProducts()]);
  return <LedgerView data={data} filters={{ ...filters, page: data.page }} owners={owners} clients={clients} products={products} />;
}

function LedgerSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Card size="sm" className="gap-3 px-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="grid gap-1">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
        <div className="flex justify-between">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-8 w-32" />
        </div>
      </Card>
      <TableSkeleton rows={10} />
    </div>
  );
}
