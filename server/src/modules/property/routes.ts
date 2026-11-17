import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { can, checkQuota, requireFeature } from '../../http/helpers.js';
import { upload } from '../../lib/upload.js';
import { invalid, propertyFromRequest, runGuard, withCtx } from './common.js';
import {
  blockSchema,
  bulkResultSchema,
  bulkRoomsBody,
  createBlockBody,
  createPropertyBody,
  createRoomBody,
  createRoomTypeBody,
  idParams,
  listBlocksQuery,
  listRoomTypesQuery,
  listRoomsQuery,
  photoParams,
  photoUrlSchema,
  propertySchema,
  roomPage,
  roomSchema,
  roomTypePage,
  roomTypeSchema,
  updatePropertyBody,
  updateRoomBody,
  updateRoomTypeBody,
} from './schemas.js';
import * as service from './service.js';

const feature = requireFeature('lodging.core');
const read = can('lodging.read', { property: propertyFromRequest });
const manage = can('lodging.manage', { property: propertyFromRequest });
const readId = can('lodging.read');
const manageId = can('lodging.manage');
const imageUpload = upload({
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  maxBytes: 5_000_000,
});

const noContent = { 204: { description: 'Deleted' } };

export const propertyRouter = createModuleRouter()
  // ── properties ──
  .route({
    method: 'get',
    path: '/properties',
    summary: 'Properties reachable by the caller',
    middleware: [readId, feature],
    responses: {
      200: { description: 'Properties', schema: z.object({ items: z.array(propertySchema) }) },
    },
    handler: (req) => withCtx(req, (ctx) => service.listProperties(ctx)),
  })
  .route({
    method: 'post',
    path: '/properties',
    summary: 'Create a property (quota `properties`)',
    middleware: [can('settings.manage'), feature],
    request: { body: createPropertyBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: propertySchema } },
    handler: async (req, res) => {
      await runGuard(
        checkQuota('properties', {
          used: (r) => withCtx(r, (ctx) => service.countProperties(ctx)),
        }),
        req,
        res,
      );
      return withCtx(req, (ctx) => service.createProperty(ctx, req.valid.body));
    },
  })
  .route({
    method: 'get',
    path: '/properties/:id',
    summary: 'Property detail',
    middleware: [readId, feature],
    request: { params: idParams },
    responses: { 200: { description: 'Property', schema: propertySchema } },
    handler: (req) => withCtx(req, (ctx) => service.getProperty(ctx, req.valid.params.id)),
  })
  .route({
    method: 'patch',
    path: '/properties/:id',
    summary: 'Update a property',
    middleware: [can('settings.manage'), feature],
    request: { params: idParams, body: updatePropertyBody },
    responses: { 200: { description: 'Updated', schema: propertySchema } },
    handler: (req) =>
      withCtx(req, (ctx) => service.updateProperty(ctx, req.valid.params.id, req.valid.body)),
  })
  // ── room types ──
  .route({
    method: 'get',
    path: '/room-types',
    summary: 'Room types of a property',
    middleware: [read, feature],
    request: { query: listRoomTypesQuery },
    responses: { 200: { description: 'Page', schema: roomTypePage } },
    handler: (req) => withCtx(req, (ctx) => service.listRoomTypes(ctx, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/room-types',
    summary: 'Create a room type',
    middleware: [manage, feature],
    request: { body: createRoomTypeBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: roomTypeSchema } },
    handler: (req) => withCtx(req, (ctx) => service.createRoomType(ctx, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/room-types/:id',
    summary: 'Room type detail',
    middleware: [readId, feature],
    request: { params: idParams },
    responses: { 200: { description: 'Room type', schema: roomTypeSchema } },
    handler: (req) => withCtx(req, (ctx) => service.getRoomType(ctx, req.valid.params.id)),
  })
  .route({
    method: 'patch',
    path: '/room-types/:id',
    summary: 'Update a room type',
    middleware: [manageId, feature],
    request: { params: idParams, body: updateRoomTypeBody },
    responses: { 200: { description: 'Updated', schema: roomTypeSchema } },
    handler: (req) =>
      withCtx(req, (ctx) => service.updateRoomType(ctx, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/room-types/:id',
    summary: 'Delete a room type without rooms',
    middleware: [manageId, feature],
    request: { params: idParams },
    status: 204,
    responses: noContent,
    handler: async (req, res) => {
      await withCtx(req, (ctx) => service.deleteRoomType(ctx, req.valid.params.id));
      res.status(204).end();
    },
  })
  .route({
    method: 'get',
    path: '/room-types/:id/photos',
    summary: 'Photos of a room type (signed URLs, 5 min)',
    middleware: [readId, feature],
    request: { params: idParams },
    responses: {
      200: { description: 'Photos', schema: z.object({ items: z.array(photoUrlSchema) }) },
    },
    handler: (req) => withCtx(req, (ctx) => service.listRoomTypePhotos(ctx, req.valid.params.id)),
  })
  .route({
    method: 'post',
    path: '/room-types/:id/photos',
    summary: 'Upload a photo (multipart field `file`, jpeg/png/webp ≤ 5 MB)',
    middleware: [manageId, feature, imageUpload],
    request: { params: idParams },
    status: 201,
    responses: { 201: { description: 'Uploaded', schema: photoUrlSchema } },
    handler: (req) => {
      const file = req.file;
      if (!file) throw invalid('file', 'A file is required', 'required');
      return withCtx(req, (ctx) => service.addRoomTypePhoto(ctx, req.valid.params.id, file));
    },
  })
  .route({
    method: 'delete',
    path: '/room-types/:id/photos/:fileId',
    summary: 'Remove a photo',
    middleware: [manageId, feature],
    request: { params: photoParams },
    status: 204,
    responses: noContent,
    handler: async (req, res) => {
      await withCtx(req, (ctx) =>
        service.removeRoomTypePhoto(ctx, req.valid.params.id, req.valid.params.fileId),
      );
      res.status(204).end();
    },
  })
  // ── rooms ──
  .route({
    method: 'get',
    path: '/rooms',
    summary: 'Rooms of a property',
    middleware: [read, feature],
    request: { query: listRoomsQuery },
    responses: { 200: { description: 'Page', schema: roomPage } },
    handler: (req) => withCtx(req, (ctx) => service.listRooms(ctx, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/rooms',
    summary: 'Create a room (quota `units`)',
    middleware: [manage, feature],
    request: { body: createRoomBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: roomSchema } },
    handler: async (req, res) => {
      await runGuard(
        checkQuota('units', { used: (r) => withCtx(r, (ctx) => service.countRooms(ctx)) }),
        req,
        res,
      );
      return withCtx(req, (ctx) => service.createRoom(ctx, req.valid.body));
    },
  })
  .route({
    method: 'post',
    path: '/rooms/bulk',
    summary: 'Create numbered rooms in bulk (e.g. 101–130, quota `units` for the whole batch)',
    middleware: [manage, feature],
    request: { body: bulkRoomsBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: bulkResultSchema } },
    handler: async (req, res) => {
      const { from, to } = req.valid.body;
      await runGuard(
        checkQuota('units', {
          used: (r) => withCtx(r, (ctx) => service.countRooms(ctx)),
          adding: () => to - from + 1,
        }),
        req,
        res,
      );
      return withCtx(req, (ctx) => service.bulkCreateRooms(ctx, req.valid.body));
    },
  })
  .route({
    method: 'get',
    path: '/rooms/:id',
    summary: 'Room detail',
    middleware: [readId, feature],
    request: { params: idParams },
    responses: { 200: { description: 'Room', schema: roomSchema } },
    handler: (req) => withCtx(req, (ctx) => service.getRoom(ctx, req.valid.params.id)),
  })
  .route({
    method: 'patch',
    path: '/rooms/:id',
    summary: 'Update a room (custom fields validated against the definitions)',
    middleware: [manageId, feature],
    request: { params: idParams, body: updateRoomBody },
    responses: { 200: { description: 'Updated', schema: roomSchema } },
    handler: (req) =>
      withCtx(req, (ctx) => service.updateRoom(ctx, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/rooms/:id',
    summary: 'Delete a room',
    middleware: [manageId, feature],
    request: { params: idParams },
    status: 204,
    responses: noContent,
    handler: async (req, res) => {
      await withCtx(req, (ctx) => service.deleteRoom(ctx, req.valid.params.id));
      res.status(204).end();
    },
  })
  // ── room blocks ──
  .route({
    method: 'get',
    path: '/room-blocks',
    summary: 'Room blocks (maintenance / out of service) of a property',
    middleware: [read, feature],
    request: { query: listBlocksQuery },
    responses: {
      200: { description: 'Blocks', schema: z.object({ items: z.array(blockSchema) }) },
    },
    handler: (req) => withCtx(req, (ctx) => service.listBlocks(ctx, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/room-blocks',
    summary: 'Block a room for nights [fromDate, toDate)',
    middleware: [manageId, feature],
    request: { body: createBlockBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: blockSchema } },
    handler: (req) => withCtx(req, (ctx) => service.createBlock(ctx, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/room-blocks/:id',
    summary: 'Lift a room block',
    middleware: [manageId, feature],
    request: { params: idParams },
    status: 204,
    responses: noContent,
    handler: async (req, res) => {
      await withCtx(req, (ctx) => service.deleteBlock(ctx, req.valid.params.id));
      res.status(204).end();
    },
  });
