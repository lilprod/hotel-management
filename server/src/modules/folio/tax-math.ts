/**
 * Pure folio tax maths (OP-94). Integers only (minor units, BigInt), no I/O.
 *
 * A charge is entered at its price "as priced" (gross). Taxes follow the same rules as the stay
 * quote (rates/quote.ts):
 *   1. fixed taxes (FIXED_PER_PERSON_NIGHT, FIXED_PER_NIGHT) are exact amounts; when inclusive
 *      they are taken out of the gross price first;
 *   2. inclusive percentages are extracted from what remains: tax = round(base × r / (100 + Σr));
 *   3. exclusive percentages apply on the net (HT) amount and are added to the price.
 * Rounding is half away from zero, so a negative amount (discount) mirrors its positive.
 */

export type FolioTaxKind = 'PERCENT' | 'FIXED_PER_PERSON_NIGHT' | 'FIXED_PER_NIGHT';

export interface FolioTaxSpec {
  id: string;
  code: string;
  name: string;
  type: FolioTaxKind;
  /** PERCENT: decimal string ("18", "7.5"); fixed taxes: integer minor units. */
  value: string;
  inclusive: boolean;
}

export interface ComputedTax {
  tax: FolioTaxSpec;
  /** Fixed taxes: persons (per person-night) or 1; percentages: 1. */
  qty: number;
  /** Fixed taxes: unit amount; percentages: the tax amount. */
  unitAmount: bigint;
  amount: bigint;
}

export interface TaxComputation {
  /** HT amount of the charge (gross minus inclusive taxes). */
  net: bigint;
  taxes: ComputedTax[];
  /** What the folio is charged in total: net + every tax. */
  total: bigint;
}

const SCALE = 10_000n;

export class TaxMathError extends Error {
  override readonly name = 'TaxMathError';
}

/** Decimal string → integer scaled by 10 000 (4 decimals max). */
export function parsePercent(value: string): bigint {
  const m = /^(\d{1,5})(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!m) throw new TaxMathError(`Invalid tax rate ${value}`);
  return BigInt(m[1]! + (m[2] ?? '').padEnd(4, '0'));
}

/** round(a × b / c), half away from zero (c > 0, b ≥ 0). */
export function mulDivRound(a: bigint, b: bigint, c: bigint): bigint {
  if (c <= 0n) throw new TaxMathError('Division by a non-positive number');
  const neg = a < 0n !== b < 0n;
  const x = (a < 0n ? -a : a) * (b < 0n ? -b : b);
  const q = (2n * x + c) / (2n * c);
  return neg ? -q : q;
}

function fixedUnit(t: FolioTaxSpec): bigint {
  if (!/^\d+(\.0+)?$/.test(t.value))
    throw new TaxMathError(`Fixed tax ${t.code} must be an integer amount`);
  return BigInt(t.value.split('.')[0]!);
}

/**
 * Taxes of one charge. `persons` is the number of taxable persons for per-person-night taxes;
 * fixed taxes are only meaningful for a room night (`withFixed`), other charges ignore them.
 */
export function computeTaxes(
  gross: bigint,
  taxes: readonly FolioTaxSpec[],
  opts: { persons?: number; withFixed?: boolean } = {},
): TaxComputation {
  const out: ComputedTax[] = [];
  const sign = gross < 0n ? -1n : 1n;
  let fixedIncl = 0n;
  if (opts.withFixed) {
    const persons = opts.persons ?? 1;
    if (!Number.isInteger(persons) || persons < 0) throw new TaxMathError('Invalid persons');
    for (const t of taxes.filter((x) => x.type !== 'PERCENT')) {
      const unit = fixedUnit(t) * sign;
      const qty = t.type === 'FIXED_PER_PERSON_NIGHT' ? persons : 1;
      const amount = unit * BigInt(qty);
      if (qty === 0) continue;
      if (t.inclusive) fixedIncl += amount;
      out.push({ tax: t, qty, unitAmount: unit, amount });
    }
  }
  const incl = taxes.filter((x) => x.type === 'PERCENT' && x.inclusive);
  const inclRates = incl.map((t) => parsePercent(t.value));
  const inclSum = inclRates.reduce((s, r) => s + r, 0n);
  const pctBase = gross - fixedIncl;
  let inclTotal = 0n;
  incl.forEach((t, i) => {
    const amount = mulDivRound(pctBase, inclRates[i]!, 100n * SCALE + inclSum);
    inclTotal += amount;
    out.push({ tax: t, qty: 1, unitAmount: amount, amount });
  });
  const net = gross - fixedIncl - inclTotal;
  for (const t of taxes.filter((x) => x.type === 'PERCENT' && !x.inclusive)) {
    const amount = mulDivRound(net, parsePercent(t.value), 100n * SCALE);
    out.push({ tax: t, qty: 1, unitAmount: amount, amount });
  }
  // Stable order: percentages first (by code), then fixed taxes.
  out.sort((a, b) =>
    a.tax.type === b.tax.type
      ? a.tax.code.localeCompare(b.tax.code)
      : a.tax.type === 'PERCENT'
        ? -1
        : 1,
  );
  return { net, taxes: out, total: net + out.reduce((s, x) => s + x.amount, 0n) };
}

/**
 * Splits a discount of `amount` (TTC, positive) proportionally over a line's net and tax parts,
 * so that the parts sum exactly to `amount` (the rounding remainder goes to the net part).
 */
export function splitProportional(
  amount: bigint,
  parts: { net: bigint; taxes: readonly bigint[] },
): { net: bigint; taxes: bigint[] } {
  const total = parts.net + parts.taxes.reduce((s, x) => s + x, 0n);
  if (total <= 0n) throw new TaxMathError('Nothing to split');
  const taxes = parts.taxes.map((t) => mulDivRound(t, amount, total));
  const net = amount - taxes.reduce((s, x) => s + x, 0n);
  return { net, taxes };
}

const FRACTION_CACHE = new Map<string, number>();

/** ISO 4217 minor unit exponent (XOF 0, EUR 2…), from ICU. */
export function currencyExponent(currency: string): number {
  let v = FRACTION_CACHE.get(currency);
  if (v === undefined) {
    try {
      v = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits;
    } catch {
      v = 2;
    }
    FRACTION_CACHE.set(currency, v ?? 2);
  }
  return v ?? 2;
}

export type FxRounding = 'DOWN' | 'HALF_UP';

/** Decimal rate string (≤ 8 decimals) → integer scaled by 1e8. */
export function parseRate(rate: string): bigint {
  const m = /^(\d{1,10})(?:\.(\d{1,8}))?$/.exec(rate.trim());
  if (!m) throw new TaxMathError(`Invalid exchange rate ${rate}`);
  const v = BigInt(m[1]! + (m[2] ?? '').padEnd(8, '0'));
  if (v <= 0n) throw new TaxMathError('Exchange rate must be positive');
  return v;
}

/**
 * Converts a tendered amount (minor units of `from`) into minor units of `to` with a rate
 * "1 unit of `from` = rate units of `to`", with an explicit rounding mode (EX-21).
 */
export function convertMinor(
  tendered: bigint,
  rate: string,
  from: string,
  to: string,
  rounding: FxRounding,
): bigint {
  if (tendered < 0n) throw new TaxMathError('Tendered amount must be positive');
  const num = tendered * parseRate(rate) * 10n ** BigInt(currencyExponent(to));
  const den = 10n ** BigInt(currencyExponent(from)) * 100_000_000n;
  return rounding === 'DOWN' ? num / den : (2n * num + den) / (2n * den);
}
