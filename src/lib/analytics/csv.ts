/**
 * Minimal RFC 4180 CSV writer.
 * Text cells that start with = + - @ (or tab/CR) are prefixed with an
 * apostrophe so a spreadsheet never evaluates user-entered data (client or
 * product names) as a formula. Numbers are written raw (no "Bs." formatting)
 * so the file stays analyzable.
 */
export type CsvCell = string | number | null | undefined;

function cell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : "";
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
