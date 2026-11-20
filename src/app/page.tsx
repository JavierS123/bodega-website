import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/format";
import { getDictionary, getLocale } from "@/lib/i18n/server";

// Phase 1 placeholder — replaced by the real dashboard in a later phase.
export default async function HomePage() {
  const [t, locale] = await Promise.all([getDictionary(), getLocale()]);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-2xl">{t.home.title}</CardTitle>
          <CardDescription>{t.home.subtitle}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm">
          <p>
            <span className="text-muted-foreground">{t.home.sampleAmount}: </span>
            <span className="font-medium tabular-nums">{formatCurrency("1200")}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{t.home.today}: </span>
            <span className="font-medium">{formatDate(new Date(), locale)}</span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
