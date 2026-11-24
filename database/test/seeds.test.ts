import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { DEFAULT_PLAN_CODES } from '@hm/shared';
import { createAdminClient, createAppClient, runWithTenant } from '../src/index.js';
import type { AdminClient, AppClient } from '../src/index.js';
import { runSeeds } from '../seeds/index.js';
import { seedId, SEED_BASE_DOMAIN } from '../seeds/common.js';
import { LOME_SLUG } from '../seeds/demo-lome.js';
import { KPALIME_SLUG } from '../seeds/demo-kpalime.js';
import { JESS_SLUG } from '../seeds/demo-jess.js';
import { utcDay } from '../seeds/demo-reservations.js';

const { adminUrl, appUrl } = inject('pg');

const LOME_ID = seedId(`tenant:${LOME_SLUG}`);
const KPALIME_ID = seedId(`tenant:${KPALIME_SLUG}`);
const JESS_ID = seedId(`tenant:${JESS_SLUG}`);
const SEEDED_TENANTS = [LOME_ID, KPALIME_ID, JESS_ID];
const SEED_OPTIONS = {
  superAdminEmail: 'superadmin@seed.example.invalid',
  superAdminPassword: 'seed-superadmin-pass-1',
  demoPassword: 'seed-demo-pass-1',
};

let admin: AdminClient;
let app: AppClient;

/**
 * Row counts restricted to the seeded rows, so that rows created by other test files sharing the
 * same database do not affect the comparison.
 */
async function snapshot(db: AdminClient) {
  const inTenants = { tenantId: { in: SEEDED_TENANTS } };
  const reservationsByStatus = await db.reservation.groupBy({
    by: ['tenantId', 'status'],
    where: inTenants,
    _count: { _all: true },
  });
  const plans = await db.plan.findMany({ where: { code: { in: [...DEFAULT_PLAN_CODES] } } });
  const planIds = plans.map((p) => p.id);
  return {
    plans: plans.length,
    planPrices: await db.planPrice.count({ where: { planId: { in: planIds } } }),
    planFeatures: await db.planFeature.count({ where: { planId: { in: planIds } } }),
    planQuotas: await db.planQuota.count({ where: { planId: { in: planIds } } }),
    platformSettings: await db.platformSetting.count({
      where: { key: { startsWith: 'billing.' } },
    }),
    platformUsers: await db.platformUser.count({
      where: { email: SEED_OPTIONS.superAdminEmail },
    }),
    taxRules: await db.taxRule.count({ where: { country: 'TG' } }),
    tenants: await db.tenant.count({ where: { id: { in: SEEDED_TENANTS } } }),
    tenantDomains: await db.tenantDomain.count({ where: inTenants }),
    subscriptions: await db.subscription.count({ where: inTenants }),
    branding: await db.branding.count({ where: inTenants }),
    securityPolicies: await db.securityPolicy.count({ where: inTenants }),
    roles: await db.role.count({ where: inTenants }),
    rolePermissions: await db.rolePermission.count({ where: inTenants }),
    users: await db.user.count({ where: inTenants }),
    userRoles: await db.userRole.count({ where: inTenants }),
    properties: await db.property.count({ where: inTenants }),
    departments: await db.department.count({ where: inTenants }),
    taxes: await db.tax.count({ where: inTenants }),
    roomTypes: await db.roomType.count({ where: inTenants }),
    rooms: await db.room.count({ where: inTenants }),
    ratePlans: await db.ratePlan.count({ where: inTenants }),
    seasons: await db.season.count({ where: inTenants }),
    rates: await db.rate.count({ where: inTenants }),
    lookupValues: await db.lookupValue.count({ where: inTenants }),
    guests: await db.guest.count({ where: inTenants }),
    products: await db.product.count({ where: inTenants }),
    outlets: await db.outlet.count({ where: inTenants }),
    menuCategories: await db.menuCategory.count({ where: inTenants }),
    menuItems: await db.menuItem.count({ where: inTenants }),
    spaServices: await db.spaService.count({ where: inTenants }),
    treatmentRooms: await db.treatmentRoom.count({ where: inTenants }),
    activities: await db.activity.count({ where: inTenants }),
    activitySlots: await db.activitySlot.count({ where: inTenants }),
    reservations: await db.reservation.count({ where: inTenants }),
    reservationsByStatus: reservationsByStatus
      .map((r) => `${r.tenantId}:${r.status}=${r._count._all}`)
      .sort(),
    reservationRooms: await db.reservationRoom.count({ where: inTenants }),
    reservationGuests: await db.reservationGuest.count({ where: inTenants }),
    unitNights: await db.unitNight.count({ where: inTenants }),
    groups: await db.group.count({ where: inTenants }),
    waitlistEntries: await db.waitlistEntry.count({ where: inTenants }),
    sequences: await db.sequence.count({ where: inTenants }),
  };
}

beforeAll(async () => {
  admin = createAdminClient({ url: adminUrl });
  app = createAppClient({ url: appUrl });
});

afterAll(async () => {
  await app?.$disconnect();
  await admin?.$disconnect();
});

describe('seeds', () => {
  let first: Awaited<ReturnType<typeof snapshot>>;
  let second: Awaited<ReturnType<typeof snapshot>>;

  beforeAll(async () => {
    await runSeeds(admin, SEED_OPTIONS);
    first = await snapshot(admin);
    await runSeeds(admin, SEED_OPTIONS);
    second = await snapshot(admin);
  });

  it('is idempotent: a second run leaves every seeded count unchanged', () => {
    expect(second).toEqual(first);
  });

  it('seeds the three default plans with prices, features and quotas', () => {
    expect(first.plans).toBe(3);
    expect(first.planPrices).toBe(9); // 3 plans x MONTHLY/QUARTERLY/YEARLY
    expect(first.planQuotas).toBe(15); // 3 plans x 5 quota keys
    expect(first.planFeatures).toBeGreaterThan(0);
  });

  it('seeds platform settings, the Togo tax rules and the Super Admin', () => {
    expect(first.platformSettings).toBeGreaterThanOrEqual(5);
    expect(first.taxRules).toBe(2);
    expect(first.platformUsers).toBe(1);
  });

  it('seeds the three demo tenants with their expected sizes', async () => {
    expect(first.tenants).toBe(3);
    expect(first.roles).toBe(30); // 10 system roles x 3 tenants
    expect(first.users).toBe(3); // one owner per tenant
    expect(first.rooms).toBe(110); // 60 (2 Février) + 20 (Kpalimé) + 30 (Jess)
    expect(first.guests).toBe(30);

    const lome = await admin.tenant.findUniqueOrThrow({ where: { id: LOME_ID } });
    const kpalime = await admin.tenant.findUniqueOrThrow({ where: { id: KPALIME_ID } });
    expect(lome.slug).toBe(LOME_SLUG);
    expect(kpalime.slug).toBe(KPALIME_SLUG);

    const domains = await admin.tenantDomain.findMany({
      where: { tenantId: { in: SEEDED_TENANTS } },
    });
    expect(domains.map((d) => d.hostname).sort()).toEqual(
      [
        `${KPALIME_SLUG}.${SEED_BASE_DOMAIN}`,
        `${LOME_SLUG}.${SEED_BASE_DOMAIN}`,
        `${JESS_SLUG}.${SEED_BASE_DOMAIN}`,
      ].sort(),
    );
  });

  it('gives each tenant the right plan, in trial, with the expected rooms', async () => {
    const lomeSub = await admin.subscription.findFirstOrThrow({ where: { tenantId: LOME_ID } });
    const kpalimeSub = await admin.subscription.findFirstOrThrow({
      where: { tenantId: KPALIME_ID },
    });
    const lomePlan = await admin.plan.findUniqueOrThrow({ where: { id: lomeSub.planId } });
    const kpalimePlan = await admin.plan.findUniqueOrThrow({ where: { id: kpalimeSub.planId } });
    expect(lomeSub.status).toBe('TRIALING');
    expect(kpalimeSub.status).toBe('TRIALING');
    expect(lomePlan.code).toBe('PREMIUM');
    expect(kpalimePlan.code).toBe('STANDARD');
    const jessSub = await admin.subscription.findFirstOrThrow({ where: { tenantId: JESS_ID } });
    const jessPlan = await admin.plan.findUniqueOrThrow({ where: { id: jessSub.planId } });
    expect(jessPlan.code).toBe('MEDIUM');
    expect(await admin.room.count({ where: { tenantId: JESS_ID } })).toBe(30);
    expect(await admin.outlet.count({ where: { tenantId: KPALIME_ID } })).toBe(0);
    expect(await admin.room.count({ where: { tenantId: LOME_ID } })).toBe(60);
    expect(await admin.room.count({ where: { tenantId: KPALIME_ID } })).toBe(20);
  });

  it('seeds demo reservations with the expected counts per tenant and status', async () => {
    const countsOf = async (tenantId: string) => {
      const rows = await admin.reservation.groupBy({
        by: ['status'],
        where: { tenantId },
        _count: { _all: true },
      });
      return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
    };
    expect(await countsOf(LOME_ID)).toEqual({
      CONFIRMED: 11,
      PENDING: 3,
      CHECKED_IN: 4,
      CHECKED_OUT: 3,
      CANCELLED: 2,
      NO_SHOW: 1,
    });
    expect(await countsOf(JESS_ID)).toEqual({ CONFIRMED: 4, PENDING: 2, CHECKED_IN: 2 });
    expect(await countsOf(KPALIME_ID)).toEqual({ CONFIRMED: 3, PENDING: 1, CHECKED_IN: 1 });
    expect(await admin.waitlistEntry.count({ where: { tenantId: LOME_ID } })).toBe(1);
    const group = await admin.reservation.findMany({
      where: { tenantId: LOME_ID, groupId: { not: null } },
      include: { reservationRooms: true },
    });
    expect(group).toHaveLength(1);
    expect(group[0]?.reservationRooms).toHaveLength(3);
  });

  it('never books a unit twice and writes unit nights only for active lines', async () => {
    const overlaps = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (
        SELECT unit_id, night FROM unit_nights GROUP BY unit_id, night HAVING COUNT(*) > 1
      ) d`;
    expect(Number(overlaps[0]?.n)).toBe(0);

    const inactive = await admin.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM unit_nights un
      JOIN reservation_rooms rr ON rr.id = un.reservation_room_id
      WHERE rr.status IN ('CHECKED_OUT', 'CANCELLED', 'NO_SHOW')`;
    expect(Number(inactive[0]?.n)).toBe(0);

    const today = utcDay();
    const inHouse = await admin.reservation.findMany({
      where: { tenantId: LOME_ID, status: 'CHECKED_IN' },
    });
    expect(inHouse).toHaveLength(4);
    for (const r of inHouse) {
      expect(r.arrival.toISOString().slice(0, 10) <= today).toBe(true);
      expect(today < r.departure.toISOString().slice(0, 10)).toBe(true);
    }
  });

  it('advances the reservation sequence above the seeded numbers', async () => {
    const year = Number(utcDay().slice(0, 4));
    for (const [tenantId, slug] of [
      [LOME_ID, LOME_SLUG],
      [JESS_ID, JESS_SLUG],
      [KPALIME_ID, KPALIME_SLUG],
    ] as const) {
      const propertyId = seedId(`property:${slug}`);
      const reservations = await admin.reservation.findMany({
        where: { tenantId },
        select: { number: true },
      });
      const numbers = reservations.map((r) => r.number);
      expect(new Set(numbers).size).toBe(numbers.length);
      const max = Math.max(...numbers.map((n) => Number(n.slice(-6))));
      const seq = await admin.sequence.findFirstOrThrow({
        where: { scope: `${tenantId}:${propertyId}`, key: 'reservation', year },
      });
      expect(seq.nextValue > BigInt(max)).toBe(true);
    }
  });

  it('stores money as integer XOF amounts', async () => {
    const prices = await admin.planPrice.findMany({ where: { currency: 'XOF' } });
    expect(prices.length).toBeGreaterThanOrEqual(9);
    for (const price of prices) expect(typeof price.amount).toBe('bigint');
    const premiumYearly = await admin.planPrice.findFirstOrThrow({
      where: { planId: seedId('plan:PREMIUM'), billingCycle: 'YEARLY' },
    });
    expect(premiumYearly.amount).toBe((100_000n * 12n * 85n) / 100n);
  });

  it('lets the tenant client see only its own guests (RLS)', async () => {
    const lomeGuests = await runWithTenant(LOME_ID, () => app.guest.findMany());
    const kpalimeGuests = await runWithTenant(KPALIME_ID, () => app.guest.findMany());
    expect(lomeGuests).toHaveLength(10);
    expect(kpalimeGuests).toHaveLength(10);
    expect(lomeGuests.every((g) => g.tenantId === LOME_ID)).toBe(true);
    expect(kpalimeGuests.every((g) => g.tenantId === KPALIME_ID)).toBe(true);

    const kpalimeGuestId = kpalimeGuests[0]?.id;
    expect(kpalimeGuestId).toBeDefined();
    const leaked = await runWithTenant(LOME_ID, () =>
      app.guest.findMany({ where: { id: kpalimeGuestId } }),
    );
    expect(leaked).toHaveLength(0);
  });
});
