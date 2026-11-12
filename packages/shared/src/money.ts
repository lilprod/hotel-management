import { z } from 'zod';

/** Money is always an integer in minor units + ISO 4217 currency. Never a float. */
export const DEFAULT_CURRENCY = 'XOF';

export const CURRENCY_MINOR_UNITS: Readonly<Record<string, number>> = {
  XOF: 0,
  EUR: 2,
  USD: 2,
};

export const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  XOF: 'FCFA',
  EUR: '€',
  USD: '$',
};

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL' | 'TRUNCATE';

export interface Money {
  /** Integer amount in minor units of `currency`. */
  amount: number;
  currency: string;
}

export function minorUnits(currency: string): number {
  const digits = CURRENCY_MINOR_UNITS[currency];
  if (digits === undefined) throw new RangeError(`Unknown currency: ${currency}`);
  return digits;
}

function assertInt(n: number, label = 'amount'): void {
  if (!Number.isSafeInteger(n)) throw new RangeError(`${label} must be a safe integer, got ${n}`);
}

function assertSame(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new RangeError(`Currency mismatch: ${a.currency} vs ${b.currency}`);
  }
}

export function money(amount: number, currency: string = DEFAULT_CURRENCY): Money {
  assertInt(amount);
  minorUnits(currency);
  return { amount, currency };
}

export function addMoney(a: Money, b: Money): Money {
  assertSame(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSame(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function negateMoney(a: Money): Money {
  return money(a.amount === 0 ? 0 : -a.amount, a.currency);
}

export function sumMoney(items: readonly Money[], currency: string = DEFAULT_CURRENCY): Money {
  return items.reduce((acc, m) => addMoney(acc, m), money(0, currency));
}

/** Round a rational number (num/den, den > 0, both integers) to an integer. */
function roundRatio(num: number, den: number, mode: RoundingMode): number {
  const q = Math.floor(num / den);
  const r = num - q * den; // 0 <= r < den
  if (r === 0) return q;
  const twice = r * 2;
  switch (mode) {
    case 'FLOOR':
      return q;
    case 'CEIL':
      return q + 1;
    case 'TRUNCATE':
      return num < 0 ? q + 1 : q;
    case 'HALF_UP': // ties away from zero
      if (twice > den) return q + 1;
      if (twice < den) return q;
      return num < 0 ? q : q + 1;
    case 'HALF_EVEN':
      if (twice > den) return q + 1;
      if (twice < den) return q;
      return q % 2 === 0 ? q : q + 1;
  }
}

/**
 * Multiply by a rational rate expressed as integers (e.g. 18 % VAT = 18/100, or basis points 1800/10000).
 * Avoids float drift: the product is exact as long as it stays a safe integer.
 */
export function multiplyByRatio(
  value: Money,
  numerator: number,
  denominator: number,
  mode: RoundingMode = 'HALF_UP',
): Money {
  assertInt(numerator, 'numerator');
  assertInt(denominator, 'denominator');
  if (denominator <= 0) throw new RangeError('denominator must be > 0');
  const product = value.amount * numerator;
  assertInt(product, 'product');
  return money(roundRatio(product, denominator, mode), value.currency);
}

/** Multiply by a rate in basis points (1800 = 18 %). */
export function multiplyByBasisPoints(
  value: Money,
  bp: number,
  mode: RoundingMode = 'HALF_UP',
): Money {
  return multiplyByRatio(value, bp, 10_000, mode);
}

/**
 * Multiply by a decimal rate given as a string or number (e.g. "0.18", 0.075). The rate is converted
 * to an exact integer ratio (max 6 decimals) before computing, so no float arithmetic touches the amount.
 */
export function multiplyByRate(
  value: Money,
  rate: number | string,
  mode: RoundingMode = 'HALF_UP',
): Money {
  const text = typeof rate === 'number' ? String(rate) : rate.trim();
  if (!/^-?\d+(\.\d{1,6})?$/.test(text)) {
    throw new RangeError(`Invalid rate: ${text} (max 6 decimals, no exponent)`);
  }
  const [intPart = '0', frac = ''] = text.split('.');
  const denominator = 10 ** frac.length;
  const numerator = Number(intPart.replace('-', '') + frac) * (text.startsWith('-') ? -1 : 1);
  return multiplyByRatio(value, numerator, denominator, mode);
}

/** Split an amount into `parts` shares (largest-remainder: earlier shares get the extra unit). */
export function allocateMoney(value: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0)
    throw new RangeError('parts must be a positive integer');
  const base = Math.trunc(value.amount / parts);
  let remainder = value.amount - base * parts;
  const step = remainder < 0 ? -1 : 1;
  return Array.from({ length: parts }, () => {
    const extra = remainder !== 0 ? step : 0;
    remainder -= extra;
    return money(base + extra, value.currency);
  });
}

export type MoneyLocale = 'fr-TG' | 'fr-FR';

/** Group digits with a (narrow) no-break space, independent of ICU data availability. */
function groupThousands(digits: string, sep: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/**
 * Format money. XOF: "1 250 000 FCFA" (no-break space grouping, suffix).
 * Other currencies: 2 decimals with comma separator, suffix symbol ("12,50 €").
 */
export function formatMoney(value: Money, locale: MoneyLocale = 'fr-TG'): string {
  const digits = minorUnits(value.currency);
  const sign = value.amount < 0 ? '-' : '';
  const abs = Math.abs(value.amount);
  const sep = locale === 'fr-FR' ? ' ' : ' ';
  const symbol = CURRENCY_SYMBOLS[value.currency] ?? value.currency;
  let body: string;
  if (digits === 0) {
    body = groupThousands(String(abs), sep);
  } else {
    const factor = 10 ** digits;
    const whole = Math.floor(abs / factor);
    const frac = String(abs % factor).padStart(digits, '0');
    body = `${groupThousands(String(whole), sep)},${frac}`;
  }
  return `${sign}${body}\u00A0${symbol}`;
}

export const currencyCodeSchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/)
  .refine((c) => c in CURRENCY_MINOR_UNITS, 'Unsupported currency');

/** Integer minor units, safe-integer range. */
export const amountSchema = z.number().int().safe();

export const moneySchema = z.object({
  amount: amountSchema,
  currency: currencyCodeSchema.default(DEFAULT_CURRENCY),
});
export type MoneyInput = z.input<typeof moneySchema>;
