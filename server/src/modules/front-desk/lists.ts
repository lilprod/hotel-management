import type { Prisma } from '@hm/database';
import type { z } from 'zod';
import { loadInventory, unitStatus } from '../availability/index.js';
import { formatDay, num, parseDay } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';
import { reservationSettings } from '../reservations/settings.js';
import { requireProperty, settingAt } from '../reservations/service.js';
import { READY_STATUSES } from './common.js';
import type { DayRow, availableRoomsQuery, dayQuery } from './schemas.js';

export type DayListKind = 'arrivals' | 'departures' | 'in-house' | 'no-shows';

const roomInclude = {
  reservation: {
    select: {
      id: true,
      number: true,
      status: true,
      bookerGuestId: true,
      company: { select: { name: true } },
    },
  },
  room: { select: { id: true, number: true, hkStatus: true } },
  roomType: { select: { id: true, name: true } },
  reservationGuests: { select: { guestId: true, isPrimary: true }, orderBy: { createdAt: 'asc' } },
  stay: { select: { id: true } },
} satisfies Prisma.ReservationRoomInclude;

/** Where-clause of each list for the business date (or the requested day). */
function whereOf(kind: DayListKind, propertyId: string, date: string, businessDate: string) {
  const day = parseDay(date);
  const today = date <= businessDate;
  const base = { propertyId };
  switch (kind) {
    case 'arrivals':
      return {
        ...base,
        status: 'CONFIRMED' as const,
        departure: { gt: day },
        // Today: arrivals due now and late ones; another day: that day's arrivals only.
        arrival: today ? { lte: day } : day,
      };
    case 'departures':
      return {
        ...base,
        status: 'CHECKED_IN' as const,
        departure: today ? { lte: day } : day,
      };
    case 'in-house':
      return { ...base, status: 'CHECKED_IN' as const };
    case 'no-shows':
      return { ...base, status: 'CONFIRMED' as const, arrival: { lt: day } };
  }
}

const searchWhere = (q: string): Prisma.ReservationRoomWhereInput => ({
  OR: [
    { reservation: { number: { contains: q, mode: 'insensitive' } } },
    { room: { number: { contains: q, mode: 'insensitive' } } },
    {
      reservation: {
        bookerGuest: {
          OR: [
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q } },
          ],
        },
      },
    },
    {
      reservationGuests: {
        some: {
          guest: {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
            ],
          },
        },
      },
    },
  ],
});

/**
 * "En retard" flag of a row. Arrivals / no-shows: the arrival date is past and the guest has not
 * checked in. Departures: the departure date is past and the guest is still in house. An in-house
 * stay is late only when its departure date is past (never because it arrived before today).
 */
export function isLate(kind: DayListKind, arrival: string, departure: string, date: string): boolean {
  switch (kind) {
    case 'arrivals':
    case 'no-shows':
      return arrival < date;
    case 'departures':
    case 'in-house':
      return departure < date;
  }
}

/** Day lists (OP-20): arrivals (incl. late), departures (incl. overdue), in-house, no-show candidates. */
export async function dayList(ctx: RCtx, kind: DayListKind, q: z.infer<typeof dayQuery>) {
  const prop = await requireProperty(ctx, q.propertyId);
  const date = q.date ?? prop.businessDate;
  const rows = await ctx.db.reservationRoom.findMany({
    where: {
      ...whereOf(kind, prop.id, date, prop.businessDate),
      ...(q.search ? searchWhere(q.search) : {}),
    },
    include: roomInclude,
    orderBy: [{ arrival: 'asc' }, { departure: 'asc' }, { id: 'asc' }],
    take: 500,
  });
  const guestIds = [
    ...new Set(
      rows.flatMap((r) => {
        const p = r.reservationGuests.find((g) => g.isPrimary) ?? r.reservationGuests[0];
        return [p?.guestId ?? r.reservation.bookerGuestId].filter((x): x is string => !!x);
      }),
    ),
  ];
  const guests = await ctx.db.guest.findMany({
    where: { id: { in: guestIds } },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true },
  });
  const byGuest = new Map(guests.map((g) => [g.id, g]));
  const stayIds = rows.flatMap((r) => (r.stay ? [r.stay.id] : []));
  const folios = stayIds.length
    ? await ctx.db.folio.findMany({
        where: { stayId: { in: stayIds } },
        select: { stayId: true, balance: true },
      })
    : [];
  const balances = new Map<string, number>();
  for (const f of folios)
    if (f.stayId) balances.set(f.stayId, (balances.get(f.stayId) ?? 0) + num(f.balance));

  const items: DayRow[] = rows.map((r) => {
    const p = r.reservationGuests.find((g) => g.isPrimary) ?? r.reservationGuests[0];
    const g = byGuest.get(p?.guestId ?? r.reservation.bookerGuestId ?? '');
    const arrival = formatDay(r.arrival);
    const departure = formatDay(r.departure);
    return {
      reservationId: r.reservationId,
      reservationRoomId: r.id,
      stayId: r.stay?.id ?? null,
      number: r.reservation.number,
      status: r.status,
      guest: {
        id: g?.id ?? null,
        name: g ? `${g.lastName.toUpperCase()} ${g.firstName}` : '—',
        phone: g?.phone ?? null,
        email: g?.email ?? null,
      },
      companyName: r.reservation.company?.name ?? null,
      roomTypeId: r.roomTypeId,
      roomTypeName: r.roomType.name,
      roomId: r.roomId,
      roomNumber: r.room?.number ?? null,
      hkStatus: r.room?.hkStatus ?? null,
      arrival,
      departure,
      adults: r.adults,
      children: r.children,
      late: isLate(kind, arrival, departure, date),
      balance: r.stay ? (balances.get(r.stay.id) ?? 0) : null,
      currency: r.currency,
    };
  });
  return { businessDate: prop.businessDate, date, items };
}

/** KPI header: counts of the four lists and the clean rooms free tonight. */
export async function summary(ctx: RCtx, q: Pick<z.infer<typeof dayQuery>, 'propertyId' | 'date'>) {
  const prop = await requireProperty(ctx, q.propertyId);
  const date = q.date ?? prop.businessDate;
  const count = (kind: DayListKind) =>
    ctx.db.reservationRoom.count({ where: whereOf(kind, prop.id, date, prop.businessDate) });
  const [arrivals, departures, inHouse, noShows] = await Promise.all([
    count('arrivals'),
    count('departures'),
    count('in-house'),
    count('no-shows'),
  ]);
  const rooms = await availableRooms(ctx, {
    propertyId: prop.id,
    from: date,
    to: formatDay(new Date(parseDay(date).getTime() + 86_400_000)),
  });
  return {
    businessDate: prop.businessDate,
    date,
    arrivals,
    departures,
    inHouse,
    noShows,
    availableCleanRooms: rooms.filter((r) => r.clean).length,
  };
}

/**
 * Units free on every night of `[from, to)` (blocks, out-of-order rooms and other stays excluded),
 * flagged `clean` when housekeeping says CLEAN / INSPECTED — only those are suggested at check-in.
 */
export async function availableRooms(ctx: RCtx, q: z.infer<typeof availableRoomsQuery>) {
  const prop = await requireProperty(ctx, q.propertyId);
  const allowance = await settingAt(ctx, reservationSettings.overbookingAllowance, prop.id);
  const inv = await loadInventory(ctx.db as never, {
    propertyId: prop.id,
    from: q.from,
    to: q.to,
    ...(q.roomTypeId ? { roomTypeIds: [q.roomTypeId] } : {}),
    ...(q.reservationRoomId ? { exclude: [q.reservationRoomId] } : {}),
    allowance,
  });
  const rooms = await ctx.db.room.findMany({
    where: {
      propertyId: prop.id,
      deletedAt: null,
      isActive: true,
      ...(q.roomTypeId ? { roomTypeId: q.roomTypeId } : {}),
    },
    include: { roomType: { select: { name: true } } },
    orderBy: [{ number: 'asc' }],
  });
  const nights: string[] = [];
  for (let t = parseDay(q.from).getTime(); t < parseDay(q.to).getTime(); t += 86_400_000)
    nights.push(formatDay(new Date(t)));
  return rooms
    .filter(
      (r) =>
        r.hkStatus !== 'OUT_OF_ORDER' &&
        r.hkStatus !== 'OUT_OF_SERVICE' &&
        nights.every((n) => unitStatus(inv, r.id, n) === null),
    )
    .map((r) => ({
      id: r.id,
      number: r.number,
      roomTypeId: r.roomTypeId,
      roomTypeName: r.roomType.name,
      floor: r.floor,
      hkStatus: r.hkStatus,
      clean: READY_STATUSES.includes(r.hkStatus),
    }));
}
