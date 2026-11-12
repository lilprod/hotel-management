import { describe, expect, it } from 'vitest';
import {
  addMoney,
  allocateMoney,
  formatMoney,
  money,
  moneySchema,
  multiplyByBasisPoints,
  multiplyByRate,
  multiplyByRatio,
  subMoney,
} from './money.js';

const xof = (n: number) => money(n, 'XOF');

describe('money math', () => {
  it('adds and subtracts in the same currency', () => {
    expect(addMoney(xof(100), xof(50)).amount).toBe(150);
    expect(subMoney(xof(100), xof(150)).amount).toBe(-50);
  });

  it('rejects currency mismatch, floats and unknown currency', () => {
    expect(() => addMoney(xof(1), money(1, 'EUR'))).toThrow();
    expect(() => money(1.5)).toThrow();
    expect(() => money(1, 'ZZZ')).toThrow();
  });

  it('rounds 18 % VAT with explicit modes', () => {
    expect(multiplyByRatio(xof(25), 18, 100, 'HALF_UP').amount).toBe(5); // 4.5 -> 5
    expect(multiplyByRatio(xof(25), 18, 100, 'HALF_EVEN').amount).toBe(4); // 4.5 -> 4
    expect(multiplyByRatio(xof(25), 18, 100, 'FLOOR').amount).toBe(4);
    expect(multiplyByRatio(xof(21), 18, 100, 'CEIL').amount).toBe(4); // 3.78
    expect(multiplyByRatio(xof(-25), 18, 100, 'HALF_UP').amount).toBe(-5);
    expect(multiplyByRatio(xof(-25), 18, 100, 'TRUNCATE').amount).toBe(-4);
    expect(multiplyByRatio(xof(-25), 18, 100, 'FLOOR').amount).toBe(-5);
  });

  it('multiplies by decimal rate and basis points without float drift', () => {
    expect(multiplyByRate(xof(1_000_000), '0.18').amount).toBe(180_000);
    expect(multiplyByRate(xof(100), 0.075).amount).toBe(8); // 7.5 half up
    expect(multiplyByBasisPoints(xof(50_000), 1500).amount).toBe(7_500);
    expect(() => multiplyByRate(xof(1), '1e-3')).toThrow();
  });

  it('allocates without losing units', () => {
    const parts = allocateMoney(xof(100), 3);
    expect(parts.map((p) => p.amount)).toEqual([34, 33, 33]);
    expect(allocateMoney(xof(-100), 3).reduce((s, p) => s + p.amount, 0)).toBe(-100);
  });
});

describe('formatMoney', () => {
  it('formats XOF as "1 250 000 FCFA"', () => {
    expect(formatMoney(xof(1_250_000))).toBe('1 250 000 FCFA');
    expect(formatMoney(xof(1_250_000)).replace(/\u00A0/g, ' ')).toBe('1 250 000 FCFA');
    expect(formatMoney(xof(0))).toBe('0 FCFA');
    expect(formatMoney(xof(-5000))).toBe('-5 000 FCFA');
  });

  it('fr-FR uses narrow no-break space grouping', () => {
    expect(formatMoney(xof(1_250_000), 'fr-FR')).toBe('1 250 000 FCFA');
  });

  it('formats 2-decimal currencies', () => {
    expect(formatMoney(money(123_456, 'EUR'))).toBe('1 234,56 €');
    expect(formatMoney(money(5, 'USD'))).toBe('0,05 $');
  });
});

describe('moneySchema', () => {
  it('defaults currency to XOF and rejects floats', () => {
    expect(moneySchema.parse({ amount: 100 })).toEqual({ amount: 100, currency: 'XOF' });
    expect(moneySchema.safeParse({ amount: 1.5 }).success).toBe(false);
    expect(moneySchema.safeParse({ amount: 1, currency: 'xof' }).success).toBe(false);
  });
});
