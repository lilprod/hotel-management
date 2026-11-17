import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { can, requireFeature } from '../../http/helpers.js';
import { propertyFromRequest, withCtx } from '../property/common.js';
import * as s from './schemas.js';
import * as service from './service.js';

const feature = requireFeature('lodging.core');
const read = can('lodging.read', { property: propertyFromRequest });
const manage = can('lodging.manage', { property: propertyFromRequest });
const readId = can('lodging.read');
const manageId = can('lodging.manage');
const setRead = can('settings.read', { property: propertyFromRequest });
const setManage = can('settings.manage', { property: propertyFromRequest });
const setReadId = can('settings.read');
const setManageId = can('settings.manage');
const items = <T extends z.ZodType>(t: T) => z.object({ items: z.array(t) });
const gone = { 204: { description: 'Deleted' } };

export const ratesRouter = createModuleRouter()
  // rate plans
  .route({
    method: 'get',
    path: '/rate-plans',
    summary: 'Rate plans of a property',
    middleware: [read, feature],
    request: { query: s.listRatePlansQuery },
    responses: { 200: { description: 'Page', schema: s.ratePlanPage } },
    handler: (req) => withCtx(req, (c) => service.listRatePlans(c, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/rate-plans',
    summary: 'Create a rate plan',
    middleware: [manage, feature],
    request: { body: s.createRatePlanBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: s.ratePlanSchema } },
    handler: (req) => withCtx(req, (c) => service.createRatePlan(c, req.valid.body)),
  })
  .route({
    method: 'get',
    path: '/rate-plans/:id',
    summary: 'Rate plan detail',
    middleware: [readId, feature],
    request: { params: s.idParams },
    responses: { 200: { description: 'Rate plan', schema: s.ratePlanSchema } },
    handler: (req) => withCtx(req, (c) => service.getRatePlan(c, req.valid.params.id)),
  })
  .route({
    method: 'patch',
    path: '/rate-plans/:id',
    summary: 'Update a rate plan',
    middleware: [manageId, feature],
    request: { params: s.idParams, body: s.updateRatePlanBody },
    responses: { 200: { description: 'Updated', schema: s.ratePlanSchema } },
    handler: (req) =>
      withCtx(req, (c) => service.updateRatePlan(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/rate-plans/:id',
    summary: 'Delete a rate plan',
    middleware: [manageId, feature],
    request: { params: s.idParams },
    status: 204,
    responses: gone,
    handler: async (req, res) => {
      await withCtx(req, (c) => service.deleteRatePlan(c, req.valid.params.id));
      res.status(204).end();
    },
  })
  // seasons
  .route({
    method: 'get',
    path: '/seasons',
    summary: 'Seasons of a property',
    middleware: [read, feature],
    request: { query: s.propertyQuery },
    responses: { 200: { description: 'Seasons', schema: items(s.seasonSchema) } },
    handler: (req) => withCtx(req, (c) => service.listSeasons(c, req.valid.query.propertyId)),
  })
  .route({
    method: 'post',
    path: '/seasons',
    summary: 'Create a season (priority: higher wins)',
    middleware: [manage, feature],
    request: { body: s.createSeasonBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: s.seasonSchema } },
    handler: (req) => withCtx(req, (c) => service.createSeason(c, req.valid.body)),
  })
  .route({
    method: 'patch',
    path: '/seasons/:id',
    summary: 'Update a season',
    middleware: [manageId, feature],
    request: { params: s.idParams, body: s.updateSeasonBody },
    responses: { 200: { description: 'Updated', schema: s.seasonSchema } },
    handler: (req) =>
      withCtx(req, (c) => service.updateSeason(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/seasons/:id',
    summary: 'Delete a season without rates',
    middleware: [manageId, feature],
    request: { params: s.idParams },
    status: 204,
    responses: gone,
    handler: async (req, res) => {
      await withCtx(req, (c) => service.deleteSeason(c, req.valid.params.id));
      res.status(204).end();
    },
  })
  // rates
  .route({
    method: 'get',
    path: '/rates',
    summary: 'Rate grid of a rate plan',
    middleware: [readId, feature],
    request: { query: s.listRatesQuery },
    responses: { 200: { description: 'Rates', schema: items(s.rateSchema) } },
    handler: (req) => withCtx(req, (c) => service.listRates(c, req.valid.query)),
  })
  .route({
    method: 'post',
    path: '/rates',
    summary: 'Create a rate (room type × season × days)',
    middleware: [manageId, feature],
    request: { body: s.createRateBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: s.rateSchema } },
    handler: (req) => withCtx(req, (c) => service.createRate(c, req.valid.body)),
  })
  .route({
    method: 'patch',
    path: '/rates/:id',
    summary: 'Update a rate',
    middleware: [manageId, feature],
    request: { params: s.idParams, body: s.updateRateBody },
    responses: { 200: { description: 'Updated', schema: s.rateSchema } },
    handler: (req) =>
      withCtx(req, (c) => service.updateRate(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/rates/:id',
    summary: 'Delete a rate',
    middleware: [manageId, feature],
    request: { params: s.idParams },
    status: 204,
    responses: gone,
    handler: async (req, res) => {
      await withCtx(req, (c) => service.deleteRate(c, req.valid.params.id));
      res.status(204).end();
    },
  })
  // taxes
  .route({
    method: 'get',
    path: '/tax-rules',
    summary: 'Platform tax rules (read only)',
    middleware: [setReadId, feature],
    request: { query: s.taxRulesQuery },
    responses: { 200: { description: 'Rules', schema: items(s.taxRuleSchema) } },
    handler: (req) => withCtx(req, (c) => service.listTaxRules(c, req.valid.query.country)),
  })
  .route({
    method: 'get',
    path: '/taxes',
    summary: 'Taxes of a property',
    middleware: [setRead, feature],
    request: { query: s.propertyQuery },
    responses: { 200: { description: 'Taxes', schema: items(s.taxSchema) } },
    handler: (req) => withCtx(req, (c) => service.listTaxes(c, req.valid.query.propertyId)),
  })
  .route({
    method: 'post',
    path: '/taxes',
    summary: 'Create a tax (optionally bound to a tax rule)',
    middleware: [setManage, feature],
    request: { body: s.createTaxBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: s.taxSchema } },
    handler: (req) => withCtx(req, (c) => service.createTax(c, req.valid.body)),
  })
  .route({
    method: 'patch',
    path: '/taxes/:id',
    summary: 'Update a tax',
    middleware: [setManageId, feature],
    request: { params: s.idParams, body: s.updateTaxBody },
    responses: { 200: { description: 'Updated', schema: s.taxSchema } },
    handler: (req) =>
      withCtx(req, (c) => service.updateTax(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/taxes/:id',
    summary: 'Delete a tax',
    middleware: [setManageId, feature],
    request: { params: s.idParams },
    status: 204,
    responses: gone,
    handler: async (req, res) => {
      await withCtx(req, (c) => service.deleteTax(c, req.valid.params.id));
      res.status(204).end();
    },
  })
  // policies
  .route({
    method: 'get',
    path: '/policies',
    summary: 'Cancellation / deposit policies',
    middleware: [setRead, feature],
    request: { query: s.propertyQuery },
    responses: { 200: { description: 'Policies', schema: items(s.policySchema) } },
    handler: (req) => withCtx(req, (c) => service.listPolicies(c, req.valid.query.propertyId)),
  })
  .route({
    method: 'post',
    path: '/policies',
    summary: 'Create a policy (rules validated per kind)',
    middleware: [setManage, feature],
    request: { body: s.createPolicyBody },
    status: 201,
    responses: { 201: { description: 'Created', schema: s.policySchema } },
    handler: (req) => withCtx(req, (c) => service.createPolicy(c, req.valid.body)),
  })
  .route({
    method: 'patch',
    path: '/policies/:id',
    summary: 'Update a policy',
    middleware: [setManageId, feature],
    request: { params: s.idParams, body: s.updatePolicyBody },
    responses: { 200: { description: 'Updated', schema: s.policySchema } },
    handler: (req) =>
      withCtx(req, (c) => service.updatePolicy(c, req.valid.params.id, req.valid.body)),
  })
  .route({
    method: 'delete',
    path: '/policies/:id',
    summary: 'Delete an unused policy',
    middleware: [setManageId, feature],
    request: { params: s.idParams },
    status: 204,
    responses: gone,
    handler: async (req, res) => {
      await withCtx(req, (c) => service.deletePolicy(c, req.valid.params.id));
      res.status(204).end();
    },
  })
  // quote
  .route({
    method: 'post',
    path: '/quote',
    summary: 'Price a stay (nightly breakdown, extras, taxes, total)',
    middleware: [read, feature],
    request: { body: s.quoteBody },
    responses: { 200: { description: 'Quote', schema: s.quoteSchema } },
    handler: (req) => withCtx(req, (c) => service.quoteStay(c, req.valid.body)),
  });
