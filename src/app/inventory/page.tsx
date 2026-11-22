import type { Metadata } from "next";
import { Suspense } from "react";

import { InventoryKpis } from "@/components/inventory/inventory-kpis";
import { InventorySkeleton } from "@/components/inventory/inventory-skeleton";
import { InventoryView } from "@/components/inventory/inventory-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { getInventoryKpis } from "@/lib/analytics/inventory";
import { getDictionary } from "@/lib/i18n/server";
import { listInventoryProducts, listOwners } from "@/lib/inventory/queries";

export const metadata: Metadata = {
  title: "Inventory · BodegaOS",
};

export default async function InventoryPage() {
  const t = await getDictionary();
  return (
    <PageContainer>
      <PageHeader title={t.inventory.title} description={t.inventory.subtitle} />
      <Suspense fallback={<InventorySkeleton />}>
        <InventoryContent />
      </Suspense>
    </PageContainer>
  );
}

/** Live data (request-time). Streams in behind the skeleton. */
async function InventoryContent() {
  const [t, products, owners, kpis] = await Promise.all([
    getDictionary(),
    listInventoryProducts(),
    listOwners(),
    getInventoryKpis(),
  ]);
  return (
    <div className="grid gap-6">
      <InventoryKpis kpis={kpis} t={t} />
      <InventoryView products={products} owners={owners} />
    </div>
  );
}
