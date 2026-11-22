import { z } from 'zod';
import { dayString, uuid } from '../property/common.js';

const range = <T extends { from: string; to: string }>(
  v: T,
  c: z.core.$RefinementCtx,
  max: number,
) => {
  if (v.to <= v.from)
    c.addIssue({ code: 'custom', path: ['to'], message: '`to` must be after `from`' });
  const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
  if (days > max) c.addIssue({ code: 'custom', path: ['to'], message: `At most ${max} days` });
};

export const availabilityQuery = z
  .object({
    propertyId: uuid,
    arrival: dayString,
    departure: dayString,
    adults: z.coerce.number().int().min(1).max(20).default(1),
    children: z.coerce.number().int().min(0).max(20).default(0),
    roomTypeId: uuid.optional(),
    /** Units wanted per room type (sellable when every night has at least this many). */
    rooms: z.coerce.number().int().min(1).max(50).default(1),
  })
  .superRefine((v, c) => range({ from: v.arrival, to: v.departure }, c, 366));

const night = z.object({ date: z.string(), free: z.number().int() });

export const availabilitySchema = z.object({
  propertyId: uuid,
  arrival: z.string(),
  departure: z.string(),
  nights: z.number().int(),
  roomTypes: z.array(
    z.object({
      roomTypeId: uuid,
      code: z.string(),
      name: z.string(),
      maxAdults: z.number().int(),
      maxChildren: z.number().int(),
      totalUnits: z.number().int(),
      fitsOccupancy: z.boolean(),
      freeByNight: z.array(night),
      minFree: z.number().int(),
      sellable: z.boolean(),
      ratePlans: z.array(
        z.object({
          ratePlanId: uuid,
          code: z.string(),
          name: z.string(),
          mealPlan: z.string(),
          isPublic: z.boolean(),
          available: z.boolean(),
          reason: z.string().nullable(),
          message: z.string().nullable(),
          quote: z.record(z.string(), z.unknown()).nullable(),
        }),
      ),
    }),
  ),
});

export const planningQuery = z
  .object({ propertyId: uuid, from: dayString, to: dayString })
  .superRefine((v, c) => range(v, c, 92));

export const planningSchema = z.object({
  propertyId: uuid,
  from: z.string(),
  to: z.string(),
  businessDate: z.string(),
  roomTypes: z.array(
    z.object({
      id: uuid,
      code: z.string(),
      name: z.string(),
      rooms: z.array(
        z.object({
          id: uuid,
          number: z.string(),
          floor: z.string().nullable(),
          building: z.string().nullable(),
          hkStatus: z.string(),
        }),
      ),
      freeByNight: z.array(night),
    }),
  ),
  segments: z.array(
    z.object({
      id: uuid,
      reservationId: uuid,
      number: z.string(),
      roomId: uuid.nullable(),
      roomTypeId: uuid,
      guestName: z.string(),
      status: z.string(),
      arrival: z.string(),
      departure: z.string(),
      adults: z.number().int(),
      children: z.number().int(),
      groupId: uuid.nullable(),
      kind: z.enum(['reservation', 'group', 'allotment']),
      colorKey: z.string(),
    }),
  ),
  blocks: z.array(
    z.object({
      id: uuid,
      roomId: uuid,
      fromDate: z.string(),
      toDate: z.string(),
      reason: z.string(),
      note: z.string().nullable(),
    }),
  ),
});
