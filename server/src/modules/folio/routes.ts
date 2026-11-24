import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { withIdempotency } from '../billing/idempotency.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from '../reservations/context.js';
import * as pay from './payments.js';
import * as s from './schemas.js';
import * as svc from './service.js';

const feature = requireFeature('billing.core');
const tags = ['Folios'];

export const folioRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags,
    summary: 'Folios (filters: property, reservation, room line, group, company, status)',
    middleware: [can('folio.read', { property: propertyFromRequest }), feature],
    request: { query: s.listQuery },
    responses: { 200: { description: 'Page', schema: s.folioPage } },
    handler: (req) => withRCtx(req, (c) => svc.listFolios(c, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/resolve',
    tags,
    summary: 'Main folio of a reservation room / reservation / group / company account (auto-created)',
    middleware: [can('folio.post'), feature],
    request: { body: s.resolveBody },
    responses: { 200: { description: 'Folio', schema: s.folioSchema } },
    handler: (req) => withRCtx(req, (c) => svc.resolveFolio(c, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/',
    tags,
    summary: 'Additional (split) folio of a reservation room or a group',
    middleware: [can('folio.post'), feature],
    request: { body: s.splitBody },
    status: 201,
    responses: { 201: { description: 'Folio', schema: s.folioSchema } },
    handler: (req) => withRCtx(req, (c) => svc.createSplitFolio(c, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/room-nights',
    tags,
    summary: 'Posts one room night (idempotent per night)',
    middleware: [can('folio.post'), feature],
    request: { body: s.postNightBody },
    responses: { 200: { description: 'Result', schema: s.nightResultSchema } },
    handler: (req) =>
      withRCtx(req, (c) =>
        svc.postRoomNight(c, req.valid.body.reservationRoomId, req.valid.body.businessDate),
      ),
  })
  .route({
    method: 'post',
    path: '/room-nights/up-to',
    tags,
    summary: 'Posts every night of a stay up to a date (night audit, check-out)',
    middleware: [can('folio.post'), feature],
    request: { body: s.postNightsBody },
    responses: { 200: { description: 'Results', schema: s.nightsResult } },
    handler: async (req) => ({
      items: await withRCtx(req, (c) =>
        svc.postNightsUpTo(c, req.valid.body.reservationRoomId, req.valid.body.upTo),
      ),
    }),
  })
  .route({
    method: 'post',
    path: '/checkout-preparation',
    tags,
    summary: 'Check-out support: posts remaining nights, returns balances and blockers',
    middleware: [can('folio.post'), feature],
    request: { body: s.checkoutBody },
    responses: { 200: { description: 'Check-out readiness', schema: s.checkoutSchema } },
    handler: (req) => withRCtx(req, (c) => svc.prepareCheckout(c, req.valid.body.reservationRoomId)),
  })
  .route({
    method: 'get',
    path: '/:id',
    tags,
    summary: 'Folio with lines, payments, balance and tax breakdown per rate',
    middleware: [can('folio.read'), feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Folio', schema: s.folioSchema } },
    handler: (req) => withRCtx(req, (c) => svc.getFolio(c, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/:id/charges',
    tags,
    summary: 'Posts an extra / product (qty × price, product tax) or a manual charge',
    middleware: [can('folio.post'), feature],
    request: { params: s.idParams, body: s.chargeBody },
    status: 201,
    responses: { 201: { description: 'Posted', schema: s.postingResult } },
    handler: (req) => withRCtx(req, (c) => svc.postCharge(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/:id/discounts',
    tags,
    summary: 'Discount on a charge (amount TTC or percent, reason)',
    middleware: [can('folio.discount'), feature],
    request: { params: s.idParams, body: s.discountBody },
    status: 201,
    responses: { 201: { description: 'Posted', schema: s.postingResult } },
    handler: (req) =>
      withRCtx(req, (c) => svc.postDiscount(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/:id/lines/:lineId/reverse',
    tags,
    summary: 'Reverses a charge with its taxes and discounts (reason)',
    middleware: [can('folio.reverse'), feature],
    request: { params: s.lineParams, body: s.reverseBody },
    status: 201,
    responses: { 201: { description: 'Reversed', schema: s.reversalResult } },
    handler: (req) =>
      withRCtx(req, (c) =>
        svc.reverseLine(c, req.valid.params.id, req.valid.params.lineId, req.valid.body.reason),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/lines/move',
    tags,
    summary: 'Moves charges to another folio (reversal + identical repost)',
    middleware: [can('folio.post'), feature],
    request: { params: s.idParams, body: s.moveBody },
    responses: { 200: { description: 'Moved', schema: s.moveResult } },
    handler: (req) => withRCtx(req, (c) => svc.moveLines(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/:id/payments',
    tags,
    summary: 'Guest payment (deposit, partial, multi-currency tender, city ledger) — Idempotency-Key',
    middleware: [can('folio.pay'), feature],
    request: { params: s.idParams, body: s.paymentBody },
    status: 201,
    responses: { 201: { description: 'Recorded', schema: s.paymentResult } },
    handler: (req, res) =>
      withIdempotency(req, res, `folio-payment:${req.valid.params.id}`, 201, () =>
        withRCtx(req, (c) => pay.recordPayment(c, req.valid.params.id, req.valid.body)),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/refunds',
    tags,
    summary: 'Refund of a credit balance — Idempotency-Key',
    middleware: [can('folio.pay'), feature],
    request: { params: s.idParams, body: s.refundBody },
    status: 201,
    responses: { 201: { description: 'Recorded', schema: s.refundResult } },
    handler: (req, res) =>
      withIdempotency(req, res, `folio-refund:${req.valid.params.id}`, 201, () =>
        withRCtx(req, (c) => pay.recordRefund(c, req.valid.params.id, req.valid.body)),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/payments/:paymentId/reverse',
    tags,
    summary: 'Reverses a payment (reason; never deleted)',
    middleware: [can('folio.reverse'), feature],
    request: { params: s.paymentParams, body: s.reverseBody },
    status: 201,
    responses: { 201: { description: 'Reversed', schema: s.paymentReversalResult } },
    handler: (req) =>
      withRCtx(req, (c) =>
        pay.reversePayment(c, req.valid.params.id, req.valid.params.paymentId, req.valid.body.reason),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/payments/:paymentId/receipt',
    tags,
    summary: 'Renders the receipt (80 mm ticket or A4) and returns a signed URL',
    middleware: [can('folio.read'), feature],
    request: { params: s.paymentParams, query: s.receiptQuery },
    responses: { 200: { description: 'Receipt', schema: s.receiptSchema } },
    handler: (req) =>
      withRCtx(req, (c) =>
        pay.renderReceipt(c, req.valid.params.id, req.valid.params.paymentId, req.valid.query.format),
      ),
  });

export const businessDateRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags,
    summary: 'Business date of a property',
    middleware: [can('folio.read', { property: propertyFromRequest }), feature],
    request: { query: s.businessDateQuery },
    responses: { 200: { description: 'Business date', schema: s.businessDateSchema } },
    handler: (req) => withRCtx(req, (c) => svc.getBusinessDate(c, req.valid.query.propertyId)),
  })
  .route({
    method: 'put',
    path: '/',
    tags,
    summary: 'Sets the business date (admin only, tests/demo until the night audit)',
    middleware: [can('night_audit.run', { property: propertyFromRequest }), feature],
    request: { body: s.businessDateBody },
    responses: { 200: { description: 'Business date', schema: s.businessDateSchema } },
    handler: (req) =>
      withRCtx(req, (c) =>
        svc.setBusinessDate(c, req.valid.body.propertyId, req.valid.body.businessDate),
      ),
  });
