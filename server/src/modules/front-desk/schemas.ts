import { z } from 'zod';
import { guestInput } from '../guests/schemas.js';
import { dayString, idParams, pageOf, uuid } from '../property/common.js';
import { guestRef } from '../reservations/schemas.js';

export { idParams };

const nullableStr = z.string().nullable();

const text = (max: number) => z.string().trim().max(max);
const opt = (max: number) => text(max).nullish();

// ───────────────────────────── identity / police form ─────────────────────────────

/**
 * Identity + police-form fields of one guest (doc 09 §4). Every field is optional in the body: a
 * missing field is prefilled from the guest profile, then the mandatory ones are checked.
 */
export const policeGuestInput = z.object({
  /** Existing profile; omitted: the primary guest of the room line (first entry) or a new guest. */
  guestId: uuid.optional(),
  firstName: text(100).min(1).optional(),
  lastName: text(100).min(1).optional(),
  birthDate: dayString.nullish(),
  birthPlace: opt(120),
  nationality: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullish(),
  profession: opt(120),
  address: opt(300),
  idDocType: opt(40),
  /** Encrypted at rest (guest profile and police snapshot). */
  idDocNumber: z.string().trim().min(2).max(60).nullish(),
  idIssuedOn: dayString.nullish(),
  idIssuedPlace: opt(120),
  /** Update the guest profile with the values entered here (default). */
  updateProfile: z.boolean().default(true),
});
export type PoliceGuestInput = z.infer<typeof policeGuestInput>;

export const policeStayInput = z.object({
  provenance: opt(200),
  destination: opt(200),
  purpose: opt(200),
  customFields: z.record(z.string(), z.unknown()).optional(),
});

export const depositInput = z.object({
  method: z.enum(['CASH', 'CARD', 'MIXX', 'MOOV_MONEY', 'BANK_TRANSFER']),
  amount: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  reference: text(80).optional(),
});

const checkInCommon = {
  guests: z.array(policeGuestInput).min(1).max(10),
  police: policeStayInput.default({}),
  /** File uploaded with `POST /front-desk/files` (handwritten signature image). */
  signatureFileId: uuid.optional(),
  /** ID scan uploaded with `POST /front-desk/files`; linked to the primary guest profile. */
  idScanFileId: uuid.optional(),
  /** Deposit taken at check-in through the folio API (needs `folio.pay`). */
  deposit: depositInput.optional(),
  /** Check in a dirty room (needs `front_desk.override_dirty`). */
  overrideDirty: z.boolean().default(false),
  notifyGuest: z.boolean().default(true),
};

export const checkInBody = z.object({
  reservationRoomId: uuid,
  /** Assign (or change) the unit in the same call, availability checked. */
  roomId: uuid.optional(),
  changeRoomType: z.boolean().default(false),
  ...checkInCommon,
});
export type CheckInInput = z.infer<typeof checkInBody>;

export const walkInBody = z.object({
  propertyId: uuid,
  departure: dayString,
  roomTypeId: uuid,
  ratePlanId: uuid,
  /** Omitted: the first clean free unit of the room type is chosen. */
  roomId: uuid.optional(),
  adults: z.number().int().min(1).max(20),
  children: z.number().int().min(0).max(20).default(0),
  guest: guestRef,
  companyId: uuid.optional(),
  source: text(60).optional(),
  segment: text(60).optional(),
  notes: text(4000).optional(),
  ...checkInCommon,
});
export type WalkInInput = z.infer<typeof walkInBody>;

// ───────────────────────────── in-stay operations ─────────────────────────────

export const roomChangeBody = z.object({
  roomId: uuid,
  reason: text(300).min(3),
  /** The new unit belongs to another room type (prices of the remaining nights are kept). */
  changeRoomType: z.boolean().default(false),
  overrideDirty: z.boolean().default(false),
});
export const departureBody = z.object({ departure: dayString });
export const earlyDepartureBody = z.object({ departure: dayString.optional() });

const invoiceCustomer = z.discriminatedUnion('type', [
  z.object({ type: z.literal('guest'), guestId: uuid }),
  z.object({ type: z.literal('company'), companyId: uuid }),
]);

export const checkoutBody = z.object({
  /** Transfers the unpaid balance of every folio to this company account (NIF required). */
  transferToCompanyId: uuid.optional(),
  /** Needs `front_desk.checkout_with_balance`; recorded in the audit trail. */
  overrideReason: text(300).min(3).optional(),
  /** The stay ends before its planned departure: remaining nights are released. */
  earlyDeparture: z.boolean().default(false),
  invoice: z
    .object({
      issue: z.boolean().default(true),
      customer: invoiceCustomer.optional(),
      sendEmail: z.boolean().default(false),
    })
    .optional(),
  notifyGuest: z.boolean().default(true),
});
export type CheckoutInput = z.infer<typeof checkoutBody>;

// ───────────────────────────── queries ─────────────────────────────

export const dayQuery = z.object({
  propertyId: uuid,
  /** Defaults to the business date of the property. */
  date: dayString.optional(),
  search: z.string().trim().min(1).max(100).optional(),
});

export const availableRoomsQuery = z.object({
  propertyId: uuid,
  from: dayString,
  to: dayString,
  roomTypeId: uuid.optional(),
  /** Reservation room being checked in (its own nights do not count as occupied). */
  reservationRoomId: uuid.optional(),
});

export const companySearchQuery = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const companyOptionSchema = z.object({
  id: uuid,
  name: z.string(),
  taxId: nullableStr,
  creditLimit: z.number().int().nullable(),
});

export const policeListQuery = z.object({
  propertyId: uuid,
  from: dayString,
  to: dayString,
  search: z.string().trim().min(2).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: uuid.optional(),
});

export const policeExportQuery = z.object({
  propertyId: uuid,
  from: dayString,
  to: dayString,
  search: z.string().trim().min(2).max(100).optional(),
  format: z.enum(['csv', 'pdf']).default('csv'),
});

// ───────────────────────────── responses ─────────────────────────────


export const dayRowSchema = z.object({
  reservationId: uuid,
  reservationRoomId: uuid,
  stayId: uuid.nullable(),
  number: z.string(),
  status: z.string(),
  guest: z.object({ id: uuid.nullable(), name: z.string(), phone: nullableStr, email: nullableStr }),
  companyName: nullableStr,
  roomTypeId: uuid,
  roomTypeName: z.string(),
  roomId: uuid.nullable(),
  roomNumber: nullableStr,
  hkStatus: nullableStr,
  arrival: z.string(),
  departure: z.string(),
  adults: z.number().int(),
  children: z.number().int(),
  /** Arrival before the business date (late arrival / no-show candidate) or departure overdue. */
  late: z.boolean(),
  balance: z.number().int().nullable(),
  currency: z.string(),
});
export type DayRow = z.infer<typeof dayRowSchema>;
export const dayListSchema = z.object({
  businessDate: z.string(),
  date: z.string(),
  items: z.array(dayRowSchema),
});

export const summarySchema = z.object({
  businessDate: z.string(),
  date: z.string(),
  arrivals: z.number().int(),
  departures: z.number().int(),
  inHouse: z.number().int(),
  noShows: z.number().int(),
  availableCleanRooms: z.number().int(),
});

export const availableRoomSchema = z.object({
  id: uuid,
  number: z.string(),
  roomTypeId: uuid,
  roomTypeName: z.string(),
  floor: nullableStr,
  hkStatus: z.string(),
  clean: z.boolean(),
});

export const stayResultSchema = z.object({
  stayId: uuid,
  reservationRoomId: uuid,
  reservationId: uuid,
  roomId: uuid,
  roomNumber: z.string(),
  policeRecordIds: z.array(uuid),
  deposit: z
    .object({
      ok: z.boolean(),
      paymentId: uuid.nullable(),
      error: nullableStr,
    })
    .nullable(),
  notified: z.boolean(),
  warnings: z.array(z.string()),
});

export const policeRecordSchema = z.object({
  id: uuid,
  stayId: uuid,
  guestId: uuid,
  checkedInAt: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  birthDate: nullableStr,
  birthPlace: nullableStr,
  nationality: nullableStr,
  profession: nullableStr,
  address: nullableStr,
  idDocType: nullableStr,
  idDocNumber: nullableStr,
  idIssuedOn: nullableStr,
  idIssuedPlace: nullableStr,
  provenance: nullableStr,
  destination: nullableStr,
  purpose: nullableStr,
  arrival: z.string(),
  departure: z.string(),
  roomNumber: nullableStr,
  reservationNumber: nullableStr,
  hasSignature: z.boolean(),
  masked: z.boolean(),
  customFields: z.record(z.string(), z.unknown()),
});
export type PoliceRecordDto = z.infer<typeof policeRecordSchema>;
export const policePage = z.object({
  items: z.array(policeRecordSchema),
  nextCursor: uuid.nullable(),
  masked: z.boolean(),
});

export const fileResultSchema = z.object({ fileId: uuid, size: z.number().int() });
export { pageOf, guestInput };
