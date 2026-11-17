import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { anyStaff, can, requireFeature } from '../../http/helpers.js';
import { withCtx } from '../property/common.js';
import {
  createValueBody,
  listKeyParams,
  listSummarySchema,
  listValuesQuery,
  updateValueBody,
  valueParams,
  valueSchema,
} from './schemas.js';
import * as service from './service.js';

const feature = requireFeature('lodging.core');

export const lookupsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    summary: 'Lookup lists of the tenant (sources, segments, cancellation reasons…)',
    // Referential read by every form: open to every staff member.
    middleware: [anyStaff(), feature],
    responses: {
      200: { description: 'Lists', schema: z.object({ items: z.array(listSummarySchema) }) },
    },
    handler: (req) => withCtx(req, (ctx) => service.listLists(ctx)),
  })
  .route({
    method: 'get',
    path: '/:listKey',
    summary: 'Values of a lookup list',
    middleware: [anyStaff(), feature],
    request: { params: listKeyParams, query: listValuesQuery },
    responses: {
      200: { description: 'Values', schema: z.object({ items: z.array(valueSchema) }) },
    },
    handler: (req) =>
      withCtx(req, (ctx) =>
        service.listValues(ctx, req.valid.params.listKey, req.valid.query.includeInactive),
      ),
  })
  .route({
    method: 'post',
    path: '/:listKey',
    summary: 'Add a value to a lookup list',
    middleware: [can('settings.manage'), feature],
    request: { params: listKeyParams, body: createValueBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: valueSchema } },
    handler: (req) =>
      withCtx(req, (ctx) => service.createValue(ctx, req.valid.params.listKey, req.valid.body)),
  })
  .route({
    method: 'patch',
    path: '/:listKey/:id',
    summary: 'Update a lookup value (label, order, active)',
    middleware: [can('settings.manage'), feature],
    request: { params: valueParams, body: updateValueBody },
    responses: { 200: { description: 'Updated', schema: valueSchema } },
    handler: (req) =>
      withCtx(req, (ctx) =>
        service.updateValue(ctx, req.valid.params.listKey, req.valid.params.id, req.valid.body),
      ),
  })
  .route({
    method: 'delete',
    path: '/:listKey/:id',
    summary: 'Delete a non-system, unused lookup value',
    middleware: [can('settings.manage'), feature],
    request: { params: valueParams },
    status: 204,
    responses: { 204: { description: 'Deleted' } },
    handler: async (req, res) => {
      await withCtx(req, (ctx) =>
        service.deleteValue(ctx, req.valid.params.listKey, req.valid.params.id),
      );
      res.status(204).end();
    },
  });
