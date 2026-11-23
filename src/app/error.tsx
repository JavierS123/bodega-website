"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { interpolate } from "@/lib/i18n/config";
import { useI18n } from "@/lib/i18n/provider";

/**
 * Error boundary for every section (renders inside the app shell, so the
 * sidebar and language toggle stay usable). In production Next.js replaces
 * server error messages with a generic text + digest, so nothing sensitive
 * (SQL, connection strings) ever reaches the browser; the digest matches the
 * server log line.
 */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const { t } = useI18n();
  const s = t.system;
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto grid w-full max-w-7xl px-4 py-12 sm:px-6">
      <Card className="mx-auto w-full max-w-lg items-center gap-3 px-6 py-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertTriangle className="size-6" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold">{s.errorTitle}</h1>
        <p className="text-sm text-muted-foreground">{s.errorDescription}</p>
        {digest && <p className="font-mono text-xs text-muted-foreground">{interpolate(s.errorRef, { digest })}</p>}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button onClick={() => retry()}>
            <RotateCcw aria-hidden />
            {s.errorRetry}
          </Button>
          <Button asChild variant="outline">
            <Link href="/">{s.errorHome}</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
