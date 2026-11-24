import { CURRENCY_MINOR_UNITS, formatMoney } from '@hm/shared';

import type { FolioLine, FolioPayment, TaxRow } from './api';

/** Pure billing rules of the folio screens (display only: the server stays the authority). */

export const money = (amount: number, currency = 'XOF'): string =>
  currency in CURRENCY_MINOR_UNITS ? formatMoney({ amount, currency }) : `${amount} ${currency}`;

export interface LineNode {
  line: FolioLine;
  /** Tax and discount lines of this charge. */
  children: FolioLine[];
}
export interface DayGroup {
  date: string;
  nodes: LineNode[];
  total: number;
}

const isChild = (l: FolioLine) =>
  (l.sourceType === 'tax' || l.sourceType === 'discount') && !!l.sourceId;

/** Lines grouped by business date (ascending), taxes and discounts nested under their charge. */
export function groupLines(lines: readonly FolioLine[]): DayGroup[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const kids = new Map<string, FolioLine[]>();
  const roots: FolioLine[] = [];
  for (const l of lines) {
    if (isChild(l) && byId.has(l.sourceId!)) {
      const list = kids.get(l.sourceId!) ?? [];
      list.push(l);
      kids.set(l.sourceId!, list);
    } else roots.push(l);
  }
  const days = new Map<string, DayGroup>();
  const sorted = [...roots].sort(
    (a, b) =>
      a.businessDate.localeCompare(b.businessDate) || a.createdAt.localeCompare(b.createdAt),
  );
  for (const l of sorted) {
    const g = days.get(l.businessDate) ?? { date: l.businessDate, nodes: [], total: 0 };
    const children = kids.get(l.id) ?? [];
    g.nodes.push({ line: l, children });
    g.total += l.amount + children.reduce((s, c) => s + c.amount, 0);
    days.set(l.businessDate, g);
  }
  return [...days.values()];
}

/** A charge can be discounted / reversed while it is live (not a reversal, not already reversed). */
export const isLiveCharge = (l: FolioLine) =>
  !l.reversalOfId && !l.reversedById && l.type !== 'TAX' && l.type !== 'DISCOUNT';

/** Totals per tax rate for the invoice preview (rows come from the folio tax breakdown). */
export function previewByRate(rows: readonly TaxRow[]) {
  return rows.map((r) => ({
    key: r.code,
    label: r.rate ? `${r.name} (${r.rate} %)` : r.name,
    base: r.base,
    amount: r.amount,
  }));
}

/** Converts a tender with "1 from = rate to" (half-up, like the server default). Integers only. */
export function convertTender(tendered: number, rate: string, from: string, to: string): number {
  const exp = (c: string) => CURRENCY_MINOR_UNITS[c] ?? 0;
  const [whole = '0', frac = ''] = rate.split('.');
  const scaled = BigInt(whole + frac.padEnd(8, '0').slice(0, 8));
  const num = BigInt(tendered) * scaled * 10n ** BigInt(exp(to));
  const den = 10n ** BigInt(exp(from)) * 100_000_000n;
  return Number((2n * num + den) / (2n * den));
}

/** Amount applied and change to give for a tender in another currency. */
export function tenderSummary(opts: {
  balance: number;
  amount: number | null;
  tendered: number | null;
  rate: string | null;
  from: string;
  to: string;
}) {
  if (opts.tendered === null || !opts.rate) return null;
  const converted = convertTender(opts.tendered, opts.rate, opts.from, opts.to);
  const applied =
    opts.amount ?? (opts.balance > 0 && converted > opts.balance ? opts.balance : converted);
  return {
    converted,
    applied,
    change: Math.max(converted - applied, 0),
    tooLow: converted < applied,
  };
}

export const isReversed = (p: FolioPayment) => p.status === 'REVERSED' || !!p.reversedById;

/** Variance (counted - expected) per tender, from the amounts typed in the close form. */
export function varianceRows(
  expected: readonly { method: string; currency: string; expected: number }[],
  counted: Record<string, number | null>,
) {
  return expected.map((e) => {
    const key = `${e.method}:${e.currency}`;
    const c = counted[key] ?? 0;
    return { ...e, key, counted: c, variance: c - e.expected };
  });
}

/** Major-unit input (what the cashier types) to integer minor units of `currency`. */
export function toMinor(value: number | null | undefined, currency: string): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(value * 10 ** (CURRENCY_MINOR_UNITS[currency] ?? 0));
}
export function fromMinor(value: number, currency: string): number {
  return value / 10 ** (CURRENCY_MINOR_UNITS[currency] ?? 0);
}
