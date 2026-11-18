import { isFeatureKey, QUOTA_KEYS } from '@hm/shared';
import { z } from 'zod';
import { isoDate, reason, uuid } from '../billing/schemas.js';

export const cycle = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);
const timezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Unknown IANA time zone');

export const tenantListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELLED']).optional(),
  tenantStatus: z.enum(['ACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  planId: uuid.optional(),
  tag: z.string().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const tenantCreateBody = z.object({
  name: z.string().trim().min(2).max(150),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/, 'Lowercase letters, digits and dashes'),
  legalName: z.string().trim().max(200).optional(),
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('TG'),
  timezone: timezone.default('Africa/Lome'),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('XOF'),
  locale: z.enum(['fr', 'en']).default('fr'),
  email: z.string().email().max(254).optional(),
  phone: z.string().max(40).optional(),
  planId: uuid,
  billingCycle: cycle.default('MONTHLY'),
  /** Overrides the plan's trial days (0 = no trial: first invoice at once). */
  trialDays: z.number().int().min(0).max(365).optional(),
  owner: z.object({
    name: z.string().trim().min(1).max(150),
    email: z.string().email().max(254),
    phone: z.string().max(40).optional(),
  }),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  notes: z.string().max(5000).optional(),
});

export const tenantUpdateBody = z
  .object({
    name: z.string().trim().min(2).max(150),
    legalName: z.string().trim().max(200).nullable(),
    email: z.string().email().max(254).nullable(),
    phone: z.string().max(40).nullable(),
    timezone,
    notes: z.string().max(5000).nullable(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20),
  })
  .partial();

export const planChangeBody = z.object({ planId: uuid, billingCycle: cycle.optional() });
export const offerDaysBody = z.object({ days: z.number().int().min(1).max(365), reason });
export const cancelBody = z.object({ reason, atPeriodEnd: z.boolean().default(false) });
export const reasonOnly = z.object({ reason });

export const overrideBody = z
  .object({
    kind: z.enum(['FEATURE', 'QUOTA', 'DISCOUNT']),
    key: z.string().trim().min(1).max(100),
    /** FEATURE: { enabled }; QUOTA: { limit } (null = unlimited); DISCOUNT: { percent } or { amount }. */
    value: z.union([
      z.object({ enabled: z.boolean() }),
      z.object({ limit: z.number().int().min(0).nullable() }),
      z.object({ percent: z.number().min(0.01).max(100) }),
      z.object({ amount: z.number().int().positive() }),
    ]),
    endsAt: z.iso.datetime({ offset: true }).nullable().default(null),
    note: z.string().max(500).optional(),
  })
  .superRefine((o, ctx) => {
    const v = o.value as Record<string, unknown>;
    const bad =
      (o.kind === 'FEATURE' && (!('enabled' in v) || !isFeatureKey(o.key))) ||
      (o.kind === 'QUOTA' &&
        (!('limit' in v) || !(QUOTA_KEYS as readonly string[]).includes(o.key))) ||
      (o.kind === 'DISCOUNT' && !('percent' in v) && !('amount' in v));
    if (bad)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Value does not match kind/key' });
  });

export const addonAttachBody = z.object({
  addonId: uuid,
  startsAt: isoDate.optional(),
  endsAt: isoDate.nullable().optional(),
});

export const couponBody = z.object({ code: z.string().trim().min(2).max(40) });

export const subIdParams = z.object({ id: uuid, subId: uuid });
