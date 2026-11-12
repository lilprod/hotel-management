import { describe, expect, it } from 'vitest';
import {
  PAYMENT_METHOD_LABELS,
  PLATFORM_PAYMENT_METHODS,
  TENANT_PAYMENT_METHODS,
} from './enums.js';
import {
  ERROR_CODES,
  cursorPageSchema,
  cursorPaginationQuerySchema,
  createProblem,
  dateOnlySchema,
  problemSchema,
  uuidSchema,
} from './http.js';
import { z } from 'zod';

describe('http contracts', () => {
  it('builds a valid RFC 7807 problem', () => {
    const p = createProblem('QUOTA_EXCEEDED', 'Quota exceeded', { meta: { quota: 'users' } });
    expect(p.status).toBe(ERROR_CODES.QUOTA_EXCEEDED);
    expect(problemSchema.parse(p).code).toBe('QUOTA_EXCEEDED');
    expect(problemSchema.safeParse({ title: 'x', status: 200, code: 'NOT_FOUND' }).success).toBe(
      false,
    );
  });

  it('contains the required codes', () => {
    for (const c of [
      'SUBSCRIPTION_SUSPENDED',
      'FEATURE_NOT_IN_PLAN',
      'QUOTA_EXCEEDED',
      'FORBIDDEN',
      'TENANT_MISMATCH',
      'VALIDATION_ERROR',
      'CONFLICT',
      'NOT_FOUND',
    ]) {
      expect(ERROR_CODES).toHaveProperty(c);
    }
  });

  it('validates dateOnly strictly', () => {
    expect(dateOnlySchema.safeParse('2026-02-28').success).toBe(true);
    expect(dateOnlySchema.safeParse('2026-02-30').success).toBe(false);
    expect(dateOnlySchema.safeParse('2026-2-1').success).toBe(false);
    expect(dateOnlySchema.safeParse('2026-02-28T00:00:00Z').success).toBe(false);
  });

  it('validates uuids', () => {
    expect(uuidSchema.safeParse('0190a1b2-7c3d-7e4f-8a5b-1c2d3e4f5a6b').success).toBe(true);
    expect(uuidSchema.safeParse('nope').success).toBe(false);
  });

  it('coerces and bounds pagination', () => {
    expect(cursorPaginationQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(cursorPaginationQuerySchema.parse({ limit: '50', cursor: 'abc' })).toEqual({
      limit: 50,
      cursor: 'abc',
    });
    expect(cursorPaginationQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
    const page = cursorPageSchema(z.object({ id: z.string() }));
    expect(page.safeParse({ data: [{ id: 'a' }], nextCursor: null, hasMore: false }).success).toBe(
      true,
    );
  });
});

describe('payment methods', () => {
  it('platform ⊂ tenant and all have FR/EN labels', () => {
    expect(PLATFORM_PAYMENT_METHODS).toEqual(['MIXX', 'MOOV_MONEY', 'CASH', 'CARD']);
    for (const m of PLATFORM_PAYMENT_METHODS) expect(TENANT_PAYMENT_METHODS).toContain(m);
    for (const m of ['BANK_TRANSFER', 'LOYALTY_POINTS', 'CITY_LEDGER']) {
      expect(TENANT_PAYMENT_METHODS).toContain(m);
    }
    for (const m of TENANT_PAYMENT_METHODS) {
      expect(PAYMENT_METHOD_LABELS[m].fr).not.toBe('');
      expect(PAYMENT_METHOD_LABELS[m].en).not.toBe('');
    }
    expect(PAYMENT_METHOD_LABELS.MIXX.fr).toBe('Mixx by Yas');
  });
});
