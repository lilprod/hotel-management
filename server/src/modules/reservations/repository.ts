import type { Prisma, TransactionClient } from '@hm/database';
import { formatDay, must, parseDay } from '../property/common.js';
import { parseNightPrices, sumNights } from '../availability/pricing.js';
import type { PenaltyDto, ReservationDto } from './schemas.js';

/** Penalty stored in the `penalty_*` columns of a reservation (null when none). */
export function penaltyOf(r: {
  penaltyKind: 'CANCELLATION' | 'NO_SHOW' | null;
  penaltyAmount: bigint | null;
  penaltyComputedAmount: bigint | null;
  penaltyCurrency: string | null;
  penaltyWaived: boolean;
  penaltyBusinessDate: Date | null;
  penaltyLines: unknown;
}): PenaltyDto | null {
  if (!r.penaltyKind || r.penaltyAmount === null || !r.penaltyBusinessDate) return null;
  return {
    kind: r.penaltyKind,
    amount: Number(r.penaltyAmount),
    computedAmount: Number(r.penaltyComputedAmount ?? r.penaltyAmount),
    waived: r.penaltyWaived,
    currency: r.penaltyCurrency ?? 'XOF',
    businessDate: formatDay(r.penaltyBusinessDate),
    lines: (Array.isArray(r.penaltyLines) ? r.penaltyLines : []) as PenaltyDto['lines'],
  };
}

/** Columns written for a penalty (see `penaltyOf`). */
export function penaltyData(p: PenaltyDto) {
  return {
    penaltyKind: p.kind,
    penaltyAmount: BigInt(p.amount),
    penaltyComputedAmount: BigInt(p.computedAmount),
    penaltyCurrency: p.currency,
    penaltyWaived: p.waived,
    penaltyBusinessDate: parseDay(p.businessDate),
    penaltyLines: p.lines as unknown as Prisma.InputJsonValue,
  } satisfies Prisma.ReservationUncheckedUpdateInput;
}

export const reservationInclude = {
  allotmentOfGroup: { select: { id: true } },
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
    isAllotment: !!r.allotmentOfGroup,
    booker: r.bookerGuest,
    currency: rooms[0]?.currency ?? 'XOF',
    roomTotal: (active.length ? active : rooms).reduce((s, x) => s + x.total, 0),
    penalty: penaltyOf(r),
    customFields: (r.customFields ?? {}) as Record<string, unknown>,
    rooms,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
