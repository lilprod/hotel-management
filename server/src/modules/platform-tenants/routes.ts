import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { recordAudit } from '../../middleware/audit.js';
import { platformRole } from '../../middleware/platform-guard.js';
import {
  cancelPendingChange,
  cancelSubscription,
  changePlan,
  offerDays,
  reactivateTenant,
  suspendTenant,
} from '../billing/management.js';
import { platformActor } from '../billing/routes.js';
import { idParams, uuid } from '../billing/schemas.js';
import { redeemCoupon } from '../platform-plans/service.js';
import { exportTenant } from './export.js';
import {
  addonAttachBody,
  cancelBody,
  couponBody,
  offerDaysBody,
  overrideBody,
  planChangeBody,
  reasonOnly,
  tenantCreateBody,
  tenantListQuery,
  tenantUpdateBody,
} from './schemas.js';
import * as svc from './service.js';

const SUPER = platformRole();
const SUPPORT = platformRole('SUPPORT');
const READERS = platformRole('FINANCE', 'SUPPORT', 'READ_ONLY');
const tags = ['platform: tenants'];
const childParams = z.object({ id: uuid, childId: uuid });

/** `/api/v1/admin/tenants` — SA-20…SA-26 (writes: SUPER_ADMIN; notes/tags also SUPPORT). */
export const tenantsRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags,
    summary: 'List / filter / search tenants',
    middleware: [READERS],
    request: { query: tenantListQuery },
    handler: (req) => svc.listTenants(req.services, req.valid.query),
  })
  .route({
    method: 'post',
    path: '/',
    tags,
    summary: 'Create a tenant manually (sub-domain, roles, owner invitation, subscription)',
    middleware: [SUPER],
    request: { body: tenantCreateBody },
    status: 201,
    handler: async (req) => {
      const t = await svc.createTenant(req.services, req.valid.body, platformActor(req));
      recordAudit(req, {
        action: 'tenant.create',
        entity: 'tenant',
        entityId: t.id,
        after: {
          slug: t.slug,
          name: t.name,
          plan: t.subscription?.plan.code,
          owner: req.valid.body.owner.email,
        },
      });
      return t;
    },
  })
  .route({
    method: 'get',
    path: '/:id',
    tags,
    summary: 'Tenant card: plan, status, quota usage, invoices, payments, events, notes, tags',
    middleware: [READERS],
    request: { params: idParams },
    handler: (req) => svc.tenantDetail(req.services, req.valid.params.id),
  })
  .route({
    method: 'patch',
    path: '/:id',
    tags,
    summary: 'Update contact data, notes and tags',
    middleware: [SUPPORT],
    request: { params: idParams, body: tenantUpdateBody },
    handler: async (req) => {
      const r = await svc.updateTenant(req.services, req.valid.params.id, req.valid.body);
      recordAudit(req, {
        action: 'tenant.update',
        entity: 'tenant',
        entityId: req.valid.params.id,
        ...r,
      });
      return svc.tenantDetail(req.services, req.valid.params.id);
    },
  })
  .route({
    method: 'post',
    path: '/:id/plan',
    tags,
    summary: 'Change plan: upgrade now with prorata invoice, downgrade at period end',
    middleware: [SUPER],
    request: { params: idParams, body: planChangeBody },
    handler: async (req) => {
      const r = await changePlan(
        req.services,
        req.valid.params.id,
        req.valid.body,
        platformActor(req),
      );
      recordAudit(req, {
        action: 'subscription.plan_change',
        entity: 'tenant',
        entityId: req.valid.params.id,
        after: { ...req.valid.body, ...r },
      });
      return r;
    },
  })
  .route({
    method: 'delete',
    path: '/:id/plan/pending',
    tags,
    summary: 'Cancel a scheduled plan change',
    middleware: [SUPER],
    request: { params: idParams },
    status: 204,
    handler: async (req, res) => {
      await cancelPendingChange(req.services, req.valid.params.id, platformActor(req));
      recordAudit(req, {
        action: 'subscription.plan_change_cancel',
        entity: 'tenant',
        entityId: req.valid.params.id,
      });
      res.status(204).end();
    },
  })
  .route({
    method: 'post',
    path: '/:id/offer-days',
    tags,
    summary: 'Extend the trial or offer days on the current period (reason mandatory)',
    middleware: [SUPER],
    request: { params: idParams, body: offerDaysBody },
    handler: async (req) => {
      const { days, reason } = req.valid.body;
      await offerDays(req.services, req.valid.params.id, days, reason, platformActor(req));
      recordAudit(req, {
        action: 'subscription.offer_days',
        entity: 'tenant',
        entityId: req.valid.params.id,
        after: { days, reason },
      });
      return svc.tenantDetail(req.services, req.valid.params.id);
    },
  })
  .route({
    method: 'post',
    path: '/:id/suspend',
    tags,
    middleware: [SUPER],
    request: { params: idParams, body: reasonOnly },
    handler: async (req) => {
      await suspendTenant(
        req.services,
        req.valid.params.id,
        req.valid.body.reason,
        platformActor(req),
      );
      recordAudit(req, {
        action: 'tenant.suspend',
        entity: 'tenant',
        entityId: req.valid.params.id,
        after: req.valid.body,
      });
      return svc.tenantDetail(req.services, req.valid.params.id);
    },
  })
  .route({
    method: 'post',
    path: '/:id/reactivate',
    tags,
    middleware: [SUPER],
    request: { params: idParams, body: reasonOnly },
    handler: async (req) => {
      await reactivateTenant(
        req.services,
        req.valid.params.id,
        req.valid.body.reason,
        platformActor(req),
      );
      recordAudit(req, {
        action: 'tenant.reactivate',
        entity: 'tenant',
        entityId: req.valid.params.id,
        after: req.valid.body,
      });
      return svc.tenantDetail(req.services, req.valid.params.id);
    },
  })
  .route({
    method: 'post',
    path: '/:id/cancel',
    tags,
    summary: 'Cancel now (export only) or at the period end',
    middleware: [SUPER],
    request: { params: idParams, body: cancelBody },
    handler: async (req) => {
      const { reason, atPeriodEnd } = req.valid.body;
      await cancelSubscription(
        req.services,
        req.valid.params.id,
        reason,
        platformActor(req),
        atPeriodEnd,
      );
      recordAudit(req, {
        action: 'tenant.cancel',
        entity: 'tenant',
        entityId: req.valid.params.id,
        after: req.valid.body,
      });
      return svc.tenantDetail(req.services, req.valid.params.id);
    },
  })
  .route({
    method: 'post',
    path: '/:id/overrides',
    tags,
    summary: 'Grant / revoke a feature, set a quota or a discount (SA-15)',
    middleware: [SUPER],
    request: { params: idParams, body: overrideBody },
    status: 201,
    handler: async (req) => {
      const o = await svc.addOverride(req.services, req.valid.params.id, req.valid.body);
      recordAudit(req, {
        action: 'tenant.override.add',
        entity: 'tenant_override',
        entityId: o.id,
        after: o,
      });
      return o;
    },
  })
  .route({
    method: 'delete',
    path: '/:id/overrides/:childId',
    tags,
    summary: 'End an override now (kept in the history)',
    middleware: [SUPER],
    request: { params: childParams },
    handler: async (req) => {
      const r = await svc.endOverride(req.services, req.valid.params.id, req.valid.params.childId);
      recordAudit(req, {
        action: 'tenant.override.end',
        entity: 'tenant_override',
        entityId: r.after.id,
        ...r,
      });
      return r.after;
    },
  })
  .route({
    method: 'post',
    path: '/:id/addons',
    tags,
    summary: 'Activate an add-on (billed with the next period invoice)',
    middleware: [SUPER],
    request: { params: idParams, body: addonAttachBody },
    status: 201,
    handler: async (req) => {
      const r = await svc.attachAddon(req.services, req.valid.params.id, req.valid.body);
      recordAudit(req, {
        action: 'tenant.addon.attach',
        entity: 'tenant_addon',
        entityId: r.id,
        after: r,
      });
      return r;
    },
  })
  .route({
    method: 'delete',
    path: '/:id/addons/:childId',
    tags,
    middleware: [SUPER],
    request: { params: childParams },
    handler: async (req) => {
      const r = await svc.detachAddon(req.services, req.valid.params.id, req.valid.params.childId);
      recordAudit(req, {
        action: 'tenant.addon.detach',
        entity: 'tenant_addon',
        entityId: r.after.id,
        ...r,
      });
      return { id: r.after.id, status: r.after.status };
    },
  })
  .route({
    method: 'post',
    path: '/:id/coupons',
    tags,
    summary: 'Redeem a coupon for the tenant (applied on the next period invoices)',
    middleware: [SUPER],
    request: { params: idParams, body: couponBody },
    status: 201,
    handler: async (req) => {
      const r = await redeemCoupon(req.services, req.valid.params.id, req.valid.body.code);
      recordAudit(req, {
        action: 'tenant.coupon.redeem',
        entity: 'coupon_redemption',
        entityId: r.redemptionId,
        after: r,
      });
      return r;
    },
  })
  .route({
    method: 'post',
    path: '/:id/export',
    tags,
    summary: 'Full data export (ZIP of JSON + CSV per table), signed URL',
    middleware: [SUPER],
    request: { params: idParams },
    status: 201,
    handler: async (req) => {
      await svc.requireTenant(req.services, req.valid.params.id);
      const r = await exportTenant(req.services, req.valid.params.id, req.platformUser!.id);
      recordAudit(req, {
        action: 'tenant.export',
        entity: 'tenant',
        entityId: req.valid.params.id,
        after: { fileId: r.fileId, size: r.size },
      });
      return r;
    },
  });
