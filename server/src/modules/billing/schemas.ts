import { z } from 'zod';
import { isIsoDate } from './domain.js';

export const isoDate = z.string().refine(isIsoDate, 'Expected a date YYYY-MM-DD');
export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });
export const method = z.enum(['MIXX', 'MOOV_MONEY', 'CASH', 'CARD']);
export const currency = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .optional();
export const amount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const reason = z.string().trim().min(3).max(1000);

const page = {
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
};

export const recordPaymentBody = z.object({
  tenantId: uuid,
  amount,
  currency,
  method,
  reference: z.string().trim().max(100).optional(),
  paidAt: isoDate,
  attachmentFileId: uuid.optional(),
  note: z.string().max(2000).optional(),
  allocations: z
    .array(z.object({ invoiceId: uuid, amount }))
    .max(50)
    .optional(),
});

export const reasonBody = z.object({ reason });

export const paymentListQuery = z.object({
  tenantId: uuid.optional(),
  method: method.optional(),
  status: z.enum(['PENDING_VALIDATION', 'CONFIRMED', 'REVERSED']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().max(100).optional(),
  ...page,
});

export const invoiceListQuery = z.object({
  tenantId: uuid.optional(),
  status: z.enum(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'VOID']).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().max(100).optional(),
  overdue: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  ...page,
});

export const attachmentQuery = z.object({ tenantId: uuid });

export const declarationBody = z.object({
  method,
  amount,
  currency,
  reference: z.string().trim().max(100).optional(),
  paidAt: isoDate,
  note: z.string().max(2000).optional(),
  attachmentFileId: uuid.optional(),
});

export const declarationListQuery = z.object({
  status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED']).optional(),
  tenantId: uuid.optional(),
  ...page,
});

export const periodQuery = z.object({
  from: isoDate,
  to: isoDate,
  groupBy: z.enum(['day', 'month']).default('month'),
  currency,
});

export const asOfQuery = z.object({ asOf: isoDate.optional() });
export const rangeQuery = z.object({ from: isoDate, to: isoDate });
