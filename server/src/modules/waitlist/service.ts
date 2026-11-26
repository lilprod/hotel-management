import type { Prisma } from '@hm/database';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { nightsOf } from '../availability/dates.js';
import { loadInventory } from '../availability/inventory.js';
import { insertGuest, loadGuest } from '../guests/service.js';
import { assertPropertyAccess, formatDay, invalid, must, parseDay } from '../property/common.js';
import { now, sendGuestNotice, type RCtx } from '../reservations/context.js';
import { publish, RESERVATION_EVENTS } from '../reservations/events.js';
import type { CreateReservationInput } from '../reservations/schemas.js';
import { createReservation, requireProperty, settingAt } from '../reservations/service.js';
import { reservationSettings } from '../reservations/settings.js';
import type { acceptBody, createEntryBody, EntryDto, listEntriesQuery } from './schemas.js';

/** Guest template of the offer (default catalogue of @hm/templates). */
export const WAITLIST_OFFER_TEMPLATE = 'waitlist_offer';

const entryInclude = {
  guest: { select: { firstName: true, lastName: true, email: true, phone: true } },
} as const;
type EntryRow = Prisma.WaitlistEntryGetPayload<{ include: typeof entryInclude }>;

const toEntry = (e: EntryRow): EntryDto => ({
  id: e.id,
  propertyId: e.propertyId,
  guestId: e.guestId,
  guestName: `${e.guest.firstName} ${e.guest.lastName}`,
  roomTypeId: e.roomTypeId,
  arrival: formatDay(e.arrival),
  departure: formatDay(e.departure),
  adults: e.adults,
  children: e.children,
  status: e.status,
  priority: e.priority,
  offeredAt: e.offeredAt?.toISOString() ?? null,
  offerExpiresAt: e.offerExpiresAt?.toISOString() ?? null,
  notes: e.notes,
  reservationId: e.reservationId,
  createdAt: e.createdAt.toISOString(),
});

async function loadEntry(ctx: RCtx, id: string): Promise<EntryRow> {
  const e = must(
    await ctx.db.waitlistEntry.findUnique({ where: { id }, include: entryInclude }),
    'Waitlist entry',
  );
  assertPropertyAccess(ctx, e.propertyId);
  return e;
}

export async function createEntry(
  ctx: RCtx,
  input: z.infer<typeof createEntryBody>,
): Promise<EntryDto> {
  const prop = await requireProperty(ctx, input.propertyId);
  if (input.arrival < prop.businessDate)
    throw invalid('arrival', `Arrival is before the business date ${prop.businessDate}`);
  if (input.roomTypeId)
    must(
      await ctx.db.roomType.findFirst({
        where: { id: input.roomTypeId, propertyId: prop.id, deletedAt: null },
      }),
      'Room type',
    );
  const guestId =
    'id' in input.guest
      ? (await loadGuest(ctx.db as never, input.guest.id)).id
      : (await insertGuest(ctx, ctx.db as never, input.guest)).id;
  const row = await ctx.db.waitlistEntry.create({
    data: {
      tenantId: ctx.tenantId,
      propertyId: prop.id,
      guestId,
      roomTypeId: input.roomTypeId ?? null,
      arrival: parseDay(input.arrival),
      departure: parseDay(input.departure),
      adults: input.adults,
      children: input.children,
      priority: input.priority,
      notes: input.notes ?? null,
    },
    include: entryInclude,
  });
  const dto = toEntry(row);
  await ctx.audit({
    action: 'waitlist.create',
    entity: 'waitlist_entry',
    entityId: row.id,
    after: dto,
  });
  return dto;
}

/** Waitlist entry from a reservation request that found no availability. */
export function joinWaitlistFor(ctx: RCtx, input: CreateReservationInput): Promise<EntryDto> {
  const first = input.rooms[0]!;
  return createEntry(ctx, {
    propertyId: input.propertyId,
    guest: input.guest,
    roomTypeId: first.roomTypeId,
    arrival: first.arrival ?? input.arrival,
    departure: first.departure ?? input.departure,
    adults: first.adults,
    children: first.children,
    priority: 0,
    notes: input.notes,
  });
}

export async function listEntries(ctx: RCtx, q: z.infer<typeof listEntriesQuery>) {
  assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.waitlistEntry.findMany({
    where: { propertyId: q.propertyId, ...(q.status ? { status: q.status } : {}) },
    include: entryInclude,
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take: q.limit,
  });
  return { items: rows.map(toEntry) };
}

async function setStatus(
  ctx: RCtx,
  e: EntryRow,
  to: 'CANCELLED' | 'EXPIRED' | 'ACCEPTED' | 'OFFERED' | 'WAITING',
  from: readonly EntryRow['status'][],
  action: string,
  extra: Prisma.WaitlistEntryUncheckedUpdateManyInput = {},
): Promise<boolean> {
  const n = await ctx.db.waitlistEntry.updateMany({
    where: { id: e.id, status: { in: [...from] } },
    data: { status: to, ...extra },
  });
  if (n.count === 1)
    await ctx.audit({
      action,
      entity: 'waitlist_entry',
      entityId: e.id,
      before: { status: e.status },
      after: { status: to },
    });
  return n.count === 1;
}

export async function cancelEntry(ctx: RCtx, id: string): Promise<EntryDto> {
  const e = await loadEntry(ctx, id);
  if (!(await setStatus(ctx, e, 'CANCELLED', ['WAITING', 'OFFERED'], 'waitlist.cancel')))
    throw new AppError('CONFLICT', undefined, { detail: `The entry is ${e.status}` });
  return toEntry(await loadEntry(ctx, id));
}

/** The guest declines the offer: the entry is closed and the next candidate may be offered. */
export async function declineOffer(ctx: RCtx, id: string): Promise<EntryDto> {
  const e = await loadEntry(ctx, id);
  if (!(await setStatus(ctx, e, 'CANCELLED', ['OFFERED'], 'waitlist.decline')))
    throw new AppError('CONFLICT', undefined, { detail: 'No pending offer on this entry' });
  await matchWaitlist(ctx, e.propertyId);
  return toEntry(await loadEntry(ctx, id));
}

/** Accepting an offer converts the entry into a reservation (availability re-checked). */
export async function acceptOffer(ctx: RCtx, id: string, input: z.infer<typeof acceptBody>) {
  const e = await loadEntry(ctx, id);
  if (e.status !== 'OFFERED')
    throw new AppError('CONFLICT', undefined, { detail: `The entry is ${e.status}` });
  if (!e.offerExpiresAt || e.offerExpiresAt <= now())
    throw new AppError('CONFLICT', undefined, {
      detail: 'The offer has expired',
      meta: { reason: 'OFFER_EXPIRED' },
    });
  const roomTypeId = input.roomTypeId ?? e.roomTypeId;
  if (!roomTypeId) throw invalid('roomTypeId', 'A room type is required');
  // Claim the offer first: a concurrent accept cannot create a second reservation.
  if (!(await setStatus(ctx, e, 'ACCEPTED', ['OFFERED'], 'waitlist.accept')))
    throw new AppError('CONFLICT', undefined, { detail: 'The offer is no longer open' });
  try {
    const result = await createReservation(
      ctx,
      {
        propertyId: e.propertyId,
        arrival: formatDay(e.arrival),
        departure: formatDay(e.departure),
        guest: { id: e.guestId },
        rooms: [
          { roomTypeId, ratePlanId: input.ratePlanId, adults: e.adults, children: e.children },
        ],
        status: input.status,
        channel: 'FRONT_DESK',
        notes: e.notes ?? undefined,
        notifyGuest: input.notifyGuest,
        joinWaitlistIfUnavailable: false,
      },
      {
        afterWrite: async (tx, reservationId) => {
          await tx.waitlistEntry.update({ where: { id: e.id }, data: { reservationId } });
        },
      },
    );
    return { entry: toEntry(await loadEntry(ctx, id)), ...result };
  } catch (err) {
    await ctx.db.waitlistEntry.updateMany({
      where: { id: e.id, status: 'ACCEPTED' },
      data: { status: 'OFFERED' },
    });
    throw err;
  }
}

export interface MatchResult {
  expired: string[];
  offered: string[];
}

/**
 * `waitlist-match` (doc 03 §5): expired offers move to EXPIRED, then WAITING entries are offered
 * in order (priority desc, then first come) while the inventory has room for them. Open offers
 * count against the inventory so the same unit is never offered twice.
 */
export async function matchWaitlist(
  ctx: RCtx,
  propertyId: string,
  at: Date = now(),
): Promise<MatchResult> {
  const prop = await requireProperty(ctx, propertyId);
  const result: MatchResult = { expired: [], offered: [] };
  const stale = await ctx.db.waitlistEntry.findMany({
    where: { propertyId, status: 'OFFERED', offerExpiresAt: { lte: at } },
    include: entryInclude,
  });
  for (const e of stale)
    if (await setStatus(ctx, e, 'EXPIRED', ['OFFERED'], 'waitlist.expire'))
      result.expired.push(e.id);

  const entries = await ctx.db.waitlistEntry.findMany({
    where: {
      propertyId,
      status: { in: ['WAITING', 'OFFERED'] },
      arrival: { gte: parseDay(prop.businessDate) },
    },
    include: entryInclude,
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });
  const waiting = entries.filter((e) => e.status === 'WAITING');
  if (!waiting.length) return result;
  let from = formatDay(entries[0]!.arrival);
  let to = formatDay(entries[0]!.departure);
  for (const e of entries) {
    if (formatDay(e.arrival) < from) from = formatDay(e.arrival);
    if (formatDay(e.departure) > to) to = formatDay(e.departure);
  }
  const [allowance, hours, roomTypes] = await Promise.all([
    settingAt(ctx, reservationSettings.overbookingAllowance, propertyId),
    settingAt(ctx, reservationSettings.waitlistOfferHours, propertyId),
    ctx.db.roomType.findMany({
      where: { propertyId, deletedAt: null, isActive: true },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
    }),
  ]);
  const inv = await loadInventory(ctx.db as never, { propertyId, from, to, allowance });
  const free = new Map<string, number>();
  for (const [t, list] of inv.perType) for (const n of list) free.set(`${t}|${n.date}`, n.free);
  const take = (typeId: string, arrival: string, departure: string) => {
    for (const n of nightsOf(arrival, departure))
      free.set(`${typeId}|${n}`, (free.get(`${typeId}|${n}`) ?? 0) - 1);
  };
  const fits = (typeId: string, arrival: string, departure: string) =>
    nightsOf(arrival, departure).every((n) => (free.get(`${typeId}|${n}`) ?? 0) >= 1);
  for (const e of entries)
    if (e.status === 'OFFERED' && e.roomTypeId)
      take(e.roomTypeId, formatDay(e.arrival), formatDay(e.departure));

  for (const e of waiting) {
    const arrival = formatDay(e.arrival);
    const departure = formatDay(e.departure);
    const candidates = e.roomTypeId
      ? roomTypes.filter((t) => t.id === e.roomTypeId)
      : roomTypes.filter((t) => e.adults <= t.maxAdults && e.children <= t.maxChildren);
    const type = candidates.find((t) => fits(t.id, arrival, departure));
    if (!type) continue;
    const expiresAt = new Date(at.getTime() + hours * 3_600_000);
    const ok = await setStatus(ctx, e, 'OFFERED', ['WAITING'], 'waitlist.offer', {
      roomTypeId: type.id,
      offeredAt: at,
      offerExpiresAt: expiresAt,
    });
    if (!ok) continue;
    take(type.id, arrival, departure);
    result.offered.push(e.id);
    await publish(ctx.db as never, RESERVATION_EVENTS.waitlistOffered, {
      propertyId,
      waitlistEntryId: e.id,
      roomTypeId: type.id,
      offerExpiresAt: expiresAt.toISOString(),
    });
    if (e.guest.email || e.guest.phone)
      try {
        await sendGuestNotice(ctx.services, {
          tenantId: ctx.tenantId,
          channels: await settingAt(ctx, reservationSettings.reminderChannels, propertyId),
          to: {
            ...(e.guest.email ? { email: e.guest.email } : {}),
            ...(e.guest.phone ? { phone: e.guest.phone } : {}),
          },
          templateCode: WAITLIST_OFFER_TEMPLATE,
          guestId: e.guestId,
          data: {
            guest: { firstName: e.guest.firstName, lastName: e.guest.lastName },
            hotel: { name: prop.name, phone: prop.phone ?? '' },
            reservation: { checkIn: arrival, checkOut: departure, roomType: type.name },
            offer: { expiresAt: expiresAt.toISOString() },
          },
          idempotencyKey: `waitlist:${e.id}:offer:${at.getTime()}`,
        });
      } catch (err) {
        ctx.services.logger.warn('waitlist offer not sent', { err, waitlistEntryId: e.id });
      }
  }
  return result;
}
