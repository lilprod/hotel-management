import { z } from 'zod';
import { dayString, money, uuid } from '../property/common.js';

export const companyParams = z.object({ companyId: uuid });
export const accountsQuery = z.object({ propertyId: uuid.optional() });
export const accountQuery = z.object({ propertyId: uuid });
export const statementQuery = z.object({
  propertyId: uuid.optional(),
  from: dayString.optional(),
  to: dayString.optional(),
});
export const agingQuery = z.object({ propertyId: uuid.optional(), asOf: dayString.optional() });

export const settlementBody = z.object({
  propertyId: uuid,
  method: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'MIXX', 'MOOV_MONEY']),
  amount: money.refine((v) => v > 0, 'Must be positive'),
  reference: z.string().trim().min(1).max(100).optional(),
});

export const accountSummary = z.object({
  folioId: uuid,
  number: z.string(),
  propertyId: uuid,
  companyId: uuid,
  companyName: z.string(),
  taxId: z.string().nullable(),
  currency: z.string(),
  creditLimit: z.number().int().nullable(),
  charges: z.number().int(),
  settlements: z.number().int(),
  balance: z.number().int(),
});
export const accountList = z.object({ items: z.array(accountSummary) });

export const statementSchema = z.object({
  company: z.object({ id: uuid, name: z.string(), taxId: z.string().nullable() }),
  from: z.string().nullable(),
  to: z.string().nullable(),
  openingBalance: z.number().int(),
  entries: z.array(
    z.object({
      date: z.string(),
      at: z.string(),
      kind: z.enum(['CHARGE', 'SETTLEMENT']),
      label: z.string(),
      reference: z.string().nullable(),
      folioNumber: z.string(),
      debit: z.number().int(),
      credit: z.number().int(),
      balance: z.number().int(),
    }),
  ),
  totalDebit: z.number().int(),
  totalCredit: z.number().int(),
  closingBalance: z.number().int(),
});

const buckets = z.object({
  current: z.number().int(),
  d31_60: z.number().int(),
  d61_90: z.number().int(),
  over90: z.number().int(),
});
export const agingSchema = z.object({
  asOf: z.string(),
  items: z.array(
    z.object({ companyId: uuid, companyName: z.string(), buckets, total: z.number().int() }),
  ),
  totals: buckets.extend({ total: z.number().int() }),
});
