import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from './context.js';
import {
  createGroupBody,
  createGroup,
  getGroup,
  groupSchema,
  groupsQuery,
  listGroups,
  pickUp,
  pickUpBody,
  releaseBody,
  releaseGroup,
} from './groups.js';
import { idParams, reservationSchema } from './schemas.js';

const feature = requireFeature('groups');

export const groupsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    summary: 'Groups of a property',
    middleware: [can('groups.read', { property: propertyFromRequest }), feature],
    request: { query: groupsQuery },
    responses: {
      200: {
        description: 'Groups',
        schema: z.object({
          items: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              companyId: z.string().nullable(),
              createdAt: z.string(),
            }),
          ),
        }),
      },
    },
    handler: (req) => withRCtx(req, (ctx) => listGroups(ctx, req.valid.query.propertyId)),
  })
  .route({
    method: 'post',
    path: '/',
    summary: 'Create a group dossier with its room block (allotment) and release date',
    middleware: [can('groups.manage', { property: propertyFromRequest }), feature],
    request: { body: createGroupBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: groupSchema } },
    handler: (req) => withRCtx(req, (ctx) => createGroup(ctx, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/:id',
    summary: 'Group: block (held / picked up per room type) and rooming list',
    middleware: [can('groups.read'), feature],
    request: { params: idParams },
    responses: { 200: { description: 'Group', schema: groupSchema } },
    handler: (req) => withRCtx(req, (ctx) => getGroup(ctx, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/:id/pick-up',
    summary: 'Pick up rooms from the block for a rooming list (one reservation per entry)',
    middleware: [can('groups.manage'), can('reservations.create'), feature],
    request: { params: idParams, body: pickUpBody },
    status: 201,
    responses: {
      201: {
        description: 'Picked up',
        schema: z.object({ group: groupSchema, reservations: z.array(reservationSchema) }),
      },
    },
    handler: (req) => withRCtx(req, (ctx) => pickUp(ctx, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'post',
    path: '/:id/release',
    summary: 'Release held rooms back to the inventory',
    middleware: [can('groups.manage'), feature],
    request: { params: idParams, body: releaseBody },
    responses: { 200: { description: 'Group', schema: groupSchema } },
    handler: (req) =>
      withRCtx(req, (ctx) => releaseGroup(ctx, req.valid.params.id, req.valid.body)),
  });
