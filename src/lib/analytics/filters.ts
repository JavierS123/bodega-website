/**
 * Global analytics slicers — synced to URL search params so every view is
 * linkable and every chart/table/export reads the SAME slice.
 * Client-safe (no server imports).
 *
 *   ?range=7d|30d|90d|1d|all|custom  &from=YYYY-MM-DD&to=YYYY-MM-DD (custom)
 *   &owner=<id>  &method=CASH|PAGO_MOVIL|FIADO  &category=<name>
 */
import type { SaleMethod } from "@/lib/transactions/shared";

export const RANGE_PRESETS = ["1d", "7d", "30d", "90d", "all"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];
export type AnalyticsRange = RangePreset | "custom";

export const ANALYTICS_METHODS = ["CASH", "PAGO_MOVIL", "FIADO"] as const satisfies readonly SaleMethod[];

export interface AnalyticsFilters {
  range: AnalyticsRange;
  /** Custom range bounds, shop-local days "YYYY-MM-DD" (inclusive). */
  from: string | null;
  to: string | null;
  ownerId: number | null;
  paymentMethod: SaleMethod | null;
  category: string | null;
}

export const DEFAULT_ANALYTICS_FILTERS: AnalyticsFilters = {
  range: "30d",
  from: null,
  to: null,
  ownerId: null,
  paymentMethod: null,
  category: null,
};

type RawParams = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function isoDay(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Lenient: invalid params fall back to defaults instead of erroring the page. */
export function parseAnalyticsFilters(params: RawParams): AnalyticsFilters {
  const rawRange = first(params.range);
  let from = isoDay(first(params.from));
  let to = isoDay(first(params.to));
  let range: AnalyticsRange =
    rawRange === "custom" || (RANGE_PRESETS as readonly string[]).includes(rawRange ?? "")
      ? (rawRange as AnalyticsRange)
      : DEFAULT_ANALYTICS_FILTERS.range;
  if (range === "custom") {
    if (!from && !to) range = DEFAULT_ANALYTICS_FILTERS.range;
    if (from && to && from > to) [from, to] = [to, from];
  }
  const owner = first(params.owner);
  const method = first(params.method);
  const category = first(params.category)?.trim();
  return {
    range,
    from: range === "custom" ? from : null,
    to: range === "custom" ? to : null,
    ownerId: owner && /^\d{1,9}$/.test(owner) && Number(owner) > 0 ? Number(owner) : null,
    paymentMethod: (ANALYTICS_METHODS as readonly string[]).includes(method ?? "") ? (method as SaleMethod) : null,
    category: category ? category.slice(0, 60) : null,
  };
}

/** Inverse of parseAnalyticsFilters — defaults omitted to keep URLs short. */
export function analyticsFiltersToSearch(f: AnalyticsFilters): string {
  const p = new URLSearchParams();
  if (f.range !== DEFAULT_ANALYTICS_FILTERS.range) p.set("range", f.range);
  if (f.range === "custom") {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  }
  if (f.ownerId) p.set("owner", String(f.ownerId));
  if (f.paymentMethod) p.set("method", f.paymentMethod);
  if (f.category) p.set("category", f.category);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function hasActiveSlicers(f: AnalyticsFilters): boolean {
  return Boolean(f.ownerId || f.paymentMethod || f.category || f.range !== DEFAULT_ANALYTICS_FILTERS.range);
}

/* ── Periods ──────────────────────────────────────────────────────────────── */

/** Shop-local day window: [start, endExclusive). null bounds = unbounded ("all"). */
export interface DayWindow {
  start: string | null;
  endExclusive: string | null;
}

export interface ResolvedPeriod {
  current: DayWindow;
  /** Same length immediately before `current`; null when there is no comparable period ("all"). */
  previous: DayWindow | null;
  /** Length in days; null for "all". */
  days: number | null;
}

const DAY_MS = 86_400_000;
export const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** `today` = the shop-local calendar day ("YYYY-MM-DD"), passed in so server and client agree. */
export function resolvePeriod(f: AnalyticsFilters, today: string): ResolvedPeriod {
  if (f.range === "all") return { current: { start: null, endExclusive: null }, previous: null, days: null };

  let start: string;
  let endExclusive: string;
  if (f.range === "custom") {
    start = f.from ?? f.to!;
    endExclusive = addDays(f.to ?? today, 1);
  } else {
    const n = Number.parseInt(f.range, 10); // "7d" → 7 (today included)
    endExclusive = addDays(today, 1);
    start = addDays(endExclusive, -n);
  }
  const days = Math.max(1, daysBetween(start, endExclusive));
  return {
    current: { start, endExclusive },
    previous: { start: addDays(start, -days), endExclusive: start },
    days,
  };
}
