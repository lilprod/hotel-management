import { createModuleRouter } from '../../core/router.js';
import { anyStaff, can, requireFeature } from '../../http/helpers.js';
import { withCtx } from '../property/common.js';
import {
  createDefinitionBody,
  definitionSchema,
  idParams,
  listDefinitionsQuery,
  updateDefinitionBody,
} from './schemas.js';
import { z } from 'zod';
import * as service from './service.js';

const feature = requireFeature('lodging.core');

export const customFieldsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/definitions',
    summary: 'List custom field definitions (forms of every module read them)',
    // Read-only referential needed to render any form: open to every staff member.
    middleware: [anyStaff(), feature],
    request: { query: listDefinitionsQuery },
    responses: {
      200: { description: 'Definitions', schema: z.object({ items: z.array(definitionSchema) }) },
    },
    handler: (req) => withCtx(req, (ctx) => service.listDefinitions(ctx, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/definitions',
    summary: 'Create a custom field definition',
    middleware: [can('settings.manage'), feature],
    request: { body: createDefinitionBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: definitionSchema } },
    handler: (req) => withCtx(req, (ctx) => service.createDefinition(ctx, req.valid.body)),
  })
  .route({
    method: 'patch',
    path: '/definitions/:id',
    summary: 'Update a custom field definition (entity, key and type are immutable)',
    middleware: [can('settings.manage'), feature],
    request: { params: idParams, body: updateDefinitionBody },
    responses: { 200: { description: 'Updated', schema: definitionSchema } },
    handler: (req) =>
      withCtx(req, (ctx) => service.updateDefinition(ctx, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/definitions/:id',
    summary: 'Delete a custom field definition',
    middleware: [can('settings.manage'), feature],
    request: { params: idParams },
    status: 204,
    responses: { 204: { description: 'Deleted' } },
    handler: async (req, res) => {
      await withCtx(req, (ctx) => service.deleteDefinition(ctx, req.valid.params.id));
      res.status(204).end();
    },
  });
