import type { TransactionClient } from '@hm/database';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { formatDay, must, parseDay } from '../property/common.js';
import type { FCtx } from '../folio/service.js';
import { parseRate } from '../folio/tax-math.js';
import type { listRatesQuery, upsertRateBody } from './schemas.js';

type RateDb = Pick<TransactionClient, 'exchangeRate'>;

const DAY_MS = 86_400_000;

const toRate = (r: {
  id: string;
  base: string;
  quote: string;
  rate: { toString(): string };
  validOn: Date;
  createdBy: string | null;
  updatedAt: Date;
}) => ({
  id: r.id,
  base: r.base,
  quote: r.quote,
  rate: r.rate.toString(),
  validOn: formatDay(r.validOn),
  createdBy: r.createdBy,
  updatedAt: r.updatedAt.toISOString(),
});

export async function listRates(ctx: FCtx, q: z.infer<typeof listRatesQuery>) {
  const rows = await ctx.db.exchangeRate.findMany({
    where: {
      ...(q.base ? { base: q.base } : {}),
      ...(q.quote ? { quote: q.quote } : {}),
      ...(q.from || q.to
        ? {
            validOn: {
              ...(q.from ? { gte: parseDay(q.from) } : {}),
              ...(q.to ? { lte: parseDay(q.to) } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ validOn: 'desc' }, { base: 'asc' }],
    take: q.limit,
  });
  return { items: rows.map(toRate) };
}

/** Daily rate "1 base = rate quote" (EX-21), one per (base, quote, day): upsert. */
export async function upsertRate(ctx: FCtx, input: z.infer<typeof upsertRateBody>) {
  if (input.base === input.quote)
    throw new AppError('VALIDATION_ERROR', undefined, {
      errors: [{ path: 'quote', message: 'base and quote must differ', code: 'custom' }],
    });
  parseRate(input.rate);
  const key = {
    tenantId: ctx.tenantId,
    base: input.base,
    quote: input.quote,
    validOn: parseDay(input.validOn),
  };
  const before = await ctx.db.exchangeRate.findUnique({ where: { tenantId_base_quote_validOn: key } });
  const row = await ctx.db.exchangeRate.upsert({
    where: { tenantId_base_quote_validOn: key },
    create: { ...key, rate: input.rate, createdBy: ctx.actorId },
    update: { rate: input.rate, createdBy: ctx.actorId },
  });
  await ctx.audit({
    action: before ? 'exchange_rate.update' : 'exchange_rate.create',
    entity: 'exchange_rate',
    entityId: row.id,
    ...(before ? { before: toRate(before) } : {}),
    after: toRate(row),
  });
  return toRate(row);
}

export async function deleteRate(ctx: FCtx, id: string) {
  const row = must(await ctx.db.exchangeRate.findFirst({ where: { id } }), 'Exchange rate');
  await ctx.db.exchangeRate.delete({ where: { id } });
  await ctx.audit({ action: 'exchange_rate.delete', entity: 'exchange_rate', entityId: id, before: toRate(row) });
}

/** Most recent rate valid on `day` (at most `maxAgeDays` old), or a PRECONDITION_FAILED. */
export async function rateFor(
  db: RateDb,
  base: string,
  quote: string,
  day: string,
  maxAgeDays: number,
): Promise<string> {
  const d = parseDay(day);
  const row = await db.exchangeRate.findFirst({
    where: {
      base,
      quote,
      validOn: { lte: d, gte: new Date(d.getTime() - maxAgeDays * DAY_MS) },
    },
    orderBy: { validOn: 'desc' },
  });
  if (!row)
    throw new AppError('PRECONDITION_FAILED', undefined, {
      detail: `No exchange rate ${base}/${quote} for ${day}`,
      meta: { reason: 'NO_EXCHANGE_RATE', base, quote, day },
    });
  return row.rate.toString();
}
