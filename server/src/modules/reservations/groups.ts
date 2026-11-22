import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { lockInventory, spanOf } from '../availability/inventory.js';
import type { guestInput } from '../guests/schemas.js';
import { dayString, formatDay, invalid, must, uuid } from '../property/common.js';
import type { RCtx } from './context.js';
import { publishInventoryReleased, publishPlanningChanged } from './events.js';
import { splitCustomFields, type ReservationRow } from './repository.js';
import { guestRef } from './schemas.js';
import {
  createReservation,
  loadReservation,
  requireProperty,
  toReservation,
  TX_OPTS,
} from './service.js';

/**
 * Groups (OP-17, feature `groups`): a group dossier holds an allotment — a reservation without
 * booker whose unassigned room lines keep the block out of the inventory until the release
 * date. Picking up a room for a guest swaps one held line for the guest's own reservation in
 * the same transaction (inventory unchanged); the rooming list is the group's reservations.
 */

export const createGroupBody = z
  .object({
    propertyId: uuid,
    name: z.string().trim().min(1).max(160),
    companyId: uuid.optional(),
    arrival: dayString,
    departure: dayString,
    ratePlanId: uuid,
    /** Held rooms not picked up by then go back to the inventory. */
    releaseDate: dayString,
    blocks: z
      .array(
        z.object({
          roomTypeId: uuid,
          count: z.number().int().min(1).max(200),
          adults: z.number().int().min(1).max(20).default(2),
        }),
      )
      .min(1)
      .max(20),
    notes: z.string().max(4000).optional(),
  })
  .superRefine((v, c) => {
    if (v.departure <= v.arrival)
      c.addIssue({
        code: 'custom',
        path: ['departure'],
        message: 'Departure must be after arrival',
      });
    if (v.releaseDate > v.arrival)
      c.addIssue({
        code: 'custom',
        path: ['releaseDate'],
        message: 'The release date is on or before arrival',
      });
  });

export const pickUpBody = z.object({
  entries: z
    .array(
      z.object({
        guest: guestRef,
        roomTypeId: uuid,
        adults: z.number().int().min(1).max(20).default(1),
        children: z.number().int().min(0).max(20).default(0),
        roomId: uuid.optional(),
        guestIds: z.array(uuid).max(10).optional(),
      }),
    )
    .min(1)
    .max(100),
});

export const releaseBody = z.object({
  roomTypeId: uuid.optional(),
  /** Number of held rooms to release (all of the type when omitted). */
  count: z.number().int().min(1).max(200).optional(),
});

export const groupsQuery = z.object({ propertyId: uuid });

export const groupSchema = z.object({
  id: uuid,
  propertyId: uuid,
  name: z.string(),
  companyId: uuid.nullable(),
  allotmentReservationId: uuid.nullable(),
  releaseDate: z.string().nullable(),
  arrival: z.string().nullable(),
  departure: z.string().nullable(),
  block: z.array(
    z.object({ roomTypeId: uuid, held: z.number().int(), pickedUp: z.number().int() }),
  ),
  roomingList: z.array(
    z.object({
      reservationId: uuid,
      reservationRoomId: uuid,
      number: z.string(),
      status: z.string(),
      guestName: z.string(),
      roomTypeId: uuid,
      roomId: uuid.nullable(),
      roomNumber: z.string().nullable(),
      arrival: z.string(),
      departure: z.string(),
    }),
  ),
});
export type GroupDto = z.infer<typeof groupSchema>;

// Unused booker of the allotment (bookerGuestId: null is passed explicitly).
const NO_GUEST = { firstName: '-', lastName: '-' } satisfies z.input<typeof guestInput>;
const HOLD = ['PENDING', 'CONFIRMED'];

async function loadGroup(ctx: RCtx, id: string) {
  const g = must(await ctx.db.group.findUnique({ where: { id } }), 'Group');
  await requireProperty(ctx, g.propertyId);
  return g;
}

async function holderOf(ctx: RCtx, groupId: string): Promise<ReservationRow | null> {
  const h = await ctx.db.reservation.findFirst({
    where: { groupId, bookerGuestId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return h ? loadReservation(ctx.db as never, h.id) : null;
}

export async function getGroup(ctx: RCtx, id: string): Promise<GroupDto> {
  const g = await loadGroup(ctx, id);
  const holder = await holderOf(ctx, id);
  const members = await ctx.db.reservationRoom.findMany({
    where: { reservation: { groupId: id, bookerGuestId: { not: null } } },
    include: {
      room: { select: { number: true } },
      reservation: {
        select: {
          id: true,
          number: true,
          status: true,
          bookerGuest: { select: { firstName: true, lastName: true } },
        },
      },
      reservationGuests: {
        where: { isPrimary: true },
        include: { guest: { select: { firstName: true, lastName: true } } },
      },
    },
    orderBy: [{ arrival: 'asc' }, { id: 'asc' }],
  });
  const block = new Map<string, { roomTypeId: string; held: number; pickedUp: number }>();
  const entry = (t: string) => {
    let e = block.get(t);
    if (!e) block.set(t, (e = { roomTypeId: t, held: 0, pickedUp: 0 }));
    return e;
  };
  for (const rr of holder?.reservationRooms ?? [])
    if (HOLD.includes(rr.status)) entry(rr.roomTypeId).held++;
  for (const m of members)
    if (m.status !== 'CANCELLED' && m.status !== 'NO_SHOW') entry(m.roomTypeId).pickedUp++;
  const sys = holder ? splitCustomFields(holder.customFields).sys : {};
  return {
    id: g.id,
    propertyId: g.propertyId,
    name: g.name,
    companyId: g.companyId,
    allotmentReservationId: holder?.id ?? null,
    releaseDate: sys.allotment?.releaseDate ?? null,
    arrival: holder ? formatDay(holder.arrival) : null,
    departure: holder ? formatDay(holder.departure) : null,
    block: [...block.values()],
    roomingList: members.map((m) => {
      const p = m.reservationGuests[0]?.guest ?? m.reservation.bookerGuest;
      return {
        reservationId: m.reservation.id,
        reservationRoomId: m.id,
        number: m.reservation.number,
        status: m.status,
        guestName: p ? `${p.firstName} ${p.lastName}` : '',
        roomTypeId: m.roomTypeId,
        roomId: m.roomId,
        roomNumber: m.room?.number ?? null,
        arrival: formatDay(m.arrival),
        departure: formatDay(m.departure),
      };
    }),
  };
}

export async function listGroups(ctx: RCtx, propertyId: string) {
  await requireProperty(ctx, propertyId);
  const rows = await ctx.db.group.findMany({
    where: { propertyId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return {
    items: rows.map((g) => ({
      id: g.id,
      name: g.name,
      companyId: g.companyId,
      createdAt: g.createdAt.toISOString(),
    })),
  };
}

export async function createGroup(
  ctx: RCtx,
  input: z.infer<typeof createGroupBody>,
): Promise<GroupDto> {
  const prop = await requireProperty(ctx, input.propertyId);
  if (input.releaseDate < prop.businessDate)
    throw invalid(
      'releaseDate',
      `The release date is before the business date ${prop.businessDate}`,
    );
  if (input.companyId)
    must(
      await ctx.db.company.findFirst({ where: { id: input.companyId, deletedAt: null } }),
      'Company',
    );
  const groupId = await ctx.db.$transaction(async (tx) => {
    const g = await tx.group.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: prop.id,
        name: input.name,
        companyId: input.companyId ?? null,
      },
    });
    await createReservation(
      ctx,
      {
        propertyId: prop.id,
        arrival: input.arrival,
        departure: input.departure,
        guest: NO_GUEST,
        companyId: input.companyId,
        rooms: input.blocks.flatMap((b) =>
          Array.from({ length: b.count }, () => ({
            roomTypeId: b.roomTypeId,
            ratePlanId: input.ratePlanId,
            adults: b.adults,
            children: 0,
          })),
        ),
        status: 'CONFIRMED',
        channel: 'FRONT_DESK',
        notes: input.notes,
        notifyGuest: false,
        joinWaitlistIfUnavailable: false,
      },
      {
        groupId: g.id,
        bookerGuestId: null,
        sys: { allotment: { releaseDate: input.releaseDate } },
        tx,
      },
    );
    return g.id;
  }, TX_OPTS);
  const dto = await getGroup(ctx, groupId);
  await ctx.audit({ action: 'group.create', entity: 'group', entityId: groupId, after: dto });
  return dto;
}

/** Rooming list: each entry takes one held room of its type and becomes a reservation. */
export async function pickUp(ctx: RCtx, groupId: string, input: z.infer<typeof pickUpBody>) {
  const g = await loadGroup(ctx, groupId);
  const holder = await holderOf(ctx, groupId);
  if (!holder || !HOLD.includes(holder.status))
    throw new AppError('CONFLICT', undefined, { detail: 'The group has no open allotment' });
  const held = holder.reservationRooms.filter((rr) => HOLD.includes(rr.status));
  const used = new Set<string>();
  const plans = input.entries.map((e, i) => {
    const line = held.find((rr) => rr.roomTypeId === e.roomTypeId && !used.has(rr.id));
    if (!line)
      throw new AppError('CONFLICT', undefined, {
        detail: 'No held room left for this room type in the allotment',
        meta: { reason: 'BLOCK_EXHAUSTED', entry: i, roomTypeId: e.roomTypeId },
      });
    used.add(line.id);
    return { e, line };
  });
  const ids = await ctx.db.$transaction(async (tx) => {
    const out: string[] = [];
    for (const { e, line } of plans) {
      const r = await createReservation(
        ctx,
        {
          propertyId: g.propertyId,
          arrival: formatDay(line.arrival),
          departure: formatDay(line.departure),
          guest: e.guest,
          companyId: g.companyId ?? undefined,
          rooms: [
            {
              roomTypeId: line.roomTypeId,
              ratePlanId: line.ratePlanId,
              roomId: e.roomId ?? null,
              adults: e.adults,
              children: e.children,
              guestIds: e.guestIds,
            },
          ],
          status: 'CONFIRMED',
          channel: 'FRONT_DESK',
          notifyGuest: false,
          joinWaitlistIfUnavailable: false,
        },
        { groupId, releaseLineIds: [line.id], tx },
      );
      out.push(r.reservation.id);
    }
    return out;
  }, TX_OPTS);
  const reservations = [];
  for (const id of ids) {
    const dto = toReservation(await loadReservation(ctx.db as never, id));
    await ctx.audit({
      action: 'group.pick_up',
      entity: 'reservation',
      entityId: id,
      after: { groupId, number: dto.number },
    });
    reservations.push(dto);
  }
  return { group: await getGroup(ctx, groupId), reservations };
}

/** Gives held rooms back to the inventory (manually or at the release date). */
export async function releaseAllotment(
  ctx: RCtx,
  holderId: string,
  opts: {
    all?: boolean;
    roomTypeId?: string | undefined;
    count?: number | undefined;
    cause: string;
  },
): Promise<boolean> {
  const holder = await loadReservation(ctx.db as never, holderId);
  if (!holder.groupId || holder.bookerGuestId) throw invalid('id', 'Not a group allotment');
  const held = holder.reservationRooms.filter(
    (rr) =>
      HOLD.includes(rr.status) &&
      (opts.all || !opts.roomTypeId || rr.roomTypeId === opts.roomTypeId),
  );
  const lines = opts.all || !opts.count ? held : held.slice(0, opts.count);
  if (!lines.length && !HOLD.includes(holder.status)) return false;
  const remaining =
    holder.reservationRooms.filter((rr) => HOLD.includes(rr.status)).length - lines.length;
  await ctx.db.$transaction(async (tx) => {
    await lockInventory(
      tx,
      holder.propertyId,
      lines.map((l) => l.roomTypeId),
    );
    if (lines.length) {
      await tx.unitNight.deleteMany({
        where: { reservationRoomId: { in: lines.map((l) => l.id) } },
      });
      await tx.reservationRoom.updateMany({
        where: { id: { in: lines.map((l) => l.id) } },
        data: { status: 'CANCELLED' },
      });
      const span = spanOf(
        lines.map((l) => ({ arrival: formatDay(l.arrival), departure: formatDay(l.departure) })),
      );
      await publishPlanningChanged(tx, {
        propertyId: holder.propertyId,
        reservationId: holder.id,
        action: 'allotment_release',
        ...span,
        reservationRoomIds: lines.map((l) => l.id),
      });
      await publishInventoryReleased(tx, {
        propertyId: holder.propertyId,
        roomTypeIds: [...new Set(lines.map((l) => l.roomTypeId))],
        ...span,
        cause: opts.cause,
      });
    }
    if (remaining <= 0)
      await tx.reservation.update({
        where: { id: holder.id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'ALLOTMENT_RELEASED' },
      });
  }, TX_OPTS);
  await ctx.audit({
    action: 'group.release',
    entity: 'reservation',
    entityId: holder.id,
    after: { released: lines.map((l) => l.id), cause: opts.cause },
  });
  return true;
}

export async function releaseGroup(ctx: RCtx, groupId: string, input: z.infer<typeof releaseBody>) {
  await loadGroup(ctx, groupId);
  const holder = await holderOf(ctx, groupId);
  if (!holder) throw new AppError('CONFLICT', undefined, { detail: 'The group has no allotment' });
  await releaseAllotment(ctx, holder.id, {
    roomTypeId: input.roomTypeId,
    count: input.count,
    all: !input.roomTypeId && !input.count,
    cause: 'manual',
  });
  return getGroup(ctx, groupId);
}
