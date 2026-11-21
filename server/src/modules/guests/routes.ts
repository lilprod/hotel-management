import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { withRCtx } from '../reservations/context.js';
import {
  createGuestBody,
  guestPage,
  guestSchema,
  idParams,
  listGuestsQuery,
  updateGuestBody,
} from './schemas.js';
import * as service from './service.js';

const feature = requireFeature('lodging.core');

export const guestsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    summary: 'Search guests by name, phone or e-mail (trigram similarity)',
    middleware: [can('guests.read'), feature],
    request: { query: listGuestsQuery },
    responses: { 200: { description: 'Page', schema: guestPage } },
    handler: (req) => withRCtx(req, (ctx) => service.listGuests(ctx, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/',
    summary: 'Create a guest (identity document number encrypted at rest)',
    middleware: [can('guests.create'), feature],
    request: { body: createGuestBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: guestSchema } },
    handler: (req) => withRCtx(req, (ctx) => service.createGuest(ctx, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/:id',
    summary: 'Guest profile',
    middleware: [can('guests.read'), feature],
    request: { params: idParams },
    responses: { 200: { description: 'Guest', schema: guestSchema } },
    handler: (req) => withRCtx(req, (ctx) => service.getGuest(ctx, req.valid.params.id)),
  })
  .route({
    method: 'patch',
    path: '/:id',
    summary: 'Update a guest (incl. blacklist flag)',
    middleware: [can('guests.update'), feature],
    request: { params: idParams, body: updateGuestBody },
    responses: { 200: { description: 'Updated', schema: guestSchema } },
    handler: (req) =>
      withRCtx(req, (ctx) => service.updateGuest(ctx, req.valid.params.id, req.valid.body)),
  });
