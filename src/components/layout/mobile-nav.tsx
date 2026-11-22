"use client";

import { Menu, Store, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { useI18n } from "@/lib/i18n/provider";

import { SidebarNav } from "./sidebar-nav";

/** Left-hand slide-in drawer with the same navigation as the desktop sidebar. */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();

  return (
    <Drawer direction="left" open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t.nav.openMenu}>
          <Menu className="size-5" aria-hidden />
        </Button>
      </DrawerTrigger>
      <DrawerContent className="bg-sidebar">
        <DrawerHeader className="flex-row items-center justify-between border-b">
          <DrawerTitle className="flex items-center gap-2">
            <Store className="size-5 text-sidebar-primary" aria-hidden />
            {t.meta.appName}
          </DrawerTitle>
          <DrawerDescription className="sr-only">{t.meta.tagline}</DrawerDescription>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t.nav.closeMenu}>
              <X className="size-4" aria-hidden />
            </Button>
          </DrawerClose>
        </DrawerHeader>
        <div className="overflow-y-auto p-3">
          <SidebarNav onNavigate={() => setOpen(false)} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
