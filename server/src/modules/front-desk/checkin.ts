import type { AppClient, Prisma, TransactionClient } from '@hm/database';
import { AppError } from '../../lib/errors.js';
import { nightsOf } from '../availability/dates.js';
import { loadInventory, unitStatus } from '../availability/index.js';
import { ensureRoomFolio, recordPayment } from '../folio/index.js';
import { conflict, formatDay, invalid, must } from '../property/common.js';
import { publishPlanningChanged } from '../reservations/events.js';
import { guardTransition, type ReservationStatusName } from '../reservations/lifecycle.js';
import type { RCtx } from '../reservations/context.js';
import { reservationSettings } from '../reservations/settings.js';
import {
  assignRoom,
  createReservation,
  requireProperty,
  settingAt,
  TX_OPTS,
  type PropertyInfo,
} from '../reservations/service.js';
import {
  assertRoomReady,
  loadReservationRoom,
  READY_STATUSES,
  requirePermission,
  type StayRoom,
} from './common.js';
import { FRONT_DESK_EVENTS, publishStayEvent } from './events.js';
import {
  buildSnapshot,
  resolveGuests,
  saveGuestProfile,
  validatePoliceCustomFields,
} from './identity.js';
import { sendStayNotice } from './notices.js';
import type { CheckInInput, WalkInInput } from './schemas.js';

type Tx = TransactionClient;

export interface CheckInResult {
  stayId: string;
  reservationRoomId: string;
  reservationId: string;
  roomId: string;
  roomNumber: string;
  policeRecordIds: string[];
  deposit: { ok: boolean; paymentId: string | null; error: string | null } | null;
  notified: boolean;
  warnings: string[];
}

interface Written {
  stayId: string;
  rr: StayRoom;
  roomId: string;
  roomNumber: string;
  folioId: string;
  policeRecordIds: string[];
  primaryGuest: { id: string; firstName: string; lastName: string; email: string | null; phone: string | null };
  overrideUsed: boolean;
  prop: PropertyInfo;
}

const asCtx = (ctx: RCtx, tx: Tx): RCtx => ({ ...ctx, db: tx as unknown as AppClient });

async function assertFiles(ctx: RCtx, db: Pick<Tx, 'file'>, input: Pick<CheckInInput, 'signatureFileId' | 'idScanFileId'>) {
  for (const [path, id] of [
    ['signatureFileId', input.signatureFileId],
    ['idScanFileId', input.idScanFileId],
  ] as const) {
    if (!id) continue;
    const f = await db.file.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } });
    if (!f) throw invalid(path, 'Unknown file (upload it with POST /front-desk/files first)');
  }
}

/**
 * Check-in core, run inside the caller's transaction (`tx` also backs `ctx.db`): lifecycle guard,
 * room readiness, identity + police records, stay row, statuses, folio link, events.
 */
async function checkInTx(ctx: RCtx, tx: Tx, rrId: string, input: CheckInInput): Promise<Written> {
  const rr = await loadReservationRoom(ctx, rrId);
  const prop = await requireProperty(ctx, rr.propertyId);
  if (rr.status === 'CHECKED_IN' || rr.stay)
    throw conflict('This room is already checked in', { reason: 'ALREADY_CHECKED_IN' });
  if (rr.status !== 'CONFIRMED' || !['CONFIRMED', 'CHECKED_IN'].includes(rr.reservation.status))
    throw conflict(`A ${rr.status} reservation cannot be checked in`, {
      reason: 'INVALID_TRANSITION',
      status: rr.status,
    });
  const arrival = formatDay(rr.arrival);
  const departure = formatDay(rr.departure);
  const g = guardTransition(rr.status as ReservationStatusName, 'CHECKED_IN', {
    businessDate: prop.businessDate,
    arrival,
    departure,
    allRoomsAssigned: !!rr.roomId,
  });
  if (!g.ok) throw conflict(g.message, { reason: g.reason });
  const room = must(rr.room, 'Room');
  const overrideUsed = assertRoomReady(ctx, room, input.overrideDirty);

  await assertFiles(ctx, tx, input);
  const customFields = await validatePoliceCustomFields(ctx, input.police.customFields);
  const resolved = await resolveGuests(ctx, tx, rr, input.guests);

  const n = await tx.reservationRoom.updateMany({
    where: { id: rr.id, status: 'CONFIRMED' },
    data: { status: 'CHECKED_IN' },
  });
  if (n.count !== 1) throw conflict('The reservation changed meanwhile, retry');
  await tx.reservation.updateMany({
    where: { id: rr.reservationId, status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
    data: { status: 'CHECKED_IN' },
  });
  const stay = await tx.stay.create({
    data: {
      tenantId: ctx.tenantId,
      propertyId: rr.propertyId,
      reservationRoomId: rr.id,
      checkedInAt: new Date(),
      checkedInBy: ctx.actorId,
    },
  });

  const policeRecordIds: string[] = [];
  let primary: Written['primaryGuest'] | null = null;
  for (const [i, r] of resolved.entries()) {
    const guest = await saveGuestProfile(ctx, tx, r, {
      idDocFileId: i === 0 ? input.idScanFileId : undefined,
    });
    await tx.reservationGuest.upsert({
      where: { reservationRoomId_guestId: { reservationRoomId: rr.id, guestId: guest.id } },
      update: {},
      create: {
        tenantId: ctx.tenantId,
        reservationRoomId: rr.id,
        guestId: guest.id,
        isPrimary: i === 0 && !rr.reservationGuests.length,
      },
    });
    const snapshot = buildSnapshot(ctx, r, input.police, {
      arrival,
      departure,
      businessDate: prop.businessDate,
      roomNumber: room.number,
      reservationNumber: rr.reservation.number,
      primary: i === 0,
      customFields,
    });
    const rec = await tx.policeRecord.create({
      data: {
        tenantId: ctx.tenantId,
        stayId: stay.id,
        guestId: guest.id,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        signatureFileId: i === 0 ? (input.signatureFileId ?? null) : null,
      },
    });
    policeRecordIds.push(rec.id);
    if (i === 0)
      primary = {
        id: guest.id,
        firstName: guest.firstName,
        lastName: guest.lastName,
        email: guest.email,
        phone: guest.phone,
      };
  }

  const folio = await ensureRoomFolio(ctx, tx, rr.id);
  await publishPlanningChanged(tx, {
    propertyId: rr.propertyId,
    reservationId: rr.reservationId,
    action: 'check_in',
    from: arrival,
    to: departure,
    reservationRoomIds: [rr.id],
  });
  await publishStayEvent(tx, FRONT_DESK_EVENTS.checkedIn, {
    propertyId: rr.propertyId,
    stayId: stay.id,
    reservationId: rr.reservationId,
    reservationRoomId: rr.id,
    roomId: room.id,
  });
  return {
    stayId: stay.id,
    rr,
    roomId: room.id,
    roomNumber: room.number,
    folioId: folio.id,
    policeRecordIds,
    primaryGuest: primary!,
    overrideUsed,
    prop,
  };
}

/** After the commit: deposit (folio API), welcome message, audit. Never undoes the check-in. */
async function afterCheckIn(ctx: RCtx, w: Written, input: CheckInInput, extra: Record<string, unknown> = {}) {
  const warnings: string[] = [];
  let deposit: CheckInResult['deposit'] = null;
  if (input.deposit) {
    try {
      const r = await recordPayment(ctx, w.folioId, {
        method: input.deposit.method,
        amount: input.deposit.amount,
        reference: input.deposit.reference,
        isDeposit: true,
      });
      deposit = { ok: true, paymentId: r.payment.id, error: null };
    } catch (err) {
      const message = err instanceof AppError ? (err.detail ?? err.message) : (err as Error).message;
      deposit = { ok: false, paymentId: null, error: message };
      warnings.push(`DEPOSIT_FAILED: ${message}`);
    }
  }
  const notified = input.notifyGuest
    ? await sendStayNotice(ctx, {
        template: 'welcome',
        propertyId: w.rr.propertyId,
        guest: w.primaryGuest,
        hotel: { name: w.prop.name, phone: w.prop.phone },
        reservation: { roomNumber: w.roomNumber, checkOut: formatDay(w.rr.departure) },
        idempotencyKey: `stay:${w.stayId}:welcome`,
      })
    : false;
  await ctx.audit({
    action: 'front_desk.check_in',
    entity: 'stay',
    entityId: w.stayId,
    after: {
      reservationId: w.rr.reservationId,
      reservationRoomId: w.rr.id,
      roomId: w.roomId,
      roomNumber: w.roomNumber,
      guests: w.policeRecordIds.length,
      policeRecordIds: w.policeRecordIds,
      overrideDirty: w.overrideUsed,
      deposit: deposit ? { ok: deposit.ok, amount: input.deposit?.amount } : null,
      ...extra,
    },
  });
  return { deposit, notified, warnings };
}

function toResult(w: Written, a: Awaited<ReturnType<typeof afterCheckIn>>): CheckInResult {
  return {
    stayId: w.stayId,
    reservationRoomId: w.rr.id,
    reservationId: w.rr.reservationId,
    roomId: w.roomId,
    roomNumber: w.roomNumber,
    policeRecordIds: w.policeRecordIds,
    deposit: a.deposit,
    notified: a.notified,
    warnings: a.warnings,
  };
}

/** `POST /front-desk/stays` — check-in of one reservation room (OP-21). */
export async function checkIn(ctx: RCtx, input: CheckInInput): Promise<CheckInResult> {
  const rr0 = await loadReservationRoom(ctx, input.reservationRoomId);
  if (input.deposit) requirePermission(ctx, 'folio.pay', 'A deposit needs folio.pay');
  if (input.overrideDirty)
    requirePermission(ctx, 'front_desk.override_dirty', 'overrideDirty needs front_desk.override_dirty');
  if (rr0.status !== 'CONFIRMED')
    throw conflict(`A ${rr0.status} reservation cannot be checked in`, {
      reason: rr0.status === 'CHECKED_IN' ? 'ALREADY_CHECKED_IN' : 'INVALID_TRANSITION',
      status: rr0.status,
    });
  if (input.roomId && input.roomId !== rr0.roomId) {
    // Readiness first, so a dirty room is never assigned for nothing; assignment re-checks availability.
    const target = must(
      await ctx.db.room.findFirst({
        where: { id: input.roomId, propertyId: rr0.propertyId, deletedAt: null, isActive: true },
        select: { number: true, hkStatus: true },
      }),
      'Room',
    );
    assertRoomReady(ctx, target, input.overrideDirty);
    await assignRoom(ctx, rr0.reservationId, rr0.id, {
      roomId: input.roomId,
      changeRoomType: input.changeRoomType,
    });
  }
  const w = await ctx.db.$transaction(async (tx) => checkInTx(asCtx(ctx, tx), tx, rr0.id, input), TX_OPTS);
  return toResult(w, await afterCheckIn(ctx, w, input));
}

/** Picks the first ready unit of a room type that is free on every night of the stay. */
async function pickRoom(ctx: RCtx, prop: PropertyInfo, roomTypeId: string, departure: string) {
  const allowance = await settingAt(ctx, reservationSettings.overbookingAllowance, prop.id);
  const inv = await loadInventory(ctx.db as never, {
    propertyId: prop.id,
    from: prop.businessDate,
    to: departure,
    roomTypeIds: [roomTypeId],
    allowance,
  });
  const rooms = await ctx.db.room.findMany({
    where: { propertyId: prop.id, roomTypeId, deletedAt: null, isActive: true },
    orderBy: [{ number: 'asc' }],
    select: { id: true, number: true, hkStatus: true },
  });
  const nights = nightsOf(prop.businessDate, departure);
  const free = rooms.find(
    (r) =>
      READY_STATUSES.includes(r.hkStatus) && nights.every((n) => unitStatus(inv, r.id, n) === null),
  );
  if (!free)
    throw conflict('No clean unit of this room type is free for the whole stay', {
      reason: 'NO_CLEAN_ROOM',
      roomTypeId,
    });
  return free;
}

/** `POST /front-desk/walk-ins` — guest + reservation (today → departure) + check-in, atomic. */
export async function walkIn(ctx: RCtx, input: WalkInInput): Promise<CheckInResult> {
  const prop = await requireProperty(ctx, input.propertyId);
  if (input.departure <= prop.businessDate)
    throw invalid('departure', 'Departure must be after the business date');
  if (input.deposit) requirePermission(ctx, 'folio.pay', 'A deposit needs folio.pay');
  if (input.overrideDirty)
    requirePermission(ctx, 'front_desk.override_dirty', 'overrideDirty needs front_desk.override_dirty');
  let roomId = input.roomId;
  if (roomId) {
    const room = must(
      await ctx.db.room.findFirst({
        where: { id: roomId, propertyId: prop.id, deletedAt: null, isActive: true },
        select: { number: true, hkStatus: true },
      }),
      'Room',
    );
    assertRoomReady(ctx, room, input.overrideDirty);
  } else roomId = (await pickRoom(ctx, prop, input.roomTypeId, input.departure)).id;

  const { departure, roomTypeId, ratePlanId, adults, children, guest } = input;
  const checkInOf = (reservationRoomId: string): CheckInInput => ({
    reservationRoomId,
    changeRoomType: false,
    guests: input.guests,
    police: input.police,
    overrideDirty: input.overrideDirty,
    notifyGuest: input.notifyGuest,
    ...(input.signatureFileId ? { signatureFileId: input.signatureFileId } : {}),
    ...(input.idScanFileId ? { idScanFileId: input.idScanFileId } : {}),
    ...(input.deposit ? { deposit: input.deposit } : {}),
  });
  const w = await ctx.db.$transaction(async (tx) => {
    const tctx = asCtx(ctx, tx);
    const created = await createReservation(
      tctx,
      {
        propertyId: prop.id,
        arrival: prop.businessDate,
        departure,
        guest,
        ...(input.companyId ? { companyId: input.companyId } : {}),
        rooms: [{ roomTypeId, ratePlanId, roomId, adults, children }],
        status: 'CONFIRMED',
        channel: 'FRONT_DESK',
        ...(input.source ? { source: input.source } : {}),
        ...(input.segment ? { segment: input.segment } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        notifyGuest: false,
        joinWaitlistIfUnavailable: false,
      },
      { tx },
    );
    const line = created.reservation.rooms[0]!;
    return checkInTx(tctx, tx, line.id, checkInOf(line.id));
  }, TX_OPTS);
  await ctx.audit({
    action: 'front_desk.walk_in',
    entity: 'reservation',
    entityId: w.rr.reservationId,
    after: { reservationRoomId: w.rr.id, roomNumber: w.roomNumber, departure },
  });
  return toResult(
    w,
    await afterCheckIn(ctx, w, checkInOf(w.rr.id), { walkIn: true }),
  );
}

