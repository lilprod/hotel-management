import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { AppError } from '../../lib/errors.js';
import { withIdempotency } from '../billing/idempotency.js';
import { propertyFromRequest } from '../property/common.js';
import { joinWaitlistFor } from '../waitlist/service.js';
import { withRCtx } from './context.js';
import {
  assignBody,
  cancelBody,
  cancelResult,
  confirmBody,
  createReservationBody,
  datesBody,
  idParams,
  listReservationsQuery,
  moveBody,
  noShowBody,
  penaltyPreviewQuery,
  penaltySchema,
  reservationPage,
  reservationResult,
  reservationSchema,
  roomParams,
  updateReservationBody,
} from './schemas.js';
import * as service from './service.js';

const feature = requireFeature('lodging.core');

const one = { 200: { description: 'Reservation', schema: reservationSchema } };

export const reservationsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    summary: 'List reservations (dates, status, guest, source, search; cursor pagination)',
    middleware: [can('reservations.read', { property: propertyFromRequest }), feature],
    request: { query: listReservationsQuery },
    responses: { 200: { description: 'Page', schema: reservationPage } },
    handler: (req) => withRCtx(req, (ctx) => service.listReservations(ctx, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/',
    summary: 'Create a reservation dossier (multi-room, Idempotency-Key supported)',
    description:
      'Anti-overbooking: availability is re-checked under a per-(property, room type) lock and ' +
      'assigned nights are protected by UNIQUE (unit_id, night). No availability → 409 CONFLICT.',
    middleware: [can('reservations.create', { property: propertyFromRequest }), feature],
    request: { body: createReservationBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: reservationResult } },
    handler: (req, res) =>
      withIdempotency(req, res, 'reservations.create', 201, () =>
        withRCtx(req, async (ctx) => {
          try {
            return await service.createReservation(ctx, req.valid.body);
          } catch (err) {
            if (
              req.valid.body.joinWaitlistIfUnavailable &&
              err instanceof AppError &&
              err.code === 'CONFLICT' &&
              err.meta?.reason === 'NO_AVAILABILITY'
            ) {
              const entry = await joinWaitlistFor(ctx, req.valid.body);
              throw new AppError('CONFLICT', undefined, {
                detail: `${err.detail ?? 'No availability'} (added to the waitlist)`,
                meta: { ...err.meta, waitlistEntryId: entry.id },
              });
            }
            throw err;
          }
        }),
      ),
  })
  .route({
    method: 'get',
    path: '/:id',
    summary: 'Reservation detail',
    middleware: [can('reservations.read'), feature],
    request: { params: idParams },
    responses: one,
    handler: (req) => withRCtx(req, (ctx) => service.getReservation(ctx, req.valid.params.id)),
  })
  .route({
    method: 'patch',
    path: '/:id',
    summary: 'Update dates, rooms, rate, occupancy, guests (re-quote and availability re-check)',
    middleware: [can('reservations.update'), feature],
    request: { params: idParams, body: updateReservationBody },
    responses: one,
    handler: (req) =>
      withRCtx(req, (ctx) => service.updateReservation(ctx, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/:id/confirm',
    summary: 'PENDING → CONFIRMED (confirmation sent to the guest)',
    middleware: [can('reservations.update'), feature],
    request: { params: idParams, body: confirmBody },
    responses: one,
    handler: (req) =>
      withRCtx(req, (ctx) =>
        service.confirmReservation(ctx, req.valid.params.id, req.valid.body.notifyGuest),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/cancel',
    summary: 'Cancel with the cancellation policy (penalty computed, stored and returned)',
    middleware: [can('reservations.cancel'), feature],
    request: { params: idParams, body: cancelBody },
    responses: { 200: { description: 'Cancelled', schema: cancelResult } },
    handler: (req) =>
      withRCtx(req, (ctx) => service.cancelReservation(ctx, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/:id/cancellation-preview',
    summary: 'Penalty the cancellation (or no-show) would cost now, same computation as the action',
    middleware: [can('reservations.cancel'), feature],
    request: { params: idParams, query: penaltyPreviewQuery },
    responses: { 200: { description: 'Penalty preview', schema: penaltySchema } },
    handler: (req) =>
      withRCtx(req, (ctx) =>
        service.previewPenalty(ctx, req.valid.params.id, req.valid.query.kind),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/no-show',
    summary: 'Mark a confirmed arrival as no-show (no-show penalty)',
    middleware: [can('reservations.cancel'), feature],
    request: { params: idParams, body: noShowBody },
    responses: { 200: { description: 'No-show', schema: cancelResult } },
    handler: (req) =>
      withRCtx(req, (ctx) =>
        service.markNoShow(ctx, req.valid.params.id, req.valid.body.waivePenalty),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/extend',
    summary: 'Extend the stay (new nights priced, kept nights keep their price)',
    middleware: [can('reservations.update'), feature],
    request: { params: idParams, body: datesBody },
    responses: one,
    handler: (req) =>
      withRCtx(req, (ctx) =>
        service.changeDeparture(ctx, req.valid.params.id, req.valid.body.departure, 'extend'),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/shorten',
    summary: 'Shorten the stay (nights released to the inventory)',
    middleware: [can('reservations.update'), feature],
    request: { params: idParams, body: datesBody },
    responses: one,
    handler: (req) =>
      withRCtx(req, (ctx) =>
        service.changeDeparture(ctx, req.valid.params.id, req.valid.body.departure, 'shorten'),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/rooms/:roomLineId/assign',
    summary: 'Assign a unit to a room line (or move it to another unit)',
    middleware: [can('reservations.assign'), feature],
    request: { params: roomParams, body: assignBody },
    responses: one,
    handler: (req) =>
      withRCtx(req, (ctx) =>
        service.assignRoom(ctx, req.valid.params.id, req.valid.params.roomLineId, req.valid.body),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/rooms/:roomLineId/unassign',
    summary: 'Remove the unit of a room line (it keeps counting against its room type)',
    middleware: [can('reservations.assign'), feature],
    request: { params: roomParams },
    responses: one,
    handler: (req) =>
      withRCtx(req, (ctx) =>
        service.unassignRoom(ctx, req.valid.params.id, req.valid.params.roomLineId),
      ),
  })
  .route({
    method: 'post',
    path: '/:id/rooms/:roomLineId/move',
    summary: 'Planning drag & drop: other unit and/or dates, atomic (conflict → 409 with details)',
    middleware: [can('reservations.assign'), feature],
    request: { params: roomParams, body: moveBody },
    responses: one,
    handler: (req) =>
      withRCtx(req, (ctx) =>
        service.moveRoom(ctx, req.valid.params.id, req.valid.params.roomLineId, req.valid.body),
      ),
  });
