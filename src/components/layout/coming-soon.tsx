import { ArrowRight, Construction, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/server";

import { PageContainer, PageHeader } from "./page-header";

type Section = "cashier" | "transactions" | "clients" | "owners" | "analytics";

/** Placeholder for sections scheduled for later phases. */
export async function ComingSoon({ section, icon: Icon }: { section: Section; icon: LucideIcon }) {
  const t = await getDictionary();
  const title = t.placeholder[`${section}Title`];
  const description = t.placeholder[`${section}Description`];

  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Icon className="size-6 text-muted-foreground" aria-hidden />
          </div>
          <p className="flex items-center gap-1.5 font-medium">
            <Construction className="size-4 text-amber-600" aria-hidden />
            {t.placeholder.comingSoon}
          </p>
          <p className="max-w-md text-sm text-muted-foreground">{t.placeholder.description}</p>
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link href="/inventory">
              {t.placeholder.goToInventory}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
