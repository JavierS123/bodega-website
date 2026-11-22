import { HandCoins, Trophy, UserRound, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { ClientsView } from "@/components/clients/clients-view";
import { PageContainer, PageHeader } from "@/components/layout/page-header";
import { KpiCard, KpiStripSkeleton, TableSkeleton } from "@/components/shared/kpi-card";
import { getClientsKpis, listClientsWithDebt } from "@/lib/clients/queries";
import type { ClientsKpis } from "@/lib/clients/shared";
import { formatCurrency } from "@/lib/format";
import { interpolate, type Dictionary } from "@/lib/i18n/config";
import { getDictionary } from "@/lib/i18n/server";
import { listOwners } from "@/lib/inventory/queries";

export const metadata: Metadata = {
  title: "Clients & Fiado · BodegaOS",
};

export default async function ClientsPage() {
  const t = await getDictionary();
  return (
    <PageContainer>
      <PageHeader title={t.clients.title} description={t.clients.subtitle} />
      <Suspense
        fallback={
          <div className="grid gap-6" aria-busy="true">
            <KpiStripSkeleton />
            <TableSkeleton rows={8} />
          </div>
        }
      >
        <ClientsContent />
      </Suspense>
    </PageContainer>
  );
}

async function ClientsContent() {
  const t = await getDictionary();
  const clients = await listClientsWithDebt();
  const [kpis, owners] = await Promise.all([getClientsKpis(clients), listOwners()]);
  return (
    <div className="grid gap-6">
      <ClientsKpiStrip kpis={kpis} t={t} />
      <ClientsView clients={clients} owners={owners} />
    </div>
  );
}

function ClientsKpiStrip({ kpis, t }: { kpis: ClientsKpis; t: Dictionary }) {
  const k = t.clients.kpis;
  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label={t.clients.title}>
      <KpiCard
        icon={Wallet}
        label={k.totalDebt}
        value={formatCurrency(kpis.totalPending)}
        hint={k.totalDebtHint}
        tone={Number(kpis.totalPending) > 0 ? "danger" : "default"}
      />
      <KpiCard
        icon={UserRound}
        label={k.debtors}
        value={String(kpis.debtorCount)}
        hint={interpolate(k.debtorsHint, { count: kpis.clientCount })}
      />
      <KpiCard
        icon={Trophy}
        label={k.largest}
        value={kpis.largest ? formatCurrency(kpis.largest.amount) : "—"}
        hint={kpis.largest?.name ?? "—"}
        tone={kpis.largest ? "warning" : "default"}
      />
      <KpiCard
        icon={HandCoins}
        label={k.collected30}
        value={formatCurrency(kpis.collected30)}
        hint={interpolate(k.collected30Hint, { count: kpis.collected30Count })}
        tone="positive"
      />
    </section>
  );
}
