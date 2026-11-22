"use client";

import { Languages } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

export function LanguageToggle({ className }: { className?: string }) {
  const { locale, t, toggleLocale } = useI18n();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={toggleLocale}
      aria-label={t.language.switchTo}
      title={t.language.switchTo}
      className={cn("gap-1.5 font-medium tabular-nums", className)}
    >
      <Languages className="size-4" aria-hidden />
      <span className={cn(locale === "en" ? "text-foreground" : "text-muted-foreground")}>EN</span>
      <span className="text-muted-foreground">/</span>
      <span className={cn(locale === "es" ? "text-foreground" : "text-muted-foreground")}>ES</span>
    </Button>
  );
}
