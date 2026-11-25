import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from '../reservations/context.js';
import { precheck } from './precheck.js';
import * as s from './schemas.js';
import * as svc from './service.js';

const feature = requireFeature('billing.core');
const tags = ['Night audit'];

export const nightAuditRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/precheck',
    tags,
    summary: 'Pre-checks of the current business date (arrivals, departures, cash, balances)',
    middleware: [can('night_audit.read', { property: propertyFromRequest }), feature],
    request: { query: s.propertyQuery },
    responses: { 200: { description: 'Pre-checks', schema: s.precheckSchema } },
    handler: (req) => withRCtx(req, (c) => precheck(c, req.valid.query.propertyId)),
  })
  .route({
    method: 'post',
    path: '/run',
    tags,
    summary: 'Runs (or resumes) the night audit of the business date: one at a time, idempotent per date',
    middleware: [can('night_audit.run', { property: propertyFromRequest }), feature],
    request: { body: s.runBody },
    responses: { 200: { description: 'Audit', schema: s.runResult } },
    handler: (req) => withRCtx(req, (c) => svc.runNightAudit(c, { ...req.valid.body, trigger: 'manual' })),
  })
  .route({
    method: 'get',
    path: '/',
    tags,
    summary: 'History of the night audits of a property (latest first)',
    middleware: [can('night_audit.read', { property: propertyFromRequest }), feature],
    request: { query: s.listQuery },
    responses: { 200: { description: 'Page', schema: s.auditPage } },
    handler: (req) => withRCtx(req, (c) => svc.listAudits(c, req.valid.query)),
  })
  .route({
    method: 'get',
    path: '/:id',
    tags,
    summary: 'Night audit with its steps and the day KPIs',
    middleware: [can('night_audit.read'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Audit', schema: s.auditSchema } },
    handler: (req) => withRCtx(req, (c) => svc.getAudit(c, req.valid.params.id)),
  })
  .route({
    method: 'get',
    path: '/:id/report',
    tags,
    summary: 'Signed URL of the day report PDF (rendered on demand when missing)',
    middleware: [can('night_audit.read'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Report', schema: s.reportSchema } },
    handler: (req) => withRCtx(req, (c) => svc.auditReport(c, req.valid.params.id)),
  });
