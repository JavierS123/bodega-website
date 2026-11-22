"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

import { isActivePath, NAV_ITEMS } from "./nav-items";

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useI18n();

  return (
    <nav aria-label={t.nav.main} className="grid gap-1">
      {NAV_ITEMS.map(({ href, icon: Icon, label, hint }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", active ? "text-sidebar-primary" : "")}
              aria-hidden
            />
            <span className="grid min-w-0 leading-tight">
              <span className="truncate font-medium">{label(t)}</span>
              <span className="truncate text-xs text-muted-foreground">{hint(t)}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
