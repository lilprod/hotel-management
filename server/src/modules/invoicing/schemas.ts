import { z } from 'zod';
import { dayString, idParams, uuid } from '../property/common.js';

export { idParams };

export const customerInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guest'), guestId: uuid }),
  z.object({ type: z.literal('company'), companyId: uuid }),
]);

export const issueBody = z.object({
  folioId: uuid,
  customer: customerInput.optional(),
  notes: z.array(z.string().trim().max(300)).max(5).optional(),
  sendEmail: z.boolean().optional(),
});

export const creditNoteBody = z.object({
  /** Charges of the invoice to credit (with their taxes and discounts); omitted = full credit note. */
  lineIds: z.array(uuid).min(1).max(500).optional(),
  reason: z.string().trim().min(3).max(200),
});

export const emailBody = z.object({ email: z.string().email().optional() });

export const listQuery = z.object({
  propertyId: uuid.optional(),
  folioId: uuid.optional(),
  kind: z.enum(['INVOICE', 'CREDIT_NOTE']).optional(),
  from: dayString.optional(),
  to: dayString.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: uuid.optional(),
});

const customer = z.object({
  type: z.enum(['guest', 'company', 'other']),
  id: z.string().nullable(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.string().nullable(),
  taxId: z.string().nullable(),
});

export const invoiceSchema = z.object({
  id: uuid,
  propertyId: uuid,
  folioId: uuid,
  number: z.string(),
  kind: z.enum(['INVOICE', 'CREDIT_NOTE']),
  creditNoteOfId: uuid.nullable(),
  issueDate: z.string(),
  customer,
  currency: z.string(),
  subtotal: z.number().int(),
  taxTotal: z.number().int(),
  total: z.number().int(),
  status: z.string(),
  pdfFileId: uuid.nullable(),
  totals: z.record(z.string(), z.unknown()),
  fiscal: z
    .object({
      provider: z.string(),
      status: z.string(),
      fiscalNumber: z.string().nullable(),
      qrCode: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.string(),
});
export const invoicePage = z.object({ items: z.array(invoiceSchema), nextCursor: uuid.nullable() });
export const documentUrl = z.object({ fileId: uuid, url: z.string() });
export const emailResult = z.object({ sent: z.boolean(), to: z.string().nullable() });
