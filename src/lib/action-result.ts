/**
 * Serializable result returned by every Server Action (client-safe module).
 * The client maps `error` codes to i18n messages.
 */
export type ActionResult<T = undefined, C extends string = string> =
  | { ok: true; data: T }
  | { ok: false; error: C; fieldErrors?: Record<string, string[]> };
