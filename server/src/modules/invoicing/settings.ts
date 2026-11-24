import { z } from 'zod';
import { defineSetting } from '../../core/settings.js';

const tenantOrProperty = ['PLATFORM', 'TENANT', 'PROPERTY'] as const;
const pattern = z
  .string()
  .min(5)
  .max(40)
  .regex(/\{seq(:\d{1,2})?\}/, 'The pattern must contain {seq}');

/** Hotel invoices and credit notes (OP-92, doc 09 §3). */
export const invoicingSettings = {
  invoicePattern: defineSetting({
    key: 'invoicing.invoice_pattern',
    schema: pattern,
    default: 'FAC-{YYYY}-{seq:6}',
    scopes: tenantOrProperty,
    description: 'Invoice number pattern, gap-free per property and year',
  }),
  creditNotePattern: defineSetting({
    key: 'invoicing.credit_note_pattern',
    schema: pattern,
    default: 'AV-{YYYY}-{seq:6}',
    scopes: tenantOrProperty,
    description: 'Credit note (avoir) number pattern, gap-free per property and year',
  }),
  legalMentions: defineSetting({
    key: 'invoicing.legal_mentions',
    schema: z.array(z.string().max(300)).max(10),
    default: [] as string[],
    scopes: tenantOrProperty,
    description: 'Extra mentions printed on invoices (legal form, tax regime…)',
  }),
  emailOnIssue: defineSetting({
    key: 'invoicing.email_on_issue',
    schema: z.boolean(),
    default: false,
    scopes: tenantOrProperty,
    description: 'E-mails the invoice to the customer when it is issued',
  }),
};
