import type { Prisma } from '@hm/database';
import type { z } from 'zod';
import {
  assertPropertyAccess,
  invalid,
  must,
  num,
  pageArgs,
  toPage,
  type Ctx,
} from '../property/common.js';
import { PRODUCT_CATEGORY_LIST } from '../lookups/schemas.js';
import type { createProductBody, listDepartmentsQuery, listProductsQuery, updateProductBody } from './schemas.js';

const toProduct = (p: Prisma.ProductGetPayload<object>) => ({
  id: p.id,
  propertyId: p.propertyId,
  categoryId: p.categoryId,
  taxId: p.taxId,
  name: p.name,
  currency: p.currency,
  price: num(p.price),
  departmentCode: p.departmentCode,
  isStockItem: p.isStockItem,
  isActive: p.isActive,
});

async function checkRefs(
  ctx: Ctx,
  propertyId: string,
  categoryId?: string | null,
  taxId?: string | null,
) {
  if (categoryId) {
    const c = await ctx.db.lookupValue.findFirst({
      where: { id: categoryId, listKey: PRODUCT_CATEGORY_LIST },
    });
    if (!c) throw invalid('categoryId', 'Unknown product category');
  }
  if (taxId) {
    const t = await ctx.db.tax.findFirst({ where: { id: taxId, propertyId, deletedAt: null } });
    if (!t) throw invalid('taxId', 'Unknown tax for this property');
  }
}

async function load(ctx: Ctx, id: string) {
  const p = must(await ctx.db.product.findFirst({ where: { id, deletedAt: null } }), 'Product');
  assertPropertyAccess(ctx, p.propertyId);
  return p;
}

export async function listProducts(ctx: Ctx, q: z.infer<typeof listProductsQuery>) {
  assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.product.findMany({
    where: {
      propertyId: q.propertyId,
      deletedAt: null,
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    ...pageArgs(q),
  });
  const page = toPage(rows, q.limit);
  return { items: page.items.map(toProduct), nextCursor: page.nextCursor };
}
export const getProduct = async (ctx: Ctx, id: string) => toProduct(await load(ctx, id));

export async function createProduct(ctx: Ctx, input: z.infer<typeof createProductBody>) {
  assertPropertyAccess(ctx, input.propertyId);
  must(
    await ctx.db.property.findFirst({ where: { id: input.propertyId, deletedAt: null } }),
    'Property',
  );
  await checkRefs(ctx, input.propertyId, input.categoryId, input.taxId);
  const { price, ...rest } = input;
  return toProduct(
    await ctx.db.product.create({
      data: { ...rest, price: BigInt(price), tenantId: ctx.tenantId },
    }),
  );
}

export async function updateProduct(
  ctx: Ctx,
  id: string,
  input: z.infer<typeof updateProductBody>,
) {
  const cur = await load(ctx, id);
  await checkRefs(ctx, cur.propertyId, input.categoryId, input.taxId);
  const { price, ...rest } = input;
  return toProduct(
    await ctx.db.product.update({
      where: { id },
      data: { ...rest, ...(price !== undefined ? { price: BigInt(price) } : {}) },
    }),
  );
}

/** Products are referenced by folio lines: they are deactivated, never hard-deleted. */
export async function deleteProduct(ctx: Ctx, id: string) {
  await load(ctx, id);
  await ctx.db.product.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
}

/** Departments written by the platform itself on folio lines (not rows of `departments`). */
const SYSTEM_DEPARTMENTS: Record<string, { fr: string; en: string }> = {
  ROOM: { fr: 'Hébergement', en: 'Accommodation' },
  EXTRA: { fr: 'Extras', en: 'Extras' },
  DISCOUNT: { fr: 'Remises', en: 'Discounts' },
  CITY_LEDGER: { fr: 'Compte client (city ledger)', en: 'City ledger' },
};

/**
 * Departments of a property: the `departments` table (name as entered by the hotel) plus the
 * system codes used by folio lines (ROOM, EXTRA…), named in the requested language. The table
 * wins over a system name when a hotel defined the same code.
 */
export async function listDepartments(ctx: Ctx, q: z.infer<typeof listDepartmentsQuery>) {
  assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.department.findMany({
    where: { propertyId: q.propertyId, deletedAt: null },
    orderBy: [{ name: 'asc' }, { code: 'asc' }],
  });
  const own = new Set(rows.map((r) => r.code));
  const items = [
    ...Object.entries(SYSTEM_DEPARTMENTS)
      .filter(([code]) => !own.has(code))
      .map(([code, n]) => ({ code, name: n[q.locale], system: true, isActive: true })),
    ...rows.map((r) => ({ code: r.code, name: r.name, system: false, isActive: r.isActive })),
  ];
  return { items };
}
