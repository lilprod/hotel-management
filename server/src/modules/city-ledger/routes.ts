import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { withIdempotency } from '../billing/idempotency.js';
import { folioSchema, paymentResult } from '../folio/schemas.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from '../reservations/context.js';
import * as s from './schemas.js';
import * as svc from './service.js';

const feature = requireFeature('city_ledger');
const tags = ['City ledger'];

export const cityLedgerRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/accounts',
    tags,
    summary: 'Company accounts with balances',
    middleware: [can('city_ledger.read', { property: propertyFromRequest }), feature],
    request: { query: s.accountsQuery },
    responses: { 200: { description: 'Accounts', schema: s.accountList } },
    handler: (req) => withRCtx(req, (c) => svc.listAccounts(c, req.valid.query)),
  })
  .route({
    method: 'get',
    path: '/aging',
    tags,
    summary: 'Aging of company balances (0-30, 31-60, 61-90, > 90 days)',
    middleware: [can('city_ledger.read', { property: propertyFromRequest }), feature],
    request: { query: s.agingQuery },
    responses: { 200: { description: 'Aging', schema: s.agingSchema } },
    handler: (req) => withRCtx(req, (c) => svc.aging(c, req.valid.query)),
  })
  .route({
    method: 'get',
    path: '/accounts/:companyId',
    tags,
    summary: 'Account folio of a company at a property (created at first need)',
    middleware: [can('city_ledger.read', { property: propertyFromRequest }), feature],
    request: { params: s.companyParams, query: s.accountQuery },
    responses: { 200: { description: 'Account', schema: folioSchema } },
    handler: (req) =>
      withRCtx(req, (c) =>
        svc.getAccount(c, req.valid.params.companyId, req.valid.query.propertyId),
      ),
  })
  .route({
    method: 'get',
    path: '/accounts/:companyId/statement',
    tags,
    summary: 'Statement of account (opening, entries with running balance, closing)',
    middleware: [can('city_ledger.read', { property: propertyFromRequest }), feature],
    request: { params: s.companyParams, query: s.statementQuery },
    responses: { 200: { description: 'Statement', schema: s.statementSchema } },
    handler: (req) =>
      withRCtx(req, (c) => svc.statement(c, req.valid.params.companyId, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/accounts/:companyId/settlements',
    tags,
    summary: 'Settlement against the company balance — Idempotency-Key',
    middleware: [can('city_ledger.manage', { property: propertyFromRequest }), feature],
    request: { params: s.companyParams, body: s.settlementBody },
    status: 201,
    responses: {
      201: {
        description: 'Recorded and matched to the city-ledger invoices',
        schema: paymentResult.extend({ allocations: s.allocationResult.shape.allocations }),
      },
    },
    handler: (req, res) =>
      withIdempotency(req, res, `city-ledger:${req.valid.params.companyId}`, 201, () =>
        withRCtx(req, (c) => svc.settle(c, req.valid.params.companyId, req.valid.body)),
      ),
  })
  .route({
    method: 'post',
    path: '/accounts/:companyId/allocations',
    tags,
    summary: 'Matches the unallocated settlements to the open city-ledger invoices (oldest first)',
    middleware: [can('city_ledger.manage', { property: propertyFromRequest }), feature],
    request: { params: s.companyParams, body: s.allocateBody },
    responses: { 200: { description: 'Allocations and invoices', schema: s.allocationResult } },
    handler: (req) => withRCtx(req, (c) => svc.allocate(c, req.valid.params.companyId, req.valid.body)),
  });
