import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest } from '../property/common.js';
import { withRCtx } from '../reservations/context.js';
import { availabilityQuery, availabilitySchema, planningQuery, planningSchema } from './schemas.js';
import { planning, searchAvailability } from './service.js';

const feature = requireFeature('lodging.core');
const read = can('reservations.read', { property: propertyFromRequest });

export const availabilityRouter = createModuleRouter().route({
  method: 'get',
  path: '/',
  summary: 'Free units per room type and night, sellable flag and quote per rate plan',
  middleware: [read, feature],
  request: { query: availabilityQuery },
  responses: { 200: { description: 'Availability', schema: availabilitySchema } },
  handler: (req) => withRCtx(req, (ctx) => searchAvailability(ctx, req.valid.query)),
});

export const planningRouter = createModuleRouter().route({
  method: 'get',
  path: '/',
  summary: 'Planning grid: rooms by type (hk status), reservation segments, blocks, free units',
  middleware: [read, feature],
  request: { query: planningQuery },
  responses: { 200: { description: 'Planning', schema: planningSchema } },
  handler: (req) => withRCtx(req, (ctx) => planning(ctx, req.valid.query)),
});
