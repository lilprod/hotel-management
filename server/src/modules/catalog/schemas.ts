import { z } from 'zod';
import { idParams, money, pageOf, pageQuery, uuid, currencyCode } from '../property/common.js';

export { idParams };
export const createProductBody = z.object({
  propertyId: uuid,
  name: z.string().trim().min(1).max(160),
  categoryId: uuid.nullish(),
  taxId: uuid.nullish(),
  currency: currencyCode.default('XOF'),
  price: money,
  departmentCode: z.string().trim().max(40).nullish(),
  isStockItem: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export const updateProductBody = createProductBody
  .omit({ propertyId: true, currency: true })
  .partial()
  .strict();
export const productSchema = z.object({
  id: uuid,
  propertyId: uuid,
  categoryId: uuid.nullable(),
  taxId: uuid.nullable(),
  name: z.string(),
  currency: z.string(),
  price: z.number().int(),
  departmentCode: z.string().nullable(),
  isStockItem: z.boolean(),
  isActive: z.boolean(),
});
export const listProductsQuery = pageQuery.extend({
  propertyId: uuid,
  categoryId: uuid.optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export const productPage = pageOf(productSchema);

export const listDepartmentsQuery = z.object({
  propertyId: uuid,
  locale: z.enum(['fr', 'en']).default('fr'),
});
export const departmentList = z.object({
  items: z.array(
    z.object({ code: z.string(), name: z.string(), system: z.boolean(), isActive: z.boolean() }),
  ),
});
