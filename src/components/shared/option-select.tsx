"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Radix Select forbids "" as a value, so "no selection" uses this sentinel. */
const NONE = "__all__";

export interface Option<V extends string | number> {
  value: V;
  label: string;
}

/**
 * Typed single-select. With `allLabel`, a first "All" option maps to `null`.
 * Values may be strings or numbers (ids); they round-trip through Radix as strings.
 */
export function OptionSelect<V extends string | number>({
  id,
  value,
  onChange,
  options,
  allLabel,
  placeholder,
  ariaLabel,
  className,
  size = "default",
  disabled,
  invalid,
}: {
  id?: string;
  value: V | null;
  onChange: (value: V | null) => void;
  options: readonly Option<V>[];
  allLabel?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  size?: "sm" | "default";
  disabled?: boolean;
  invalid?: boolean;
}) {
  const current = value === null ? (allLabel ? NONE : "") : String(value);
  return (
    <Select
      value={current}
      disabled={disabled}
      onValueChange={(raw) => {
        if (raw === NONE) return onChange(null);
        const match = options.find((o) => String(o.value) === raw);
        onChange(match ? match.value : null);
      }}
    >
      <SelectTrigger
        id={id}
        size={size}
        aria-label={ariaLabel}
        aria-invalid={invalid || undefined}
        className={cn("w-full min-w-0", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allLabel && <SelectItem value={NONE}>{allLabel}</SelectItem>}
        {options.map((o) => (
          <SelectItem key={String(o.value)} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
