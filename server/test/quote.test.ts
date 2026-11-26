import { describe, expect, it } from 'vitest';
import {
  priceStay,
  QuoteError,
  type QuoteData,
  type QuoteRate,
  type QuoteSeason,
  type QuoteTax,
} from '../src/modules/rates/quote.js';

const ALL = 127;
const FRI_SAT = (1 << 5) | (1 << 6);
const rate = (o: Partial<QuoteRate> & { id: string }): QuoteRate => ({
  seasonId: null,
  dowMask: ALL,
  price: 30000,
  extraAdult: 5000,
  extraChild: 2000,
  minStay: 1,
  ...o,
});
const VAT_EXCL: QuoteTax = {
  id: 'vat',
  code: 'TVA',
  name: 'TVA',
  type: 'PERCENT',
  value: '18',
  inclusive: false,
};
const VAT_INCL: QuoteTax = { ...VAT_EXCL, inclusive: true };
const STAY_TAX: QuoteTax = {
  id: 'ts',
  code: 'TS',
  name: 'Taxe de séjour',
  type: 'FIXED_PER_PERSON_NIGHT',
  value: '500',
  inclusive: false,
};
const data = (o: Partial<QuoteData> = {}): QuoteData => ({
  currency: 'XOF',
  roomType: { baseOccupancy: 2, maxAdults: 3, maxChildren: 2 },
  rates: [rate({ id: 'r1' })],
  seasons: [],
  taxes: [],
  ...o,
});
// 2026-11-16 is a Monday; 2026-11-20 Friday, 2026-11-21 Saturday.
const stay = (arrival: string, departure: string, adults = 2, children = 0) => ({
  arrival,
  departure,
  adults,
  children,
});

describe('priceStay', () => {
  it('sums nights (departure excluded)', () => {
    const q = priceStay(data(), stay('2026-11-16', '2026-11-19'));
    expect(q.nights).toBe(3);
    expect(q.nightly.map((n) => n.date)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
    expect(q.total).toBe(90000);
  });

  it('season priority: higher priority season wins over a lower one and over no season', () => {
    const seasons: QuoteSeason[] = [
      { id: 'low', fromDate: '2026-11-01', toDate: '2026-11-30', priority: 1 },
      { id: 'high', fromDate: '2026-11-17', toDate: '2026-11-17', priority: 5 },
    ];
    const rates = [
      rate({ id: 'base', price: 20000 }),
      rate({ id: 'rl', seasonId: 'low', price: 30000 }),
      rate({ id: 'rh', seasonId: 'high', price: 50000 }),
    ];
    const q = priceStay(data({ seasons, rates }), stay('2026-11-16', '2026-11-19'));
    expect(q.nightly.map((n) => n.base)).toEqual([30000, 50000, 30000]);
    const out = priceStay(data({ seasons, rates }), stay('2026-12-01', '2026-12-02'));
    expect(out.nightly[0]?.base).toBe(20000);
  });

  it('weekend price: a Fri/Sat rate beats the all-week rate in the same season', () => {
    const rates = [
      rate({ id: 'wk', price: 30000 }),
      rate({ id: 'we', dowMask: FRI_SAT, price: 40000 }),
    ];
    const q = priceStay(data({ rates }), stay('2026-11-19', '2026-11-23'));
    // Thu, Fri, Sat, Sun
    expect(q.nightly.map((n) => n.base)).toEqual([30000, 40000, 40000, 30000]);
  });

  it('errors when a night has no rate', () => {
    const rates = [rate({ id: 'we', dowMask: FRI_SAT })];
    expect(() => priceStay(data({ rates }), stay('2026-11-16', '2026-11-17'))).toThrowError(
      expect.objectContaining({ code: 'NO_RATE' }),
    );
  });

  it('extra adults beyond base occupancy and children, per night', () => {
    const q = priceStay(data(), stay('2026-11-16', '2026-11-18', 3, 2));
    // per night: 30000 + 1 extra adult 5000 + 2 children 4000
    expect(q.nightly[0]).toMatchObject({
      extraAdultAmount: 5000,
      extraChildAmount: 4000,
      total: 39000,
    });
    expect(q.roomTotal).toBe(60000);
    expect(q.extrasTotal).toBe(18000);
    expect(q.total).toBe(78000);
  });

  it('rejects occupancy above capacity or without adult', () => {
    expect(() => priceStay(data(), stay('2026-11-16', '2026-11-17', 4))).toThrowError(QuoteError);
    expect(() => priceStay(data(), stay('2026-11-16', '2026-11-17', 2, 3))).toThrowError(
      QuoteError,
    );
    expect(() => priceStay(data(), stay('2026-11-16', '2026-11-17', 0))).toThrowError(
      expect.objectContaining({ code: 'INVALID_OCCUPANCY' }),
    );
  });

  it('min stay from the arrival night rate', () => {
    const rates = [rate({ id: 'r', minStay: 3 })];
    expect(() => priceStay(data({ rates }), stay('2026-11-16', '2026-11-18'))).toThrowError(
      expect.objectContaining({ code: 'MIN_STAY' }),
    );
    expect(priceStay(data({ rates }), stay('2026-11-16', '2026-11-19')).minStay).toBe(3);
  });

  it('max stay from the arrival night rate (null = no maximum)', () => {
    const rates = [rate({ id: 'r', maxStay: 2 })];
    expect(() => priceStay(data({ rates }), stay('2026-11-16', '2026-11-19'))).toThrowError(
      expect.objectContaining({ code: 'MAX_STAY', meta: { maxStay: 2, nights: 3 } }),
    );
    expect(priceStay(data({ rates }), stay('2026-11-16', '2026-11-18')).maxStay).toBe(2);
    expect(priceStay(data(), stay('2026-11-16', '2026-11-30')).maxStay).toBeNull();
  });

  it('closed to arrival on the nights of the restricted rate only', () => {
    // Weekend rate closed to arrival: Friday arrival refused, Thursday arrival through it allowed.
    const rates = [rate({ id: 'a' }), rate({ id: 'w', dowMask: FRI_SAT, closedToArrival: true })];
    expect(() => priceStay(data({ rates }), stay('2026-11-20', '2026-11-22'))).toThrowError(
      expect.objectContaining({ code: 'CLOSED_TO_ARRIVAL', meta: { date: '2026-11-20' } }),
    );
    expect(priceStay(data({ rates }), stay('2026-11-19', '2026-11-22')).nights).toBe(3);
  });

  it('closed to departure on the day the restricted rate applies to', () => {
    const rates = [rate({ id: 'a' }), rate({ id: 'w', dowMask: FRI_SAT, closedToDeparture: true })];
    // Departure on Saturday 2026-11-21: refused; on Sunday: allowed (the Sat night is fine).
    expect(() => priceStay(data({ rates }), stay('2026-11-19', '2026-11-21'))).toThrowError(
      expect.objectContaining({ code: 'CLOSED_TO_DEPARTURE', meta: { date: '2026-11-21' } }),
    );
    expect(priceStay(data({ rates }), stay('2026-11-19', '2026-11-22')).nights).toBe(3);
  });

  it('restrictions follow the season rate (per season)', () => {
    const seasons: QuoteSeason[] = [
      { id: 'hi', fromDate: '2026-12-20', toDate: '2027-01-05', priority: 10 },
    ];
    const rates = [
      rate({ id: 'base' }),
      rate({ id: 'xmas', seasonId: 'hi', minStay: 2, maxStay: 7, closedToArrival: false }),
    ];
    expect(() =>
      priceStay(data({ rates, seasons }), stay('2026-12-24', '2026-12-25')),
    ).toThrowError(expect.objectContaining({ code: 'MIN_STAY' }));
    expect(() =>
      priceStay(data({ rates, seasons }), stay('2026-12-20', '2026-12-30')),
    ).toThrowError(expect.objectContaining({ code: 'MAX_STAY' }));
    expect(priceStay(data({ rates, seasons }), stay('2026-12-10', '2026-12-11')).nights).toBe(1);
  });

  it('VAT exclusive is added to the price', () => {
    const q = priceStay(data({ taxes: [VAT_EXCL] }), stay('2026-11-16', '2026-11-17'));
    expect(q.netSubtotal).toBe(30000);
    expect(q.taxes[0]?.amount).toBe(5400);
    expect(q.total).toBe(35400);
  });

  it('VAT inclusive is extracted from the price (total unchanged)', () => {
    const q = priceStay(data({ taxes: [VAT_INCL] }), stay('2026-11-16', '2026-11-17'));
    // 30000 * 18 / 118 = 4576.27 -> 4576
    expect(q.taxes[0]?.amount).toBe(4576);
    expect(q.netSubtotal).toBe(25424);
    expect(q.inclusiveTaxTotal).toBe(4576);
    expect(q.total).toBe(30000);
  });

  it('taxe de séjour is per person and per night, VAT does not apply on it', () => {
    const q = priceStay(
      data({ taxes: [VAT_EXCL, STAY_TAX] }),
      stay('2026-11-16', '2026-11-19', 2, 1),
    );
    const ts = q.taxes.find((t) => t.code === 'TS');
    expect(ts?.amount).toBe(500 * 3 * 3);
    // base: 3 nights * (30000 + 2000 child) = 96000 ; VAT 18% = 17280
    expect(q.taxes.find((t) => t.code === 'TVA')?.amount).toBe(17280);
    expect(q.total).toBe(96000 + 17280 + 4500);
  });

  it('fixed per night tax', () => {
    const t: QuoteTax = {
      ...STAY_TAX,
      id: 'pn',
      code: 'PN',
      type: 'FIXED_PER_NIGHT',
      value: '1000',
    };
    const q = priceStay(data({ taxes: [t] }), stay('2026-11-16', '2026-11-18', 2, 0));
    expect(q.taxes[0]?.amount).toBe(2000);
  });

  it('returns integers only', () => {
    const t: QuoteTax = { ...VAT_EXCL, value: '7.5' };
    const q = priceStay(
      data({ taxes: [t], rates: [rate({ id: 'r', price: 33333 })] }),
      stay('2026-11-16', '2026-11-19'),
    );
    for (const n of [q.total, q.netSubtotal, ...q.taxes.map((x) => x.amount)])
      expect(Number.isInteger(n)).toBe(true);
    expect(q.taxes[0]?.amount).toBe(7500); // 99999 * 7.5% = 7499.9
  });

  it('rejects invalid dates', () => {
    expect(() => priceStay(data(), stay('2026-11-18', '2026-11-18'))).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATES' }),
    );
    expect(() => priceStay(data(), stay('2026-02-30', '2026-03-02'))).toThrowError(
      expect.objectContaining({ code: 'INVALID_DATES' }),
    );
  });
});
