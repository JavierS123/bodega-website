import "server-only";

import type { User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";

import { hasSupabaseEnv } from "./env";
import { createSupabaseServerClient } from "./server";

/** Thrown by requireAdmin(). `status` maps directly to an HTTP status code. */
export class AuthError extends Error {
  readonly status: 401 | 403;

  constructor(status: 401 | 403, message?: string) {
    super(message ?? (status === 401 ? "Authentication required" : "Admin privileges required"));
    this.name = "AuthError";
    this.status = status;
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}

/** Lower-cased emails from the ADMIN_EMAILS env var. */
function getAdminAllowlist(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

/**
 * The authenticated Supabase user for this request, or null for visitors.
 *
 * Uses auth.getUser(), which validates the token with Supabase Auth (never
 * trust the unverified cookie payload for authorization). Deduped per request.
 * Under Cache Components, call it from inside a <Suspense> boundary.
 */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  await cookies(); // always request-time, even when Supabase isn't configured
  if (!hasSupabaseEnv()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

/**
 * Admin = `app_metadata.role === "admin"` (only settable server-side with the
 * service role) OR email present in the ADMIN_EMAILS allowlist.
 * Never use `user_metadata` here — users can edit it themselves.
 */
export function isAdmin(user: User | null | undefined): user is User {
  if (!user) return false;
  if (user.app_metadata?.role === "admin") return true;
  const email = user.email?.toLowerCase();
  return Boolean(email && getAdminAllowlist().has(email));
}

/**
 * Server guard for EVERY Server Action and mutating Route Handler.
 * Throws AuthError(401) for visitors and AuthError(403) for non-admins.
 */
export async function requireAdmin(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError(401);
  if (!isAdmin(user)) throw new AuthError(403);
  return user;
}

/** Convert an AuthError into a JSON Response for Route Handlers (re-throws anything else). */
export function authErrorResponse(error: unknown): Response {
  if (isAuthError(error)) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  throw error;
}
