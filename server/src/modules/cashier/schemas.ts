import { z } from 'zod';
import { currencyCode, dayString, idParams, money, uuid } from '../property/common.js';

export { idParams };

export const TENDER_METHODS = ['CASH', 'CARD', 'BANK_TRANSFER', 'MIXX', 'MOOV_MONEY'] as const;

export const openSessionBody = z.object({
  propertyId: uuid,
  openingFloat: money.default(0),
  note: z.string().trim().max(500).optional(),
});

export const movementBody = z.object({
  type: z.enum(['IN', 'OUT']),
  amount: money.refine((v) => v > 0, 'Must be positive'),
  currency: currencyCode.optional(),
  reason: z.string().trim().min(3).max(200),
});

export const closeSessionBody = z.object({
  counted: z
    .array(
      z.object({
        method: z.enum(TENDER_METHODS),
        currency: currencyCode.optional(),
        amount: z.number().int().min(0),
      }),
    )
    .max(20),
  note: z.string().trim().max(500).optional(),
});

export const listSessionsQuery = z.object({
  propertyId: uuid.optional(),
  userId: uuid.optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const currentSessionQuery = z.object({ propertyId: uuid });

const totalRow = z.object({
  method: z.string(),
  currency: z.string(),
  count: z.number().int(),
  received: z.number().int(),
  paidOut: z.number().int(),
  net: z.number().int(),
});
const expectedRow = z.object({
  method: z.string(),
  currency: z.string(),
  expected: z.number().int(),
});
const varianceRow = expectedRow.extend({ counted: z.number().int(), variance: z.number().int() });

export const sessionSchema = z.object({
  id: uuid,
  propertyId: uuid,
  userId: uuid,
  status: z.enum(['OPEN', 'CLOSED']),
  currency: z.string(),
  openingFloat: z.number().int(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  expectedAmount: z.number().int().nullable(),
  countedAmount: z.number().int().nullable(),
  variance: z.number().int().nullable(),
  note: z.string().nullable(),
});

export const reportSchema = z.object({
  kind: z.enum(['X', 'Z']),
  session: sessionSchema,
  generatedAt: z.string(),
  totals: z.array(totalRow),
  nonTender: z.array(totalRow),
  movements: z.object({
    in: z.array(z.object({ currency: z.string(), amount: z.number().int(), count: z.number().int() })),
    out: z.array(z.object({ currency: z.string(), amount: z.number().int(), count: z.number().int() })),
  }),
  expected: z.array(expectedRow),
  counted: z.array(varianceRow).nullable(),
});

export const sessionDetail = sessionSchema.extend({ expected: z.array(expectedRow) });
export const sessionList = z.object({ items: z.array(sessionSchema) });

export const movementSchema = z.object({
  id: uuid,
  cashSessionId: uuid,
  type: z.enum(['IN', 'OUT']),
  currency: z.string(),
  amount: z.number().int(),
  reason: z.string(),
  createdAt: z.string(),
  createdBy: uuid.nullable(),
});

// ── exchange rates ──
export const rateString = z
  .string()
  .regex(/^\d{1,10}(\.\d{1,8})?$/, 'Decimal rate with up to 8 decimals')
  .refine((s) => Number(s) > 0, 'Rate must be positive');

export const upsertRateBody = z.object({
  base: currencyCode,
  quote: currencyCode.default('XOF'),
  rate: rateString,
  validOn: dayString,
});
export const listRatesQuery = z.object({
  base: currencyCode.optional(),
  quote: currencyCode.optional(),
  from: dayString.optional(),
  to: dayString.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});
export const rateSchema = z.object({
  id: uuid,
  base: z.string(),
  quote: z.string(),
  rate: z.string(),
  validOn: z.string(),
  createdBy: uuid.nullable(),
  updatedAt: z.string(),
});
export const rateList = z.object({ items: z.array(rateSchema) });
