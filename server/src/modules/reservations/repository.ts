import type { Prisma, TransactionClient } from '@hm/database';
import { formatDay, must } from '../property/common.js';
import { parseNightPrices, sumNights } from '../availability/pricing.js';
import type { PenaltyDto, ReservationDto } from './schemas.js';

/**
 * Engine data with no dedicated column (schema gap, reported): stored under the reserved
 * `_sys` key of `reservations.custom_fields`, never validated as a custom field nor exposed in
 * `customFields`.
 */
export interface SysData {
  penalty?: PenaltyDto;
  /** Group allotment holder (rooms held for a group until `releaseDate`). */
  allotment?: { releaseDate: string };
  /** Waitlist entry converted into this reservation. */
  waitlistEntryId?: string;
}

export const SYS_KEY = '_sys';

export function splitCustomFields(json: unknown): { user: Record<string, unknown>; sys: SysData } {
  const all = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const { [SYS_KEY]: sys, ...user } = all;
  return { user, sys: (sys && typeof sys === 'object' ? sys : {}) as SysData };
}

export function joinCustomFields(
  user: Record<string, unknown>,
  sys: SysData,
): Prisma.InputJsonValue {
  const out: Record<string, unknown> = { ...user };
  if (Object.keys(sys).length) out[SYS_KEY] = sys;
  return out as Prisma.InputJsonValue;
}

export const reservationInclude = {
  bookerGuest: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      isBlacklisted: true,
    },
  },
  reservationRooms: {
    orderBy: [{ arrival: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: {
      room: { select: { number: true } },
      reservationGuests: {
        select: { guestId: true, isPrimary: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  },
} satisfies Prisma.ReservationInclude;

export type ReservationRow = Prisma.ReservationGetPayload<{ include: typeof reservationInclude }>;
export type ReservationRoomRow = ReservationRow['reservationRooms'][number];

export type RepoDb = Pick<TransactionClient, 'reservation'>;

export async function loadReservation(db: RepoDb, id: string): Promise<ReservationRow> {
  return must(
    await db.reservation.findUnique({ where: { id }, include: reservationInclude }),
    'Reservation',
  );
}

export function toReservation(r: ReservationRow): ReservationDto {
  const { user, sys } = splitCustomFields(r.customFields);
  const rooms = r.reservationRooms.map((rr) => {
    const daily = parseNightPrices(rr.dailyPrices);
    return {
      id: rr.id,
      roomTypeId: rr.roomTypeId,
      roomId: rr.roomId,
      roomNumber: rr.room?.number ?? null,
      ratePlanId: rr.ratePlanId,
      arrival: formatDay(rr.arrival),
      departure: formatDay(rr.departure),
      adults: rr.adults,
      children: rr.children,
      status: rr.status,
      currency: rr.currency,
      dailyPrices: daily,
      total: sumNights(daily),
      guests: rr.reservationGuests,
    };
  });
  const active = rooms.filter((x) => x.status !== 'CANCELLED' && x.status !== 'NO_SHOW');
  return {
    id: r.id,
    propertyId: r.propertyId,
    number: r.number,
    status: r.status,
    channel: r.channel,
    source: r.source,
    segment: r.segment,
    arrival: formatDay(r.arrival),
    departure: formatDay(r.departure),
    adults: r.adults,
    children: r.children,
    notes: r.notes,
    optionExpiresAt: r.optionExpiresAt?.toISOString() ?? null,
    confirmedAt: r.confirmedAt?.toISOString() ?? null,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
    groupId: r.groupId,
    companyId: r.companyId,
    isAllotment: !!sys.allotment,
    booker: r.bookerGuest,
    currency: rooms[0]?.currency ?? 'XOF',
    roomTotal: (active.length ? active : rooms).reduce((s, x) => s + x.total, 0),
    penalty: sys.penalty ?? null,
    customFields: user,
    rooms,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
