import type { Request } from 'express';
import { createModuleRouter } from '../../core/router.js';
import { notFound, unauthenticated } from '../../lib/errors.js';
import { platformRole } from '../../middleware/platform-guard.js';
import { recordAudit } from '../../middleware/audit.js';
import { platformToday, type Actor } from './common.js';

export { platformToday };
import { sendCsv } from './csv.js';
import { approveDeclaration, rejectDeclaration, serializeDeclaration } from './declarations.js';
import { proofAttachment, proofUpload, storeProof } from './files.js';
import { withIdempotency } from './idempotency.js';
import { voidInvoice } from './management.js';
import {
  getPayment,
  receiptUrl,
  recordPayment,
  reversePayment,
  validatePayment,
} from './payments.js';
import {
  invoiceDetail,
  invoicePdfUrl,
  listInvoices,
  listPayments,
  PAYMENT_CSV_COLUMNS,
  paymentsCsvRows,
} from './queries.js';
import {
  agedReceivables,
  collectionsReport,
  recurringRevenue,
  tenantsByStatus,
  trialConversions,
} from './reports.js';
import {
  asOfQuery,
  attachmentQuery,
  declarationListQuery,
  idParams,
  invoiceListQuery,
  paymentListQuery,
  periodQuery,
  rangeQuery,
  reasonBody,
  recordPaymentBody,
} from './schemas.js';
import { billingSettingsPatch, loadBillingSettings, updateBillingSettings } from './settings.js';

/** Platform user acting (set by the platform guard). */
export function platformActor(req: Request): Actor {
  if (!req.platformUser) throw unauthenticated();
  return { kind: 'platform', id: req.platformUser.id };
}

const FINANCE = platformRole('FINANCE');
const READERS = platformRole('FINANCE', 'SUPPORT', 'READ_ONLY');
const PROOF_READERS = platformRole('FINANCE', 'READ_ONLY');
const SUPER = platformRole();

// --- /api/v1/admin/payments ---------------------------------------------------------------

export const paymentsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags: ['platform: payments'],
    summary: 'List / filter manual payments',
    middleware: [READERS],
    request: { query: paymentListQuery },
    handler: (req) => listPayments(req.services, req.valid.query),
  })
  .route({
    method: 'get',
    path: '/export.csv',
    tags: ['platform: payments'],
    summary: 'CSV export of the payments (same filters)',
    middleware: [READERS],
    request: { query: paymentListQuery },
    responses: { 200: { description: 'text/csv' } },
    handler: async (req, res) => {
      const rows = await paymentsCsvRows(req.services, req.valid.query);
      recordAudit(req, {
        action: 'payments.export',
        entity: 'payment',
        after: { count: rows.length },
      });
      sendCsv(res, `payments-${platformToday()}.csv`, PAYMENT_CSV_COLUMNS, rows);
    },
  })
  .route({
    method: 'post',
    path: '/attachments',
    tags: ['platform: payments'],
    summary: 'Upload a payment proof (image or PDF ≤ 5 MB) for a tenant',
    middleware: [FINANCE, proofUpload()],
    request: { query: attachmentQuery },
    status: 201,
    handler: async (req) => {
      const out = await storeProof(
        req.services,
        req,
        req.valid.query.tenantId,
        req.platformUser!.id,
      );
      recordAudit(req, { action: 'payment.attachment', entity: 'file', entityId: out.fileId });
      return out;
    },
  })
  .route({
    method: 'post',
    path: '/',
    tags: ['platform: payments'],
    summary: 'Record a manual payment (Idempotency-Key supported)',
    middleware: [FINANCE],
    request: { body: recordPaymentBody },
    status: 201,
    handler: (req, res) =>
      withIdempotency(req, res, 'admin-payments', 201, async () => {
        const p = await recordPayment(req.services, req.valid.body, platformActor(req));
        recordAudit(req, { action: 'payment.record', entity: 'payment', entityId: p.id, after: p });
        return p;
      }),
  })
  .route({
    method: 'get',
    path: '/:id/attachment',
    tags: ['platform: payments'],
    summary: 'Signed URL (5 min) + mime of the payment proof',
    middleware: [PROOF_READERS],
    request: { params: idParams },
    handler: async (req) => {
      const p = await req.services.admin.payment.findUnique({
        where: { id: req.valid.params.id },
        select: { tenantId: true, attachmentFileId: true },
      });
      if (!p) throw notFound('Payment');
      return proofAttachment(req.services, p.tenantId, p.attachmentFileId);
    },
  })
  .route({
    method: 'get',
    path: '/:id',
    tags: ['platform: payments'],
    middleware: [READERS],
    request: { params: idParams },
    handler: (req) => getPayment(req.services, req.valid.params.id),
  })
  .route({
    method: 'post',
    path: '/:id/validate',
    tags: ['platform: payments'],
    summary: 'Second validation (another user than the one who recorded it)',
    middleware: [FINANCE],
    request: { params: idParams },
    handler: async (req) => {
      const p = await validatePayment(req.services, req.valid.params.id, platformActor(req));
      recordAudit(req, { action: 'payment.validate', entity: 'payment', entityId: p.id, after: p });
      return p;
    },
  })
  .route({
    method: 'post',
    path: '/:id/reverse',
    tags: ['platform: payments'],
    summary: 'Reverse a payment (contre-passation, reason mandatory; never deleted)',
    middleware: [FINANCE],
    request: { params: idParams, body: reasonBody },
    handler: async (req) => {
      const out = await reversePayment(
        req.services,
        req.valid.params.id,
        req.valid.body.reason,
        platformActor(req),
      );
      recordAudit(req, {
        action: 'payment.reverse',
        entity: 'payment',
        entityId: out.payment.id,
        after: { reason: req.valid.body.reason, reopened: out.reopened, transition: out.decision },
      });
      return out;
    },
  })
  .route({
    method: 'get',
    path: '/:id/receipt',
    tags: ['platform: payments'],
    summary: 'Signed URL (5 min) of the receipt PDF',
    middleware: [READERS],
    request: { params: idParams },
    handler: (req) => receiptUrl(req.services, req.valid.params.id),
  });

// --- /api/v1/admin/invoices ---------------------------------------------------------------

export const invoicesRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags: ['platform: invoices'],
    middleware: [READERS],
    request: { query: invoiceListQuery },
    handler: (req) => listInvoices(req.services, req.valid.query, platformToday()),
  })
  .route({
    method: 'get',
    path: '/:id',
    tags: ['platform: invoices'],
    middleware: [READERS],
    request: { params: idParams },
    handler: (req) => invoiceDetail(req.services, req.valid.params.id, platformToday()),
  })
  .route({
    method: 'get',
    path: '/:id/pdf',
    tags: ['platform: invoices'],
    summary: 'Signed URL (5 min) of the invoice PDF (rendered on demand)',
    middleware: [READERS],
    request: { params: idParams },
    handler: (req) => invoicePdfUrl(req.services, req.valid.params.id),
  })
  .route({
    method: 'post',
    path: '/:id/void',
    tags: ['platform: invoices'],
    summary: 'Void an unpaid invoice (reason mandatory)',
    middleware: [FINANCE],
    request: { params: idParams, body: reasonBody },
    handler: async (req) => {
      const out = await voidInvoice(req.services, req.valid.params.id, req.valid.body.reason);
      recordAudit(req, {
        action: 'invoice.void',
        entity: 'platform_invoice',
        entityId: out.id,
        after: { ...out, reason: req.valid.body.reason },
      });
      return out;
    },
  });

// --- /api/v1/admin/declarations -----------------------------------------------------------

export const declarationsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags: ['platform: payment declarations'],
    summary: 'Queue of tenant payment declarations (SA-36)',
    middleware: [READERS],
    request: { query: declarationListQuery },
    handler: async (req) => {
      const q = req.valid.query;
      const where = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.tenantId ? { tenantId: q.tenantId } : {}),
      };
      const [rows, total] = await Promise.all([
        req.services.admin.paymentDeclaration.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take: q.limit,
          skip: q.offset,
          include: { tenant: { select: { name: true } } },
        }),
        req.services.admin.paymentDeclaration.count({ where }),
      ]);
      return {
        items: rows.map((d) => ({ ...serializeDeclaration(d), tenantName: d.tenant.name })),
        total,
      };
    },
  })
  .route({
    method: 'get',
    path: '/:id/attachment',
    tags: ['platform: payment declarations'],
    summary: 'Signed URL (5 min) + mime of the declaration proof',
    middleware: [PROOF_READERS],
    request: { params: idParams },
    handler: async (req) => {
      const d = await req.services.admin.paymentDeclaration.findUnique({
        where: { id: req.valid.params.id },
        select: { tenantId: true, attachmentFileId: true },
      });
      if (!d) throw notFound('Declaration');
      return proofAttachment(req.services, d.tenantId, d.attachmentFileId);
    },
  })
  .route({
    method: 'post',
    path: '/:id/approve',
    tags: ['platform: payment declarations'],
    summary: 'Approve: creates a CONFIRMED payment',
    middleware: [FINANCE],
    request: { params: idParams },
    handler: async (req) => {
      const out = await approveDeclaration(req.services, req.valid.params.id, platformActor(req));
      recordAudit(req, {
        action: 'payment_declaration.approve',
        entity: 'payment_declaration',
        entityId: out.declaration.id,
        after: { paymentId: out.payment.id },
      });
      return out;
    },
  })
  .route({
    method: 'post',
    path: '/:id/reject',
    tags: ['platform: payment declarations'],
    summary: 'Reject with a reason (notified to the tenant)',
    middleware: [FINANCE],
    request: { params: idParams, body: reasonBody },
    handler: async (req) => {
      const out = await rejectDeclaration(
        req.services,
        req.valid.params.id,
        req.valid.body.reason,
        platformActor(req),
      );
      recordAudit(req, {
        action: 'payment_declaration.reject',
        entity: 'payment_declaration',
        entityId: out.id,
        after: { reason: req.valid.body.reason },
      });
      return out;
    },
  });

// --- /api/v1/admin/billing (settings + reports) -------------------------------------------

export const billingAdminRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/settings',
    tags: ['platform: billing'],
    summary: 'Billing settings (identity, instructions, grace, purge, reminders, VAT…)',
    middleware: [READERS],
    handler: (req) => loadBillingSettings(req.services.admin),
  })
  .route({
    method: 'patch',
    path: '/settings',
    tags: ['platform: billing'],
    middleware: [SUPER],
    request: { body: billingSettingsPatch },
    handler: async (req) => {
      const diff = await updateBillingSettings(req.services.admin, req.valid.body);
      recordAudit(req, {
        action: 'billing.settings.update',
        entity: 'platform_setting',
        before: diff.before,
        after: diff.after,
      });
      return loadBillingSettings(req.services.admin);
    },
  })
  .route({
    method: 'get',
    path: '/reports/collections',
    tags: ['platform: billing reports'],
    summary: 'Collections by method and period (SA-38)',
    middleware: [READERS],
    request: { query: periodQuery },
    handler: (req) => collectionsReport(req.services, req.valid.query),
  })
  .route({
    method: 'get',
    path: '/reports/collections.csv',
    tags: ['platform: billing reports'],
    middleware: [READERS],
    request: { query: periodQuery },
    responses: { 200: { description: 'text/csv' } },
    handler: async (req, res) => {
      const r = await collectionsReport(req.services, req.valid.query);
      sendCsv(
        res,
        `collections-${r.from}-${r.to}.csv`,
        ['period', 'method', 'currency', 'count', 'amount'],
        r.rows,
      );
    },
  })
  .route({
    method: 'get',
    path: '/reports/aged-receivables',
    tags: ['platform: billing reports'],
    summary: 'Aged receivables per tenant (SA-38)',
    middleware: [READERS],
    request: { query: asOfQuery },
    handler: (req) => agedReceivables(req.services, req.valid.query.asOf ?? platformToday()),
  })
  .route({
    method: 'get',
    path: '/reports/aged-receivables.csv',
    tags: ['platform: billing reports'],
    middleware: [READERS],
    request: { query: asOfQuery },
    responses: { 200: { description: 'text/csv' } },
    handler: async (req, res) => {
      const r = await agedReceivables(req.services, req.valid.query.asOf ?? platformToday());
      sendCsv(
        res,
        `aged-receivables-${r.asOf}.csv`,
        ['tenant', 'currency', 'current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus', 'total'],
        r.rows.map((x) => ({ ...x, tenant: x.tenant.name })),
      );
    },
  })
  .route({
    method: 'get',
    path: '/reports/dashboard',
    tags: ['platform: billing reports'],
    summary: 'SA-01: MRR / ARR, tenants by status, trial conversions, collections of the month',
    middleware: [READERS],
    request: { query: asOfQuery },
    handler: async (req) => {
      const asOf = req.valid.query.asOf ?? platformToday();
      const monthStart = `${asOf.slice(0, 7)}-01`;
      const [revenue, statuses, trials, collections, receivables] = await Promise.all([
        recurringRevenue(req.services, asOf),
        tenantsByStatus(req.services),
        trialConversions(req.services, monthStart, asOf),
        collectionsReport(req.services, { from: monthStart, to: asOf, groupBy: 'month' }),
        agedReceivables(req.services, asOf),
      ]);
      return {
        asOf,
        revenue,
        tenantsByStatus: statuses,
        trialConversions: trials,
        collectionsThisMonth: collections.totalsByMethod,
        receivables: receivables.totals,
      };
    },
  })
  .route({
    method: 'get',
    path: '/reports/trial-conversions',
    tags: ['platform: billing reports'],
    middleware: [READERS],
    request: { query: rangeQuery },
    handler: (req) => trialConversions(req.services, req.valid.query.from, req.valid.query.to),
  });
