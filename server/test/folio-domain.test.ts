import { describe, expect, it } from 'vitest';
import { breakdown, rateLabel } from '../src/modules/folio/repository.js';
import {
  computeTaxes,
  convertMinor,
  currencyExponent,
  mulDivRound,
  splitProportional,
  type FolioTaxSpec,
} from '../src/modules/folio/tax-math.js';

const tva = (inclusive: boolean, value = '18'): FolioTaxSpec => ({
  id: 't1',
  code: 'TVA18',
  name: 'TVA 18 %',
  type: 'PERCENT',
  value,
  inclusive,
});
const sejour = (inclusive = false): FolioTaxSpec => ({
  id: 't2',
  code: 'TS',
  name: 'Taxe de séjour',
  type: 'FIXED_PER_PERSON_NIGHT',
  value: '1000',
  inclusive,
});

describe('folio tax maths', () => {
  it('exclusive VAT is added on the HT price', () => {
    const c = computeTaxes(30_000n, [tva(false)]);
    expect(c.net).toBe(30_000n);
    expect(c.taxes.map((t) => t.amount)).toEqual([5_400n]);
    expect(c.total).toBe(35_400n);
  });

  it('inclusive VAT is extracted from the TTC price, the total is unchanged', () => {
    const c = computeTaxes(50_000n, [tva(true)]);
    // 50 000 × 18 / 118 = 7 627.12 → 7 627 ; net 42 373
    expect(c.taxes[0]!.amount).toBe(7_627n);
    expect(c.net).toBe(42_373n);
    expect(c.total).toBe(50_000n);
  });

  it('tourist tax per person-night, exclusive or inclusive, only on room nights', () => {
    const c = computeTaxes(30_000n, [tva(false), sejour()], { persons: 3, withFixed: true });
    expect(c.taxes.map((t) => [t.tax.code, t.qty, t.unitAmount, t.amount])).toEqual([
      ['TVA18', 1, 5_400n, 5_400n],
      ['TS', 3, 1_000n, 3_000n],
    ]);
    expect(c.total).toBe(38_400n);
    // Inclusive fixed tax is taken out of the price before the inclusive VAT.
    const i = computeTaxes(32_000n, [tva(true), sejour(true)], { persons: 2, withFixed: true });
    expect(i.taxes.find((t) => t.tax.code === 'TS')!.amount).toBe(2_000n);
    expect(i.taxes.find((t) => t.tax.code === 'TVA18')!.amount).toBe(4_576n);
    expect(i.net).toBe(25_424n);
    expect(i.total).toBe(32_000n);
    // Not a room night: fixed taxes are ignored.
    expect(computeTaxes(30_000n, [sejour()]).taxes).toEqual([]);
  });

  it('rounds half away from zero and mirrors negatives', () => {
    expect(mulDivRound(5n, 1n, 2n)).toBe(3n);
    expect(mulDivRound(-5n, 1n, 2n)).toBe(-3n);
    const pos = computeTaxes(1_003n, [tva(false, '7.5')]);
    const neg = computeTaxes(-1_003n, [tva(false, '7.5')]);
    expect(pos.taxes[0]!.amount).toBe(75n); // 75.225
    expect(neg.taxes[0]!.amount).toBe(-75n);
    expect(computeTaxes(1_000n, [tva(false, '0.05')]).taxes[0]!.amount).toBe(1n); // 0.5 → 1
  });

  it('splits a discount exactly over net and taxes', () => {
    const s = splitProportional(3_541n, { net: 30_000n, taxes: [5_400n] });
    expect(s.net + s.taxes[0]!).toBe(3_541n);
    expect(s.taxes[0]).toBe(540n);
  });

  it('converts a foreign tender with an explicit rounding (EX-21)', () => {
    expect(currencyExponent('XOF')).toBe(0);
    expect(currencyExponent('EUR')).toBe(2);
    // 100.00 EUR at 655.957 = 65 595.7 XOF
    expect(convertMinor(10_000n, '655.957', 'EUR', 'XOF', 'DOWN')).toBe(65_595n);
    expect(convertMinor(10_000n, '655.957', 'EUR', 'XOF', 'HALF_UP')).toBe(65_596n);
    expect(convertMinor(5_000n, '1', 'XOF', 'XOF', 'DOWN')).toBe(5_000n);
  });

  it('breaks a set of lines down per tax rate, tourist tax apart', () => {
    const l = (id: string, type: string, amount: number, extra: Record<string, unknown> = {}) => ({
      id,
      type: type as 'ROOM',
      amount: BigInt(amount),
      sourceType: null,
      sourceId: null,
      departmentCode: null,
      label: id,
      ...extra,
    });
    const lines = [
      l('room', 'ROOM', 30_000),
      l('vat', 'TAX', 5_400, { sourceType: 'tax', sourceId: 'room', departmentCode: 'TVA18' }),
      l('ts', 'TAX', 2_000, { sourceType: 'tax', sourceId: 'room', departmentCode: 'TS' }),
      l('misc', 'EXTRA', 1_000),
    ];
    const taxes = new Map([
      ['TVA18', { code: 'TVA18', name: 'TVA 18 %', type: 'PERCENT' as const, value: '18.0000' }],
      ['TS', { code: 'TS', name: 'Taxe de séjour', type: 'FIXED_PER_PERSON_NIGHT' as const, value: '1000' }],
    ]);
    const b = breakdown(lines, taxes);
    expect(b).toMatchObject({ net: 31_000, percentTax: 5_400, fixedTax: 2_000, total: 38_400, untaxedBase: 1_000 });
    expect(b.rows).toEqual([
      { code: 'TVA18', name: 'TVA 18 %', type: 'PERCENT', rate: '18', base: 30_000, amount: 5_400 },
      { code: 'TS', name: 'Taxe de séjour', type: 'FIXED_PER_PERSON_NIGHT', rate: null, base: 30_000, amount: 2_000 },
    ]);
    expect(rateLabel('7.5000')).toBe('7.5');
  });
});
