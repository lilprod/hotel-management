import { z } from 'zod';
import {
  currencyCode,
  dayString,
  idParams,
  money,
  pageOf,
  pageQuery,
  uuid,
} from '../property/common.js';

export { idParams };
const propertyQuery = z.object({ propertyId: uuid });
export { propertyQuery };
const code = z.string().regex(/^[A-Za-z0-9_-]{1,20}$/);

// ── rate plans ──
export const MEAL_PLANS = ['RO', 'BB', 'HB', 'FB'] as const;
export const createRatePlanBody = z.object({
  propertyId: uuid,
  code,
  name: z.string().trim().min(1).max(120),
  mealPlan: z.enum(MEAL_PLANS).default('RO'),
  isPublic: z.boolean().default(true),
  currency: currencyCode.default('XOF'),
  cancellationPolicyId: uuid.nullish(),
  isActive: z.boolean().default(true),
});
export const updateRatePlanBody = createRatePlanBody
  .omit({ propertyId: true, code: true, currency: true })
  .partial()
  .strict();
export const ratePlanSchema = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  name: z.string(),
  mealPlan: z.enum(MEAL_PLANS),
  isPublic: z.boolean(),
  currency: z.string(),
  cancellationPolicyId: uuid.nullable(),
  isActive: z.boolean(),
});
export const ratePlanPage = pageOf(ratePlanSchema);
export const listRatePlansQuery = pageQuery.extend({ propertyId: uuid });

// ── seasons ──
export const createSeasonBody = z
  .object({
    propertyId: uuid,
    name: z.string().trim().min(1).max(120),
    /** First night (included). */
    fromDate: dayString,
    /** Last night (included). */
    toDate: dayString,
    priority: z.number().int().min(0).max(1000).default(0),
  })
  .refine((v) => v.toDate >= v.fromDate, {
    path: ['toDate'],
    message: 'toDate must be >= fromDate',
  });
export const updateSeasonBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    fromDate: dayString.optional(),
    toDate: dayString.optional(),
    priority: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export const seasonSchema = z.object({
  id: uuid,
  propertyId: uuid,
  name: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  priority: z.number().int(),
});

// ── rates ──
export const createRateBody = z.object({
  ratePlanId: uuid,
  roomTypeId: uuid,
  seasonId: uuid.nullish(),
  /** Bit i = day i (0 = Sunday … 6 = Saturday); 127 = every day. */
  dowMask: z.number().int().min(1).max(127).default(127),
  price: money,
  extraAdult: money.default(0),
  extraChild: money.default(0),
  minStay: z.number().int().min(1).max(365).default(1),
});
export const updateRateBody = z
  .object({
    seasonId: uuid.nullable().optional(),
    dowMask: z.number().int().min(1).max(127).optional(),
    price: money.optional(),
    extraAdult: money.optional(),
    extraChild: money.optional(),
    minStay: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export const rateSchema = z.object({
  id: uuid,
  ratePlanId: uuid,
  roomTypeId: uuid,
  seasonId: uuid.nullable(),
  dowMask: z.number().int(),
  currency: z.string(),
  price: z.number().int(),
  extraAdult: z.number().int(),
  extraChild: z.number().int(),
  minStay: z.number().int(),
});
export const listRatesQuery = z.object({
  ratePlanId: uuid,
  roomTypeId: uuid.optional(),
  seasonId: uuid.optional(),
});

// ── taxes ──
export const TAX_TYPES = ['PERCENT', 'FIXED_PER_PERSON_NIGHT', 'FIXED_PER_NIGHT'] as const;
export const TAX_APPLIES = [
  'LODGING',
  'FOLIO',
  'RESTAURANT',
  'SPA',
  'ACTIVITY',
  'PRODUCT',
] as const;
export const createTaxBody = z
  .object({
    propertyId: uuid,
    taxRuleId: uuid.nullish(),
    code,
    name: z.string().trim().min(1).max(120),
    type: z.enum(TAX_TYPES),
    /** PERCENT: percentage (max 4 decimals); fixed: integer amount. Defaults to the rule's rate. */
    value: z.number().min(0).max(1_000_000_000).optional(),
    inclusive: z.boolean().optional(),
    appliesTo: z.array(z.enum(TAX_APPLIES)).min(1).default(['LODGING']),
  })
  .superRefine((v, c) => {
    if (v.value !== undefined && v.type !== 'PERCENT' && !Number.isInteger(v.value))
      c.addIssue({ code: 'custom', path: ['value'], message: 'Fixed amounts are integers' });
    if (v.value !== undefined && v.type === 'PERCENT' && v.value > 100)
      c.addIssue({ code: 'custom', path: ['value'], message: 'Percentage above 100' });
  });
export const updateTaxBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    value: z.number().min(0).max(1_000_000_000).optional(),
    inclusive: z.boolean().optional(),
    appliesTo: z.array(z.enum(TAX_APPLIES)).min(1).optional(),
  })
  .strict();
export const taxSchema = z.object({
  id: uuid,
  propertyId: uuid,
  taxRuleId: uuid.nullable(),
  code: z.string(),
  name: z.string(),
  type: z.enum(TAX_TYPES),
  value: z.string(),
  inclusive: z.boolean(),
  appliesTo: z.array(z.string()),
});
export const taxRuleSchema = z.object({
  id: uuid,
  country: z.string(),
  code: z.string(),
  name: z.string().nullable(),
  kind: z.string(),
  base: z.string(),
  rate: z.string(),
  inclusive: z.boolean(),
});
export const taxRulesQuery = z.object({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
});

// ── policies ──
const pct = z.number().int().min(0).max(100);
export const cancellationRules = z
  .object({
    /** Tiers: cancelling at least `daysBefore` days before arrival costs `penaltyPercent` of the stay. */
    tiers: z
      .array(z.object({ daysBefore: z.number().int().min(0).max(365), penaltyPercent: pct }))
      .min(1)
      .max(10),
    /** Penalty applied when cancelling later than every tier, or on no-show. */
    noShowPercent: pct.default(100),
    firstNightMinimum: z.boolean().default(false),
  })
  .strict()
  .refine((v) => new Set(v.tiers.map((t) => t.daysBefore)).size === v.tiers.length, {
    path: ['tiers'],
    message: 'Duplicate daysBefore',
  });
export const depositRules = z
  .object({
    mode: z.enum(['PERCENT', 'FIXED', 'FIRST_NIGHT']),
    value: z.number().int().min(0).max(1_000_000_000).default(0),
    /** Days before arrival at which the deposit is due (0 = at booking). */
    dueDaysBefore: z.number().int().min(0).max(365).default(0),
    refundable: z.boolean().default(false),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.mode === 'PERCENT' && v.value > 100)
      c.addIssue({ code: 'custom', path: ['value'], message: 'Percentage above 100' });
  });
const policyName = z.string().trim().min(1).max(120);
export const createPolicyBody = z.discriminatedUnion('kind', [
  z.object({
    propertyId: uuid,
    kind: z.literal('CANCELLATION'),
    name: policyName,
    rules: cancellationRules,
  }),
  z.object({ propertyId: uuid, kind: z.literal('DEPOSIT'), name: policyName, rules: depositRules }),
]);
export const updatePolicyBody = z
  .object({ name: policyName.optional(), rules: z.record(z.string(), z.unknown()).optional() })
  .strict();
export const policySchema = z.object({
  id: uuid,
  propertyId: uuid,
  kind: z.enum(['CANCELLATION', 'DEPOSIT']),
  name: z.string(),
  rules: z.record(z.string(), z.unknown()),
});

// ── quote ──
export const quoteBody = z.object({
  propertyId: uuid,
  roomTypeId: uuid,
  ratePlanId: uuid,
  arrival: dayString,
  departure: dayString,
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20).default(0),
});
export const quoteSchema = z.object({
  currency: z.string(),
  nights: z.number().int(),
  nightly: z.array(z.record(z.string(), z.unknown())),
  roomTotal: z.number().int(),
  extrasTotal: z.number().int(),
  grossSubtotal: z.number().int(),
  netSubtotal: z.number().int(),
  taxes: z.array(z.record(z.string(), z.unknown())),
  inclusiveTaxTotal: z.number().int(),
  exclusiveTaxTotal: z.number().int(),
  total: z.number().int(),
  minStay: z.number().int(),
});
