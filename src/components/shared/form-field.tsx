import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FormField({
  label,
  htmlFor,
  hint,
  invalid,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  invalid?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={htmlFor} className={cn(invalid && "text-destructive")}>
        {label}
      </Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Small key/value tile for live calculation previews inside dialogs. */
export function PreviewStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  tone?: "default" | "positive" | "negative" | "muted";
}) {
  return (
    <div className="grid gap-0.5 rounded-lg bg-muted/60 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-sm font-semibold tabular-nums",
          tone === "positive" && "text-success",
          tone === "negative" && "text-destructive",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
