import { z } from 'zod';
import { guestInput } from '../guests/schemas.js';
import { dayString, idParams, pageOf, uuid } from '../property/common.js';
import { RESERVATION_STATUSES } from './lifecycle.js';

export { idParams };

const lookupCode = z.string().trim().min(1).max(60);
const occupancy = {
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20).default(0),
};

/** Booker: an existing guest (`{ id }`) or a new profile created with the reservation. */
export const guestRef = z.union([z.object({ id: uuid }).strict(), guestInput]);

export const roomLineInput = z.object({
  roomTypeId: uuid,
  ratePlanId: uuid,
  /** Optional at creation; mandatory at check-in. */
  roomId: uuid.nullish(),
  /** Defaults to the dossier dates. */
  arrival: dayString.optional(),
  departure: dayString.optional(),
  ...occupancy,
  /** Additional guests of the room (the booker is the primary guest by default). */
  guestIds: z.array(uuid).max(10).optional(),
});

const datesRefine = <T extends { arrival?: string | undefined; departure?: string | undefined }>(
  v: T,
  c: z.core.$RefinementCtx,
) => {
  if (v.arrival && v.departure && v.departure <= v.arrival)
    c.addIssue({ code: 'custom', path: ['departure'], message: 'Departure must be after arrival' });
};

export const createReservationBody = z
  .object({
    propertyId: uuid,
    arrival: dayString,
    departure: dayString,
    guest: guestRef,
    companyId: uuid.optional(),
    rooms: z.array(roomLineInput.superRefine(datesRefine)).min(1).max(50),
    status: z.enum(['PENDING', 'CONFIRMED']).default('CONFIRMED'),
    /** PENDING only: option expiry (default: now + `reservations.option_hours`). */
    optionExpiresAt: z.string().datetime({ offset: true }).optional(),
    channel: z.enum(['FRONT_DESK', 'PORTAL', 'PHONE', 'AGENCY']).default('FRONT_DESK'),
    source: lookupCode.optional(),
    segment: lookupCode.optional(),
    notes: z.string().max(4000).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    notifyGuest: z.boolean().default(true),
    /** When nothing is available: create a waitlist entry (returned in the 409 problem). */
    joinWaitlistIfUnavailable: z.boolean().default(false),
  })
  .superRefine(datesRefine);
export type CreateReservationInput = z.infer<typeof createReservationBody>;

export const updateRoomLine = z
  .object({
    /** Existing reservation room; omitted = a room added to the dossier. */
    id: uuid.optional(),
    remove: z.boolean().optional(),
    roomTypeId: uuid.optional(),
    ratePlanId: uuid.optional(),
    roomId: uuid.nullish(),
    arrival: dayString.optional(),
    departure: dayString.optional(),
    adults: z.number().int().min(1).max(20).optional(),
    children: z.number().int().min(0).max(20).optional(),
    guestIds: z.array(uuid).max(10).optional(),
  })
  .superRefine(datesRefine);

export const updateReservationBody = z
  .object({
    /** Shifts every room of the dossier to these dates. */
    arrival: dayString.optional(),
    departure: dayString.optional(),
    rooms: z.array(updateRoomLine).max(50).optional(),
    /** Re-price every changed room from the rate grid (default: keep the prices of kept nights). */
    requote: z.boolean().default(false),
    source: lookupCode.nullish(),
    segment: lookupCode.nullish(),
    companyId: uuid.nullish(),
    notes: z.string().max(4000).nullish(),
    optionExpiresAt: z.string().datetime({ offset: true }).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine(datesRefine);
export type UpdateReservationInput = z.infer<typeof updateReservationBody>;

export const roomParams = z.object({ id: uuid, roomLineId: uuid });
export const assignBody = z.object({
  roomId: uuid,
  /** Allows a unit of another room type (the line's room type follows, prices are kept). */
  changeRoomType: z.boolean().default(false),
});
export const moveBody = z
  .object({
    roomId: uuid.nullish(),
    /** With `roomId: null`: stay unassigned but on this room type (needs `changeRoomType`, re-quoted). */
    roomTypeId: uuid.optional(),
    arrival: dayString.optional(),
    departure: dayString.optional(),
    changeRoomType: z.boolean().default(false),
    requote: z.boolean().default(false),
  })
  .superRefine(datesRefine);
export const movePreview = z.object({
  currency: z.string(),
  currentTotal: z.number().int(),
  newTotal: z.number().int(),
  delta: z.number().int(),
});
export const datesBody = z.object({ departure: dayString });
export const cancelBody = z.object({
  reasonCode: lookupCode,
  note: z.string().max(1000).optional(),
  /** Waive the computed penalty (still stored, with the waiver). */
  waivePenalty: z.boolean().default(false),
});
export const penaltyPreviewQuery = z.object({
  kind: z.enum(['CANCELLATION', 'NO_SHOW']).default('CANCELLATION'),
});
export const noShowBody = z.object({ waivePenalty: z.boolean().default(false) });
export const confirmBody = z.object({ notifyGuest: z.boolean().default(true) });

const csvStatuses = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim().toUpperCase()))
  .pipe(z.array(z.enum(RESERVATION_STATUSES)).min(1));

export const listReservationsQuery = z.object({
  propertyId: uuid,
  /** Stays overlapping [from, to). */
  from: dayString.optional(),
  to: dayString.optional(),
  arrivalFrom: dayString.optional(),
  arrivalTo: dayString.optional(),
  status: csvStatuses.optional(),
  guestId: uuid.optional(),
  groupId: uuid.optional(),
  source: lookupCode.optional(),
  /** Number, booker name, phone or e-mail. */
  search: z.string().trim().min(2).max(100).optional(),
  includeAllotments: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: uuid.optional(),
});

// ───────────────────────────── responses ─────────────────────────────

const nightPrice = z.object({
  date: z.string(),
  rateId: z.string().nullable(),
  seasonId: z.string().nullable(),
  base: z.number().int(),
  extraAdultAmount: z.number().int(),
  extraChildAmount: z.number().int(),
  total: z.number().int(),
});

export const reservationRoomSchema = z.object({
  id: uuid,
  roomTypeId: uuid,
  roomId: uuid.nullable(),
  roomNumber: z.string().nullable(),
  ratePlanId: uuid,
  arrival: z.string(),
  departure: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  status: z.enum(RESERVATION_STATUSES),
  currency: z.string(),
  dailyPrices: z.array(nightPrice),
  total: z.number().int(),
  guests: z.array(z.object({ guestId: uuid, isPrimary: z.boolean() })),
});

export const penaltySchema = z.object({
  kind: z.enum(['CANCELLATION', 'NO_SHOW']),
  amount: z.number().int(),
  computedAmount: z.number().int(),
  waived: z.boolean(),
  currency: z.string(),
  businessDate: z.string(),
  lines: z.array(
    z.object({
      reservationRoomId: uuid,
      policyId: z.string().nullable(),
      percent: z.number().int(),
      amount: z.number().int(),
      daysBefore: z.number().int(),
      tier: z.number().int().nullable(),
    }),
  ),
});
export type PenaltyDto = z.infer<typeof penaltySchema>;

export const reservationSchema = z.object({
  id: uuid,
  propertyId: uuid,
  number: z.string(),
  status: z.enum(RESERVATION_STATUSES),
  channel: z.string(),
  source: z.string().nullable(),
  segment: z.string().nullable(),
  arrival: z.string(),
  departure: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  notes: z.string().nullable(),
  optionExpiresAt: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  groupId: uuid.nullable(),
  companyId: uuid.nullable(),
  isAllotment: z.boolean(),
  booker: z
    .object({
      id: uuid,
      firstName: z.string(),
      lastName: z.string(),
      phone: z.string().nullable(),
      email: z.string().nullable(),
      isBlacklisted: z.boolean(),
    })
    .nullable(),
  currency: z.string(),
  roomTotal: z.number().int(),
  penalty: penaltySchema.nullable(),
  customFields: z.record(z.string(), z.unknown()),
  rooms: z.array(reservationRoomSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ReservationDto = z.infer<typeof reservationSchema>;

export const warningSchema = z.object({
  code: z.string(),
  message: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Warning = z.infer<typeof warningSchema>;

export const reservationResult = z.object({
  reservation: reservationSchema,
  warnings: z.array(warningSchema),
  quotes: z
    .array(z.object({ reservationRoomId: uuid, total: z.number().int(), taxes: z.number().int() }))
    .optional(),
});

export const cancelResult = z.object({ reservation: reservationSchema, penalty: penaltySchema });
export const reservationPage = pageOf(reservationSchema);
