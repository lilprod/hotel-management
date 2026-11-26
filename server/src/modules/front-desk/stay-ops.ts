import { addDays, nightsOf } from '../availability/dates.js';
import { assertDemands, loadInventory, lockInventory } from '../availability/index.js';
import { conflict, formatDay, invalid, must, parseDay } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';
import { publishInventoryReleased, publishPlanningChanged } from '../reservations/events.js';
import { reservationSettings } from '../reservations/settings.js';
import {
  loadReservation,
  rebook,
  requireProperty,
  settingAt,
  toReservation,
  TX_OPTS,
} from '../reservations/service.js';
import { assertRoomReady, requirePermission, resolveStay, setHkStatus } from './common.js';
import { FRONT_DESK_EVENTS, publishStayEvent } from './events.js';

/**
 * Room change during the stay (OP-22): the nights from the business date on move to another unit
 * (nights already spent stay on the previous unit), the old room becomes DIRTY, the reason is
 * kept in `stay_events` (and audited). The new room must be ready (or `front_desk.override_dirty`) and free for the nights.
 */
export async function changeRoom(
  ctx: RCtx,
  id: string,
  input: { roomId: string; reason: string; changeRoomType: boolean; overrideDirty: boolean },
) {
  const { rr, stayId } = await resolveStay(ctx, id);
  if (rr.status !== 'CHECKED_IN')
    throw conflict('Only an in-house stay can change room', { reason: 'NOT_IN_HOUSE' });
  const prop = await requireProperty(ctx, rr.propertyId);
  const oldRoom = must(rr.room, 'Room');
  if (input.roomId === oldRoom.id)
    throw invalid('roomId', 'The guest is already in this room', 'SAME_ROOM');
  const target = must(
    await ctx.db.room.findFirst({
      where: { id: input.roomId, propertyId: rr.propertyId, deletedAt: null, isActive: true },
      select: { id: true, number: true, hkStatus: true, roomTypeId: true },
    }),
    'Room',
  );
  if (target.roomTypeId !== rr.roomTypeId && !input.changeRoomType)
    throw invalid('roomId', 'The room belongs to another room type (set changeRoomType)', 'ROOM_TYPE_MISMATCH');
  if (input.overrideDirty)
    requirePermission(ctx, 'front_desk.override_dirty', 'overrideDirty needs front_desk.override_dirty');
  const overrideUsed = assertRoomReady(ctx, target, input.overrideDirty);
  const arrival = formatDay(rr.arrival);
  const departure = formatDay(rr.departure);
  const from = arrival > prop.businessDate ? arrival : prop.businessDate;
  if (from >= departure)
    throw conflict('No night left to move', { reason: 'NO_REMAINING_NIGHTS' });
  const allowance = await settingAt(ctx, reservationSettings.overbookingAllowance, prop.id);

  const moved = await ctx.db.$transaction(async (tx) => {
    await lockInventory(tx, prop.id, [rr.roomTypeId, target.roomTypeId]);
    const inv = await loadInventory(tx, {
      propertyId: prop.id,
      from,
      to: departure,
      roomTypeIds: [target.roomTypeId],
      exclude: [rr.id],
      allowance,
    });
    assertDemands(inv, [
      { roomTypeId: target.roomTypeId, arrival: from, departure, roomId: target.id },
    ]);
    await tx.unitNight.deleteMany({
      where: { reservationRoomId: rr.id, night: { gte: parseDay(from) } },
    });
    const nights = nightsOf(from, departure);
    await tx.unitNight.createMany({
      data: nights.map((n) => ({
        tenantId: ctx.tenantId,
        unitId: target.id,
        reservationRoomId: rr.id,
        night: parseDay(n),
      })),
    });
    await tx.reservationRoom.update({
      where: { id: rr.id },
      data: { roomId: target.id, roomTypeId: target.roomTypeId },
    });
    await setHkStatus(ctx, tx, oldRoom.id, 'DIRTY', `Changement de chambre — ${input.reason}`);
    await publishPlanningChanged(tx, {
      propertyId: prop.id,
      reservationId: rr.reservationId,
      action: 'room_change',
      from,
      to: departure,
      reservationRoomIds: [rr.id],
    });
    if (target.roomTypeId !== rr.roomTypeId)
      await publishInventoryReleased(tx, {
        propertyId: prop.id,
        roomTypeIds: [rr.roomTypeId],
        from,
        to: departure,
        cause: 'room_change',
      });
    await tx.stayEvent.create({
      data: {
        tenantId: ctx.tenantId,
        stayId,
        type: 'ROOM_CHANGE',
        reason: input.reason,
        actorId: ctx.actorId,
        payload: {
          fromRoomId: oldRoom.id,
          fromRoomNumber: oldRoom.number,
          toRoomId: target.id,
          toRoomNumber: target.number,
          from,
          movedNights: nights.length,
          overrideDirty: overrideUsed,
        },
      },
    });
    await publishStayEvent(tx, FRONT_DESK_EVENTS.roomChanged, {
      propertyId: prop.id,
      stayId,
      reservationRoomId: rr.id,
      fromRoomId: oldRoom.id,
      toRoomId: target.id,
    });
    return nights.length;
  }, TX_OPTS);

  await ctx.audit({
    action: 'front_desk.room_change',
    entity: 'stay',
    entityId: stayId,
    before: { roomId: oldRoom.id, roomNumber: oldRoom.number },
    after: {
      roomId: target.id,
      roomNumber: target.number,
      reason: input.reason,
      movedNights: moved,
      from,
      overrideDirty: overrideUsed,
    },
  });
  return { stayId, reservationRoomId: rr.id, from: oldRoom.number, to: target.number, movedNights: moved, effectiveFrom: from };
}

const DEPARTURE_EVENT = { extend: 'EXTEND', shorten: 'SHORTEN', early_departure: 'EARLY_DEPARTURE' } as const;

async function applyDeparture(
  ctx: RCtx,
  id: string,
  departure: string,
  mode: 'extend' | 'shorten',
  action: keyof typeof DEPARTURE_EVENT,
  reason?: string,
) {
  const { rr, stayId } = await resolveStay(ctx, id);
  if (rr.status !== 'CHECKED_IN')
    throw conflict('Only an in-house stay can be extended or shortened here', {
      reason: 'NOT_IN_HOUSE',
    });
  const prop = await requireProperty(ctx, rr.propertyId);
  const old = formatDay(rr.departure);
  if (mode === 'extend' && departure <= old) throw invalid('departure', 'The new departure must be later');
  if (mode === 'shorten' && departure >= old) throw invalid('departure', 'The new departure must be earlier');
  if (mode === 'shorten' && departure <= formatDay(rr.arrival))
    throw invalid('departure', 'The stay keeps at least one night');
  if (mode === 'shorten' && departure < prop.businessDate)
    throw invalid('departure', 'The new departure cannot be before the business date');
  // Re-quote of the new nights + availability re-check live in the reservation engine.
  const reservation = await rebook(ctx, rr.reservationId, [{ id: rr.id, departure }], {
    action,
    departureOnly: true,
  });
  await ctx.db.stayEvent.create({
    data: {
      tenantId: ctx.tenantId,
      stayId,
      type: DEPARTURE_EVENT[action],
      reason: reason ?? null,
      actorId: ctx.actorId,
      payload: { before: { departure: old }, after: { departure } },
    },
  });
  await ctx.audit({
    action: `front_desk.${action}`,
    entity: 'stay',
    entityId: stayId,
    before: { departure: old },
    after: { departure, ...(reason ? { reason } : {}) },
  });
  return { stayId, reservationRoomId: rr.id, reservation };
}

export const extendStay = (ctx: RCtx, id: string, departure: string, reason?: string) =>
  applyDeparture(ctx, id, departure, 'extend', 'extend', reason);

export const shortenStay = (ctx: RCtx, id: string, departure: string, reason?: string) =>
  applyDeparture(ctx, id, departure, 'shorten', 'shorten', reason);

/** Departure earlier than planned: default = today (the minimum is arrival + 1 night). */
export async function earlyDeparture(ctx: RCtx, id: string, departure?: string, reason?: string) {
  const { rr } = await resolveStay(ctx, id);
  const prop = await requireProperty(ctx, rr.propertyId);
  const minimum = addDays(formatDay(rr.arrival), 1);
  const target = departure ?? (prop.businessDate > minimum ? prop.businessDate : minimum);
  return applyDeparture(ctx, id, target, 'shorten', 'early_departure', reason);
}

/** Stay summary for the desk drawers (lazy-creates the stay of seeded in-house reservations). */
export async function getStay(ctx: RCtx, id: string) {
  const { rr, stayId } = await resolveStay(ctx, id);
  const [stay, reservation, policeRecords, events] = await Promise.all([
    ctx.db.stay.findFirst({ where: { id: stayId } }).then((s) => must(s, 'Stay')),
    loadReservation(ctx.db as never, rr.reservationId),
    ctx.db.policeRecord.count({ where: { stayId } }),
    ctx.db.stayEvent.findMany({ where: { stayId }, orderBy: [{ at: 'asc' }, { id: 'asc' }] }),
  ]);
  return {
    stayId,
    reservationRoomId: rr.id,
    reservation: toReservation(reservation),
    checkedInAt: stay.checkedInAt.toISOString(),
    checkedOutAt: stay.checkedOutAt?.toISOString() ?? null,
    policeRecords,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      reason: e.reason,
      actorId: e.actorId,
      payload: e.payload as Record<string, unknown>,
      at: e.at.toISOString(),
    })),
  };
}
