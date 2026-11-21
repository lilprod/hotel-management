import { z } from 'zod';
import { guestRef } from '../reservations/schemas.js';
import { dayString, idParams, uuid } from '../property/common.js';

export { idParams };

export const WAITLIST_STATUSES = [
  'WAITING',
  'OFFERED',
  'ACCEPTED',
  'EXPIRED',
  'CANCELLED',
] as const;

export const createEntryBody = z
  .object({
    propertyId: uuid,
    guest: guestRef,
    /** Any room type fitting the occupancy when omitted. */
    roomTypeId: uuid.optional(),
    arrival: dayString,
    departure: dayString,
    adults: z.number().int().min(1).max(20),
    children: z.number().int().min(0).max(20).default(0),
    priority: z.number().int().min(0).max(100).default(0),
    notes: z.string().max(2000).optional(),
  })
  .superRefine((v, c) => {
    if (v.departure <= v.arrival)
      c.addIssue({
        code: 'custom',
        path: ['departure'],
        message: 'Departure must be after arrival',
      });
  });

export const listEntriesQuery = z.object({
  propertyId: uuid,
  status: z.enum(WAITLIST_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const acceptBody = z.object({
  ratePlanId: uuid,
  /** Defaults to the room type of the offer. */
  roomTypeId: uuid.optional(),
  status: z.enum(['PENDING', 'CONFIRMED']).default('CONFIRMED'),
  notifyGuest: z.boolean().default(true),
});

export const entrySchema = z.object({
  id: uuid,
  propertyId: uuid,
  guestId: uuid,
  guestName: z.string(),
  roomTypeId: uuid.nullable(),
  arrival: z.string(),
  departure: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  status: z.enum(WAITLIST_STATUSES),
  priority: z.number().int(),
  offeredAt: z.string().nullable(),
  offerExpiresAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type EntryDto = z.infer<typeof entrySchema>;
