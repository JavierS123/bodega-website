import { Eye, LogIn, LogOut, Store } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/actions/auth";
import { LanguageToggle } from "@/components/language-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCurrentUser, isAdmin } from "@/lib/auth/guards";
import { dictionaries } from "@/lib/i18n/config";
import { LanguageProvider } from "@/lib/i18n/provider";
import { getLocale } from "@/lib/i18n/server";

/**
 * Request-time chrome: reads the locale cookie and the auth session, so it is
 * rendered inside the root layout's <Suspense> boundary (Cache Components).
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const [locale, user] = await Promise.all([getLocale(), getCurrentUser()]);
  const t = dictionaries[locale];
  const admin = isAdmin(user);

  return (
    <LanguageProvider initialLocale={locale}>
      {!admin && (
        <div
          role="status"
          className="flex items-center justify-center gap-2 border-b bg-muted/60 px-4 py-1.5 text-center text-xs text-muted-foreground"
        >
          <Eye className="size-3.5 shrink-0" aria-hidden />
          <span>{t.demo.banner}</span>
        </div>
      )}

      <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold">
            <Store className="size-5 text-primary" aria-hidden />
            <span>{t.meta.appName}</span>
          </Link>

          <div className="ml-auto flex items-center gap-2">
            <LanguageToggle />
            {admin ? (
              <>
                <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">
                  {user.email}
                </span>
                <Badge variant="secondary">{t.auth.adminBadge}</Badge>
                <form action={signOut}>
                  <Button type="submit" variant="ghost" size="sm" aria-label={t.auth.signOut}>
                    <LogOut className="size-4" aria-hidden />
                    <span className="hidden sm:inline">{t.auth.signOut}</span>
                  </Button>
                </form>
              </>
            ) : (
              <Button asChild variant="ghost" size="sm">
                <Link href="/login">
                  <LogIn className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{t.auth.adminLogin}</span>
                </Link>
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col">{children}</main>
    </LanguageProvider>
  );
}

export function AppShellFallback() {
  return (
    <>
      <div className="h-7 border-b bg-muted/60" />
      <div className="h-14 border-b" />
      <div className="flex-1" />
    </>
  );
}
