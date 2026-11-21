import type { AdminClient } from '@hm/database';

export interface LodgingSeed {
  std: string;
  dlx: string;
  sgl: string;
  rooms: Record<string, string>;
  bar: string;
  flex: string;
  policyId: string;
}

/**
 * Lodging fixture of a property: STD (3 units 101-103), DLX (1 unit 201), SGL (1 unit 301);
 * rate plan BAR (cancellation policy: free ≥ 7 days, 50 % ≥ 2 days, no-show 100 %) and FLEX
 * (no policy); lookups for sources, segments and cancel reasons.
 */
export async function seedLodging(
  admin: AdminClient,
  tenantId: string,
  propertyId: string,
): Promise<LodgingSeed> {
  const rt = (code: string, maxAdults: number) =>
    admin.roomType.create({
      data: {
        tenantId,
        propertyId,
        code,
        name: `Type ${code}`,
        maxAdults,
        maxChildren: 2,
        baseOccupancy: Math.min(2, maxAdults),
      },
    });
  const [std, dlx, sgl] = await Promise.all([rt('STD', 3), rt('DLX', 4), rt('SGL', 1)]);
  const rooms: Record<string, string> = {};
  for (const [n, t] of [
    ['101', std.id],
    ['102', std.id],
    ['103', std.id],
    ['201', dlx.id],
    ['301', sgl.id],
  ] as const) {
    const r = await admin.room.create({
      data: { tenantId, propertyId, roomTypeId: t, number: n, hkStatus: 'CLEAN' },
    });
    rooms[n] = r.id;
  }
  const policy = await admin.policy.create({
    data: {
      tenantId,
      propertyId,
      kind: 'CANCELLATION',
      name: 'Standard',
      rules: {
        tiers: [
          { daysBefore: 7, penaltyPercent: 0 },
          { daysBefore: 2, penaltyPercent: 50 },
        ],
        noShowPercent: 100,
        firstNightMinimum: false,
      },
    },
  });
  const bar = await admin.ratePlan.create({
    data: {
      tenantId,
      propertyId,
      code: 'BAR',
      name: 'Best available',
      cancellationPolicyId: policy.id,
    },
  });
  const flex = await admin.ratePlan.create({
    data: { tenantId, propertyId, code: 'FLEX', name: 'Flexible' },
  });
  for (const [plan, type, price] of [
    [bar.id, std.id, 30_000n],
    [bar.id, dlx.id, 50_000n],
    [bar.id, sgl.id, 20_000n],
    [flex.id, std.id, 35_000n],
  ] as const)
    await admin.rate.create({
      data: {
        tenantId,
        ratePlanId: plan,
        roomTypeId: type,
        price,
        extraAdult: 5_000n,
        extraChild: 2_000n,
      },
    });
  for (const [listKey, code] of [
    ['reservation_source', 'PHONE'],
    ['guest_segment', 'LEISURE'],
    ['cancel_reason', 'GUEST_REQUEST'],
  ] as const)
    await admin.lookupValue.create({
      data: { tenantId, listKey, code, labelI18n: { fr: code, en: code } },
    });
  return {
    std: std.id,
    dlx: dlx.id,
    sgl: sgl.id,
    rooms,
    bar: bar.id,
    flex: flex.id,
    policyId: policy.id,
  };
}
