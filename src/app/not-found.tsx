import { Compass } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getDictionary } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "404",
  robots: { index: false },
};

export default async function NotFound() {
  const s = (await getDictionary()).system;
  return (
    <div className="mx-auto grid w-full max-w-7xl px-4 py-12 sm:px-6">
      <Card className="mx-auto w-full max-w-lg items-center gap-3 px-6 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Compass className="size-6" aria-hidden />
        </div>
        <p className="font-mono text-xs text-muted-foreground">404</p>
        <h1 className="text-lg font-semibold">{s.notFoundTitle}</h1>
        <p className="text-sm text-muted-foreground">{s.notFoundDescription}</p>
        <Button asChild className="mt-2">
          <Link href="/">{s.notFoundHome}</Link>
        </Button>
      </Card>
    </div>
  );
}
