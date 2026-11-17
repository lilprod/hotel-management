import type { Prisma } from '@hm/database';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import {
  assertPropertyAccess,
  conflict,
  formatDay,
  invalid,
  must,
  num,
  pageArgs,
  parseDay,
  toPage,
  type Ctx,
} from '../property/common.js';
import { priceStay, QuoteError, type Quote } from './quote.js';
import {
  cancellationRules,
  depositRules,
  type createPolicyBody,
  type createRateBody,
  type createRatePlanBody,
  type createSeasonBody,
  type createTaxBody,
  type listRatePlansQuery,
  type listRatesQuery,
  type quoteBody,
  type updatePolicyBody,
  type updateRateBody,
  type updateRatePlanBody,
  type updateSeasonBody,
  type updateTaxBody,
} from './schemas.js';

type In<T extends z.ZodType> = z.infer<T>;

async function requireProperty(ctx: Ctx, propertyId: string) {
  assertPropertyAccess(ctx, propertyId);
  return must(
    await ctx.db.property.findFirst({ where: { id: propertyId, deletedAt: null } }),
    'Property',
  );
}

// ── rate plans ──
const toPlan = (p: Prisma.RatePlanGetPayload<object>) => ({
  id: p.id,
  propertyId: p.propertyId,
  code: p.code,
  name: p.name,
  mealPlan: p.mealPlan,
  isPublic: p.isPublic,
  currency: p.currency,
  cancellationPolicyId: p.cancellationPolicyId,
  isActive: p.isActive,
});

async function loadPlan(ctx: Ctx, id: string) {
  const p = must(await ctx.db.ratePlan.findFirst({ where: { id, deletedAt: null } }), 'Rate plan');
  assertPropertyAccess(ctx, p.propertyId);
  return p;
}

async function checkPolicy(ctx: Ctx, policyId: string | null | undefined, propertyId: string) {
  if (!policyId) return;
  const pol = await ctx.db.policy.findUnique({ where: { id: policyId } });
  if (!pol || pol.propertyId !== propertyId || pol.kind !== 'CANCELLATION')
    throw invalid('cancellationPolicyId', 'Unknown cancellation policy for this property');
}

export async function listRatePlans(ctx: Ctx, q: In<typeof listRatePlansQuery>) {
  assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.ratePlan.findMany({
    where: { propertyId: q.propertyId, deletedAt: null },
    orderBy: [{ code: 'asc' }, { id: 'asc' }],
    ...pageArgs(q),
  });
  const page = toPage(rows, q.limit);
  return { items: page.items.map(toPlan), nextCursor: page.nextCursor };
}
export const getRatePlan = async (ctx: Ctx, id: string) => toPlan(await loadPlan(ctx, id));

export async function createRatePlan(ctx: Ctx, input: In<typeof createRatePlanBody>) {
  await requireProperty(ctx, input.propertyId);
  await checkPolicy(ctx, input.cancellationPolicyId, input.propertyId);
  return toPlan(await ctx.db.ratePlan.create({ data: { ...input, tenantId: ctx.tenantId } }));
}
export async function updateRatePlan(ctx: Ctx, id: string, input: In<typeof updateRatePlanBody>) {
  const cur = await loadPlan(ctx, id);
  await checkPolicy(ctx, input.cancellationPolicyId, cur.propertyId);
  return toPlan(await ctx.db.ratePlan.update({ where: { id }, data: input }));
}
export async function deleteRatePlan(ctx: Ctx, id: string) {
  await loadPlan(ctx, id);
  const used = await ctx.db.reservationRoom.count({ where: { ratePlanId: id } });
  if (used > 0) throw conflict('Rate plan is used by reservations: deactivate it instead');
  await ctx.db.ratePlan.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
}

// ── seasons ──
const toSeason = (s: Prisma.SeasonGetPayload<object>) => ({
  id: s.id,
  propertyId: s.propertyId,
  name: s.name,
  fromDate: formatDay(s.fromDate),
  toDate: formatDay(s.toDate),
  priority: s.priority,
});
async function loadSeason(ctx: Ctx, id: string) {
  const s = must(await ctx.db.season.findUnique({ where: { id } }), 'Season');
  assertPropertyAccess(ctx, s.propertyId);
  return s;
}
export async function listSeasons(ctx: Ctx, propertyId: string) {
  assertPropertyAccess(ctx, propertyId);
  const rows = await ctx.db.season.findMany({
    where: { propertyId },
    orderBy: [{ fromDate: 'asc' }, { priority: 'desc' }],
  });
  return { items: rows.map(toSeason) };
}
export async function createSeason(ctx: Ctx, input: In<typeof createSeasonBody>) {
  await requireProperty(ctx, input.propertyId);
  const row = await ctx.db.season.create({
    data: {
      tenantId: ctx.tenantId,
      propertyId: input.propertyId,
      name: input.name,
      fromDate: parseDay(input.fromDate),
      toDate: parseDay(input.toDate),
      priority: input.priority,
    },
  });
  return toSeason(row);
}
export async function updateSeason(ctx: Ctx, id: string, input: In<typeof updateSeasonBody>) {
  const cur = await loadSeason(ctx, id);
  const from = input.fromDate ?? formatDay(cur.fromDate);
  const to = input.toDate ?? formatDay(cur.toDate);
  if (to < from) throw invalid('toDate', 'toDate must be >= fromDate');
  const row = await ctx.db.season.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      fromDate: parseDay(from),
      toDate: parseDay(to),
    },
  });
  return toSeason(row);
}
export async function deleteSeason(ctx: Ctx, id: string) {
  await loadSeason(ctx, id);
  const rates = await ctx.db.rate.count({ where: { seasonId: id } });
  if (rates > 0) throw conflict('Season still has rates', { rates });
  await ctx.db.season.delete({ where: { id } });
}

// ── rates ──
const toRate = (r: Prisma.RateGetPayload<object>) => ({
  id: r.id,
  ratePlanId: r.ratePlanId,
  roomTypeId: r.roomTypeId,
  seasonId: r.seasonId,
  dowMask: r.dowMask,
  currency: r.currency,
  price: num(r.price),
  extraAdult: num(r.extraAdult),
  extraChild: num(r.extraChild),
  minStay: r.minStay,
});
async function checkRateRefs(
  ctx: Ctx,
  propertyId: string,
  roomTypeId: string | undefined,
  seasonId: string | null | undefined,
) {
  if (roomTypeId) {
    const rt = await ctx.db.roomType.findFirst({ where: { id: roomTypeId, deletedAt: null } });
    if (!rt || rt.propertyId !== propertyId) throw invalid('roomTypeId', 'Unknown room type');
  }
  if (seasonId) {
    const s = await ctx.db.season.findUnique({ where: { id: seasonId } });
    if (!s || s.propertyId !== propertyId) throw invalid('seasonId', 'Unknown season');
  }
}
export async function listRates(ctx: Ctx, q: In<typeof listRatesQuery>) {
  await loadPlan(ctx, q.ratePlanId);
  const rows = await ctx.db.rate.findMany({
    where: {
      ratePlanId: q.ratePlanId,
      ...(q.roomTypeId ? { roomTypeId: q.roomTypeId } : {}),
      ...(q.seasonId ? { seasonId: q.seasonId } : {}),
    },
    orderBy: [{ roomTypeId: 'asc' }, { seasonId: 'asc' }, { id: 'asc' }],
    take: 1000,
  });
  return { items: rows.map(toRate) };
}
async function loadRate(ctx: Ctx, id: string) {
  const r = must(
    await ctx.db.rate.findUnique({ where: { id }, include: { ratePlan: true } }),
    'Rate',
  );
  assertPropertyAccess(ctx, r.ratePlan.propertyId);
  return r;
}
export async function createRate(ctx: Ctx, input: In<typeof createRateBody>) {
  const plan = await loadPlan(ctx, input.ratePlanId);
  await checkRateRefs(ctx, plan.propertyId, input.roomTypeId, input.seasonId);
  const dup = await ctx.db.rate.findFirst({
    where: {
      ratePlanId: input.ratePlanId,
      roomTypeId: input.roomTypeId,
      seasonId: input.seasonId ?? null,
      dowMask: input.dowMask,
    },
    select: { id: true },
  });
  if (dup) throw conflict('A rate already exists for this plan, room type, season and days');
  const row = await ctx.db.rate.create({
    data: {
      tenantId: ctx.tenantId,
      ratePlanId: input.ratePlanId,
      roomTypeId: input.roomTypeId,
      seasonId: input.seasonId ?? null,
      dowMask: input.dowMask,
      currency: plan.currency,
      price: BigInt(input.price),
      extraAdult: BigInt(input.extraAdult),
      extraChild: BigInt(input.extraChild),
      minStay: input.minStay,
    },
  });
  return toRate(row);
}
export async function updateRate(ctx: Ctx, id: string, input: In<typeof updateRateBody>) {
  const cur = await loadRate(ctx, id);
  await checkRateRefs(ctx, cur.ratePlan.propertyId, undefined, input.seasonId);
  const row = await ctx.db.rate.update({
    where: { id },
    data: {
      ...(input.seasonId !== undefined ? { seasonId: input.seasonId } : {}),
      ...(input.dowMask !== undefined ? { dowMask: input.dowMask } : {}),
      ...(input.price !== undefined ? { price: BigInt(input.price) } : {}),
      ...(input.extraAdult !== undefined ? { extraAdult: BigInt(input.extraAdult) } : {}),
      ...(input.extraChild !== undefined ? { extraChild: BigInt(input.extraChild) } : {}),
      ...(input.minStay !== undefined ? { minStay: input.minStay } : {}),
    },
  });
  return toRate(row);
}
export async function deleteRate(ctx: Ctx, id: string) {
  await loadRate(ctx, id);
  await ctx.db.rate.delete({ where: { id } });
}

// ── taxes (bound to platform tax_rules) ──
const toTax = (t: Prisma.TaxGetPayload<object>) => ({
  id: t.id,
  propertyId: t.propertyId,
  taxRuleId: t.taxRuleId,
  code: t.code,
  name: t.name,
  type: t.type,
  value: t.value.toString(),
  inclusive: t.inclusive,
  appliesTo: t.appliesTo,
});
async function loadTax(ctx: Ctx, id: string) {
  const t = must(await ctx.db.tax.findFirst({ where: { id, deletedAt: null } }), 'Tax');
  assertPropertyAccess(ctx, t.propertyId);
  return t;
}
export async function listTaxRules(ctx: Ctx, country?: string) {
  const rows = await ctx.db.taxRule.findMany({
    where: country ? { country } : {},
    orderBy: [{ country: 'asc' }, { code: 'asc' }, { effectiveFrom: 'desc' }],
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      country: r.country,
      code: r.code,
      name: r.name,
      kind: r.kind,
      base: r.base,
      rate: r.rate.toString(),
      inclusive: r.inclusive,
    })),
  };
}
export async function listTaxes(ctx: Ctx, propertyId: string) {
  assertPropertyAccess(ctx, propertyId);
  const rows = await ctx.db.tax.findMany({
    where: { propertyId, deletedAt: null },
    orderBy: { code: 'asc' },
  });
  return { items: rows.map(toTax) };
}
export async function createTax(ctx: Ctx, input: In<typeof createTaxBody>) {
  const prop = await requireProperty(ctx, input.propertyId);
  let value = input.value;
  let inclusive = input.inclusive;
  if (input.taxRuleId) {
    const rule = must(
      await ctx.db.taxRule.findUnique({ where: { id: input.taxRuleId } }),
      'Tax rule',
    );
    if (rule.country !== prop.country)
      throw invalid('taxRuleId', 'Tax rule belongs to another country');
    value ??= Number(rule.rate);
    inclusive ??= rule.inclusive;
  }
  if (value === undefined) throw invalid('value', 'A value or a tax rule is required', 'required');
  const row = await ctx.db.tax.create({
    data: {
      tenantId: ctx.tenantId,
      propertyId: input.propertyId,
      taxRuleId: input.taxRuleId ?? null,
      code: input.code,
      name: input.name,
      type: input.type,
      value,
      inclusive: inclusive ?? false,
      appliesTo: input.appliesTo,
    },
  });
  return toTax(row);
}
export async function updateTax(ctx: Ctx, id: string, input: In<typeof updateTaxBody>) {
  const cur = await loadTax(ctx, id);
  if (input.value !== undefined && cur.type !== 'PERCENT' && !Number.isInteger(input.value))
    throw invalid('value', 'Fixed amounts are integers');
  return toTax(await ctx.db.tax.update({ where: { id }, data: input }));
}
export async function deleteTax(ctx: Ctx, id: string) {
  await loadTax(ctx, id);
  await ctx.db.tax.update({ where: { id }, data: { deletedAt: new Date() } });
}

// ── policies ──
const toPolicy = (p: Prisma.PolicyGetPayload<object>) => ({
  id: p.id,
  propertyId: p.propertyId,
  kind: p.kind,
  name: p.name,
  rules: (p.rules ?? {}) as Record<string, unknown>,
});
async function loadPolicy(ctx: Ctx, id: string) {
  const p = must(await ctx.db.policy.findUnique({ where: { id } }), 'Policy');
  assertPropertyAccess(ctx, p.propertyId);
  return p;
}
function parseRules(kind: 'CANCELLATION' | 'DEPOSIT', rules: unknown) {
  const r = (kind === 'CANCELLATION' ? cancellationRules : depositRules).safeParse(rules);
  if (r.success) return r.data;
  throw new AppError('VALIDATION_ERROR', undefined, {
    errors: r.error.issues.map((i) => ({
      path: ['rules', ...i.path.map(String)].join('.'),
      message: i.message,
      code: i.code,
    })),
  });
}
export async function listPolicies(ctx: Ctx, propertyId: string) {
  assertPropertyAccess(ctx, propertyId);
  const rows = await ctx.db.policy.findMany({ where: { propertyId }, orderBy: { name: 'asc' } });
  return { items: rows.map(toPolicy) };
}
export async function createPolicy(ctx: Ctx, input: In<typeof createPolicyBody>) {
  await requireProperty(ctx, input.propertyId);
  const row = await ctx.db.policy.create({
    data: {
      tenantId: ctx.tenantId,
      propertyId: input.propertyId,
      kind: input.kind,
      name: input.name,
      rules: input.rules as Prisma.InputJsonValue,
    },
  });
  return toPolicy(row);
}
export async function updatePolicy(ctx: Ctx, id: string, input: In<typeof updatePolicyBody>) {
  const cur = await loadPolicy(ctx, id);
  const data: Prisma.PolicyUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.rules !== undefined)
    data.rules = parseRules(cur.kind, input.rules) as Prisma.InputJsonValue;
  return toPolicy(await ctx.db.policy.update({ where: { id }, data }));
}
export async function deletePolicy(ctx: Ctx, id: string) {
  await loadPolicy(ctx, id);
  const used = await ctx.db.ratePlan.count({
    where: { cancellationPolicyId: id, deletedAt: null },
  });
  if (used > 0) throw conflict('Policy is used by rate plans', { ratePlans: used });
  await ctx.db.policy.delete({ where: { id } });
}

// ── quote ──
/** Loads the pricing data and runs the pure calculator (OP-04). */
export async function quoteStay(ctx: Ctx, input: In<typeof quoteBody>): Promise<Quote> {
  await requireProperty(ctx, input.propertyId);
  const roomType = must(
    await ctx.db.roomType.findFirst({
      where: { id: input.roomTypeId, propertyId: input.propertyId, deletedAt: null },
    }),
    'Room type',
  );
  const plan = must(
    await ctx.db.ratePlan.findFirst({
      where: {
        id: input.ratePlanId,
        propertyId: input.propertyId,
        deletedAt: null,
        isActive: true,
      },
    }),
    'Rate plan',
  );
  const [rates, seasons, taxes] = await Promise.all([
    ctx.db.rate.findMany({ where: { ratePlanId: plan.id, roomTypeId: roomType.id } }),
    ctx.db.season.findMany({ where: { propertyId: input.propertyId } }),
    ctx.db.tax.findMany({
      where: { propertyId: input.propertyId, deletedAt: null, appliesTo: { has: 'LODGING' } },
      orderBy: { code: 'asc' },
    }),
  ]);
  try {
    return priceStay(
      {
        currency: plan.currency,
        roomType,
        rates: rates.map((r) => ({
          id: r.id,
          seasonId: r.seasonId,
          dowMask: r.dowMask,
          price: num(r.price),
          extraAdult: num(r.extraAdult),
          extraChild: num(r.extraChild),
          minStay: r.minStay,
        })),
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
      },
      input,
    );
  } catch (e) {
    if (e instanceof QuoteError)
      throw invalid(e.code === 'MIN_STAY' ? 'departure' : 'arrival', e.message, e.code);
    throw e;
  }
}
