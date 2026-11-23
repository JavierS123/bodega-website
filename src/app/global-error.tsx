"use client";

import "./globals.css";

/**
 * Last-resort boundary for errors in the root layout itself (the shell,
 * providers and dictionaries may be unavailable, so text is bilingual and
 * static). Must render its own <html>/<body>.
 */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <html lang="es">
      <body className="flex min-h-dvh items-center justify-center bg-background p-6 font-sans text-foreground antialiased">
        <title>BodegaOS — Error</title>
        <main className="grid max-w-md gap-3 text-center">
          <h1 className="text-xl font-semibold">Algo salió mal · Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            BodegaOS no pudo cargar. Tus datos están a salvo. · BodegaOS couldn&apos;t load. Your data is safe.
          </p>
          {digest && <p className="font-mono text-xs text-muted-foreground">Ref: {digest}</p>}
          <div className="mt-2 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => retry()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Reintentar · Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
