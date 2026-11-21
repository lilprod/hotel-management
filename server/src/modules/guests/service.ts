import { Prisma, type TransactionClient } from '@hm/database';
import type { z } from 'zod';
import { validateCustomFields } from '../custom-fields/validation.js';
import { formatDay, must, parseDay, toPage } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';
import { encryptIdNumber, decryptIdNumber, maskIdNumber } from './crypto.js';
import type { GuestDto, GuestInput, listGuestsQuery, updateGuestBody } from './schemas.js';

type GuestRow = Prisma.GuestGetPayload<object>;
type GuestDb = Pick<TransactionClient, 'guest' | 'customFieldDefinition'>;

export function toGuest(g: GuestRow, secret: string): GuestDto {
  let masked: string | null = null;
  if (g.idDocNumberEnc) {
    try {
      masked = maskIdNumber(decryptIdNumber(g.idDocNumberEnc, secret));
    } catch {
      masked = '••••';
    }
  }
  return {
    id: g.id,
    firstName: g.firstName,
    lastName: g.lastName,
    gender: g.gender,
    birthDate: g.birthDate ? formatDay(g.birthDate) : null,
    birthPlace: g.birthPlace,
    nationality: g.nationality,
    profession: g.profession,
    phone: g.phone,
    email: g.email,
    address: g.address,
    idDocType: g.idDocType,
    idDocNumberMasked: masked,
    tags: g.tags,
    isBlacklisted: g.isBlacklisted,
    notes: g.notes,
    customFields: (g.customFields ?? {}) as Record<string, unknown>,
    createdAt: g.createdAt.toISOString(),
  };
}

const secretOf = (ctx: RCtx) => ctx.services.config.JWT_ACCESS_SECRET;

function columns(ctx: RCtx, input: Partial<GuestInput>) {
  const { idDocNumber, birthDate, ...rest } = input;
  const data: Record<string, unknown> = { ...rest };
  delete data.customFields;
  if (birthDate !== undefined) data.birthDate = birthDate ? parseDay(birthDate) : null;
  if (idDocNumber !== undefined)
    data.idDocNumberEnc = idDocNumber ? encryptIdNumber(idDocNumber, secretOf(ctx)) : null;
  return data;
}

/** Creates a guest (inside the caller's transaction when given). */
export async function insertGuest(ctx: RCtx, db: GuestDb, input: GuestInput): Promise<GuestRow> {
  const customFields = await validateCustomFields(db as never, 'guest', input.customFields ?? {}, {
    path: 'guest.customFields',
  });
  return db.guest.create({
    data: {
      ...(columns(ctx, input) as Omit<Prisma.GuestUncheckedCreateInput, 'tenantId'>),
      firstName: input.firstName,
      lastName: input.lastName,
      tenantId: ctx.tenantId,
      tags: input.tags ?? [],
      customFields: customFields as Prisma.InputJsonValue,
      createdBy: ctx.actorId,
    },
  });
}

export async function createGuest(ctx: RCtx, input: GuestInput): Promise<GuestDto> {
  const g = await insertGuest(ctx, ctx.db as unknown as GuestDb, input);
  await ctx.audit({
    action: 'guest.create',
    entity: 'guest',
    entityId: g.id,
    after: { ...input, idDocNumber: undefined },
  });
  return toGuest(g, secretOf(ctx));
}

export async function loadGuest(db: GuestDb, id: string): Promise<GuestRow> {
  return must(await db.guest.findFirst({ where: { id, deletedAt: null } }), 'Guest');
}

export async function getGuest(ctx: RCtx, id: string): Promise<GuestDto> {
  return toGuest(await loadGuest(ctx.db as unknown as GuestDb, id), secretOf(ctx));
}

export async function updateGuest(
  ctx: RCtx,
  id: string,
  input: z.infer<typeof updateGuestBody>,
): Promise<GuestDto> {
  const cur = await loadGuest(ctx.db as unknown as GuestDb, id);
  const { isBlacklisted, customFields, ...rest } = input;
  const data: Prisma.GuestUncheckedUpdateInput = columns(
    ctx,
    rest,
  ) as Prisma.GuestUncheckedUpdateInput;
  if (isBlacklisted !== undefined) data.isBlacklisted = isBlacklisted;
  if (customFields !== undefined) {
    const merged = { ...((cur.customFields ?? {}) as Record<string, unknown>), ...customFields };
    data.customFields = (await validateCustomFields(
      ctx.db,
      'guest',
      merged,
    )) as Prisma.InputJsonValue;
  }
  const row = await ctx.db.guest.update({ where: { id }, data });
  const before = toGuest(cur, secretOf(ctx));
  const after = toGuest(row, secretOf(ctx));
  await ctx.audit({
    action:
      isBlacklisted !== undefined && isBlacklisted !== cur.isBlacklisted
        ? 'guest.blacklist'
        : 'guest.update',
    entity: 'guest',
    entityId: id,
    before: before as unknown as Record<string, unknown>,
    after: after as unknown as Record<string, unknown>,
  });
  return after;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Guest search (name / phone / e-mail). Names use trigram similarity (pg_trgm, GIN index on
 * last_name) plus a substring match; phones compare digits only.
 */
export async function listGuests(ctx: RCtx, q: z.infer<typeof listGuestsQuery>) {
  const secret = secretOf(ctx);
  if (!q.search) {
    const rows = await ctx.db.guest.findMany({
      where: {
        deletedAt: null,
        ...(q.blacklisted !== undefined ? { isBlacklisted: q.blacklisted } : {}),
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = toPage(rows, q.limit);
    return { items: page.items.map((g) => toGuest(g, secret)), nextCursor: page.nextCursor };
  }
  const s = q.search;
  const like = `%${escapeLike(s.toLowerCase())}%`;
  const digits = s.replace(/\D/g, '');
  const phoneLike = digits.length >= 4 ? `%${digits}%` : null;
  const black =
    q.blacklisted === undefined ? Prisma.sql`` : Prisma.sql`AND is_blacklisted = ${q.blacklisted}`;
  const ids = await ctx.db.$queryRaw<{ id: string }[]>`
    SELECT id::text AS id FROM guests
    WHERE deleted_at IS NULL ${black} AND (
      last_name % ${s} OR first_name % ${s}
      OR lower(first_name || ' ' || last_name) LIKE ${like}
      OR lower(last_name || ' ' || first_name) LIKE ${like}
      OR lower(coalesce(email, '')) LIKE ${like}
      OR (${phoneLike}::text IS NOT NULL AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') LIKE ${phoneLike})
    )
    ORDER BY greatest(similarity(last_name, ${s}), similarity(first_name, ${s}),
                      similarity(first_name || ' ' || last_name, ${s})) DESC, last_name, id
    LIMIT ${q.limit}`;
  const rows = await ctx.db.guest.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const items = ids.flatMap((r) => {
    const g = byId.get(r.id);
    return g ? [toGuest(g, secret)] : [];
  });
  return { items, nextCursor: null };
}
