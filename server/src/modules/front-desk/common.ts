import type { HkStatus, Prisma, TransactionClient } from '@hm/database';
import { PermissionService } from '../../core/permissions.js';
import { AppError } from '../../lib/errors.js';
import { isUniqueViolation } from '../availability/index.js';
import { assertPropertyAccess, conflict, formatDay, must } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';

type Tx = TransactionClient;

/** Housekeeping statuses a guest can be put in. */
export const READY_STATUSES: readonly HkStatus[] = ['CLEAN', 'INSPECTED'];
/** Rooms that can never be occupied, override or not. */
export const UNUSABLE_STATUSES: readonly HkStatus[] = ['OUT_OF_ORDER', 'OUT_OF_SERVICE'];

export const hasPerm = (ctx: RCtx, permission: string): boolean =>
  PermissionService.allows(ctx.grants, permission);

export function requirePermission(ctx: RCtx, permission: string, detail: string): void {
  if (!hasPerm(ctx, permission))
    throw new AppError('FORBIDDEN', undefined, { detail, meta: { permission } });
}

/**
 * Room readiness for an arrival: CLEAN / INSPECTED pass. DIRTY / IN_PROGRESS need the explicit
 * `overrideDirty` flag *and* `front_desk.override_dirty`; out-of-order rooms never pass.
 * Returns true when the override was used.
 */
export function assertRoomReady(
  ctx: RCtx,
  room: { number: string; hkStatus: HkStatus },
  overrideDirty: boolean,
): boolean {
  if (READY_STATUSES.includes(room.hkStatus)) return false;
  if (UNUSABLE_STATUSES.includes(room.hkStatus))
    throw conflict(`Room ${room.number} is ${room.hkStatus} and cannot be occupied`, {
      reason: 'ROOM_UNUSABLE',
      roomNumber: room.number,
      hkStatus: room.hkStatus,
    });
  if (!overrideDirty)
    throw conflict(`Room ${room.number} is not clean (${room.hkStatus})`, {
      reason: 'ROOM_NOT_CLEAN',
      roomNumber: room.number,
      hkStatus: room.hkStatus,
    });
  requirePermission(
    ctx,
    'front_desk.override_dirty',
    'Checking in a room that is not clean needs front_desk.override_dirty',
  );
  return true;
}

/** Sets a room's housekeeping status and keeps its history (no-op when unchanged). */
export async function setHkStatus(
  ctx: RCtx,
  tx: Tx,
  roomId: string,
  to: HkStatus,
  reason: string,
): Promise<void> {
  const room = await tx.room.findFirst({ where: { id: roomId }, select: { hkStatus: true } });
  if (!room || room.hkStatus === to) return;
  await tx.room.update({ where: { id: roomId }, data: { hkStatus: to } });
  await tx.roomStatusHistory.create({
    data: {
      tenantId: ctx.tenantId,
      roomId,
      fromStatus: room.hkStatus,
      toStatus: to,
      userId: ctx.actorId,
      reason,
    },
  });
}

export const stayRoomInclude = {
  reservation: true,
  room: { select: { id: true, number: true, hkStatus: true } },
  roomType: { select: { id: true, name: true } },
  reservationGuests: { orderBy: { createdAt: 'asc' } },
  stay: true,
} satisfies Prisma.ReservationRoomInclude;
export type StayRoom = Prisma.ReservationRoomGetPayload<{ include: typeof stayRoomInclude }>;

export async function loadReservationRoom(ctx: RCtx, id: string): Promise<StayRoom> {
  const rr = must(
    await ctx.db.reservationRoom.findFirst({ where: { id }, include: stayRoomInclude }),
    'Reservation room',
  );
  assertPropertyAccess(ctx, rr.propertyId);
  return rr;
}

/**
 * Resolves a stay from its id **or** from the id of its reservation room. In-house stays of the
 * seeds / legacy data have no `stays` row: it is created lazily (check-in time estimated from the
 * arrival date and the property check-in time, `checked_in_by` unknown).
 */
export async function resolveStay(
  ctx: RCtx,
  id: string,
): Promise<{ rr: StayRoom; stayId: string; lazy: boolean }> {
  const found = await ctx.db.stay.findFirst({
    where: { OR: [{ id }, { reservationRoomId: id }] },
    select: { id: true, reservationRoomId: true },
  });
  const rr = await loadReservationRoom(ctx, found?.reservationRoomId ?? id);
  if (rr.stay) return { rr, stayId: rr.stay.id, lazy: false };
  if (rr.status !== 'CHECKED_IN')
    throw conflict(`The reservation room is ${rr.status}: there is no stay`, {
      reason: 'NOT_IN_HOUSE',
      status: rr.status,
    });
  const prop = must(await ctx.db.property.findFirst({ where: { id: rr.propertyId } }), 'Property');
  const checkedInAt = new Date(`${formatDay(rr.arrival)}T${prop.checkinTime}:00.000Z`);
  try {
    const stay = await ctx.db.stay.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: rr.propertyId,
        reservationRoomId: rr.id,
        checkedInAt,
      },
    });
    await ctx.audit({
      action: 'front_desk.stay.lazy_create',
      entity: 'stay',
      entityId: stay.id,
      after: { reservationRoomId: rr.id, checkedInAt: checkedInAt.toISOString() },
    });
    return { rr, stayId: stay.id, lazy: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const stay = must(await ctx.db.stay.findFirst({ where: { reservationRoomId: rr.id } }), 'Stay');
    return { rr, stayId: stay.id, lazy: false };
  }
}

export const primaryGuestId = (rr: StayRoom): string | null =>
  rr.reservationGuests.find((g) => g.isPrimary)?.guestId ??
  rr.reservationGuests[0]?.guestId ??
  rr.reservation.bookerGuestId;
