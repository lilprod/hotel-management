import { z } from 'zod';
import { uuid } from '../property/common.js';

/**
 * Lists seeded or expected by other modules (doc 08 X6). Lists are free-form: any `listKey`
 * matching LIST_KEY_RE can be created by a tenant.
 */
export const KNOWN_LIST_KEYS = [
  'reservation_source',
  'guest_segment',
  'cancel_reason',
  'task_type',
  'product_category',
  'tag',
] as const;

export const PRODUCT_CATEGORY_LIST = 'product_category';

export const LIST_KEY_RE = /^[a-z][a-z0-9_]{1,39}$/;
export const listKeyParams = z.object({ listKey: z.string().regex(LIST_KEY_RE) });
export const valueParams = listKeyParams.extend({ id: uuid });

const label = z.object({
  fr: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120).optional(),
});

export const createValueBody = z.object({
  code: z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/, 'Letters, digits, _ . - only (max 40)'),
  label,
  sort: z.number().int().min(0).max(10_000).optional(),
  active: z.boolean().default(true),
});
export type CreateValueInput = z.infer<typeof createValueBody>;

/** The code is immutable: other tables reference values by id, exports and rules by code. */
export const updateValueBody = z
  .object({
    label: label.optional(),
    sort: z.number().int().min(0).max(10_000).optional(),
    active: z.boolean().optional(),
  })
  .strict();
export type UpdateValueInput = z.infer<typeof updateValueBody>;

export const listValuesQuery = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const valueSchema = z.object({
  id: uuid,
  listKey: z.string(),
  code: z.string(),
  label,
  sort: z.number().int(),
  isSystem: z.boolean(),
  active: z.boolean(),
});
export type ValueDto = z.infer<typeof valueSchema>;

export const listSummarySchema = z.object({
  listKey: z.string(),
  total: z.number().int(),
  active: z.number().int(),
});
