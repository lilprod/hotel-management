import type { Request } from 'express';
import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { anyStaff, can } from '../../http/helpers.js';
import { AppError } from '../../lib/errors.js';
import { recordAudit } from '../../middleware/audit.js';
import type { Actor } from '../billing/common.js';
import { serializeDeclaration, submitDeclaration } from '../billing/declarations.js';
import { proofUpload, storeProof } from '../billing/files.js';
import { changePlan } from '../billing/management.js';
import { receiptUrl } from '../billing/payments.js';
import { invoiceDetail, invoicePdfUrl } from '../billing/queries.js';
import { declarationBody, idParams } from '../billing/schemas.js';
import { planChangeBody } from '../platform-tenants/schemas.js';
import * as svc from './service.js';

const MANAGE = can('billing.manage');
const tags = ['tenant: subscription'];

/** Tenant of the request: resolved server side from the Host and the token, never the body. */
function tenantIdOf(req: Request): string {
  const id = req.tenant?.id;
  if (!id) throw new AppError('NOT_FOUND', undefined, { detail: 'Unknown tenant' });
  return id;
}

const actorOf = (req: Request): Actor => ({ kind: 'tenant', id: req.auth?.userId ?? null });

const page = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * `/api/v1/t/billing` — the tenant's SaaS subscription (TN-30…TN-34): plan, status, quotas,
 * invoices and receipts, payment instructions, plan change, payment declarations, banners.
 * Mounted under `/billing` so a SUSPENDED tenant can still pay / declare (core whitelist) and
 * impersonating support agents cannot write here.
 */
export const tenantSubscriptionRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/banners',
    tags,
    summary: 'Banners: trial J-x, due soon, overdue, suspended (any staff member)',
    middleware: [anyStaff()],
    handler: (req) => svc.banners(req.services, tenantIdOf(req)),
  })
  .route({
    method: 'get',
    path: '/subscription',
    tags,
    summary: 'Current plan, status, period end, quota usage, amount due',
    middleware: [MANAGE],
    handler: (req) => svc.subscriptionOverview(req.services, tenantIdOf(req)),
  })
  .route({
    method: 'get',
    path: '/plans',
    tags,
    summary: 'Plans available for a change, with current prices',
    middleware: [MANAGE],
    handler: (req) => svc.availablePlans(req.services, tenantIdOf(req)),
  })
  .route({
    method: 'post',
    path: '/plan-change',
    tags,
    summary: 'Change plan (TN-32): upgrade now with prorata, downgrade at the period end',
    middleware: [MANAGE],
    request: { body: planChangeBody },
    handler: async (req) => {
      const r = await changePlan(req.services, tenantIdOf(req), req.valid.body, actorOf(req));
      recordAudit(req, {
        action: 'subscription.plan_change',
        entity: 'subscription',
        after: { ...req.valid.body, ...r },
      });
      return r;
    },
  })
  .route({
    method: 'get',
    path: '/invoices',
    tags,
    middleware: [MANAGE],
    request: { query: page },
    handler: (req) =>
      svc.tenantInvoices(
        req.services,
        tenantIdOf(req),
        req.valid.query.limit,
        req.valid.query.offset,
      ),
  })
  .route({
    method: 'get',
    path: '/invoices/:id',
    tags,
    middleware: [MANAGE],
    request: { params: idParams },
    handler: async (req) => {
      const tenantId = tenantIdOf(req);
      const { today } = await svc.tenantToday(req.services, tenantId);
      return invoiceDetail(req.services, req.valid.params.id, today, tenantId);
    },
  })
  .route({
    method: 'get',
    path: '/invoices/:id/pdf',
    tags,
    summary: 'Signed URL (5 min) of the invoice PDF',
    middleware: [MANAGE],
    request: { params: idParams },
    handler: (req) => invoicePdfUrl(req.services, req.valid.params.id, tenantIdOf(req)),
  })
  .route({
    method: 'get',
    path: '/receipts',
    tags,
    middleware: [MANAGE],
    handler: (req) => svc.tenantReceipts(req.services, tenantIdOf(req)),
  })
  .route({
    method: 'get',
    path: '/receipts/:id/pdf',
    tags,
    summary: 'Signed URL (5 min) of a receipt PDF',
    middleware: [MANAGE],
    request: { params: idParams },
    handler: (req) => receiptUrl(req.services, req.valid.params.id, tenantIdOf(req)),
  })
  .route({
    method: 'get',
    path: '/payment-instructions',
    tags,
    summary: 'How to pay: platform merchant numbers (Mixx, Moov Money…) and amounts due',
    middleware: [MANAGE],
    handler: (req) => svc.paymentInstructions(req.services, tenantIdOf(req)),
  })
  .route({
    method: 'post',
    path: '/declarations/attachments',
    tags,
    summary: 'Upload the payment screenshot / proof (image or PDF ≤ 5 MB)',
    middleware: [MANAGE, proofUpload()],
    status: 201,
    handler: async (req) => {
      const out = await storeProof(req.services, req, tenantIdOf(req), req.auth?.userId ?? null);
      recordAudit(req, {
        action: 'payment_declaration.attachment',
        entity: 'file',
        entityId: out.fileId,
      });
      return out;
    },
  })
  .route({
    method: 'post',
    path: '/declarations',
    tags,
    summary: 'Declare a payment (TN-31) for the platform to validate',
    middleware: [MANAGE],
    request: { body: declarationBody },
    status: 201,
    handler: async (req) => {
      const d = await submitDeclaration(
        req.services,
        tenantIdOf(req),
        req.auth!.userId,
        req.valid.body,
      );
      recordAudit(req, {
        action: 'payment_declaration.submit',
        entity: 'payment_declaration',
        entityId: d.id,
        after: d,
      });
      return d;
    },
  })
  .route({
    method: 'get',
    path: '/declarations',
    tags,
    middleware: [MANAGE],
    handler: async (req) => {
      const rows = await req.services.admin.paymentDeclaration.findMany({
        where: { tenantId: tenantIdOf(req) },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });
      return { items: rows.map(serializeDeclaration) };
    },
  });
