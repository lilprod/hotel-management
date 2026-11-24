import { defineModule } from '../../core/module.js';
import { FOLIO_EVENTS } from '../folio/events.js';
import { invoicesRouter } from './routes.js';
import { invoicingSettings } from './settings.js';

export { issueInvoice, issueCreditNote, getInvoice, invoicePdf, emailInvoice } from './service.js';
export { invoicingSettings } from './settings.js';

/** Hotel invoices and credit notes (OP-92, EX-51): gap-free numbering, PDF, fiscal hook. */
export const invoicingModule = defineModule({
  key: 'invoicing',
  basePath: '/invoices',
  router: { t: invoicesRouter },
  permissions: ['invoices.read', 'invoices.issue', 'invoices.credit_note'],
  features: ['billing.core'],
  events: [{ type: FOLIO_EVENTS.invoiceIssued }, { type: FOLIO_EVENTS.creditNoteIssued }],
  settings: Object.values(invoicingSettings),
});
