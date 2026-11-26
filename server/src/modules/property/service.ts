import { Prisma } from '@hm/database';
import { TenantStorage } from '../../lib/storage.js';
import { validateCustomFields } from '../custom-fields/validation.js';
import {
  assertPropertyAccess,
  conflict,
  formatDay,
  invalid,
  must,
  pageArgs,
  parseDay,
  toPage,
  type Ctx,
} from './common.js';
import type { z } from 'zod';
import type {
  BlockDto,
  PropertyDto,
  RoomDto,
  RoomTypeDto,
  bulkRoomsBody,
  createBlockBody,
  createPropertyBody,
  createRoomBody,
  createRoomTypeBody,
  listBlocksQuery,
  listRoomTypesQuery,
  listRoomsQuery,
  updatePropertyBody,
  updateRoomBody,
  updateRoomTypeBody,
} from './schemas.js';

type In<T extends z.ZodType> = z.infer<T>;

// ───────────────────────────── properties ─────────────────────────────

const toProperty = (p: Prisma.PropertyGetPayload<object>): PropertyDto => ({
  id: p.id,
  name: p.name,
  address: p.address,
  city: p.city,
  country: p.country,
  phone: p.phone,
  email: p.email,
  taxId: p.taxId,
  rccm: p.rccm,
  currency: p.currency,
  timezone: p.timezone,
  checkinTime: p.checkinTime,
  checkoutTime: p.checkoutTime,
  businessDate: formatDay(p.businessDate),
});

export async function countProperties(ctx: Ctx): Promise<number> {
  return ctx.db.property.count({ where: { deletedAt: null } });
}

/** Properties reachable by the caller (all for the `*` permission, else `user_properties`). */
export async function listProperties(ctx: Ctx): Promise<{ items: PropertyDto[] }> {
  const all = ctx.grants.permissions.includes('*');
  const rows = await ctx.db.property.findMany({
    where: { deletedAt: null, ...(all ? {} : { id: { in: ctx.grants.propertyIds } }) },
    orderBy: { name: 'asc' },
  });
  return { items: rows.map(toProperty) };
}

export async function getProperty(ctx: Ctx, id: string): Promise<PropertyDto> {
  assertPropertyAccess(ctx, id);
  return toProperty(
    must(await ctx.db.property.findFirst({ where: { id, deletedAt: null } }), 'Property'),
  );
}

export async function createProperty(
  ctx: Ctx,
  input: In<typeof createPropertyBody>,
): Promise<PropertyDto> {
  const today = new Date().toISOString().slice(0, 10);
  const { businessDate, ...rest } = input;
  const row = await ctx.db.$transaction(async (tx) => {
    const p = await tx.property.create({
      data: { ...rest, tenantId: ctx.tenantId, businessDate: parseDay(businessDate ?? today) },
    });
    // The creator keeps access to the property he just created.
    await tx.userProperty.create({
      data: { tenantId: ctx.tenantId, userId: ctx.userId, propertyId: p.id },
    });
    return p;
  });
  return toProperty(row);
}

export async function updateProperty(
  ctx: Ctx,
  id: string,
  input: In<typeof updatePropertyBody>,
): Promise<PropertyDto> {
  assertPropertyAccess(ctx, id);
  must(
    await ctx.db.property.findFirst({ where: { id, deletedAt: null }, select: { id: true } }),
    'Property',
  );
  return toProperty(await ctx.db.property.update({ where: { id }, data: input }));
}

// ───────────────────────────── room types ─────────────────────────────

const toRoomType = (r: Prisma.RoomTypeGetPayload<object>): RoomTypeDto => ({
  id: r.id,
  propertyId: r.propertyId,
  code: r.code,
  name: r.name,
  description: r.description,
  nameI18n: (r.nameI18n ?? {}) as Record<string, string>,
  descriptionI18n: (r.descriptionI18n ?? null) as Record<string, string> | null,
  maxAdults: r.maxAdults,
  maxChildren: r.maxChildren,
  baseOccupancy: r.baseOccupancy,
  beds: r.beds,
  sizeM2: r.sizeM2,
  amenities: r.amenities,
  photos: r.photos,
  sort: r.sort,
  isActive: r.isActive,
});

async function requireProperty(ctx: Ctx, propertyId: string) {
  assertPropertyAccess(ctx, propertyId);
  return must(
    await ctx.db.property.findFirst({ where: { id: propertyId, deletedAt: null } }),
    'Property',
  );
}

export async function listRoomTypes(ctx: Ctx, q: In<typeof listRoomTypesQuery>) {
  assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.roomType.findMany({
    where: { propertyId: q.propertyId, deletedAt: null },
    orderBy: [{ sort: 'asc' }, { code: 'asc' }, { id: 'asc' }],
    ...pageArgs(q),
  });
  const page = toPage(rows, q.limit);
  return { items: page.items.map(toRoomType), nextCursor: page.nextCursor };
}

export async function loadRoomType(ctx: Ctx, id: string) {
  const row = must(
    await ctx.db.roomType.findFirst({ where: { id, deletedAt: null } }),
    'Room type',
  );
  assertPropertyAccess(ctx, row.propertyId);
  return row;
}

export async function getRoomType(ctx: Ctx, id: string) {
  return toRoomType(await loadRoomType(ctx, id));
}

/** Default locale of the tenant: the language of the plain `name` / `description` columns. */
async function defaultLocale(ctx: Ctx): Promise<string> {
  const t = await ctx.services.admin.tenant.findUnique({
    where: { id: ctx.tenantId },
    select: { defaultLocale: true },
  });
  return t?.defaultLocale ?? 'fr';
}

type I18n = Record<string, string>;

/**
 * Keeps `name` / `description` (default-locale fallback) and their translations in sync: an
 * explicit translation of the default locale wins, otherwise the plain column feeds it.
 */
function syncI18n(
  locale: string,
  cur: { name: string; description: string | null; nameI18n: I18n; descriptionI18n: I18n | null },
  input: {
    name?: string | undefined;
    description?: string | null | undefined;
    nameI18n?: I18n | undefined;
    descriptionI18n?: I18n | null | undefined;
  },
) {
  const nameI18n: I18n = { ...cur.nameI18n, ...(input.nameI18n ?? {}) };
  if (input.name !== undefined && input.nameI18n?.[locale] === undefined)
    nameI18n[locale] = input.name;
  const name = nameI18n[locale] ?? input.name ?? cur.name;
  nameI18n[locale] = name;
  let descriptionI18n: I18n | null =
    input.descriptionI18n === null
      ? null
      : { ...(cur.descriptionI18n ?? {}), ...(input.descriptionI18n ?? {}) };
  if (input.description !== undefined && input.descriptionI18n?.[locale] === undefined) {
    descriptionI18n ??= {};
    if (input.description === null) delete descriptionI18n[locale];
    else descriptionI18n[locale] = input.description;
  }
  const description =
    descriptionI18n?.[locale] ??
    (input.description !== undefined ? input.description : cur.description) ??
    null;
  if (descriptionI18n && !Object.keys(descriptionI18n).length) descriptionI18n = null;
  return { name, description, nameI18n, descriptionI18n };
}

const jsonOrNull = (v: I18n | null) => (v === null ? Prisma.DbNull : v);

export async function createRoomType(ctx: Ctx, input: In<typeof createRoomTypeBody>) {
  await requireProperty(ctx, input.propertyId);
  const i18n = syncI18n(
    await defaultLocale(ctx),
    { name: input.name, description: null, nameI18n: {}, descriptionI18n: null },
    input,
  );
  const row = await ctx.db.roomType.create({
    data: {
      ...input,
      ...i18n,
      descriptionI18n: jsonOrNull(i18n.descriptionI18n),
      tenantId: ctx.tenantId,
    },
  });
  return toRoomType(row);
}

export async function updateRoomType(ctx: Ctx, id: string, input: In<typeof updateRoomTypeBody>) {
  const cur = await loadRoomType(ctx, id);
  const adults = input.maxAdults ?? cur.maxAdults;
  if ((input.baseOccupancy ?? cur.baseOccupancy) > adults)
    throw invalid('baseOccupancy', 'Base occupancy cannot exceed max adults');
  const { nameI18n, descriptionI18n, ...columns } = input;
  const touchesText =
    input.name !== undefined ||
    input.description !== undefined ||
    nameI18n !== undefined ||
    descriptionI18n !== undefined;
  const i18n = touchesText ? syncI18n(await defaultLocale(ctx), toRoomType(cur), input) : null;
  return toRoomType(
    await ctx.db.roomType.update({
      where: { id },
      data: {
        ...columns,
        ...(i18n ? { ...i18n, descriptionI18n: jsonOrNull(i18n.descriptionI18n) } : {}),
      },
    }),
  );
}

export async function deleteRoomType(ctx: Ctx, id: string): Promise<void> {
  await loadRoomType(ctx, id);
  const rooms = await ctx.db.room.count({ where: { roomTypeId: id, deletedAt: null } });
  if (rooms > 0) throw conflict('Room type still has rooms', { rooms });
  await ctx.db.roomType.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
}

// Photos go through the tenant storage helper (key `t/{tenant}/room-types/{id}/{file}`).
let storageFactory: (ctx: Ctx) => Pick<TenantStorage, 'put' | 'signedUrl' | 'delete'> = (ctx) =>
  TenantStorage.fromConfig(ctx.services.config);
/** Test seam: replaces the S3-backed storage. */
export function setPhotoStorage(f: typeof storageFactory): void {
  storageFactory = f;
}

export const MAX_PHOTOS = 12;

export async function addRoomTypePhoto(
  ctx: Ctx,
  id: string,
  file: { buffer: Buffer; mimetype: string; originalname: string; size: number },
) {
  const rt = await loadRoomType(ctx, id);
  if (rt.photos.length >= MAX_PHOTOS) throw conflict(`At most ${MAX_PHOTOS} photos per room type`);
  const ext =
    file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
  const storage = storageFactory(ctx);
  const name = `${crypto.randomUUID()}.${ext}`;
  const { key, size } = await storage.put({
    key: `room-types/${id}/${name}`,
    body: file.buffer,
    contentType: file.mimetype,
  });
  const f = await ctx.db.file.create({
    data: {
      tenantId: ctx.tenantId,
      key,
      originalName: file.originalname.slice(0, 200),
      mime: file.mimetype,
      size: BigInt(size),
      createdBy: ctx.userId,
    },
  });
  await ctx.db.roomType.update({ where: { id }, data: { photos: { push: f.id } } });
  return { fileId: f.id, url: await storage.signedUrl(key) };
}

export async function listRoomTypePhotos(ctx: Ctx, id: string) {
  const rt = await loadRoomType(ctx, id);
  const files = await ctx.db.file.findMany({ where: { id: { in: rt.photos } } });
  const byId = new Map(files.map((f) => [f.id, f]));
  const storage = storageFactory(ctx);
  const items = [];
  for (const fid of rt.photos) {
    const f = byId.get(fid);
    if (f) items.push({ fileId: fid, url: await storage.signedUrl(f.key) });
  }
  return { items };
}

export async function removeRoomTypePhoto(ctx: Ctx, id: string, fileId: string): Promise<void> {
  const rt = await loadRoomType(ctx, id);
  if (!rt.photos.includes(fileId)) throw must(null, 'Photo');
  const f = await ctx.db.file.findUnique({ where: { id: fileId } });
  await ctx.db.roomType.update({
    where: { id },
    data: { photos: rt.photos.filter((p) => p !== fileId) },
  });
  if (f) {
    await storageFactory(ctx).delete(f.key);
    await ctx.db.file.delete({ where: { id: fileId } });
  }
}

// ───────────────────────────── rooms ─────────────────────────────

const toRoom = (r: Prisma.RoomGetPayload<object>): RoomDto => ({
  id: r.id,
  propertyId: r.propertyId,
  roomTypeId: r.roomTypeId,
  number: r.number,
  floor: r.floor,
  building: r.building,
  hkStatus: r.hkStatus,
  isActive: r.isActive,
  features: r.features,
  customFields: (r.customFields ?? {}) as Record<string, unknown>,
});

export async function countRooms(ctx: Ctx): Promise<number> {
  return ctx.db.room.count({ where: { deletedAt: null } });
}

async function requireRoomTypeIn(ctx: Ctx, roomTypeId: string, propertyId: string) {
  const rt = must(
    await ctx.db.roomType.findFirst({ where: { id: roomTypeId, deletedAt: null } }),
    'Room type',
  );
  if (rt.propertyId !== propertyId)
    throw invalid('roomTypeId', 'Room type belongs to another property');
  return rt;
}

export async function listRooms(ctx: Ctx, q: In<typeof listRoomsQuery>) {
  assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.room.findMany({
    where: {
      propertyId: q.propertyId,
      deletedAt: null,
      ...(q.roomTypeId ? { roomTypeId: q.roomTypeId } : {}),
      ...(q.includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ number: 'asc' }, { id: 'asc' }],
    ...pageArgs(q),
  });
  const page = toPage(rows, q.limit);
  return { items: page.items.map(toRoom), nextCursor: page.nextCursor };
}

export async function loadRoom(ctx: Ctx, id: string) {
  const row = must(await ctx.db.room.findFirst({ where: { id, deletedAt: null } }), 'Room');
  assertPropertyAccess(ctx, row.propertyId);
  return row;
}

export const getRoom = async (ctx: Ctx, id: string) => toRoom(await loadRoom(ctx, id));

export async function createRoom(ctx: Ctx, input: In<typeof createRoomBody>) {
  await requireProperty(ctx, input.propertyId);
  await requireRoomTypeIn(ctx, input.roomTypeId, input.propertyId);
  const customFields = await validateCustomFields(ctx.db, 'room', input.customFields);
  const exists = await ctx.db.room.findFirst({
    where: { propertyId: input.propertyId, number: input.number, deletedAt: null },
    select: { id: true },
  });
  if (exists) throw conflict(`Room ${input.number} already exists`, { number: input.number });
  const row = await ctx.db.room.create({
    data: { ...input, customFields: customFields as Prisma.InputJsonValue, tenantId: ctx.tenantId },
  });
  return toRoom(row);
}

export async function bulkCreateRooms(ctx: Ctx, input: In<typeof bulkRoomsBody>) {
  await requireProperty(ctx, input.propertyId);
  await requireRoomTypeIn(ctx, input.roomTypeId, input.propertyId);
  const numbers: string[] = [];
  for (let n = input.from; n <= input.to; n++) numbers.push(`${input.prefix}${n}`);
  const existing = await ctx.db.room.findMany({
    where: { propertyId: input.propertyId, number: { in: numbers }, deletedAt: null },
    select: { number: true },
  });
  if (existing.length)
    throw conflict('Some room numbers already exist', { numbers: existing.map((e) => e.number) });
  const rows = await ctx.db.$transaction(async (tx) => {
    const out = [];
    for (const number of numbers)
      out.push(
        await tx.room.create({
          data: {
            tenantId: ctx.tenantId,
            propertyId: input.propertyId,
            roomTypeId: input.roomTypeId,
            number,
            floor: input.floor ?? null,
            building: input.building ?? null,
            features: input.features,
          },
        }),
      );
    return out;
  });
  return { created: rows.length, items: rows.map(toRoom) };
}

export async function updateRoom(ctx: Ctx, id: string, input: In<typeof updateRoomBody>) {
  const cur = await loadRoom(ctx, id);
  const { customFields, ...rest } = input;
  if (input.roomTypeId) await requireRoomTypeIn(ctx, input.roomTypeId, cur.propertyId);
  if (input.number && input.number !== cur.number) {
    const dup = await ctx.db.room.findFirst({
      where: { propertyId: cur.propertyId, number: input.number, deletedAt: null },
      select: { id: true },
    });
    if (dup) throw conflict(`Room ${input.number} already exists`, { number: input.number });
  }
  const data: Prisma.RoomUncheckedUpdateInput = { ...rest };
  if (customFields !== undefined) {
    const merged = { ...((cur.customFields ?? {}) as Record<string, unknown>), ...customFields };
    data.customFields = (await validateCustomFields(
      ctx.db,
      'room',
      merged,
    )) as Prisma.InputJsonValue;
  }
  return toRoom(await ctx.db.room.update({ where: { id }, data }));
}

export async function deleteRoom(ctx: Ctx, id: string): Promise<void> {
  await loadRoom(ctx, id);
  // Soft delete: the partial unique index (deleted_at IS NULL) frees the number for reuse.
  await ctx.db.room.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
}

// ───────────────────────────── room blocks ─────────────────────────────

const toBlock = (b: Prisma.RoomBlockGetPayload<object>): BlockDto => ({
  id: b.id,
  roomId: b.roomId,
  fromDate: formatDay(b.fromDate),
  toDate: formatDay(b.toDate),
  reason: b.reason,
  note: b.note,
});

export async function listBlocks(ctx: Ctx, q: In<typeof listBlocksQuery>) {
  assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.roomBlock.findMany({
    where: {
      room: { propertyId: q.propertyId },
      ...(q.roomId ? { roomId: q.roomId } : {}),
      ...(q.from ? { toDate: { gt: parseDay(q.from) } } : {}),
      ...(q.to ? { fromDate: { lt: parseDay(q.to) } } : {}),
    },
    orderBy: [{ fromDate: 'asc' }, { id: 'asc' }],
    take: 500,
  });
  return { items: rows.map(toBlock) };
}

export async function createBlock(ctx: Ctx, input: In<typeof createBlockBody>) {
  await loadRoom(ctx, input.roomId);
  const from = parseDay(input.fromDate);
  const to = parseDay(input.toDate);
  const overlap = await ctx.db.roomBlock.findFirst({
    where: { roomId: input.roomId, fromDate: { lt: to }, toDate: { gt: from } },
    select: { id: true },
  });
  if (overlap) throw conflict('The room already has a block on these nights');
  const row = await ctx.db.roomBlock.create({
    data: {
      tenantId: ctx.tenantId,
      roomId: input.roomId,
      fromDate: from,
      toDate: to,
      reason: input.reason,
      note: input.note ?? null,
      createdBy: ctx.userId,
    },
  });
  return toBlock(row);
}

export async function deleteBlock(ctx: Ctx, id: string): Promise<void> {
  const b = must(await ctx.db.roomBlock.findUnique({ where: { id } }), 'Room block');
  await loadRoom(ctx, b.roomId);
  await ctx.db.roomBlock.delete({ where: { id } });
}
