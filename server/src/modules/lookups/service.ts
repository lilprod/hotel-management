import type { AppClient, Prisma } from '@hm/database';
import { conflict, invalid, must, type Ctx } from '../property/common.js';
import {
  KNOWN_LIST_KEYS,
  PRODUCT_CATEGORY_LIST,
  valueSchema,
  type CreateValueInput,
  type UpdateValueInput,
  type ValueDto,
} from './schemas.js';

type Row = Prisma.LookupValueGetPayload<object>;

export function toDto(r: Row): ValueDto {
  const label = (r.labelI18n ?? {}) as { fr?: string; en?: string };
  return valueSchema.parse({
    id: r.id,
    listKey: r.listKey,
    code: r.code,
    label: { fr: label.fr ?? r.code, ...(label.en ? { en: label.en } : {}) },
    sort: r.sort,
    isSystem: r.isSystem,
    active: r.active,
  });
}

/** Lists that exist for the tenant, plus the well-known ones (possibly empty). */
export async function listLists(ctx: Ctx) {
  const rows = await ctx.db.lookupValue.groupBy({
    by: ['listKey', 'active'],
    _count: { _all: true },
  });
  const map = new Map<string, { listKey: string; total: number; active: number }>();
  for (const k of KNOWN_LIST_KEYS) map.set(k, { listKey: k, total: 0, active: 0 });
  for (const r of rows) {
    const e = map.get(r.listKey) ?? { listKey: r.listKey, total: 0, active: 0 };
    e.total += r._count._all;
    if (r.active) e.active += r._count._all;
    map.set(r.listKey, e);
  }
  return { items: [...map.values()].sort((a, b) => a.listKey.localeCompare(b.listKey)) };
}

export async function listValues(
  ctx: Ctx,
  listKey: string,
  includeInactive: boolean,
): Promise<{ items: ValueDto[] }> {
  const rows = await ctx.db.lookupValue.findMany({
    where: { listKey, ...(includeInactive ? {} : { active: true }) },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }],
  });
  return { items: rows.map(toDto) };
}

export async function createValue(
  ctx: Ctx,
  listKey: string,
  input: CreateValueInput,
): Promise<ValueDto> {
  const dup = await ctx.db.lookupValue.findFirst({
    where: { listKey, code: input.code },
    select: { id: true },
  });
  if (dup) throw conflict(`Value ${input.code} already exists in ${listKey}`);
  const sort =
    input.sort ??
    ((await ctx.db.lookupValue.aggregate({ where: { listKey }, _max: { sort: true } }))._max.sort ??
      0) + 1;
  const row = await ctx.db.lookupValue.create({
    data: {
      tenantId: ctx.tenantId,
      listKey,
      code: input.code,
      labelI18n: input.label,
      sort,
      active: input.active,
      isSystem: false,
    },
  });
  return toDto(row);
}

export async function updateValue(
  ctx: Ctx,
  listKey: string,
  id: string,
  input: UpdateValueInput,
): Promise<ValueDto> {
  must(await ctx.db.lookupValue.findFirst({ where: { id, listKey } }), 'List value');
  const row = await ctx.db.lookupValue.update({
    where: { id },
    data: {
      ...(input.label ? { labelI18n: input.label } : {}),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
  return toDto(row);
}

export async function deleteValue(ctx: Ctx, listKey: string, id: string): Promise<void> {
  const row = must(await ctx.db.lookupValue.findFirst({ where: { id, listKey } }), 'List value');
  if (row.isSystem) throw conflict('System values cannot be deleted; deactivate them instead');
  if (listKey === PRODUCT_CATEGORY_LIST) {
    const used = await ctx.db.product.count({ where: { categoryId: id, deletedAt: null } });
    if (used) throw conflict(`Category used by ${used} product(s); deactivate it instead`);
  }
  await ctx.db.lookupValue.delete({ where: { id } });
}

/**
 * For other modules: ensures `code` is an active value of `listKey` for the current tenant
 * (e.g. the cancellation reason of a reservation) and returns its id.
 */
export async function requireLookupCode(
  db: AppClient,
  listKey: string,
  code: string,
  path = 'code',
): Promise<string> {
  const row = await db.lookupValue.findFirst({
    where: { listKey, code, active: true },
    select: { id: true },
  });
  if (!row) throw invalid(path, `Unknown value "${code}" for list ${listKey}`);
  return row.id;
}
