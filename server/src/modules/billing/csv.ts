import type { Response } from 'express';

/** CSV cell with the formula-injection guard (numbers are written as is). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): string {
  const lines = [columns.join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c])).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Sends a UTF-8 CSV (BOM for spreadsheet apps) as an attachment. */
export function sendCsv(
  res: Response,
  filename: string,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
): void {
  res
    .status(200)
    .type('text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`${String.fromCharCode(0xfeff)}${toCsv(columns, rows)}`);
}
