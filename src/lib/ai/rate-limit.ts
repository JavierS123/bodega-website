import "server-only";

/**
 * In-memory sliding-window rate limiter for unauthenticated AI requests.
 *
 * Caveat (by design, free tier): state lives in the server instance's memory,
 * so on serverless each warm instance keeps its own window and a cold start
 * resets it. Good enough to stop casual abuse of the public demo; swap for a
 * shared store (e.g. Upstash / a Postgres table) if it ever needs to be strict.
 */
const WINDOW_MS = 60 * 60 * 1000;
export const VISITOR_LIMIT = 5;

const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, limit = VISITOR_LIMIT, now = Date.now()) {
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return { ok: false as const, retryAfterSec: Math.ceil((recent[0] + WINDOW_MS - now) / 1000) };
  }
  recent.push(now);
  hits.set(key, recent);
  // Opportunistic cleanup so the map can't grow without bound.
  if (hits.size > 5_000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= WINDOW_MS)) hits.delete(k);
  }
  return { ok: true as const, remaining: limit - recent.length };
}

/** Client IP from proxy headers (Vercel sets x-forwarded-for / x-real-ip). */
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || "unknown";
}
