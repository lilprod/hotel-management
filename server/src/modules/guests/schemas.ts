import { z } from 'zod';
import { dayString, idParams, pageOf, uuid } from '../property/common.js';

export { idParams };

const name = z.string().trim().min(1).max(100);
const opt = (max: number) => z.string().trim().max(max).nullish();

export const guestInput = z.object({
  firstName: name,
  lastName: name,
  gender: z.enum(['M', 'F', 'X']).nullish(),
  birthDate: dayString.nullish(),
  birthPlace: opt(120),
  nationality: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullish(),
  profession: opt(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9 ()-]{5,19}$/, 'Invalid phone number')
    .nullish(),
  email: z.string().trim().toLowerCase().email().max(254).nullish(),
  address: opt(300),
  idDocType: opt(40),
  /** Stored encrypted; responses only show the last 4 characters. */
  idDocNumber: z.string().trim().min(2).max(60).nullish(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  notes: opt(2000),
  customFields: z.record(z.string(), z.unknown()).optional(),
});
export type GuestInput = z.infer<typeof guestInput>;

export const createGuestBody = guestInput;
export const updateGuestBody = guestInput
  .partial()
  .extend({ isBlacklisted: z.boolean().optional() })
  .strict();

export const listGuestsQuery = z.object({
  search: z.string().trim().min(2).max(100).optional(),
  blacklisted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: uuid.optional(),
});

export const guestSchema = z.object({
  id: uuid,
  firstName: z.string(),
  lastName: z.string(),
  gender: z.string().nullable(),
  birthDate: z.string().nullable(),
  birthPlace: z.string().nullable(),
  nationality: z.string().nullable(),
  profession: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  idDocType: z.string().nullable(),
  idDocNumberMasked: z.string().nullable(),
  tags: z.array(z.string()),
  isBlacklisted: z.boolean(),
  notes: z.string().nullable(),
  customFields: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type GuestDto = z.infer<typeof guestSchema>;
export const guestPage = pageOf(guestSchema);
