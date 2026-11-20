import { AppError } from '../../lib/errors.js';
import { conflict, type Ctx } from '../property/common.js';
import {
  DEMO_ID_KEYS,
  EMPTY_DEMO,
  ONBOARDING_STEPS,
  onboardingSettings,
  type DemoIdKey,
  type OnboardingDemo,
  type OnboardingState,
} from './settings.js';

const at = (ctx: Ctx) => ({ tenantId: ctx.tenantId });
const target = (ctx: Ctx) => ({ tenantId: ctx.tenantId, scope: 'TENANT' as const });

/** Counts that tell which wizard steps are already done (checklist, tenants configured by hand). */
async function facts(ctx: Ctx) {
  const [property, roomTypes, rooms, ratePlans, rates, taxes, users, branding] = await Promise.all([
    ctx.db.property.findFirst({
      where: { deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { id: true, address: true, taxId: true, rccm: true },
    }),
    ctx.db.roomType.count({ where: { deletedAt: null, isActive: true } }),
    ctx.db.room.count({ where: { deletedAt: null } }),
    ctx.db.ratePlan.count({ where: { deletedAt: null } }),
    ctx.db.rate.count(),
    ctx.db.tax.count({ where: { deletedAt: null } }),
    ctx.db.user.count({ where: { deletedAt: null, status: { in: ['ACTIVE', 'INVITED'] } } }),
    ctx.db.branding.findFirst({ select: { logoFileId: true } }),
  ]);
  return {
    propertyId: property?.id ?? null,
    property: !!property?.address,
    roomTypes,
    rooms,
    ratePlans,
    rates,
    taxes,
    team: users > 1,
    branding: !!branding?.logoFileId,
  };
}

/** Stored state; a tenant with rooms and no stored state was configured by hand: completed. */
async function readState(ctx: Ctx, roomCount: number): Promise<OnboardingState> {
  const stored = await ctx.db.setting.findFirst({
    where: { scope: 'TENANT', scopeId: ctx.tenantId, key: onboardingSettings.state.key },
    select: { id: true },
  });
  const state = await ctx.services.settings.get(onboardingSettings.state, at(ctx));
  if (!stored && roomCount > 0 && state.status === 'in_progress')
    return { ...state, status: 'completed' };
  return state;
}

export async function getOnboarding(ctx: Ctx) {
  const f = await facts(ctx);
  const [state, demo] = await Promise.all([
    readState(ctx, f.rooms),
    ctx.services.settings.get(onboardingSettings.demo, at(ctx)),
  ]);
  return { ...state, demo: demoView(demo), facts: f };
}

function demoView(demo: OnboardingDemo) {
  return {
    loaded: demo.loaded,
    loadedAt: demo.loadedAt,
    counts: Object.fromEntries(DEMO_ID_KEYS.map((k) => [k, demo.ids[k].length])) as Record<
      DemoIdKey,
      number
    >,
  };
}

export interface StatePatch {
  step?: number | undefined;
  completedSteps?: number[] | undefined;
  status?: OnboardingState['status'] | undefined;
}

export async function updateOnboarding(ctx: Ctx, patch: StatePatch) {
  const f = await facts(ctx);
  const cur = await readState(ctx, f.rooms);
  const now = new Date().toISOString();
  const status = patch.status ?? cur.status;
  const completed = new Set([...cur.completedSteps, ...(patch.completedSteps ?? [])]);
  const next: OnboardingState = {
    status,
    step: Math.min(patch.step ?? cur.step, ONBOARDING_STEPS - 1),
    completedSteps: [...completed].sort((a, b) => a - b),
    updatedAt: now,
    finishedAt: status === 'in_progress' ? null : (cur.finishedAt ?? now),
  };
  await ctx.services.settings.set(onboardingSettings.state, next, target(ctx));
  return next;
}

// ── demonstration data (TN-03) ─────────────────────────────────────────────────────────

const DEMO_ROOM_TYPES = [
  {
    code: 'DEMO-STD',
    name: 'Chambre Standard (démo)',
    beds: '1 lit double',
    maxAdults: 2,
    price: 25_000,
    rooms: ['DEMO-101', 'DEMO-102', 'DEMO-103', 'DEMO-104'],
  },
  {
    code: 'DEMO-SUP',
    name: 'Chambre Supérieure (démo)',
    beds: '1 lit king-size',
    maxAdults: 3,
    price: 38_000,
    rooms: ['DEMO-201', 'DEMO-202', 'DEMO-203'],
  },
] as const;

const DEMO_GUESTS = [
  ['Afi', 'Démo-Ayivi', '+22890000001'],
  ['Kossi', 'Démo-Dogbé', '+22890000002'],
  ['Akossiwa', 'Démo-Lawson', '+22890000003'],
  ['Komlan', 'Démo-Amouzou', '+22890000004'],
  ['Essi', 'Démo-Togbé', '+22890000005'],
] as const;

const DEMO_PRODUCTS = [
  { name: 'Eau minérale 50 cl (démo)', price: 500 },
  { name: 'Petit-déjeuner (démo)', price: 3_500 },
  { name: 'Blanchisserie, par pièce (démo)', price: 1_000 },
] as const;

export const DEMO_ROOM_COUNT = DEMO_ROOM_TYPES.reduce((n, t) => n + t.rooms.length, 0);

/**
 * Loads a small fictional dataset (2 room types, 7 rooms, a rate plan with rates, 5 guests, 3
 * products), ids tracked in `onboarding.demo` so that "delete demo data" removes exactly them.
 * The rooms count against the `units` quota like any room.
 */
export async function loadDemoData(ctx: Ctx) {
  const demo = await ctx.services.settings.get(onboardingSettings.demo, at(ctx));
  if (demo.loaded) throw conflict('Demonstration data is already loaded');
  const property = await ctx.db.property.findFirst({
    where: { deletedAt: null },
    orderBy: { createdAt: 'asc' },
  });
  if (!property) throw conflict('No property to attach the demonstration data to');

  const limit = await ctx.services.entitlements.limit(ctx.tenantId, 'units');
  if (limit !== null) {
    const used = await ctx.db.room.count({ where: { deletedAt: null } });
    if (used + DEMO_ROOM_COUNT > limit)
      throw new AppError('QUOTA_EXCEEDED', undefined, {
        detail: `Quota units reached (${used}/${limit})`,
        meta: { quota: 'units', limit, used },
      });
  }
  const clash = await ctx.db.roomType.findFirst({
    where: { propertyId: property.id, code: { startsWith: 'DEMO-' } },
    select: { id: true },
  });
  if (clash) throw conflict('Demo room types already exist');

  const vat = await ctx.db.tax.findFirst({
    where: { propertyId: property.id, deletedAt: null, type: 'PERCENT' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  const ids: OnboardingDemo['ids'] = structuredClone(EMPTY_DEMO.ids);
  const { tenantId } = ctx;
  await ctx.db.$transaction(async (tx) => {
    const plan = await tx.ratePlan.create({
      data: {
        tenantId,
        propertyId: property.id,
        code: 'DEMO-BAR',
        name: 'Tarif public (démo)',
        currency: property.currency,
      },
    });
    ids.ratePlans.push(plan.id);
    for (const t of DEMO_ROOM_TYPES) {
      const rt = await tx.roomType.create({
        data: {
          tenantId,
          propertyId: property.id,
          code: t.code,
          name: t.name,
          beds: t.beds,
          maxAdults: t.maxAdults,
          maxChildren: 1,
          baseOccupancy: 2,
          amenities: ['Climatisation', 'Wi-Fi'],
        },
      });
      ids.roomTypes.push(rt.id);
      const rate = await tx.rate.create({
        data: {
          tenantId,
          ratePlanId: plan.id,
          roomTypeId: rt.id,
          currency: property.currency,
          price: BigInt(t.price),
        },
      });
      ids.rates.push(rate.id);
      for (const number of t.rooms) {
        const room = await tx.room.create({
          data: { tenantId, propertyId: property.id, roomTypeId: rt.id, number },
        });
        ids.rooms.push(room.id);
      }
    }
    for (const p of DEMO_PRODUCTS) {
      const row = await tx.product.create({
        data: {
          tenantId,
          propertyId: property.id,
          name: p.name,
          price: BigInt(p.price),
          currency: property.currency,
          taxId: vat?.id ?? null,
        },
      });
      ids.products.push(row.id);
    }
    for (const [firstName, lastName, phone] of DEMO_GUESTS) {
      const g = await tx.guest.create({
        data: { tenantId, firstName, lastName, phone, tags: ['demo'], nationality: 'TG' },
      });
      ids.guests.push(g.id);
    }
  });
  const next: OnboardingDemo = { loaded: true, loadedAt: new Date().toISOString(), ids };
  await ctx.services.settings.set(onboardingSettings.demo, next, target(ctx));
  return demoView(next);
}

/** Removes exactly the rows created by `loadDemoData` (children first). */
export async function deleteDemoData(ctx: Ctx) {
  const demo = await ctx.services.settings.get(onboardingSettings.demo, at(ctx));
  if (!demo.loaded) throw conflict('No demonstration data to delete');
  const { ids } = demo;
  const removed = demoView(demo).counts;
  try {
    await ctx.db.$transaction(async (tx) => {
      await tx.rate.deleteMany({ where: { id: { in: ids.rates } } });
      await tx.ratePlan.deleteMany({ where: { id: { in: ids.ratePlans } } });
      await tx.room.deleteMany({ where: { id: { in: ids.rooms } } });
      await tx.roomType.deleteMany({ where: { id: { in: ids.roomTypes } } });
      await tx.product.deleteMany({ where: { id: { in: ids.products } } });
      await tx.guest.deleteMany({ where: { id: { in: ids.guests } } });
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2003' || code === '23503')
      throw conflict(
        'Demonstration data is already used (reservations, folios…): delete it by hand',
      );
    throw err;
  }
  await ctx.services.settings.set(onboardingSettings.demo, EMPTY_DEMO, target(ctx));
  return { removed };
}
