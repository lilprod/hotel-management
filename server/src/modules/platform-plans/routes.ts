import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { recordAudit } from '../../middleware/audit.js';
import { platformRole } from '../../middleware/platform-guard.js';
import { idParams } from '../billing/schemas.js';
import {
  addonCreateBody,
  addonUpdateBody,
  couponCreateBody,
  couponUpdateBody,
  featuresBody,
  planCreateBody,
  planUpdateBody,
  priceInput,
  quotasBody,
} from './schemas.js';
import * as svc from './service.js';

const SUPER = platformRole();
const READERS = platformRole('FINANCE', 'SUPPORT', 'READ_ONLY');
const tags = ['platform: plans'];

/** `/api/v1/admin/plans` — SA-10…SA-14 (writes: SUPER_ADMIN). */
export const plansRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags,
    middleware: [READERS],
    request: {
      query: z.object({
        includeDeleted: z
          .enum(['true', 'false'])
          .transform((v) => v === 'true')
          .optional(),
      }),
    },
    handler: (req) => svc.listPlans(req.services, req.valid.query.includeDeleted ?? false),
  })
  .route({
    method: 'post',
    path: '/',
    tags,
    summary: 'Create a plan with features, quotas and prices',
    middleware: [SUPER],
    request: { body: planCreateBody },
    status: 201,
    handler: async (req) => {
      const p = await svc.createPlan(req.services, req.valid.body);
      recordAudit(req, { action: 'plan.create', entity: 'plan', entityId: p.id, after: p });
      return p;
    },
  })
  .route({
    method: 'get',
    path: '/:id',
    tags,
    middleware: [READERS],
    request: { params: idParams },
    handler: (req) => svc.getPlan(req.services, req.valid.params.id),
  })
  .route({
    method: 'patch',
    path: '/:id',
    tags,
    middleware: [SUPER],
    request: { params: idParams, body: planUpdateBody },
    handler: async (req) => {
      const r = await svc.updatePlan(req.services, req.valid.params.id, req.valid.body);
      recordAudit(req, { action: 'plan.update', entity: 'plan', entityId: r.after.id, ...r });
      return r.after;
    },
  })
  .route({
    method: 'delete',
    path: '/:id',
    tags,
    summary: 'Archive a plan without subscribers (soft delete)',
    middleware: [SUPER],
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      const before = await svc.deletePlan(req.services, req.valid.params.id);
      recordAudit(req, { action: 'plan.delete', entity: 'plan', entityId: before.id, before });
      res.status(204).end();
    },
  })
  .route({
    method: 'put',
    path: '/:id/features',
    tags,
    middleware: [SUPER],
    request: { params: idParams, body: featuresBody },
    handler: async (req) => {
      const r = await svc.setPlanFeatures(
        req.services,
        req.valid.params.id,
        req.valid.body.features,
      );
      recordAudit(req, { action: 'plan.features', entity: 'plan', entityId: r.after.id, ...r });
      return r.after;
    },
  })
  .route({
    method: 'put',
    path: '/:id/quotas',
    tags,
    middleware: [SUPER],
    request: { params: idParams, body: quotasBody },
    handler: async (req) => {
      const r = await svc.setPlanQuotas(req.services, req.valid.params.id, req.valid.body.quotas);
      recordAudit(req, { action: 'plan.quotas', entity: 'plan', entityId: r.after.id, ...r });
      return r.after;
    },
  })
  .route({
    method: 'post',
    path: '/:id/prices',
    tags,
    summary: 'Add a price version (cycle, currency, amount, valid from ≥ today)',
    middleware: [SUPER],
    request: { params: idParams, body: priceInput },
    status: 201,
    handler: async (req) => {
      const p = await svc.addPlanPrice(req.services, req.valid.params.id, req.valid.body);
      recordAudit(req, {
        action: 'plan.price.add',
        entity: 'plan_price',
        entityId: p.id,
        after: { planId: req.valid.params.id, ...p },
      });
      return p;
    },
  });

/** `/api/v1/admin/addons` — EX-01 add-ons and their prices. */
export const addonsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags: ['platform: add-ons'],
    middleware: [READERS],
    handler: (req) => svc.listAddons(req.services),
  })
  .route({
    method: 'post',
    path: '/',
    tags: ['platform: add-ons'],
    middleware: [SUPER],
    request: { body: addonCreateBody },
    status: 201,
    handler: async (req) => {
      const a = await svc.createAddon(req.services, req.valid.body);
      recordAudit(req, { action: 'addon.create', entity: 'addon', entityId: a.id, after: a });
      return a;
    },
  })
  .route({
    method: 'get',
    path: '/:id',
    tags: ['platform: add-ons'],
    middleware: [READERS],
    request: { params: idParams },
    handler: (req) => svc.getAddon(req.services, req.valid.params.id),
  })
  .route({
    method: 'patch',
    path: '/:id',
    tags: ['platform: add-ons'],
    middleware: [SUPER],
    request: { params: idParams, body: addonUpdateBody },
    handler: async (req) => {
      const r = await svc.updateAddon(req.services, req.valid.params.id, req.valid.body);
      recordAudit(req, { action: 'addon.update', entity: 'addon', entityId: r.after.id, ...r });
      return r.after;
    },
  })
  .route({
    method: 'post',
    path: '/:id/prices',
    tags: ['platform: add-ons'],
    middleware: [SUPER],
    request: { params: idParams, body: priceInput },
    status: 201,
    handler: async (req) => {
      const p = await svc.addAddonPrice(req.services, req.valid.params.id, req.valid.body);
      recordAudit(req, {
        action: 'addon.price.add',
        entity: 'addon_price',
        entityId: p.id,
        after: { addonId: req.valid.params.id, ...p },
      });
      return p;
    },
  });

/** `/api/v1/admin/coupons` — EX-01 coupons (%, amount, free months). */
export const couponsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags: ['platform: coupons'],
    middleware: [READERS],
    handler: (req) => svc.listCoupons(req.services),
  })
  .route({
    method: 'post',
    path: '/',
    tags: ['platform: coupons'],
    middleware: [SUPER],
    request: { body: couponCreateBody },
    status: 201,
    handler: async (req) => {
      const c = await svc.createCoupon(req.services, req.valid.body);
      recordAudit(req, { action: 'coupon.create', entity: 'coupon', entityId: c.id, after: c });
      return c;
    },
  })
  .route({
    method: 'get',
    path: '/:id',
    tags: ['platform: coupons'],
    middleware: [READERS],
    request: { params: idParams },
    handler: (req) => svc.getCoupon(req.services, req.valid.params.id),
  })
  .route({
    method: 'patch',
    path: '/:id',
    tags: ['platform: coupons'],
    middleware: [SUPER],
    request: { params: idParams, body: couponUpdateBody },
    handler: async (req) => {
      const r = await svc.updateCoupon(req.services, req.valid.params.id, req.valid.body);
      recordAudit(req, { action: 'coupon.update', entity: 'coupon', entityId: r.after.id, ...r });
      return r.after;
    },
  });
