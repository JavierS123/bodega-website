/**
 * Dependency-free parsing helpers for the Google Sheets CSV exports.
 * Money is handled as integer cents end-to-end so no float ever touches it.
 */

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, UTF-8 BOM). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Lowercase, strip accents, collapse whitespace — for header / enum matching. */
export function normKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[\s_]+/g, " ")
    .trim();
}

/**
 * Finds the header row (the first row containing `marker`) and returns the
 * data rows as objects keyed by normalized header name. Blank rows are dropped.
 * `line` is the 1-based line number in the source file, for error messages.
 */
export function readTable(
  text: string,
  marker: string,
): { headers: string[]; rows: { line: number; get: (header: string) => string }[] } {
  const all = parseCsv(text);
  const headerIdx = all.findIndex((r) => r.some((c) => normKey(c) === normKey(marker)));
  if (headerIdx === -1) {
    throw new Error(`Header row containing "${marker}" not found.`);
  }
  const headers = all[headerIdx].map(normKey);

  const rows = all
    .slice(headerIdx + 1)
    .map((cells, i) => ({ cells, line: headerIdx + 2 + i }))
    .filter(({ cells }) => cells.some((c) => c.trim() !== ""))
    .map(({ cells, line }) => ({
      line,
      get(header: string): string {
        const idx = headers.indexOf(normKey(header));
        if (idx === -1) throw new Error(`Column "${header}" not found (line ${line}).`);
        return (cells[idx] ?? "").normalize("NFC").trim();
      },
    }));

  return { headers, rows };
}

/**
 * "$1,200.00" / "1.200" / "Bs. 6,050.00" / "-$300.00" → 120000 (cents).
 * Legacy sheets use `$` but the amounts are Bolívares. Returns null for "".
 */
export function toCents(raw: string): number | null {
  let s = raw.trim();
  if (s === "" || s === "-") return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/Bs\.?/gi, "").replace(/[$\s]/g, "");
  if (s.startsWith("-")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/,/g, "");
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) throw new Error(`Unparseable money value: "${raw}"`);
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw new Error(`Money value out of range: "${raw}"`);
  return negative ? -cents : cents;
}

/** 120000 → "1200.00" (the exact string Postgres numeric(12,2) expects). */
export function centsToNumeric(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 120000 → "Bs. 1,200.00" for the console report. */
export function formatBs(cents: number): string {
  const [int, dec] = centsToNumeric(Math.abs(cents)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${cents < 0 ? "-" : ""}Bs. ${grouped}.${dec}`;
}

/** Strict non-negative integer parse; "" → null. */
export function toInt(raw: string): number | null {
  const s = raw.trim();
  if (s === "") return null;
  if (!/^-?\d+$/.test(s)) throw new Error(`Not an integer: "${raw}"`);
  return Number(s);
}

/**
 * Google Sheets "M/D/YYYY H:MM:SS" in the shop's local time → Date.
 * Venezuela is UTC-04:00 year-round (no DST).
 */
export const SHOP_UTC_OFFSET = "-04:00";

export function parseSheetDate(raw: string): Date {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(raw.trim());
  if (!m) throw new Error(`Unparseable date: "${raw}"`);
  const [, mo, d, y, h = "0", mi = "0", s = "0"] = m;
  const p = (v: string) => v.padStart(2, "0");
  const iso = `${y}-${p(mo)}-${p(d)}T${p(h)}:${p(mi)}:${p(s)}${SHOP_UTC_OFFSET}`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: "${raw}"`);
  return date;
}

/** "  bIaNeCCi " → "Bianecci", "maria jose" → "Maria Jose". */
export function normalizePersonName(raw: string): string {
  return raw
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("es")
    .replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toLocaleUpperCase("es"));
}
