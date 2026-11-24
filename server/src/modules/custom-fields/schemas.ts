import { z } from 'zod';
import { idParams, uuid } from '../property/common.js';

/** Entities that carry a `custom_fields` JSONB column (doc 08 X5). */
export const CUSTOM_FIELD_ENTITIES = [
  'guest',
  'reservation',
  'police_record',
  'room',
  'employee',
  'product',
  'work_order',
] as const;
export type CustomFieldEntity = (typeof CUSTOM_FIELD_ENTITIES)[number];

export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'DATE',
  'BOOLEAN',
  'SELECT',
  'MULTI_SELECT',
] as const;
export type CustomFieldTypeName = (typeof CUSTOM_FIELD_TYPES)[number];

export const i18nLabel = z.object({
  fr: z.string().trim().min(1).max(120),
  en: z.string().trim().min(1).max(120).optional(),
});
export type I18nLabel = z.infer<typeof i18nLabel>;

export const selectOptionsSchema = z
  .array(
    z.object({
      value: z.string().regex(/^[A-Za-z0-9_.-]{1,40}$/, 'Letters, digits, _ . - only (max 40)'),
      label: i18nLabel,
    }),
  )
  .min(1)
  .max(100)
  .refine((o) => new Set(o.map((x) => x.value)).size === o.length, 'Option values must be unique');
export type SelectOptions = z.infer<typeof selectOptionsSchema>;

export const textOptionsSchema = z
  .object({
    maxLength: z.number().int().min(1).max(2000).optional(),
    pattern: z
      .string()
      .max(200)
      .refine((p) => {
        try {
          new RegExp(p);
          return true;
        } catch {
          return false;
        }
      }, 'Invalid regular expression')
      .optional(),
  })
  .strict();

export const numberOptionsSchema = z
  .object({
    min: z.number().optional(),
    max: z.number().optional(),
    integer: z.boolean().optional(),
  })
  .strict()
  .refine((o) => o.min === undefined || o.max === undefined || o.min <= o.max, 'min must be ≤ max');

export const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

const baseFields = {
  entity: z.enum(CUSTOM_FIELD_ENTITIES),
  key: z.string().regex(KEY_RE, 'snake_case, starts with a letter, max 40'),
  label: i18nLabel,
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.unknown().optional(),
  required: z.boolean().default(false),
  sort: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
};

/** Options must match the type (select list, number bounds, text constraints, none otherwise). */
export function optionsError(type: CustomFieldTypeName, options: unknown): string | null {
  const empty = options === undefined || options === null;
  switch (type) {
    case 'SELECT':
    case 'MULTI_SELECT': {
      const r = selectOptionsSchema.safeParse(options);
      return r.success
        ? null
        : (r.error.issues[0]?.message ?? 'Options required for a select field');
    }
    case 'NUMBER': {
      if (empty) return null;
      const r = numberOptionsSchema.safeParse(options);
      return r.success ? null : (r.error.issues[0]?.message ?? 'Invalid number options');
    }
    case 'TEXT': {
      if (empty) return null;
      const r = textOptionsSchema.safeParse(options);
      return r.success ? null : (r.error.issues[0]?.message ?? 'Invalid text options');
    }
    default:
      return empty ? null : `No options for a ${type} field`;
  }
}

export const createDefinitionBody = z.object(baseFields).superRefine((d, ctx) => {
  const message = optionsError(d.type, d.options);
  if (message) ctx.addIssue({ code: 'custom', path: ['options'], message });
});
export type CreateDefinitionInput = z.infer<typeof createDefinitionBody>;

/** `entity`, `key` and `type` are immutable (stored values depend on them). */
export const updateDefinitionBody = z
  .object({
    label: i18nLabel.optional(),
    options: z.unknown().optional(),
    required: z.boolean().optional(),
    sort: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateDefinitionInput = z.infer<typeof updateDefinitionBody>;

export const listDefinitionsQuery = z.object({
  entity: z.enum(CUSTOM_FIELD_ENTITIES).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const definitionSchema = z.object({
  id: uuid,
  entity: z.enum(CUSTOM_FIELD_ENTITIES).or(z.string()),
  key: z.string(),
  label: i18nLabel,
  type: z.enum(CUSTOM_FIELD_TYPES),
  options: z.unknown().nullable(),
  required: z.boolean(),
  sort: z.number().int(),
  isActive: z.boolean(),
});
export type DefinitionDto = z.infer<typeof definitionSchema>;

export { idParams };
