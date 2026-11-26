import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { upload } from '../../lib/upload.js';
import { withIdempotency } from '../billing/idempotency.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from '../reservations/context.js';
import { reservationSchema } from '../reservations/schemas.js';
import { checkIn, walkIn } from './checkin.js';
import { checkOut, previewCheckout, searchCompanies } from './checkout.js';
import { FILE_MAX_BYTES, FILE_MIME_TYPES, uploadFile } from './files.js';
import { availableRooms, dayList, summary } from './lists.js';
import { exportPolice, listPolice, policeFormPdf } from './police.js';
import {
  availableRoomSchema,
  companyOptionSchema,
  companySearchQuery,
  checkInBody,
  checkoutBody,
  dayListSchema,
  dayQuery,
  departureBody,
  earlyDepartureBody,
  fileResultSchema,
  idParams,
  availableRoomsQuery,
  policeExportQuery,
  policeListQuery,
  policePage,
  roomChangeBody,
  stayResultSchema,
  summarySchema,
  walkInBody,
} from './schemas.js';
import { changeRoom, earlyDeparture, extendStay, getStay, shortenStay } from './stay-ops.js';
import type { DayListKind } from './lists.js';

const feature = requireFeature('lodging.core');
const tags = ['Front desk'];
const byProperty = { property: propertyFromRequest };
const loose = z.record(z.string(), z.unknown());

const listRoute = (path: string, kind: DayListKind, summaryText: string) => ({
  method: 'get' as const,
  path,
  tags,
  summary: summaryText,
  middleware: [can('front_desk.read', byProperty), feature],
  request: { query: dayQuery },
  responses: { 200: { description: 'List', schema: dayListSchema } },
  handler: (req: { valid: { query: z.infer<typeof dayQuery> } } & Parameters<typeof withRCtx>[0]) =>
    withRCtx(req, (ctx) => dayList(ctx, kind, req.valid.query)),
});

/** Front desk (OP-20…OP-25), mounted on `/api/v1/t/front-desk`. */
export const frontDeskRouter = createModuleRouter()
  .route(listRoute('/arrivals', 'arrivals', 'Arrivals due on the business date (late ones included)'))
  .route(listRoute('/departures', 'departures', 'Departures due on the business date (overdue included)'))
  .route(listRoute('/in-house', 'in-house', 'In-house stays'))
  .route(listRoute('/no-shows', 'no-shows', 'No-show candidates (confirmed, arrival date passed)'))
  .route({
    method: 'get',
    path: '/summary',
    tags,
    summary: 'KPI header: arrivals, departures, in-house, no-show candidates, clean free rooms',
    middleware: [can('front_desk.read', byProperty), feature],
    request: { query: dayQuery },
    responses: { 200: { description: 'Counts', schema: summarySchema } },
    handler: (req) => withRCtx(req, (ctx) => summary(ctx, req.valid.query)),
  })
  .route({
    method: 'get',
    path: '/available-rooms',
    tags,
    summary: 'Free units over [from, to) with their housekeeping status (clean ones are suggested)',
    middleware: [can('front_desk.read', byProperty), feature],
    request: { query: availableRoomsQuery },
    responses: { 200: { description: 'Rooms', schema: z.array(availableRoomSchema) } },
    handler: (req) => withRCtx(req, (ctx) => availableRooms(ctx, req.valid.query)),
  })
  .route({
    method: 'get',
    path: '/companies',
    tags,
    summary: 'Companies able to receive a balance transfer (search by name or NIF)',
    middleware: [can('front_desk.check_out'), feature],
    request: { query: companySearchQuery },
    responses: { 200: { description: 'Companies', schema: z.array(companyOptionSchema) } },
    handler: (req) => withRCtx(req, (ctx) => searchCompanies(ctx, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/files',
    tags,
    summary: 'Uploads a signature image or an ID scan (multipart field `file`, query kind)',
    middleware: [
      can('front_desk.check_in'),
      feature,
      upload({ field: 'file', maxBytes: FILE_MAX_BYTES, mimeTypes: FILE_MIME_TYPES }),
    ],
    request: { query: z.object({ kind: z.enum(['signature', 'id_scan']).default('signature') }) },
    status: 201,
    responses: { 201: { description: 'Stored', schema: fileResultSchema } },
    handler: (req) =>
      withRCtx(req, (ctx) =>
        uploadFile(ctx, req.valid.query.kind, (req as unknown as { file?: Express.Multer.File }).file),
      ),
  })
  .route({
    method: 'post',
    path: '/stays',
    tags,
    summary: 'Check-in of a reservation room (room, identity + police record, optional deposit)',
    description:
      'The room must be CLEAN/INSPECTED unless overrideDirty with front_desk.override_dirty. ' +
      'Creates the stay and one police record per guest, then CHECKED_IN. Idempotency-Key supported.',
    middleware: [can('front_desk.check_in'), feature],
    request: { body: checkInBody },
    status: 201,
    responses: { 201: { description: 'Checked in', schema: stayResultSchema } },
    handler: (req, res) =>
      withIdempotency(req, res, 'front-desk.check-in', 201, () =>
        withRCtx(req, (ctx) => checkIn(ctx, req.valid.body)),
      ),
  })
  .route({
    method: 'post',
    path: '/walk-ins',
    tags,
    summary: 'Walk-in: guest + reservation (today → departure) + check-in in one call',
    middleware: [can('front_desk.check_in', byProperty), can('reservations.create', byProperty), feature],
    request: { body: walkInBody },
    status: 201,
    responses: { 201: { description: 'Checked in', schema: stayResultSchema } },
    handler: (req, res) =>
      withIdempotency(req, res, 'front-desk.walk-in', 201, () =>
        withRCtx(req, (ctx) => walkIn(ctx, req.valid.body)),
      ),
  })
  .route({
    method: 'get',
    path: '/stays/:id',
    tags,
    summary: 'Stay summary (the id may be the stay or its reservation room; created lazily if absent)',
    middleware: [can('front_desk.read'), feature],
    request: { params: idParams },
    responses: { 200: { description: 'Stay', schema: z.object({ reservation: reservationSchema }).passthrough() } },
    handler: (req) => withRCtx(req, (ctx) => getStay(ctx, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/stays/:id/room-change',
    tags,
    summary: 'Moves the remaining nights to another unit (old room becomes DIRTY)',
    middleware: [can('front_desk.move'), feature],
    request: { params: idParams, body: roomChangeBody },
    responses: { 200: { description: 'Moved', schema: loose } },
    handler: (req) => withRCtx(req, (ctx) => changeRoom(ctx, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/stays/:id/extend',
    tags,
    summary: 'Extends the stay (new nights re-quoted, availability checked)',
    middleware: [can('front_desk.move'), feature],
    request: { params: idParams, body: departureBody },
    responses: { 200: { description: 'Extended', schema: loose } },
    handler: (req) =>
      withRCtx(req, (ctx) => extendStay(ctx, req.valid.params.id, req.valid.body.departure, req.valid.body.reason)),
  })
  .route({
    method: 'post',
    path: '/stays/:id/shorten',
    tags,
    summary: 'Shortens the stay (nights released)',
    middleware: [can('front_desk.move'), feature],
    request: { params: idParams, body: departureBody },
    responses: { 200: { description: 'Shortened', schema: loose } },
    handler: (req) =>
      withRCtx(req, (ctx) => shortenStay(ctx, req.valid.params.id, req.valid.body.departure, req.valid.body.reason)),
  })
  .route({
    method: 'post',
    path: '/stays/:id/early-departure',
    tags,
    summary: 'Early departure (default: leaves today, remaining nights released)',
    middleware: [can('front_desk.move'), feature],
    request: { params: idParams, body: earlyDepartureBody },
    responses: { 200: { description: 'Shortened', schema: loose } },
    handler: (req) =>
      withRCtx(req, (ctx) => earlyDeparture(ctx, req.valid.params.id, req.valid.body.departure, req.valid.body.reason)),
  })
  .route({
    method: 'post',
    path: '/stays/:id/checkout-preview',
    tags,
    summary: 'Posts the nights due, then returns folios, department summary, balance and blockers',
    middleware: [can('front_desk.check_out'), feature],
    request: { params: idParams },
    responses: { 200: { description: 'Preview', schema: loose } },
    handler: (req) => withRCtx(req, (ctx) => previewCheckout(ctx, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/stays/:id/checkout',
    tags,
    summary: 'Check-out: blockers refuse it unless city-ledger transfer or checkout_with_balance',
    middleware: [can('front_desk.check_out'), feature],
    request: { params: idParams, body: checkoutBody },
    responses: { 200: { description: 'Checked out', schema: loose } },
    handler: (req, res) =>
      withIdempotency(req, res, `front-desk.check-out:${req.valid.params.id}`, 200, () =>
        withRCtx(req, (ctx) => checkOut(ctx, req.valid.params.id, req.valid.body)),
      ),
  })
  .route({
    method: 'get',
    path: '/stays/:id/police-form',
    tags,
    summary: 'Printable police form (PDF, signed URL)',
    middleware: [can('front_desk.police_form'), feature],
    request: { params: idParams },
    responses: { 200: { description: 'PDF', schema: z.object({ fileId: z.string(), url: z.string() }) } },
    handler: (req) => withRCtx(req, (ctx) => policeFormPdf(ctx, req.valid.params.id)),
  })
  .route({
    method: 'get',
    path: '/police-records',
    tags,
    summary: 'Police register of a period (sensitive fields masked without guests.export)',
    middleware: [can('front_desk.police_form', byProperty), feature],
    request: { query: policeListQuery },
    responses: { 200: { description: 'Page', schema: policePage } },
    handler: (req) => withRCtx(req, (ctx) => listPolice(ctx, req.valid.query)),
  })
  .route({
    method: 'get',
    path: '/police-records/export',
    tags,
    summary: 'Register export: CSV (download) or PDF (signed URL), same masking rule',
    middleware: [can('front_desk.police_form', byProperty), feature],
    request: { query: policeExportQuery },
    responses: { 200: { description: 'text/csv or { url }' } },
    handler: (req, res) => withRCtx(req, (ctx) => exportPolice(ctx, res, req.valid.query)),
  });
