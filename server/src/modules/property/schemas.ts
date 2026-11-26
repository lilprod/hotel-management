import { z } from 'zod';
import { dayString, idParams, pageOf, pageQuery, uuid } from './common.js';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
const country = z.string().regex(/^[A-Z]{2}$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const optText = (max: number) => z.string().trim().max(max).nullish();
/** Translations {locale: text} (locale = ISO 639-1, e.g. "fr", "en"). */
const i18nText = (max: number) =>
  z.record(z.string().regex(/^[a-z]{2}$/), z.string().trim().min(1).max(max));

export { idParams };

// ───────────────────────────── properties ─────────────────────────────

export const propertyBase = z.object({
  name: z.string().trim().min(1).max(160),
  address: optText(300),
  city: optText(120),
  country,
  phone: optText(40),
  email: z.string().email().max(200).nullish(),
  taxId: optText(60),
  rccm: optText(60),
  currency: currency.default('XOF'),
  timezone: z.string().trim().min(1).max(64),
  checkinTime: hhmm.default('14:00'),
  checkoutTime: hhmm.default('12:00'),
});
export const createPropertyBody = propertyBase.extend({ businessDate: dayString.optional() });
export const updatePropertyBody = propertyBase.omit({ currency: true }).partial().strict();

export const propertySchema = z.object({
  id: uuid,
  name: z.string(),
  address: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  taxId: z.string().nullable(),
  rccm: z.string().nullable(),
  currency: z.string(),
  timezone: z.string(),
  checkinTime: z.string(),
  checkoutTime: z.string(),
  businessDate: z.string(),
});
export type PropertyDto = z.infer<typeof propertySchema>;

// ───────────────────────────── room types ─────────────────────────────

export const roomTypeBase = z.object({
  propertyId: uuid,
  code: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/),
  name: z.string().trim().min(1).max(120),
  description: optText(2000),
  /** Translations of the name; `name` is the label in the tenant default locale. */
  nameI18n: i18nText(120).optional(),
  descriptionI18n: i18nText(2000).nullish(),
  maxAdults: z.number().int().min(1).max(20),
  maxChildren: z.number().int().min(0).max(20).default(0),
  baseOccupancy: z.number().int().min(1).max(20),
  beds: optText(120),
  sizeM2: z.number().int().min(1).max(10_000).nullish(),
  amenities: z.array(z.string().trim().min(1).max(60)).max(60).default([]),
  sort: z.number().int().min(0).max(10_000).default(0),
  isActive: z.boolean().default(true),
});
export const createRoomTypeBody = roomTypeBase.refine((v) => v.baseOccupancy <= v.maxAdults, {
  path: ['baseOccupancy'],
  message: 'Base occupancy cannot exceed max adults',
});
export const updateRoomTypeBody = roomTypeBase
  .omit({ propertyId: true, code: true })
  .partial()
  .strict();

export const roomTypeSchema = z.object({
  id: uuid,
  propertyId: uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  nameI18n: z.record(z.string(), z.string()),
  descriptionI18n: z.record(z.string(), z.string()).nullable(),
  maxAdults: z.number().int(),
  maxChildren: z.number().int(),
  baseOccupancy: z.number().int(),
  beds: z.string().nullable(),
  sizeM2: z.number().int().nullable(),
  amenities: z.array(z.string()),
  photos: z.array(uuid),
  sort: z.number().int(),
  isActive: z.boolean(),
});
export type RoomTypeDto = z.infer<typeof roomTypeSchema>;

export const listRoomTypesQuery = pageQuery.extend({ propertyId: uuid });
export const roomTypePage = pageOf(roomTypeSchema);
export const photoParams = z.object({ id: uuid, fileId: uuid });
export const photoUrlSchema = z.object({ fileId: uuid, url: z.string() });

// ───────────────────────────── rooms ─────────────────────────────

export const roomBase = z.object({
  roomTypeId: uuid,
  number: z.string().trim().min(1).max(20),
  floor: optText(20),
  building: optText(60),
  features: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  customFields: z.record(z.string(), z.unknown()).default({}),
});
export const createRoomBody = roomBase.extend({ propertyId: uuid });
export const updateRoomBody = roomBase
  .omit({ number: true })
  .partial()
  .extend({ isActive: z.boolean().optional(), number: z.string().trim().min(1).max(20).optional() })
  .strict();

export const MAX_BULK_ROOMS = 500;
/** Bulk creation of numbered rooms, e.g. prefix "" from 101 to 130, or prefix "A-" 1…20. */
export const bulkRoomsBody = z
  .object({
    propertyId: uuid,
    roomTypeId: uuid,
    prefix: z.string().trim().max(10).default(''),
    from: z.number().int().min(0).max(99_999),
    to: z.number().int().min(0).max(99_999),
    floor: optText(20),
    building: optText(60),
    features: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  })
  .refine((v) => v.to >= v.from, { path: ['to'], message: 'to must be >= from' })
  .refine((v) => v.to - v.from + 1 <= MAX_BULK_ROOMS, {
    path: ['to'],
    message: `At most ${MAX_BULK_ROOMS} rooms at once`,
  });

export const roomSchema = z.object({
  id: uuid,
  propertyId: uuid,
  roomTypeId: uuid,
  number: z.string(),
  floor: z.string().nullable(),
  building: z.string().nullable(),
  hkStatus: z.string(),
  isActive: z.boolean(),
  features: z.array(z.string()),
  customFields: z.record(z.string(), z.unknown()),
});
export type RoomDto = z.infer<typeof roomSchema>;

export const listRoomsQuery = pageQuery.extend({
  propertyId: uuid,
  roomTypeId: uuid.optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
export const roomPage = pageOf(roomSchema);
export const bulkResultSchema = z.object({ created: z.number().int(), items: z.array(roomSchema) });

// ───────────────────────────── room blocks ─────────────────────────────

export const createBlockBody = z
  .object({
    roomId: uuid,
    /** First blocked night (included). */
    fromDate: dayString,
    /** Departure-style end: last blocked night + 1 (excluded). */
    toDate: dayString,
    reason: z.enum(['MAINTENANCE', 'OUT_OF_SERVICE']),
    note: optText(500),
  })
  .refine((v) => v.toDate > v.fromDate, {
    path: ['toDate'],
    message: 'toDate must be after fromDate',
  });

export const blockSchema = z.object({
  id: uuid,
  roomId: uuid,
  fromDate: z.string(),
  toDate: z.string(),
  reason: z.string(),
  note: z.string().nullable(),
});
export type BlockDto = z.infer<typeof blockSchema>;

export const listBlocksQuery = z.object({
  propertyId: uuid,
  roomId: uuid.optional(),
  from: dayString.optional(),
  to: dayString.optional(),
});
