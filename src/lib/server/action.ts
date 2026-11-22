import "server-only";

import { refresh } from "next/cache";
import { z } from "zod";

import { isAuthError, requireAdmin } from "@/lib/auth/guards";
import type { ActionResult } from "@/lib/action-result";

/**
 * Shared plumbing for every admin Server Action:
 *   requireAdmin() → Zod validation → run → refresh() the current route.
 *
 * Each domain passes its own error-code union `C`. Throw `ActionError(code)`
 * inside `fn` for expected business failures; anything else is logged and
 * surfaced as "unknown" (never leaks internals to the client).
 */
export class ActionError<C extends string = string> extends Error {
  constructor(readonly code: C) {
    super(code);
  }
}

type BaseCode = "unauthorized" | "validation" | "unknown";

export async function runAdminAction<S extends z.ZodType, T, C extends string>(
  options: {
    schema: S;
    input: unknown;
    /** Domain label for server logs. */
    label: string;
    /** Error code returned for unique-constraint violations (SQLSTATE 23505). */
    onUniqueViolation?: C;
  },
  fn: (data: z.output<S>) => Promise<T>,
): Promise<ActionResult<T, C | BaseCode>> {
  try {
    await requireAdmin();
  } catch (error) {
    if (isAuthError(error)) return { ok: false, error: "unauthorized" };
    throw error;
  }

  const parsed = options.schema.safeParse(options.input);
  if (!parsed.success) {
    return {
      ok: false,
      error: "validation",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    const data = await fn(parsed.data);
    refresh(); // re-render the current route with fresh data
    return { ok: true, data };
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.code as C };
    if (options.onUniqueViolation && pgErrorCode(error) === "23505") {
      return { ok: false, error: options.onUniqueViolation };
    }
    console.error(`[${options.label} action]`, error);
    return { ok: false, error: "unknown" };
  }
}

/** Postgres SQLSTATE from a postgres-js error (possibly wrapped by Drizzle). */
export function pgErrorCode(error: unknown): string | undefined {
  for (let e: unknown = error, i = 0; e && i < 3; e = (e as { cause?: unknown }).cause, i++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/* ── Shared Zod building blocks ───────────────────────────────────────────── */

/** Positive money string with ≤ 2 decimals ("1200", "1200.5"). */
export const zMoney = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, "Invalid amount");

export const zId = z.number().int().positive();

/** Optional free-text note: trimmed, empty → null. */
export const zNote = (max = 300) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

/** ISO datetime string (from a datetime-local input converted client-side), optional. */
export const zOccurredAt = z.iso
  .datetime({ offset: true })
  .nullish()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => !d || d.getTime() <= Date.now() + 5 * 60_000, "Date is in the future");
