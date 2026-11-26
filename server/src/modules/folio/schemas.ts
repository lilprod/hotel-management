import { z } from 'zod';
import { currencyCode, dayString, idParams, money, uuid } from '../property/common.js';

export { idParams };

export const PAYMENT_METHODS = [
  'CASH',
  'CARD',
  'BANK_TRANSFER',
  'MIXX',
  'MOOV_MONEY',
  'LOYALTY_POINTS',
  'CITY_LEDGER',
] as const;

const reason = z.string().trim().min(3).max(200);
const positive = money.refine((v) => v > 0, 'Must be positive');

export const resolveBody = z.union([
  z.object({ reservationRoomId: uuid }).strict(),
  z.object({ reservationId: uuid }).strict(),
  z.object({ groupId: uuid }).strict(),
  z.object({ companyId: uuid, propertyId: uuid }).strict(),
]);

export const splitBody = z.union([
  z.object({ reservationRoomId: uuid }).strict(),
  z.object({ groupId: uuid }).strict(),
]);

export const listQuery = z.object({
  propertyId: uuid.optional(),
  reservationId: uuid.optional(),
  reservationRoomId: uuid.optional(),
  groupId: uuid.optional(),
  companyId: uuid.optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: uuid.optional(),
});

export const chargeBody = z
  .object({
    productId: uuid.optional(),
    qty: z.number().positive().max(10_000).multipleOf(0.001).default(1),
    amount: money.optional(),
    label: z.string().trim().min(1).max(200).optional(),
    departmentCode: z.string().trim().min(1).max(40).optional(),
    taxIds: z.array(uuid).max(5).optional(),
    type: z.enum(['EXTRA', 'ADJUSTMENT', 'PENALTY']).optional(),
  })
  .refine((v) => v.productId || v.amount !== undefined, {
    message: 'productId or amount is required',
    path: ['amount'],
  });

export const discountBody = z
  .object({
    lineId: uuid,
    amount: positive.optional(),
    percent: z.number().positive().max(100).optional(),
    reason,
  })
  .refine((v) => (v.amount === undefined) !== (v.percent === undefined), {
    message: 'Give either amount or percent',
    path: ['amount'],
  });

export const reverseBody = z.object({ reason });
export const lineParams = z.object({ id: uuid, lineId: uuid });
export const paymentParams = z.object({ id: uuid, paymentId: uuid });

export const moveBody = z.object({
  lineIds: z.array(uuid).min(1).max(200),
  targetFolioId: uuid,
  reason,
});

export const paymentBody = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: positive.optional(),
    tenderedCurrency: currencyCode.optional(),
    tenderedAmount: positive.optional(),
    reference: z.string().trim().min(1).max(100).optional(),
    isDeposit: z.boolean().optional(),
    companyId: uuid.optional(),
  })
  .refine((v) => v.tenderedCurrency === undefined || v.tenderedAmount !== undefined, {
    message: 'tenderedAmount is required with tenderedCurrency',
    path: ['tenderedAmount'],
  });

export const refundBody = z.object({
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MIXX', 'MOOV_MONEY']),
  amount: positive,
  reference: z.string().trim().min(1).max(100).optional(),
  reason,
});

export const receiptQuery = z.object({ format: z.enum(['ticket', 'a4']).default('a4') });

export const postNightsBody = z.object({ reservationRoomId: uuid, upTo: dayString });
export const postNightBody = z.object({ reservationRoomId: uuid, businessDate: dayString });
export const checkoutBody = z.object({ reservationRoomId: uuid });

export const businessDateQuery = z.object({ propertyId: uuid });
export const businessDateBody = z.object({ propertyId: uuid, businessDate: dayString });

// ── responses ──
export const lineSchema = z.object({
  id: uuid,
  folioId: uuid,
  businessDate: z.string(),
  type: z.string(),
  departmentCode: z.string().nullable(),
  label: z.string(),
  qty: z.number(),
  currency: z.string(),
  unitAmount: z.number().int(),
  amount: z.number().int(),
  taxAmount: z.number().int(),
  productId: uuid.nullable(),
  sourceType: z.string().nullable(),
  sourceId: uuid.nullable(),
  /** Reason of a correction (reversal, discount, transfer, credit note). */
  reason: z.string().nullable(),
  reversalOfId: uuid.nullable(),
  reversedById: uuid.nullable(),
  createdAt: z.string(),
  createdBy: uuid.nullable(),
});

export const paymentSchema = z.object({
  id: uuid,
  folioId: uuid,
  method: z.string(),
  currency: z.string(),
  amount: z.number().int(),
  reference: z.string().nullable(),
  isDeposit: z.boolean(),
  status: z.string(),
  paidAt: z.string(),
  /** Business day of the property when the payment was recorded. */
  businessDate: z.string(),
  /** Gap-free receipt number (per property and year). */
  receiptNumber: z.string(),
  cashSessionId: uuid.nullable(),
  tenderedCurrency: z.string().nullable(),
  tenderedAmount: z.number().int().nullable(),
  rate: z.string().nullable(),
  reversedById: uuid.nullable(),
  reversedAt: z.string().nullable(),
  reversalReason: z.string().nullable(),
  createdBy: uuid.nullable(),
});

export const breakdownSchema = z.object({
  net: z.number().int(),
  percentTax: z.number().int(),
  fixedTax: z.number().int(),
  total: z.number().int(),
  untaxedBase: z.number().int(),
  rows: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      type: z.string(),
      rate: z.string().nullable(),
      base: z.number().int(),
      amount: z.number().int(),
    }),
  ),
});

export const folioHeader = z.object({
  id: uuid,
  propertyId: uuid,
  number: z.string(),
  status: z.enum(['OPEN', 'CLOSED']),
  currency: z.string(),
  balance: z.number().int(),
  stayId: uuid.nullable(),
  groupId: uuid.nullable(),
  companyId: uuid.nullable(),
  closedAt: z.string().nullable(),
  createdAt: z.string(),
  kind: z.enum(['STAY', 'GROUP', 'COMPANY', 'OTHER']),
  reservationId: uuid.nullable(),
  reservationNumber: z.string().nullable(),
  reservationRoomId: uuid.nullable(),
});

export const folioSchema = folioHeader.extend({
  chargesTotal: z.number().int(),
  paymentsTotal: z.number().int(),
  taxBreakdown: breakdownSchema,
  lines: z.array(lineSchema),
  payments: z.array(paymentSchema),
});

export const folioPage = z.object({ items: z.array(folioHeader), nextCursor: uuid.nullable() });
export const postingResult = z.object({ lineId: uuid, folio: folioSchema });
export const reversalResult = z.object({ reversalLineIds: z.array(uuid), folio: folioSchema });
export const moveResult = z.object({
  moved: z.array(z.object({ from: uuid, to: uuid })),
  folio: folioSchema,
});
export const paymentResult = z.object({
  payment: paymentSchema,
  convertedAmount: z.number().int(),
  change: z.number().int(),
  changeCurrency: z.string(),
  companyFolioId: uuid.nullable(),
  folio: folioSchema,
});
export const refundResult = z.object({ payment: paymentSchema, folio: folioSchema });
export const paymentReversalResult = z.object({ reversal: paymentSchema, folio: folioSchema });
export const receiptSchema = z.object({
  number: z.string(),
  format: z.enum(['ticket', 'a4']),
  fileId: uuid,
  url: z.string(),
});
const nightResult = z.object({
  date: z.string(),
  posted: z.boolean(),
  lineId: uuid.nullable(),
  folioId: uuid,
});
export const nightResultSchema = nightResult;
export const nightsResult = z.object({ items: z.array(nightResult) });
export const checkoutSchema = z.object({
  reservationRoomId: uuid,
  businessDate: z.string(),
  arrival: z.string(),
  departure: z.string(),
  postedNights: z.array(nightResult),
  folios: z.array(
    z.object({ id: uuid, number: z.string(), status: z.string(), balance: z.number().int() }),
  ),
  balance: z.number().int(),
  blockers: z.array(
    z.object({
      code: z.string(),
      message: z.string(),
      folioId: uuid.optional(),
      amount: z.number().int().optional(),
      count: z.number().int().optional(),
    }),
  ),
  canCheckout: z.boolean(),
});
export const businessDateSchema = z.object({ propertyId: uuid, businessDate: z.string() });
