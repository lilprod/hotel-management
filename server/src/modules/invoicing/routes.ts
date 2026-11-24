import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from '../reservations/context.js';
import * as s from './schemas.js';
import * as svc from './service.js';

const feature = requireFeature('billing.core');
const tags = ['Invoices'];

export const invoicesRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags,
    summary: 'Invoices and credit notes',
    middleware: [can('invoices.read', { property: propertyFromRequest }), feature],
    request: { query: s.listQuery },
    responses: { 200: { description: 'Page', schema: s.invoicePage } },
    handler: (req) => withRCtx(req, (c) => svc.listInvoices(c, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/',
    tags,
    summary: 'Issues the invoice of a settled folio (gap-free FAC number, PDF, fiscal hook)',
    middleware: [can('invoices.issue'), feature],
    request: { body: s.issueBody },
    status: 201,
    responses: { 201: { description: 'Issued', schema: s.invoiceSchema } },
    handler: (req) => withRCtx(req, (c) => svc.issueInvoice(c, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/:id',
    tags,
    summary: 'Invoice or credit note',
    middleware: [can('invoices.read'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Invoice', schema: s.invoiceSchema } },
    handler: (req) => withRCtx(req, (c) => svc.getInvoice(c, req.valid.params.id)),
  })
  .route({
    method: 'get',
    path: '/:id/pdf',
    tags,
    summary: 'Signed URL of the PDF (A4, tenant branding, Togo mentions)',
    middleware: [can('invoices.read'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Document', schema: s.documentUrl } },
    handler: (req) => withRCtx(req, (c) => svc.invoicePdf(c, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/:id/email',
    tags,
    summary: 'E-mails the invoice to the customer (template invoice_issued)',
    middleware: [can('invoices.issue'), feature],
    request: { params: s.idParams, body: s.emailBody },
    responses: { 200: { description: 'Sent', schema: s.emailResult } },
    handler: (req) =>
      withRCtx(req, (c) => svc.emailInvoice(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/:id/credit-notes',
    tags,
    summary: 'Credit note (avoir AV-…), full or partial; reopens the folio balance',
    middleware: [can('invoices.credit_note'), feature],
    request: { params: s.idParams, body: s.creditNoteBody },
    status: 201,
    responses: { 201: { description: 'Credit note', schema: s.invoiceSchema } },
    handler: (req) =>
      withRCtx(req, (c) => svc.issueCreditNote(c, req.valid.params.id, req.valid.body)),
  });
