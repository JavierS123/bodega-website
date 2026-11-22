import { Eye, LogIn, LogOut, ShieldCheck, Store } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { signOut } from "@/actions/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getCurrentUser, isAdmin } from "@/lib/auth/guards";
import { dictionaries, type Dictionary } from "@/lib/i18n/config";
import { LanguageProvider } from "@/lib/i18n/provider";
import { getLocale } from "@/lib/i18n/server";

import { LanguageToggle } from "./language-toggle";
import { MobileNav } from "./mobile-nav";
import { SessionProvider } from "./session-provider";
import { SidebarNav } from "./sidebar-nav";

/**
 * Request-time chrome: reads the locale cookie and the auth session, so it is
 * rendered inside the root layout's <Suspense> boundary (Cache Components).
 *
 * Layout: fixed sidebar on lg+, slide-in drawer below lg; sticky header with
 * the demo banner (visitors) or the admin badge + sign out (admins).
 */
export async function AppShell({ children }: { children: ReactNode }) {
  const [locale, user] = await Promise.all([getLocale(), getCurrentUser()]);
  const t = dictionaries[locale];
  const admin = isAdmin(user);
  const email = admin ? (user.email ?? null) : null;

  return (
    <LanguageProvider initialLocale={locale}>
      <SessionProvider value={{ isAdmin: admin, email }}>
        <TooltipProvider>
          <div className="flex min-h-full flex-1">
            <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r bg-sidebar lg:flex">
              <Brand t={t} className="h-14 border-b px-5" />
              <div className="flex-1 overflow-y-auto p-3">
                <SidebarNav />
              </div>
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">{t.meta.tagline}</p>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
              <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
                {!admin && <DemoBanner t={t} />}
                <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
                  <MobileNav />
                  <Brand t={t} className="lg:hidden" />
                  <div className="ml-auto flex items-center gap-2">
                    <LanguageToggle />
                    {admin && <AdminControls t={t} email={email} />}
                  </div>
                </div>
              </header>

              <main className="flex flex-1 flex-col">{children}</main>
            </div>
          </div>
        </TooltipProvider>
      </SessionProvider>
    </LanguageProvider>
  );
}

function Brand({ t, className }: { t: Dictionary; className?: string }) {
  return (
    <Link href="/" className={`flex items-center gap-2 font-semibold tracking-tight ${className ?? ""}`}>
      <Store className="size-5 text-sidebar-primary" aria-hidden />
      <span>{t.meta.appName}</span>
    </Link>
  );
}

function DemoBanner({ t }: { t: Dictionary }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-x-3 gap-y-1 border-b bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <Eye className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate sm:whitespace-normal">{t.demo.banner}</span>
      </span>
      <Link
        href="/login"
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-medium underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:outline-none"
      >
        <LogIn className="size-3.5" aria-hidden />
        {t.auth.adminLogin}
      </Link>
    </div>
  );
}

function AdminControls({ t, email }: { t: Dictionary; email: string | null }) {
  return (
    <>
      {email && (
        <span className="hidden max-w-48 truncate text-sm text-muted-foreground md:inline">{email}</span>
      )}
      <Badge className="gap-1 bg-emerald-600 text-white">
        <ShieldCheck aria-hidden />
        {t.auth.adminBadge}
      </Badge>
      <form action={signOut}>
        <Button type="submit" variant="ghost" size="sm" aria-label={t.auth.signOut}>
          <LogOut className="size-4" aria-hidden />
          <span className="hidden sm:inline">{t.auth.signOut}</span>
        </Button>
      </form>
    </>
  );
}

export function AppShellFallback() {
  return (
    <div className="flex min-h-full flex-1">
      <div className="fixed inset-y-0 left-0 hidden w-64 border-r bg-sidebar lg:block" />
      <div className="flex flex-1 flex-col lg:pl-64">
        <div className="h-14 border-b" />
        <div className="flex-1" />
      </div>
    </div>
  );
}
