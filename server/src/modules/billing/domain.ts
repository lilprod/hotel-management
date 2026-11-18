/**
 * Pure billing arithmetic (doc 02 §3): calendar dates, billing cycles, prorata, VAT and coupon
 * discounts. Money is always an integer of minor units (`bigint`, XOF = 0 decimals), never a
 * float; every division rounds half up explicitly.
 */

/** Calendar date `YYYY-MM-DD` (the platform stores billing dates as DATE / UTC midnight). */
export type IsoDate = string;

export type Cycle = 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export const CYCLE_MONTHS: Record<Cycle, number> = { MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: string): boolean {
  return ISO_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function toIsoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function fromIsoDate(s: IsoDate): Date {
  if (!isIsoDate(s)) throw new RangeError(`Invalid date ${s}`);
  return new Date(`${s}T00:00:00.000Z`);
}

export function addDays(s: IsoDate, days: number): IsoDate {
  const d = fromIsoDate(s);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDate(d);
}

/** Adds months, clamping to the end of the month (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s: IsoDate, months: number): IsoDate {
  const d = fromIsoDate(s);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toIsoDate(d);
}

/** Whole days from `a` to `b` (`b - a`). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((fromIsoDate(b).getTime() - fromIsoDate(a).getTime()) / 86_400_000);
}

export const minDate = (a: IsoDate, b: IsoDate) => (a <= b ? a : b);
export const maxDate = (a: IsoDate, b: IsoDate) => (a >= b ? a : b);

/** End (exclusive) of a billing period starting on `start`. */
export function periodEndOf(start: IsoDate, cycle: Cycle): IsoDate {
  return addMonths(start, CYCLE_MONTHS[cycle]);
}

/** Local calendar date of `now` in an IANA time zone. */
export function localDate(now: Date, timeZone: string): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Minutes since local midnight of `now` in an IANA time zone. */
export function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/** `a * num / den`, rounded half up (non-negative operands). */
export function mulDivRound(a: bigint, num: bigint, den: bigint): bigint {
  if (den <= 0n) throw new RangeError('Denominator must be positive');
  const sign = a * num < 0n ? -1n : 1n;
  const abs = (a * num * sign + den / 2n) / den;
  return abs * sign;
}

/**
 * Upgrade prorata (doc 02 §3): `(new − old) × remaining_days / period_days`, rounded half up,
 * never negative (a cheaper plan is a downgrade, applied at the period end).
 */
export function prorata(
  newPrice: bigint,
  oldPrice: bigint,
  remainingDays: number,
  periodDays: number,
): bigint {
  if (periodDays <= 0) return 0n;
  const remaining = Math.max(0, Math.min(remainingDays, periodDays));
  const diff = newPrice - oldPrice;
  if (diff <= 0n || remaining === 0) return 0n;
  return mulDivRound(diff, BigInt(remaining), BigInt(periodDays));
}

/** Tax of a net amount at `rateBps` basis points (1800 = 18 %), rounded half up. */
export function taxOf(net: bigint, rateBps: number): bigint {
  if (rateBps <= 0 || net <= 0n) return 0n;
  return mulDivRound(net, BigInt(rateBps), 10_000n);
}

/** Basis points of a percentage given as a decimal string (`"12.5"` → 1250). */
export function percentToBps(value: string | number): number {
  const s = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new RangeError(`Invalid percentage ${s}`);
  const [int, frac = ''] = s.split('.');
  return Number(int) * 100 + Number(frac.padEnd(2, '0'));
}

export type CouponKind = 'PERCENT' | 'AMOUNT' | 'FREE_MONTHS';

export interface CouponTerms {
  type: CouponKind;
  /** PERCENT: percentage ("10"); AMOUNT: minor units; FREE_MONTHS: number of months. */
  value: string;
  /** Number of billing cycles the coupon applies to (`null` = forever). */
  duration: number | null;
}

/**
 * Discount of a coupon on one period invoice (base = plan + add-ons for the cycle).
 * `cyclesUsed` = period invoices already discounted by this coupon.
 */
export function couponDiscount(
  terms: CouponTerms,
  base: bigint,
  cycle: Cycle,
  cyclesUsed: number,
): bigint {
  if (base <= 0n) return 0n;
  const months = CYCLE_MONTHS[cycle];
  let discount = 0n;
  if (terms.type === 'FREE_MONTHS') {
    const free = Math.trunc(Number(terms.value));
    const remainingMonths = free - cyclesUsed * months;
    if (remainingMonths <= 0) return 0n;
    discount = mulDivRound(base, BigInt(Math.min(remainingMonths, months)), BigInt(months));
  } else {
    if (terms.duration !== null && cyclesUsed >= terms.duration) return 0n;
    discount =
      terms.type === 'PERCENT'
        ? mulDivRound(base, BigInt(percentToBps(terms.value)), 10_000n)
        : BigInt(Math.trunc(Number(terms.value)));
  }
  return discount > base ? base : discount < 0n ? 0n : discount;
}

/** Status of an invoice from its total and paid amount (VOID / DRAFT are kept as is). */
export function invoiceStatusOf(
  current: string,
  total: bigint,
  paid: bigint,
): 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID' | 'DRAFT' {
  if (current === 'VOID' || current === 'DRAFT') return current;
  if (paid >= total) return 'PAID';
  if (paid > 0n) return 'PARTIALLY_PAID';
  return 'ISSUED';
}

export interface OpenInvoice {
  id: string;
  dueDate: IsoDate;
  issueDate: IsoDate;
  number: string;
  balance: bigint;
}

export interface Allocation {
  invoiceId: string;
  amount: bigint;
}

/**
 * Automatic allocation: oldest open invoice first (due date, then issue date, then number).
 * Returns the allocations and the remainder (future tenant credit).
 */
export function allocateOldestFirst(
  amount: bigint,
  invoices: readonly OpenInvoice[],
): { allocations: Allocation[]; remainder: bigint } {
  const sorted = [...invoices]
    .filter((i) => i.balance > 0n)
    .sort(
      (a, b) =>
        a.dueDate.localeCompare(b.dueDate) ||
        a.issueDate.localeCompare(b.issueDate) ||
        a.number.localeCompare(b.number),
    );
  let left = amount;
  const allocations: Allocation[] = [];
  for (const inv of sorted) {
    if (left <= 0n) break;
    const take = inv.balance < left ? inv.balance : left;
    allocations.push({ invoiceId: inv.id, amount: take });
    left -= take;
  }
  return { allocations, remainder: left };
}
