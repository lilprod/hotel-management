import { isFeatureKey, QUOTA_KEYS } from '@hm/shared';
import { z } from 'zod';
import { isoDate } from '../billing/schemas.js';

export const cycle = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);
const code = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/, 'Uppercase code (A-Z, 0-9, _ -)');
const featureKey = z.string().refine(isFeatureKey, 'Unknown feature key');
const quotaKey = z.enum(QUOTA_KEYS);
const limit = z.number().int().min(0).nullable();

export const priceInput = z.object({
  billingCycle: cycle,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('XOF'),
  /** Integer minor units (XOF: francs). 0 = free. */
  amount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  /** First day of validity (≥ today: no retroactive effect). Default: today. */
  validFrom: isoDate.optional(),
});

export const featuresBody = z.object({ features: z.array(featureKey).max(100) });
export const quotasBody = z.object({
  quotas: z.partialRecord(quotaKey, limit),
});

export const planCreateBody = z.object({
  code,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
  trialDays: z.number().int().min(0).max(365).default(0),
  sort: z.number().int().min(0).max(10_000).default(0),
  isPublic: z.boolean().default(true),
  isActive: z.boolean().default(true),
  features: z.array(featureKey).max(100).default([]),
  quotas: z.partialRecord(quotaKey, limit).default({}),
  prices: z.array(priceInput).max(20).default([]),
});

export const planUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000).nullable(),
    trialDays: z.number().int().min(0).max(365),
    sort: z.number().int().min(0).max(10_000),
    isPublic: z.boolean(),
    isActive: z.boolean(),
  })
  .partial();

export const addonCreateBody = z.object({
  code,
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).optional(),
  featureKeys: z.array(featureKey).max(50).default([]),
  quotaDeltas: z.partialRecord(quotaKey, z.number().int().min(0).max(1_000_000)).default({}),
  sort: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
  prices: z.array(priceInput).max(20).default([]),
});

export const addonUpdateBody = z
  .object({
    name: z.string().trim().min(1).max(100),
    description: z.string().max(2000).nullable(),
    featureKeys: z.array(featureKey).max(50),
    quotaDeltas: z.partialRecord(quotaKey, z.number().int().min(0).max(1_000_000)),
    sort: z.number().int().min(0).max(10_000),
    isActive: z.boolean(),
  })
  .partial();

export const couponCreateBody = z
  .object({
    code,
    type: z.enum(['PERCENT', 'AMOUNT', 'FREE_MONTHS']),
    /** PERCENT: 0.01–100 (string or number, 2 decimals); AMOUNT: minor units; FREE_MONTHS: months. */
    value: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
    /** Billing cycles the discount applies to (null = forever, 1 = once). */
    duration: z.number().int().min(1).max(120).nullable().default(1),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().default(null),
    eligiblePlans: z.array(code).max(50).default([]),
    expiresAt: z.iso.datetime({ offset: true }).nullable().default(null),
    isActive: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    const ok =
      c.type === 'PERCENT'
        ? /^\d{1,3}(\.\d{1,2})?$/.test(c.value) && Number(c.value) > 0 && Number(c.value) <= 100
        : /^\d{1,12}$/.test(c.value) && Number(c.value) > 0;
    if (!ok) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Invalid value for type' });
  });

export const couponUpdateBody = z
  .object({
    isActive: z.boolean(),
    maxRedemptions: z.number().int().min(1).max(1_000_000).nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    eligiblePlans: z.array(code).max(50),
  })
  .partial();
