import { z } from 'zod';
import { DEFAULT_COUNTRY, SIGNUP_COUNTRIES } from '../platform-tenants/country-defaults.js';
import { SLUG_RE } from './slug.js';

export const cycle = z.enum(['MONTHLY', 'QUARTERLY', 'YEARLY']);

export const slugQuery = z.object({
  slug: z.string().trim().toLowerCase().max(60),
});

export const slugAvailabilitySchema = z.object({
  slug: z.string(),
  available: z.boolean(),
  reason: z.enum(['INVALID', 'RESERVED', 'TAKEN']).optional(),
});

export const publicPlanSchema = z.object({
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  trialDays: z.number().int(),
  features: z.array(z.string()),
  quotas: z.record(z.string(), z.number().int().nullable()),
  prices: z.array(
    z.object({ billingCycle: cycle, currency: z.string(), amount: z.number().int() }),
  ),
});

export const publicPlansSchema = z.object({ items: z.array(publicPlanSchema) });

export const signupBody = z.object({
  hotelName: z.string().trim().min(2).max(150),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(SLUG_RE, 'Lowercase letters, digits and dashes (3 to 48 characters)'),
  ownerName: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(254),
  phone: z.string().trim().min(1).max(40),
  country: z.enum(SIGNUP_COUNTRIES).default(DEFAULT_COUNTRY),
  city: z.string().trim().min(1).max(100),
  planCode: z.string().trim().min(1).max(60),
  cycle: cycle.default('MONTHLY'),
  password: z.string().min(1).max(256),
  acceptTerms: z.literal(true, { error: 'The terms of service must be accepted' }),
  acceptDpa: z.literal(true, { error: 'The data processing agreement must be accepted' }),
  locale: z.enum(['fr', 'en']).default('fr'),
  /** Honeypot: invisible to humans, must stay empty. */
  website: z.string().max(500).optional(),
  captchaToken: z.string().max(4000).optional(),
});

export const signupResultSchema = z.object({
  status: z.literal('pending_verification'),
  email: z.string(),
  host: z.string(),
});

export const verifyBody = z.object({ token: z.string().trim().min(10).max(200) });

export const verifyResultSchema = z.object({
  loginUrl: z.string(),
  host: z.string(),
  email: z.string(),
});

export const resendBody = z.object({
  slug: z.string().trim().toLowerCase().max(60),
  email: z.string().trim().toLowerCase().email().max(254),
});

export const resendResultSchema = z.object({ status: z.literal('ok') });
