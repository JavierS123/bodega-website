/**
 * Exact money arithmetic in integer cents (client- and server-safe).
 * Postgres numeric(12,2) values arrive as strings ("1200.00"); never do
 * float math on them directly — convert to cents, compute, convert back.
 */

/** "1,200.5" | "1200.50" | 1200.5 → 120050. Throws on garbage. */
export function toCents(value: string | number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Invalid amount: ${value}`);
    return Math.round(value * 100);
  }
  const s = value.trim().replace(/,/g, "");
  const m = /^(-)?(\d+)(?:\.(\d{1,2})\d*)?$/.exec(s);
  if (!m) throw new Error(`Invalid amount: "${value}"`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? "0").padEnd(2, "0"));
  return m[1] ? -cents : cents;
}

/** Like toCents but returns null instead of throwing (for live form previews). */
export function tryCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return toCents(value);
  } catch {
    return null;
  }
}

/** 120050 → "1200.50" (the exact string numeric(12,2) expects). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}
