import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from '../reservations/context.js';
import { reservationResult } from '../reservations/schemas.js';
import { acceptBody, createEntryBody, entrySchema, idParams, listEntriesQuery } from './schemas.js';
import * as service from './service.js';

const feature = requireFeature('lodging.core');
const one = { 200: { description: 'Entry', schema: entrySchema } };

export const waitlistRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    summary: 'Waitlist of a property (priority, then first come)',
    middleware: [can('waitlist.read', { property: propertyFromRequest }), feature],
    request: { query: listEntriesQuery },
    responses: {
      200: { description: 'Entries', schema: z.object({ items: z.array(entrySchema) }) },
    },
    handler: (req) => withRCtx(req, (ctx) => service.listEntries(ctx, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/',
    summary: 'Add a guest to the waitlist',
    middleware: [can('waitlist.manage', { property: propertyFromRequest }), feature],
    request: { body: createEntryBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: entrySchema } },
    handler: (req) => withRCtx(req, (ctx) => service.createEntry(ctx, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/:id/cancel',
    summary: 'Remove an entry from the waitlist',
    middleware: [can('waitlist.manage'), feature],
    request: { params: idParams },
    responses: one,
    handler: (req) => withRCtx(req, (ctx) => service.cancelEntry(ctx, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/:id/decline',
    summary: 'The guest declines the offer (next candidate offered)',
    middleware: [can('waitlist.manage'), feature],
    request: { params: idParams },
    responses: one,
    handler: (req) => withRCtx(req, (ctx) => service.declineOffer(ctx, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/:id/accept',
    summary: 'Accept an open offer: converted into a reservation',
    middleware: [can('waitlist.manage'), can('reservations.create'), feature],
    request: { params: idParams, body: acceptBody },
    status: 201,
    responses: {
      201: {
        description: 'Reservation created',
        schema: reservationResult.extend({ entry: entrySchema }),
      },
    },
    handler: (req) =>
      withRCtx(req, (ctx) => service.acceptOffer(ctx, req.valid.params.id, req.valid.body)),
  });
