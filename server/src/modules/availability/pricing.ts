import type { TransactionClient } from '@hm/database';
import { formatDay, num } from '../property/common.js';
import {
  priceStay,
  QuoteError,
  type NightLine,
  type Quote,
  type QuoteData,
} from '../rates/quote.js';

/**
 * Batched pricing data of a property (same inputs as `quoteStay`, loaded once for several room
 * types and rate plans) and the per-line call to the pure calculator `priceStay`.
 */
export type PricingDb = Pick<
  TransactionClient,
  'roomType' | 'ratePlan' | 'rate' | 'season' | 'tax'
>;

export interface PricingData {
  roomTypes: Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      baseOccupancy: number;
      maxAdults: number;
      maxChildren: number;
    }
  >;
  plans: Map<
    string,
    {
      id: string;
      code: string;
      name: string;
      mealPlan: string;
      currency: string;
      isPublic: boolean;
      cancellationPolicyId: string | null;
    }
  >;
  ratesByKey: Map<string, QuoteData['rates'][number][]>;
  seasons: QuoteData['seasons'][number][];
  taxes: QuoteData['taxes'][number][];
}

export async function loadPricing(
  db: PricingDb,
  propertyId: string,
  opts: { roomTypeIds?: readonly string[]; ratePlanIds?: readonly string[] } = {},
): Promise<PricingData> {
  const rtWhere = opts.roomTypeIds ? { id: { in: [...opts.roomTypeIds] } } : {};
  const rpWhere = opts.ratePlanIds ? { id: { in: [...opts.ratePlanIds] } } : {};
  const [roomTypes, plans, seasons, taxes] = await Promise.all([
    db.roomType.findMany({
      where: { propertyId, deletedAt: null, ...rtWhere },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    }),
    db.ratePlan.findMany({
      where: { propertyId, deletedAt: null, isActive: true, ...rpWhere },
      orderBy: { code: 'asc' },
    }),
    db.season.findMany({ where: { propertyId } }),
    db.tax.findMany({
      where: { propertyId, deletedAt: null, appliesTo: { has: 'LODGING' } },
      orderBy: { code: 'asc' },
    }),
  ]);
  const rates =
    plans.length && roomTypes.length
      ? await db.rate.findMany({
          where: {
            ratePlanId: { in: plans.map((p) => p.id) },
            roomTypeId: { in: roomTypes.map((r) => r.id) },
          },
        })
      : [];
  const ratesByKey = new Map<string, QuoteData['rates'][number][]>();
  for (const r of rates) {
    const k = `${r.ratePlanId}|${r.roomTypeId}`;
    const list = ratesByKey.get(k) ?? [];
    list.push({
      id: r.id,
      seasonId: r.seasonId,
      dowMask: r.dowMask,
      price: num(r.price),
      extraAdult: num(r.extraAdult),
      extraChild: num(r.extraChild),
      minStay: r.minStay,
      maxStay: r.maxStay,
      closedToArrival: r.closedToArrival,
      closedToDeparture: r.closedToDeparture,
    });
    ratesByKey.set(k, list);
  }
  return {
    roomTypes: new Map(roomTypes.map((r) => [r.id, r])),
    plans: new Map(plans.map((p) => [p.id, p])),
    ratesByKey,
    seasons: seasons.map((s) => ({
      id: s.id,
      fromDate: formatDay(s.fromDate),
      toDate: formatDay(s.toDate),
      priority: s.priority,
    })),
    taxes: taxes.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      type: t.type,
      value: t.value.toString(),
      inclusive: t.inclusive,
    })),
  };
}

export interface LineQuoteInput {
  roomTypeId: string;
  ratePlanId: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
}

/** Prices one line; throws QuoteError (NO_RATE, MIN_STAY, INVALID_OCCUPANCY...). */
export function quoteLine(data: PricingData, input: LineQuoteInput): Quote {
  const roomType = data.roomTypes.get(input.roomTypeId);
  if (!roomType)
    throw new QuoteError('INVALID_DATA', 'Unknown room type', { roomTypeId: input.roomTypeId });
  const plan = data.plans.get(input.ratePlanId);
  if (!plan)
    throw new QuoteError('INVALID_DATA', 'Unknown or inactive rate plan', {
      ratePlanId: input.ratePlanId,
    });
  return priceStay(
    {
      currency: plan.currency,
      roomType,
      rates: data.ratesByKey.get(`${plan.id}|${roomType.id}`) ?? [],
      seasons: data.seasons,
      taxes: data.taxes,
    },
    input,
  );
}

/** Nightly price snapshot stored in `reservation_rooms.daily_prices`. */
export interface NightPrice {
  date: string;
  rateId: string | null;
  seasonId: string | null;
  base: number;
  extraAdultAmount: number;
  extraChildAmount: number;
  total: number;
}

export const toNightPrices = (nightly: readonly NightLine[]): NightPrice[] =>
  nightly.map((n) => ({
    date: n.date,
    rateId: n.rateId,
    seasonId: n.seasonId,
    base: n.base,
    extraAdultAmount: n.extraAdultAmount,
    extraChildAmount: n.extraChildAmount,
    total: n.total,
  }));

export function parseNightPrices(json: unknown): NightPrice[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((x) => {
    const o = x as Partial<NightPrice> | null;
    if (!o || typeof o.date !== 'string' || typeof o.total !== 'number') return [];
    return [
      {
        date: o.date,
        rateId: o.rateId ?? null,
        seasonId: o.seasonId ?? null,
        base: o.base ?? o.total,
        extraAdultAmount: o.extraAdultAmount ?? 0,
        extraChildAmount: o.extraChildAmount ?? 0,
        total: o.total,
      },
    ];
  });
}

export const sumNights = (n: readonly { total: number }[]) => n.reduce((s, x) => s + x.total, 0);
