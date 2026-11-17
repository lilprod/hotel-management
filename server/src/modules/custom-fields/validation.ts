import type { AppClient } from '@hm/database';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { dayString } from '../property/common.js';
import {
  numberOptionsSchema,
  selectOptionsSchema,
  textOptionsSchema,
  type CustomFieldEntity,
  type CustomFieldTypeName,
} from './schemas.js';

/** Minimal shape of a definition needed to validate values (a `custom_field_definitions` row). */
export interface CustomFieldRule {
  key: string;
  type: CustomFieldTypeName | string;
  options?: unknown;
  required: boolean;
  isActive?: boolean;
}

export interface BuildOptions {
  /** PATCH semantics: required fields may be omitted (they are still refused when null). */
  partial?: boolean;
}

function fieldSchema(def: CustomFieldRule): z.ZodType {
  switch (def.type) {
    case 'TEXT': {
      const o = textOptionsSchema.safeParse(def.options ?? {});
      const opts = o.success ? o.data : {};
      let s = z.string().max(opts.maxLength ?? 2000);
      if (opts.pattern) s = s.regex(new RegExp(opts.pattern), 'Does not match the expected format');
      return def.required ? s.min(1) : s;
    }
    case 'NUMBER': {
      const o = numberOptionsSchema.safeParse(def.options ?? {});
      const opts = o.success ? o.data : {};
      let s = z.number().finite();
      if (opts.integer) s = s.int();
      if (opts.min !== undefined) s = s.min(opts.min);
      if (opts.max !== undefined) s = s.max(opts.max);
      return s;
    }
    case 'DATE':
      return dayString;
    case 'BOOLEAN':
      return z.boolean();
    case 'SELECT':
    case 'MULTI_SELECT': {
      const o = selectOptionsSchema.safeParse(def.options);
      const allowed = new Set(o.success ? o.data.map((x) => x.value) : []);
      const one = z.string().refine((v) => allowed.has(v), 'Not one of the allowed options');
      return def.type === 'SELECT'
        ? one
        : z
            .array(one)
            .max(allowed.size)
            .refine((a) => new Set(a).size === a.length, 'Duplicate values');
    }
    default:
      return z.never();
  }
}

/**
 * Dynamic Zod schema for the `custom_fields` JSON of an entity (doc 08 X5): one property per
 * active definition, typed from `type` + `options`, `required` enforced, unknown keys refused.
 * Optional fields accept `null` (clears the value). Exported for every module that owns an
 * entity with custom fields.
 */
export function buildCustomFieldsSchema(
  defs: readonly CustomFieldRule[],
  opts: BuildOptions = {},
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const def of defs) {
    if (def.isActive === false) continue;
    const base = fieldSchema(def);
    shape[def.key] =
      def.required && !opts.partial ? base : def.required ? base.optional() : base.nullish();
  }
  return z.object(shape).strict() as unknown as z.ZodType<Record<string, unknown>>;
}

/** Loads the active definitions of an entity (current tenant context) and validates `values`. */
export async function validateCustomFields(
  db: AppClient,
  entity: CustomFieldEntity,
  values: unknown,
  opts: BuildOptions & { path?: string } = {},
): Promise<Record<string, unknown>> {
  const defs = await db.customFieldDefinition.findMany({
    where: { entity, isActive: true },
    select: { key: true, type: true, options: true, required: true, isActive: true },
  });
  return parseCustomFields(defs, values ?? {}, opts);
}

/** Synchronous variant when the definitions are already loaded. */
export function parseCustomFields(
  defs: readonly CustomFieldRule[],
  values: unknown,
  opts: BuildOptions & { path?: string } = {},
): Record<string, unknown> {
  const result = buildCustomFieldsSchema(defs, opts).safeParse(values);
  if (result.success) {
    // `null` means "clear": drop it so the stored JSON only holds set values.
    return Object.fromEntries(Object.entries(result.data).filter(([, v]) => v !== null));
  }
  const prefix = opts.path ?? 'customFields';
  throw new AppError('VALIDATION_ERROR', undefined, {
    errors: result.error.issues.map((i) => ({
      path: [prefix, ...i.path.map(String)].join('.'),
      message: i.message,
      code: i.code,
    })),
  });
}
