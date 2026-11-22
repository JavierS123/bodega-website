"use client";

import { cloneElement, isValidElement, type ReactElement } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n/provider";

import { useSession } from "./session-provider";

/**
 * Wraps an admin-only control.
 * - Visitors (demo mode): the child renders disabled, with a tooltip explaining why.
 * - Admins: the child renders untouched (with `label` as a tooltip, if given —
 *   handy for icon-only buttons).
 *
 * UI convenience only — the Server Actions behind these controls enforce
 * requireAdmin() themselves.
 */
export function AdminOnly({
  children,
  label,
}: {
  children: ReactElement<{ disabled?: boolean }>;
  label?: string;
}) {
  const { isAdmin } = useSession();
  const { t } = useI18n();

  if (!isValidElement(children)) return children;

  if (isAdmin) {
    if (!label) return children;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {/* Disabled buttons swallow pointer events, so the wrapper owns the tooltip. */}
        <span
          tabIndex={0}
          className="inline-flex cursor-not-allowed rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {cloneElement(children, { disabled: true })}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label ? `${label} — ${t.demo.adminOnly}` : t.demo.adminOnly}</TooltipContent>
    </Tooltip>
  );
}
