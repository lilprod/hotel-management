import type { Prisma } from '@hm/database';
import type { z } from 'zod';
import type { Services } from '../../core/container.js';
import { CORE_EVENTS, publishPlatformEvent } from '../../core/events.js';
import {
  conflict,
  dateOf,
  inTx,
  invalid,
  isoOf,
  isoOrNull,
  notFound,
  num,
  platformToday,
  precondition,
  type Tx,
} from '../billing/common.js';
import type {
  addonCreateBody,
  addonUpdateBody,
  couponCreateBody,
  couponUpdateBody,
  planCreateBody,
  planUpdateBody,
  priceInput,
} from './schemas.js';

type PriceInput = z.infer<typeof priceInput>;

const planInclude = {
  planPrices: { orderBy: [{ billingCycle: 'asc' }, { validFrom: 'desc' }] },
  planFeatures: { orderBy: { featureKey: 'asc' } },
  planQuotas: { orderBy: { quotaKey: 'asc' } },
} as const satisfies Prisma.PlanInclude;

type PlanFull = Prisma.PlanGetPayload<{ include: typeof planInclude }>;

const serializePrice = (p: {
  id: string;
  billingCycle: string;
  currency: string;
  amount: bigint;
  validFrom: Date | null;
  validTo: Date | null;
}) => ({
  id: p.id,
  billingCycle: p.billingCycle,
  currency: p.currency,
  amount: num(p.amount),
  validFrom: isoOrNull(p.validFrom),
  validTo: isoOrNull(p.validTo),
});

function serializePlan(p: PlanFull, today: string, subscribers?: number) {
  const current = p.planPrices.filter(
    (x) => isoOf(x.validFrom) <= today && (!x.validTo || isoOf(x.validTo) > today),
  );
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    trialDays: p.trialDays,
    sort: p.sort,
    isPublic: p.isPublic,
    isActive: p.isActive,
    deletedAt: p.deletedAt?.toISOString() ?? null,
    features: p.planFeatures.filter((f) => f.enabled).map((f) => f.featureKey),
    quotas: Object.fromEntries(p.planQuotas.map((q) => [q.quotaKey, q.limit])),
    prices: current.map(serializePrice),
    priceHistory: p.planPrices.map(serializePrice),
    ...(subscribers !== undefined ? { subscribers } : {}),
  };
}

/** Every tenant whose current subscription is on `planId` (entitlements to invalidate). */
async function tenantsOnPlan(db: Tx | Services['admin'], planId: string) {
  const subs = await db.subscription.findMany({
    where: { planId, status: { not: 'CANCELLED' } },
    select: { tenantId: true },
    distinct: ['tenantId'],
  });
  return subs.map((s) => s.tenantId);
}

async function entitlementsChanged(
  services: Services,
  tenantIds: readonly string[],
  reason: string,
) {
  for (const t of tenantIds) {
    await publishPlatformEvent(services.admin, t, CORE_EVENTS.entitlementsChanged, { reason });
    await services.entitlements.invalidate(t);
  }
}

// --- versioned prices -------------------------------------------------------------------

/**
 * Adds a price version (SA-11): never edits an existing amount. The open version of the same
 * cycle + currency is closed the day before (`valid_to` = new `valid_from`, exclusive). No
 * retroactive effect: `valid_from` ≥ today, and issued invoices never change.
 */
async function addPriceVersion(
  tx: Tx,
  kind: 'plan' | 'addon',
  ownerId: string,
  p: PriceInput,
  today: string,
) {
  const from = p.validFrom ?? today;
  if (from < today) throw invalid('validFrom', 'Prices cannot be retroactive');
  const where = { billingCycle: p.billingCycle, currency: p.currency };
  if (kind === 'plan') {
    const later = await tx.planPrice.findFirst({
      where: { planId: ownerId, ...where, validFrom: { gte: dateOf(from) } },
    });
    if (later)
      throw conflict('A price version already starts on or after this date', { priceId: later.id });
    await tx.planPrice.updateMany({
      where: {
        planId: ownerId,
        ...where,
        OR: [{ validTo: null }, { validTo: { gt: dateOf(from) } }],
      },
      data: { validTo: dateOf(from) },
    });
    return tx.planPrice.create({
      data: { planId: ownerId, ...where, amount: BigInt(p.amount), validFrom: dateOf(from) },
    });
  }
  const later = await tx.addonPrice.findFirst({
    where: { addonId: ownerId, ...where, validFrom: { gte: dateOf(from) } },
  });
  if (later)
    throw conflict('A price version already starts on or after this date', { priceId: later.id });
  await tx.addonPrice.updateMany({
    where: {
      addonId: ownerId,
      ...where,
      OR: [{ validTo: null }, { validTo: { gt: dateOf(from) } }],
    },
    data: { validTo: dateOf(from) },
  });
  return tx.addonPrice.create({
    data: { addonId: ownerId, ...where, amount: BigInt(p.amount), validFrom: dateOf(from) },
  });
}

// --- plans ------------------------------------------------------------------------------

export async function listPlans(services: Services, includeDeleted: boolean) {
  const today = platformToday();
  const plans = await services.admin.plan.findMany({
    where: includeDeleted ? {} : { deletedAt: null },
    include: planInclude,
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  const counts = await services.admin.subscription.groupBy({
    by: ['planId'],
    where: { status: { not: 'CANCELLED' } },
    _count: { _all: true },
  });
  const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]));
  return { items: plans.map((p) => serializePlan(p, today, byPlan.get(p.id) ?? 0)) };
}

export async function getPlan(services: Services, id: string) {
  const p = await services.admin.plan.findUnique({ where: { id }, include: planInclude });
  if (!p) throw notFound('Plan');
  return serializePlan(p, platformToday(), (await tenantsOnPlan(services.admin, id)).length);
}

export async function createPlan(services: Services, body: z.infer<typeof planCreateBody>) {
  const today = platformToday();
  const exists = await services.admin.plan.findUnique({ where: { code: body.code } });
  if (exists) throw conflict('Plan code already used', { planId: exists.id });
  const id = await inTx(services, async (tx) => {
    const plan = await tx.plan.create({
      data: {
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        trialDays: body.trialDays,
        sort: body.sort,
        isPublic: body.isPublic,
        isActive: body.isActive,
        planFeatures: { create: [...new Set(body.features)].map((featureKey) => ({ featureKey })) },
        planQuotas: {
          create: Object.entries(body.quotas).map(([quotaKey, limit]) => ({
            quotaKey,
            limit: limit ?? null,
          })),
        },
      },
    });
    for (const p of body.prices) await addPriceVersion(tx, 'plan', plan.id, p, today);
    return plan.id;
  });
  return getPlan(services, id);
}

export async function updatePlan(
  services: Services,
  id: string,
  body: z.infer<typeof planUpdateBody>,
) {
  const before = await getPlan(services, id);
  await services.admin.plan.update({ where: { id }, data: body });
  if (body.isActive !== undefined && body.isActive !== before.isActive)
    await entitlementsChanged(services, await tenantsOnPlan(services.admin, id), 'plan.updated');
  return { before, after: await getPlan(services, id) };
}

/** Soft delete (never a hard delete: invoices and history reference the plan). */
export async function deletePlan(services: Services, id: string) {
  const before = await getPlan(services, id);
  if ((before.subscribers ?? 0) > 0)
    throw precondition('Plan still used by subscriptions', { subscribers: before.subscribers });
  await services.admin.plan.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, isPublic: false },
  });
  return before;
}

export async function setPlanFeatures(services: Services, id: string, features: string[]) {
  const before = await getPlan(services, id);
  const keep = new Set(features);
  await inTx(services, async (tx) => {
    await tx.planFeature.updateMany({
      where: { planId: id, featureKey: { notIn: [...keep] } },
      data: { enabled: false },
    });
    for (const featureKey of keep)
      await tx.planFeature.upsert({
        where: { planId_featureKey: { planId: id, featureKey } },
        create: { planId: id, featureKey, enabled: true },
        update: { enabled: true },
      });
  });
  await entitlementsChanged(services, await tenantsOnPlan(services.admin, id), 'plan.features');
  return { before, after: await getPlan(services, id) };
}

export async function setPlanQuotas(
  services: Services,
  id: string,
  quotas: Partial<Record<string, number | null>>,
) {
  const before = await getPlan(services, id);
  await inTx(services, async (tx) => {
    for (const [quotaKey, limit] of Object.entries(quotas)) {
      if (limit === undefined) continue;
      await tx.planQuota.upsert({
        where: { planId_quotaKey: { planId: id, quotaKey } },
        create: { planId: id, quotaKey, limit },
        update: { limit },
      });
    }
  });
  await entitlementsChanged(services, await tenantsOnPlan(services.admin, id), 'plan.quotas');
  return { before, after: await getPlan(services, id) };
}

export async function addPlanPrice(services: Services, id: string, p: PriceInput) {
  await getPlan(services, id);
  const row = await inTx(services, (tx) => addPriceVersion(tx, 'plan', id, p, platformToday()));
  return serializePrice(row);
}

// --- add-ons ----------------------------------------------------------------------------

const addonInclude = {
  addonPrices: { orderBy: [{ billingCycle: 'asc' }, { validFrom: 'desc' }] },
} as const satisfies Prisma.AddonInclude;

function serializeAddon(a: Prisma.AddonGetPayload<{ include: typeof addonInclude }>) {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    description: a.description,
    featureKeys: a.featureKeys,
    quotaDeltas: (a.quotaDeltas as Record<string, number> | null) ?? {},
    sort: a.sort,
    isActive: a.isActive,
    prices: a.addonPrices.map(serializePrice),
  };
}

export async function listAddons(services: Services) {
  const rows = await services.admin.addon.findMany({
    include: addonInclude,
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  return { items: rows.map(serializeAddon) };
}

export async function getAddon(services: Services, id: string) {
  const a = await services.admin.addon.findUnique({ where: { id }, include: addonInclude });
  if (!a) throw notFound('Add-on');
  return serializeAddon(a);
}

export async function createAddon(services: Services, body: z.infer<typeof addonCreateBody>) {
  if (await services.admin.addon.findUnique({ where: { code: body.code } }))
    throw conflict('Add-on code already used');
  const today = platformToday();
  const id = await inTx(services, async (tx) => {
    const a = await tx.addon.create({
      data: {
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        featureKeys: [...new Set(body.featureKeys)],
        quotaDeltas: body.quotaDeltas as Prisma.InputJsonValue,
        sort: body.sort,
        isActive: body.isActive,
      },
    });
    for (const p of body.prices) await addPriceVersion(tx, 'addon', a.id, p, today);
    return a.id;
  });
  return getAddon(services, id);
}

async function tenantsWithAddon(services: Services, addonId: string) {
  const rows = await services.admin.tenantAddon.findMany({
    where: { addonId, status: 'ACTIVE' },
    select: { tenantId: true },
    distinct: ['tenantId'],
  });
  return rows.map((r) => r.tenantId);
}

export async function updateAddon(
  services: Services,
  id: string,
  body: z.infer<typeof addonUpdateBody>,
) {
  const before = await getAddon(services, id);
  await services.admin.addon.update({
    where: { id },
    data: {
      ...body,
      ...(body.quotaDeltas ? { quotaDeltas: body.quotaDeltas as Prisma.InputJsonValue } : {}),
      ...(body.featureKeys ? { featureKeys: [...new Set(body.featureKeys)] } : {}),
    },
  });
  await entitlementsChanged(services, await tenantsWithAddon(services, id), 'addon.updated');
  return { before, after: await getAddon(services, id) };
}

export async function addAddonPrice(services: Services, id: string, p: PriceInput) {
  await getAddon(services, id);
  const row = await inTx(services, (tx) => addPriceVersion(tx, 'addon', id, p, platformToday()));
  return serializePrice(row);
}

// --- coupons ----------------------------------------------------------------------------

type CouponRow = Prisma.CouponGetPayload<object>;

export function serializeCoupon(c: CouponRow) {
  return {
    id: c.id,
    code: c.code,
    type: c.type,
    value: c.value.toString(),
    duration: c.duration,
    maxRedemptions: c.maxRedemptions,
    redeemedCount: c.redeemedCount,
    eligiblePlans: c.eligiblePlans,
    expiresAt: c.expiresAt?.toISOString() ?? null,
    isActive: c.isActive,
    createdAt: c.createdAt.toISOString(),
  };
}

export async function listCoupons(services: Services) {
  const rows = await services.admin.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  return { items: rows.map(serializeCoupon) };
}

export async function getCoupon(services: Services, id: string) {
  const c = await services.admin.coupon.findUnique({
    where: { id },
    include: { couponRedemptions: { include: { tenant: { select: { id: true, name: true } } } } },
  });
  if (!c) throw notFound('Coupon');
  return {
    ...serializeCoupon(c),
    redemptions: c.couponRedemptions.map((r) => ({
      tenant: r.tenant,
      subscriptionId: r.subscriptionId,
      redeemedAt: r.redeemedAt.toISOString(),
    })),
  };
}

export async function createCoupon(services: Services, body: z.infer<typeof couponCreateBody>) {
  if (await services.admin.coupon.findUnique({ where: { code: body.code } }))
    throw conflict('Coupon code already used');
  const c = await services.admin.coupon.create({
    data: {
      code: body.code,
      type: body.type,
      value: body.value,
      duration: body.type === 'FREE_MONTHS' ? null : body.duration,
      maxRedemptions: body.maxRedemptions,
      eligiblePlans: body.eligiblePlans,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      isActive: body.isActive,
    },
  });
  return serializeCoupon(c);
}

export async function updateCoupon(
  services: Services,
  id: string,
  body: z.infer<typeof couponUpdateBody>,
) {
  const before = await getCoupon(services, id);
  const c = await services.admin.coupon.update({
    where: { id },
    data: {
      ...body,
      ...(body.expiresAt !== undefined
        ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
        : {}),
    },
  });
  return { before, after: serializeCoupon(c) };
}

/**
 * Redeems a coupon for a tenant (EX-01): active, not expired, eligible plan, under the maximum
 * (atomic conditional increment), once per tenant.
 */
export async function redeemCoupon(services: Services, tenantId: string, code: string) {
  return inTx(services, async (tx) => {
    const c = await tx.coupon.findUnique({ where: { code: code.trim().toUpperCase() } });
    if (!c || !c.isActive) throw notFound('Coupon');
    if (c.expiresAt && c.expiresAt <= new Date()) throw precondition('Coupon expired');
    const sub = await tx.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    });
    if (!sub) throw notFound('Subscription');
    if (c.eligiblePlans.length && !c.eligiblePlans.includes(sub.plan.code))
      throw precondition('Coupon not valid for this plan', { plan: sub.plan.code });
    const already = await tx.couponRedemption.findUnique({
      where: { couponId_tenantId: { couponId: c.id, tenantId } },
    });
    if (already) throw conflict('Coupon already redeemed by this tenant');
    const n = await tx.$executeRaw`
      UPDATE coupons SET redeemed_count = redeemed_count + 1, updated_at = now()
      WHERE id = ${c.id}::uuid AND (max_redemptions IS NULL OR redeemed_count < max_redemptions)`;
    if (n !== 1) throw precondition('Coupon fully redeemed');
    const r = await tx.couponRedemption.create({
      data: { tenantId, couponId: c.id, subscriptionId: sub.id },
    });
    return { coupon: serializeCoupon(c), redemptionId: r.id, subscriptionId: sub.id };
  });
}
