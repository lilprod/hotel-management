import type { CustomFieldType, Prisma } from '@hm/database';
import { conflict, must, invalid, type Ctx } from '../property/common.js';
import {
  definitionSchema,
  optionsError,
  type CreateDefinitionInput,
  type CustomFieldTypeName,
  type DefinitionDto,
  type UpdateDefinitionInput,
} from './schemas.js';

type Row = Prisma.CustomFieldDefinitionGetPayload<object>;

export function toDto(r: Row): DefinitionDto {
  const label = (r.labelI18n ?? {}) as { fr?: string; en?: string };
  return definitionSchema.parse({
    id: r.id,
    entity: r.entity,
    key: r.key,
    label: { fr: label.fr ?? r.key, ...(label.en ? { en: label.en } : {}) },
    type: r.type,
    options: r.options ?? null,
    required: r.required,
    sort: r.sort,
    isActive: r.isActive,
  });
}

export async function listDefinitions(
  ctx: Ctx,
  q: { entity?: string | undefined; includeInactive: boolean },
): Promise<{ items: DefinitionDto[] }> {
  const rows = await ctx.db.customFieldDefinition.findMany({
    where: {
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ entity: 'asc' }, { sort: 'asc' }, { key: 'asc' }],
  });
  return { items: rows.map(toDto) };
}

export async function createDefinition(
  ctx: Ctx,
  input: CreateDefinitionInput,
): Promise<DefinitionDto> {
  const existing = await ctx.db.customFieldDefinition.findFirst({
    where: { entity: input.entity, key: input.key },
    select: { id: true },
  });
  if (existing) throw conflict(`Field ${input.entity}.${input.key} already exists`);
  const row = await ctx.db.customFieldDefinition.create({
    data: {
      tenantId: ctx.tenantId,
      entity: input.entity,
      key: input.key,
      labelI18n: input.label,
      type: input.type as CustomFieldType,
      ...(input.options === undefined || input.options === null
        ? {}
        : { options: input.options as Prisma.InputJsonValue }),
      required: input.required,
      sort: input.sort,
      isActive: input.isActive,
    },
  });
  return toDto(row);
}

export async function updateDefinition(
  ctx: Ctx,
  id: string,
  input: UpdateDefinitionInput,
): Promise<DefinitionDto> {
  const row = must(await ctx.db.customFieldDefinition.findUnique({ where: { id } }), 'Field');
  if (input.options !== undefined) {
    const message = optionsError(row.type as CustomFieldTypeName, input.options);
    if (message) throw invalid('options', message);
  }
  const updated = await ctx.db.customFieldDefinition.update({
    where: { id },
    data: {
      ...(input.label ? { labelI18n: input.label } : {}),
      ...(input.options !== undefined
        ? { options: input.options === null ? undefined : (input.options as Prisma.InputJsonValue) }
        : {}),
      ...(input.required !== undefined ? { required: input.required } : {}),
      ...(input.sort !== undefined ? { sort: input.sort } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });
  return toDto(updated);
}

export async function deleteDefinition(ctx: Ctx, id: string): Promise<void> {
  must(await ctx.db.customFieldDefinition.findUnique({ where: { id } }), 'Field');
  await ctx.db.customFieldDefinition.delete({ where: { id } });
}
