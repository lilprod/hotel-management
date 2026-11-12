import { describe, expect, it } from 'vitest';
import { formatPhone, normalizePhone, phoneSchema } from './phone.js';

const e164 = (s: string) => {
  const r = normalizePhone(s);
  return r.ok ? r.e164 : r.reason;
};

describe('normalizePhone', () => {
  it('normalizes Togo numbers', () => {
    expect(e164('90 12 34 56')).toBe('+22890123456');
    expect(e164('+228 90 12 34 56')).toBe('+22890123456');
    expect(e164('00228-90-12-34-56')).toBe('+22890123456');
    expect(e164('228 90123456')).toBe('+22890123456');
  });

  it('rejects malformed Togo numbers', () => {
    expect(e164('901234')).toBe('INVALID');
    expect(e164('+228 9012345')).toBe('INVALID');
    expect(e164('+228 901234567')).toBe('INVALID');
    expect(e164('abc')).toBe('INVALID');
    expect(e164('  ')).toBe('EMPTY');
  });

  it('accepts generic international numbers', () => {
    expect(e164('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(e164('0033612345678')).toBe('+33612345678');
    expect(e164('+1')).toBe('INVALID');
  });

  it('flags the country', () => {
    expect(normalizePhone('90123456')).toMatchObject({ ok: true, country: 'TG' });
    expect(normalizePhone('+33612345678')).toMatchObject({ ok: true, country: null });
  });
});

describe('phoneSchema / formatPhone', () => {
  it('transforms to E.164 or fails', () => {
    expect(phoneSchema.parse('90 12 34 56')).toBe('+22890123456');
    expect(phoneSchema.safeParse('12').success).toBe(false);
  });

  it('formats Togo numbers for display', () => {
    expect(formatPhone('+22890123456')).toBe('+228 90 12 34 56');
    expect(formatPhone('+33612345678')).toBe('+33612345678');
  });
});
