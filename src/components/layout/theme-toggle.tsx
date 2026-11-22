"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

/**
 * Light / dark switch. The icon is chosen with `dark:` classes (not React
 * state), so server and client render identical markup — no hydration
 * mismatch and no flash before next-themes resolves the stored theme.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();
  const { t } = useI18n();

  return (
    <Button
      type="button"
      variant="outline"
      size="icon-sm"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label={t.theme.toggle}
      title={t.theme.toggle}
      className={cn("relative", className)}
    >
      <Sun className="size-4 scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" aria-hidden />
      <Moon
        className="absolute size-4 scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0"
        aria-hidden
      />
    </Button>
  );
}
