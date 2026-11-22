import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Horizontally scrollable group of filter pills (or a segmented control). */
export function PillGroup({
  label,
  children,
  className,
  segmented = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  segmented?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]",
        segmented && "mx-0 shrink-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Pill({
  active,
  onClick,
  children,
  segmented = false,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  segmented?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-7 shrink-0 px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        segmented ? "rounded-md" : "rounded-full border",
        active
          ? segmented
            ? "bg-background text-foreground shadow-sm"
            : "border-primary bg-primary text-primary-foreground"
          : segmented
            ? "text-muted-foreground hover:text-foreground"
            : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
