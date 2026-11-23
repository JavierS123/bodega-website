import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";

import { CashierConsole } from "@/components/cashier/cashier-console";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listChatMessages } from "@/lib/ai/history";
import { listClientOptions, listOpenDebts } from "@/lib/clients/queries";
import { getDictionary } from "@/lib/i18n/server";
import { listOwners } from "@/lib/inventory/queries";
import { listSaleProducts } from "@/lib/transactions/queries";

export const metadata: Metadata = {
  // / shares the root layout segment, so the "%s · BodegaOS" template does not apply here.
  title: { absolute: "AI Cashier · BodegaOS" },
  description: "Log sales, Fiado, abonos and restocks in plain Spanish or English — Gemini parses them into editable confirmation cards.",
};

export default async function HomePage() {
  const t = await getDictionary();
  return (
    <PageContainer className="gap-4 lg:py-6">
      <PageHeader title={t.cashier.title} description={t.cashier.subtitle} />
      <Suspense fallback={<ConsoleSkeleton />}>
        <CashierContent />
      </Suspense>
    </PageContainer>
  );
}

/** Live chat history + the catalog the Confirmation Cards edit against. */
async function CashierContent() {
  await connection();
  const initial = await listChatMessages();
  const [products, clients, owners, debts] = await Promise.all([
    listSaleProducts(),
    listClientOptions(),
    listOwners(),
    listOpenDebts(),
  ]);
  return <CashierConsole initial={initial} catalog={{ products, clients, owners, debts }} />;
}

function ConsoleSkeleton() {
  return (
    <Card className="h-[calc(100dvh-13rem)] min-h-[26rem] gap-4 p-5" aria-busy="true">
      <div className="mx-auto grid w-full max-w-3xl flex-1 content-end gap-4">
        <Skeleton className="h-9 w-2/3 justify-self-end rounded-2xl" />
        <Skeleton className="h-28 w-3/4 rounded-2xl" />
        <Skeleton className="h-9 w-1/2 justify-self-end rounded-2xl" />
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
      </div>
      <Skeleton className="mx-auto h-9 w-full max-w-3xl rounded-xl" />
    </Card>
  );
}
