/**
 * Shared display formatting. All money in BodegaOS is Venezuelan Bolívares.
 *
 * Postgres `numeric` columns arrive from Drizzle as strings ("1200.00"), so
 * every helper accepts number | string. Formatting is locale-independent for
 * money (always `Bs. 1,200.00`) to match the shop's existing records.
 */

export type Amount = number | string | null | undefined;

/** Time zone of the shop — keeps server and client renders identical. */
export const SHOP_TIME_ZONE = "America/Caracas";

const moneyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Parse a numeric value (number or Postgres numeric string). Invalid → 0. */
export function toNumber(value: Amount): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * formatCurrency(1200)        → "Bs. 1,200.00"
 * formatCurrency("-35.5")     → "-Bs. 35.50"
 * formatCurrency(null)        → "Bs. 0.00"
 */
export function formatCurrency(value: Amount): string {
  const n = toNumber(value);
  // Avoid "-Bs. 0.00" for values that round to zero.
  const rounded = Math.round(n * 100) / 100;
  const sign = rounded < 0 ? "-" : "";
  return `${sign}Bs. ${moneyFormatter.format(Math.abs(rounded))}`;
}

/** formatPercent(30) → "30.00%" */
export function formatPercent(value: Amount, fractionDigits = 2): string {
  return `${toNumber(value).toFixed(fractionDigits)}%`;
}

/* ── Dates ─────────────────────────────────────────────────────────────────── */

export type DateLocale = "en" | "es";
type DateInput = Date | string | number;

const intlLocale: Record<DateLocale, string> = { en: "en-US", es: "es-VE" };

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function make(locale: DateLocale, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(intlLocale[locale], { timeZone: SHOP_TIME_ZONE, ...options });
}

/** "Nov 20, 2026" / "20 nov 2026" */
export function formatDate(value: DateInput, locale: DateLocale = "en"): string {
  return make(locale, { year: "numeric", month: "short", day: "numeric" }).format(toDate(value));
}

/** "Nov 20, 2026, 3:45 PM" / "20 nov 2026, 3:45 p. m." */
export function formatDateTime(value: DateInput, locale: DateLocale = "en"): string {
  return make(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(toDate(value));
}

/** "3:45 PM" */
export function formatTime(value: DateInput, locale: DateLocale = "en"): string {
  return make(locale, { hour: "numeric", minute: "2-digit" }).format(toDate(value));
}

/** Calendar day in the shop's time zone as "YYYY-MM-DD" (handy for grouping). */
export function toShopDateKey(value: DateInput): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SHOP_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(toDate(value));
}

/** "2 hours ago" / "hace 2 horas" relative to `now`. */
export function formatRelativeTime(
  value: DateInput,
  locale: DateLocale = "en",
  now: DateInput = Date.now(),
): string {
  const diffSec = Math.round((toDate(value).getTime() - toDate(now).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(intlLocale[locale], { numeric: "auto" });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
    ["minute", 60],
  ];
  for (const [unit, seconds] of units) {
    if (Math.abs(diffSec) >= seconds) return rtf.format(Math.round(diffSec / seconds), unit);
  }
  return rtf.format(diffSec, "second");
}
