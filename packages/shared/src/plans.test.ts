import { describe, expect, it } from 'vitest';
import { FEATURE_KEYS } from './features.js';
import { DEFAULT_PLAN_CODES, DEFAULT_PLANS } from './plans.js';
import { QUOTA_KEYS } from './quotas.js';

describe('default plan matrix', () => {
  it('feature keys are unique', () => {
    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length);
  });

  it('every matrix feature exists in the catalog, without duplicates', () => {
    for (const code of DEFAULT_PLAN_CODES) {
      const { features } = DEFAULT_PLANS[code];
      expect(new Set(features).size).toBe(features.length);
      for (const f of features) expect(FEATURE_KEYS).toContain(f);
    }
  });

  it('every plan defines every quota key', () => {
    for (const code of DEFAULT_PLAN_CODES) {
      expect(Object.keys(DEFAULT_PLANS[code].quotas).sort()).toEqual([...QUOTA_KEYS].sort());
    }
  });

  it('plans are monotonic: Standard ⊂ Medium ⊂ Premium', () => {
    const s = new Set<string>(DEFAULT_PLANS.STANDARD.features);
    const m = new Set<string>(DEFAULT_PLANS.MEDIUM.features);
    const p = new Set<string>(DEFAULT_PLANS.PREMIUM.features);
    for (const f of s) expect(m.has(f)).toBe(true);
    for (const f of m) expect(p.has(f)).toBe(true);
  });

  it('matches doc 02 gating', () => {
    const std = DEFAULT_PLANS.STANDARD.features;
    const med = DEFAULT_PLANS.MEDIUM.features;
    expect(std).not.toContain('restaurant');
    expect(med).toContain('restaurant');
    expect(med).toContain('analytics.advanced');
    expect(med).not.toContain('reports.scheduled');
    expect(med).not.toContain('branding.custom_domain');
    expect(DEFAULT_PLANS.PREMIUM.features).toContain('api');
    expect(DEFAULT_PLANS.PREMIUM.quotas.units).toBeNull();
    expect(DEFAULT_PLANS.STANDARD.quotas).toMatchObject({ properties: 1, units: 20, users: 5 });
  });
});
