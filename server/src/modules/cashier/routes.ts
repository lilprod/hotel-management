import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from '../reservations/context.js';
import * as fx from './exchange-rates.js';
import * as s from './schemas.js';
import * as svc from './service.js';

const feature = requireFeature('billing.core');
const tags = ['Cash sessions'];

export const cashRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags,
    summary: 'Cash sessions (own sessions only without cash.read)',
    middleware: [can('cash.session', { property: propertyFromRequest }), feature],
    request: { query: s.listSessionsQuery },
    responses: { 200: { description: 'Sessions', schema: s.sessionList } },
    handler: (req) => withRCtx(req, (c) => svc.listSessions(c, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/',
    tags,
    summary: 'Opens the cash session of the current user (one per user and property)',
    middleware: [can('cash.session', { property: propertyFromRequest }), feature],
    request: { body: s.openSessionBody },
    status: 201,
    responses: { 201: { description: 'Opened', schema: s.sessionDetail } },
    handler: (req) => withRCtx(req, (c) => svc.openSession(c, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/current',
    tags,
    summary: 'Open session of the current user with the expected amount per method',
    middleware: [can('cash.session', { property: propertyFromRequest }), feature],
    request: { query: s.currentSessionQuery },
    responses: { 200: { description: 'Session or null', schema: s.sessionDetail.nullable() } },
    handler: async (req) =>
      (await withRCtx(req, (c) => svc.currentSession(c, req.valid.query.propertyId))) ?? null,
  })
  .route({
    method: 'get',
    path: '/:id',
    tags,
    summary: 'Session detail with expected amounts',
    middleware: [can('cash.session'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Session', schema: s.sessionDetail } },
    handler: (req) => withRCtx(req, (c) => svc.getSession(c, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/:id/movements',
    tags,
    summary: 'Cash in / cash out with a reason (cashier of the session)',
    middleware: [can('cash.movements'), feature],
    request: { params: s.idParams, body: s.movementBody },
    status: 201,
    responses: { 201: { description: 'Movement', schema: s.movementSchema } },
    handler: (req) =>
      withRCtx(req, (c) => svc.addMovement(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/:id/x-report',
    tags,
    summary: 'X report: current totals per method and currency',
    middleware: [can('cash.session'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Report', schema: s.reportSchema } },
    handler: (req) => withRCtx(req, (c) => svc.xReport(c, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/:id/close',
    tags,
    summary: 'Closes with counted amounts; a variance requires cash.close_with_variance',
    middleware: [can('cash.close'), feature],
    request: { params: s.idParams, body: s.closeSessionBody },
    responses: { 200: { description: 'Z report', schema: s.reportSchema } },
    handler: (req) =>
      withRCtx(req, (c) => svc.closeSession(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/:id/z-report',
    tags,
    summary: 'Z report of a closed session (counted, expected, variance)',
    middleware: [can('cash.session'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Report', schema: s.reportSchema } },
    handler: (req) => withRCtx(req, (c) => svc.zReport(c, req.valid.params.id)),
  });

export const ratesRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags: ['Exchange rates'],
    summary: 'Daily exchange rates (1 base = rate quote)',
    middleware: [can('folio.read'), feature],
    request: { query: s.listRatesQuery },
    responses: { 200: { description: 'Rates', schema: s.rateList } },
    handler: (req) => withRCtx(req, (c) => fx.listRates(c, req.valid.query)),
  })
  .route({
    method: 'put',
    path: '/',
    tags: ['Exchange rates'],
    summary: 'Creates or replaces the rate of a day',
    middleware: [can('settings.manage'), feature],
    request: { body: s.upsertRateBody },
    responses: { 200: { description: 'Rate', schema: s.rateSchema } },
    handler: (req) => withRCtx(req, (c) => fx.upsertRate(c, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/:id',
    tags: ['Exchange rates'],
    summary: 'Deletes a rate (payments keep their own rate snapshot)',
    middleware: [can('settings.manage'), feature],
    request: { params: s.idParams },
    status: 204,
    responses: { 204: { description: 'Deleted' } },
    handler: async (req, res) => {
      await withRCtx(req, (c) => fx.deleteRate(c, req.valid.params.id));
      res.status(204).end();
    },
  });
