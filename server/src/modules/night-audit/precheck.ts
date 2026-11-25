import type { Prisma } from '@hm/database';
import { formatDay, num, parseDay } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';
import { previewPenalty, requireProperty, settingAt } from '../reservations/service.js';
import { lastClosedDate } from '../folio/repository.js';
import { asTx } from '../folio/repository.js';
import { nightAuditSettings } from './settings.js';

export type CheckCode =
  | 'PENDING_ARRIVALS'
  | 'PENDING_DEPARTURES'
  | 'OPEN_CASH_SESSIONS'
  | 'NEGATIVE_BALANCES'
  | 'UNASSIGNED_IN_HOUSE';

/** DECISION: each item needs a choice (no-show / keep) in the run request. */
export type Severity = 'DECISION' | 'WARNING' | 'BLOCKING';

export interface CheckItem {
  reservationId?: string;
  reservationRoomId?: string;
  stayId?: string | null;
  number?: string;
  guestName?: string;
  roomNumber?: string | null;
  arrival?: string;
  departure?: string;
  balance?: number;
  currency?: string;
  /** No-show penalty per the cancellation policy (preview). */
  penalty?: { amount: number; currency: string } | null;
  canNoShow?: boolean;
  folioId?: string;
  cashSessionId?: string;
  userId?: string;
  userName?: string;
  openedAt?: string;
}

export interface Check {
  code: CheckCode;
  severity: Severity;
  count: number;
  items: CheckItem[];
}

export interface Precheck {
  propertyId: string;
  businessDate: string;
  closedDate: string | null;
  running: { id: string; status: string; startedAt: string } | null;
  checks: Check[];
  /** True when nothing blocks (decisions may still be required). */
  canRun: boolean;
}

const rrInclude = {
  reservation: { select: { id: true, number: true, status: true, bookerGuestId: true } },
  room: { select: { number: true } },
  reservationGuests: {
    select: { isPrimary: true, guest: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'asc' },
  },
  stay: { select: { id: true } },
} satisfies Prisma.ReservationRoomInclude;
type RrRow = Prisma.ReservationRoomGetPayload<{ include: typeof rrInclude }>;

async function guestNames(ctx: RCtx, rows: RrRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const bookers = rows
    .filter((r) => !r.reservationGuests.length && r.reservation.bookerGuestId)
    .map((r) => r.reservation.bookerGuestId!);
  const guests = bookers.length
    ? await ctx.db.guest.findMany({ where: { id: { in: bookers } }, select: { id: true, firstName: true, lastName: true } })
    : [];
  const byId = new Map(guests.map((g) => [g.id, g]));
  for (const r of rows) {
    const g =
      (r.reservationGuests.find((x) => x.isPrimary) ?? r.reservationGuests[0])?.guest ??
      byId.get(r.reservation.bookerGuestId ?? '');
    out.set(r.id, g ? `${g.lastName.toUpperCase()} ${g.firstName}` : '—');
  }
  return out;
}

/**
 * Pre-checks of the night audit for the current business date `D` (OP-24): arrivals still
 * expected (arrival ≤ D, not checked in: a no-show or keep decision is required), departures due
 * (departure ≤ D, still in house), open cash sessions (warn or block per setting), folios with a
 * credit (negative) balance and in-house lines without a room.
 */
export async function precheck(ctx: RCtx, propertyId: string): Promise<Precheck> {
  const prop = await requireProperty(ctx, propertyId);
  const D = prop.businessDate;
  const day = parseDay(D);
  const [departuresPolicy, cashPolicy] = await Promise.all([
    settingAt(ctx, nightAuditSettings.departuresPolicy, prop.id),
    settingAt(ctx, nightAuditSettings.cashSessionsPolicy, prop.id),
  ]);

  const [arrivals, departures, unassigned, sessions, negatives, running, closed] = await Promise.all([
    ctx.db.reservationRoom.findMany({
      where: { propertyId: prop.id, status: 'CONFIRMED', arrival: { lte: day } },
      include: rrInclude,
      orderBy: [{ arrival: 'asc' }, { id: 'asc' }],
      take: 500,
    }),
    ctx.db.reservationRoom.findMany({
      where: { propertyId: prop.id, status: 'CHECKED_IN', departure: { lte: day } },
      include: rrInclude,
      orderBy: [{ departure: 'asc' }, { id: 'asc' }],
      take: 500,
    }),
    ctx.db.reservationRoom.findMany({
      where: { propertyId: prop.id, status: 'CHECKED_IN', roomId: null },
      include: rrInclude,
      take: 500,
    }),
    ctx.db.cashSession.findMany({
      where: { propertyId: prop.id, closedAt: null },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { openedAt: 'asc' },
    }),
    ctx.db.folio.findMany({
      where: { propertyId: prop.id, status: 'OPEN', balance: { lt: 0n } },
      select: { id: true, number: true, balance: true, currency: true },
      orderBy: { number: 'asc' },
      take: 500,
    }),
    ctx.db.nightAudit.findFirst({
      where: { propertyId: prop.id, status: { in: ['RUNNING', 'FAILED'] } },
      orderBy: { businessDate: 'desc' },
    }),
    lastClosedDate(asTx(ctx.db), prop.id),
  ]);
  const names = await guestNames(ctx, [...arrivals, ...departures, ...unassigned]);

  // One decision per reservation (the no-show transition applies to the whole reservation).
  const byReservation = new Map<string, RrRow[]>();
  for (const r of arrivals) byReservation.set(r.reservationId, [...(byReservation.get(r.reservationId) ?? []), r]);
  const arrivalItems: CheckItem[] = [];
  for (const [reservationId, rows] of byReservation) {
    const r = rows[0]!;
    const canNoShow = r.reservation.status === 'CONFIRMED';
    let penalty: CheckItem['penalty'] = null;
    if (canNoShow)
      try {
        const p = await previewPenalty(ctx, reservationId, 'NO_SHOW');
        penalty = { amount: p.amount, currency: p.currency };
      } catch {
        penalty = null;
      }
    arrivalItems.push({
      reservationId,
      reservationRoomId: r.id,
      number: r.reservation.number,
      guestName: names.get(r.id) ?? '—',
      roomNumber: rows.map((x) => x.room?.number).filter(Boolean).join(', ') || null,
      arrival: formatDay(r.arrival),
      departure: formatDay(r.departure),
      currency: r.currency,
      penalty,
      canNoShow,
    });
  }

  const stayIds = departures.flatMap((r) => (r.stay ? [r.stay.id] : []));
  const balances = new Map<string, number>();
  if (stayIds.length)
    for (const f of await ctx.db.folio.findMany({
      where: { stayId: { in: stayIds } },
      select: { stayId: true, balance: true },
    }))
      if (f.stayId) balances.set(f.stayId, (balances.get(f.stayId) ?? 0) + num(f.balance));

  const rrItem = (r: RrRow): CheckItem => ({
    reservationId: r.reservationId,
    reservationRoomId: r.id,
    stayId: r.stay?.id ?? null,
    number: r.reservation.number,
    guestName: names.get(r.id) ?? '—',
    roomNumber: r.room?.number ?? null,
    arrival: formatDay(r.arrival),
    departure: formatDay(r.departure),
    currency: r.currency,
    ...(r.stay ? { balance: balances.get(r.stay.id) ?? 0 } : {}),
  });

  const checks: Check[] = [
    { code: 'PENDING_ARRIVALS', severity: 'DECISION', count: arrivalItems.length, items: arrivalItems },
    {
      code: 'PENDING_DEPARTURES',
      severity: departuresPolicy === 'BLOCK' ? 'BLOCKING' : 'WARNING',
      count: departures.length,
      items: departures.map(rrItem),
    },
    {
      code: 'OPEN_CASH_SESSIONS',
      severity: cashPolicy === 'BLOCK' ? 'BLOCKING' : 'WARNING',
      count: sessions.length,
      items: sessions.map((s) => ({
        cashSessionId: s.id,
        userId: s.user.id,
        userName: s.user.name,
        openedAt: s.openedAt.toISOString(),
        currency: s.currency,
      })),
    },
    {
      code: 'NEGATIVE_BALANCES',
      severity: 'WARNING',
      count: negatives.length,
      items: negatives.map((f) => ({ folioId: f.id, number: f.number, balance: num(f.balance), currency: f.currency })),
    },
    {
      code: 'UNASSIGNED_IN_HOUSE',
      severity: 'WARNING',
      count: unassigned.length,
      items: unassigned.map(rrItem),
    },
  ];
  return {
    propertyId: prop.id,
    businessDate: D,
    closedDate: closed,
    running: running
      ? { id: running.id, status: running.status, startedAt: running.startedAt.toISOString() }
      : null,
    checks,
    canRun: !checks.some((c) => c.severity === 'BLOCKING' && c.count > 0),
  };
}

/** Codes of the checks that block a run (blocking checks with items). */
export const blockingCodes = (p: Precheck) =>
  p.checks.filter((c) => c.severity === 'BLOCKING' && c.count > 0).map((c) => c.code);
