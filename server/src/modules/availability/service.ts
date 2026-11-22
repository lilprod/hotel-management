import type { z } from 'zod';
import { formatDay, parseDay } from '../property/common.js';
import { QuoteError } from '../rates/quote.js';
import type { RCtx } from '../reservations/context.js';
import { requireProperty, settingAt } from '../reservations/service.js';
import { reservationSettings } from '../reservations/settings.js';
import { buildInventory, HOLDING_STATUSES, loadInventory } from './inventory.js';
import { loadPricing, quoteLine } from './pricing.js';
import type { availabilityQuery, planningQuery } from './schemas.js';

/**
 * Availability search (OP-11): free units per room type and night, sellable flag and a quote per
 * active rate plan (minimum stay and occupancy enforced by the calculator).
 */
export async function searchAvailability(ctx: RCtx, q: z.infer<typeof availabilityQuery>) {
  const prop = await requireProperty(ctx, q.propertyId);
  const allowance = await settingAt(ctx, reservationSettings.overbookingAllowance, prop.id);
  const roomTypeIds = q.roomTypeId ? [q.roomTypeId] : undefined;
  const [inv, pricing] = await Promise.all([
    loadInventory(ctx.db as never, {
      propertyId: prop.id,
      from: q.arrival,
      to: q.departure,
      roomTypeIds,
      allowance,
    }),
    loadPricing(ctx.db as never, prop.id, roomTypeIds ? { roomTypeIds } : {}),
  ]);
  const roomTypes = [...pricing.roomTypes.values()]
    .filter((rt) => (rt as { isActive?: boolean }).isActive !== false)
    .map((rt) => {
      const nights =
        inv.perType.get(rt.id) ?? inv.nights.map((date) => ({ date, free: 0, total: 0 }));
      const freeByNight = nights.map((n) => ({ date: n.date, free: Math.max(0, n.free) }));
      const minFree = freeByNight.reduce((m, n) => Math.min(m, n.free), Number.MAX_SAFE_INTEGER);
      const fitsOccupancy = q.adults <= rt.maxAdults && q.children <= rt.maxChildren;
      const sellable = fitsOccupancy && minFree >= q.rooms;
      const ratePlans = [...pricing.plans.values()].map((p) => {
        const base = {
          ratePlanId: p.id,
          code: p.code,
          name: p.name,
          mealPlan: p.mealPlan,
          isPublic: p.isPublic,
        };
        try {
          const quote = quoteLine(pricing, {
            roomTypeId: rt.id,
            ratePlanId: p.id,
            arrival: q.arrival,
            departure: q.departure,
            adults: q.adults,
            children: q.children,
          });
          return {
            ...base,
            available: sellable,
            reason: sellable ? null : fitsOccupancy ? 'NO_AVAILABILITY' : 'INVALID_OCCUPANCY',
            message: null,
            quote: quote as unknown as Record<string, unknown>,
          };
        } catch (e) {
          if (!(e instanceof QuoteError)) throw e;
          return { ...base, available: false, reason: e.code, message: e.message, quote: null };
        }
      });
      return {
        roomTypeId: rt.id,
        code: rt.code,
        name: rt.name,
        maxAdults: rt.maxAdults,
        maxChildren: rt.maxChildren,
        totalUnits: nights[0]?.total ?? 0,
        fitsOccupancy,
        freeByNight,
        minFree: minFree === Number.MAX_SAFE_INTEGER ? 0 : minFree,
        sellable,
        ratePlans,
      };
    });
  return {
    propertyId: prop.id,
    arrival: q.arrival,
    departure: q.departure,
    nights: inv.nights.length,
    roomTypes,
  };
}

interface SegmentRow {
  id: string;
  reservationId: string;
  number: string;
  roomId: string | null;
  roomTypeId: string;
  status: string;
  arrival: Date;
  departure: Date;
  adults: number;
  children: number;
  groupId: string | null;
  guestName: string | null;
  isAllotment: boolean;
}

/**
 * Planning grid (OP-10): rooms grouped by type with their housekeeping status, reservation
 * segments, blocks and free units per type and night. Fixed query set (6 queries) whatever the
 * number of rooms and days.
 */
export async function planning(ctx: RCtx, q: z.infer<typeof planningQuery>) {
  const prop = await requireProperty(ctx, q.propertyId);
  const from = parseDay(q.from);
  const to = parseDay(q.to);
  const [allowance, roomTypes, rooms, blocks, unitNights, segments] = await Promise.all([
    settingAt(ctx, reservationSettings.overbookingAllowance, prop.id),
    ctx.db.roomType.findMany({
      where: { propertyId: prop.id, deletedAt: null },
      orderBy: [{ sort: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, name: true },
    }),
    ctx.db.room.findMany({
      where: { propertyId: prop.id, deletedAt: null, isActive: true },
      orderBy: [{ number: 'asc' }],
      select: {
        id: true,
        number: true,
        floor: true,
        building: true,
        hkStatus: true,
        roomTypeId: true,
      },
    }),
    ctx.db.roomBlock.findMany({
      where: {
        room: { propertyId: prop.id, deletedAt: null },
        fromDate: { lt: to },
        toDate: { gt: from },
      },
      orderBy: [{ fromDate: 'asc' }],
      select: { id: true, roomId: true, fromDate: true, toDate: true, reason: true, note: true },
    }),
    ctx.db.unitNight.findMany({
      where: {
        unit: { propertyId: prop.id, deletedAt: null, isActive: true },
        night: { gte: from, lt: to },
      },
      select: { unitId: true, night: true, reservationRoomId: true },
    }),
    ctx.db.$queryRaw<SegmentRow[]>`
      SELECT rr.id::text AS id, rr.reservation_id::text AS "reservationId", r.number,
             rr.room_id::text AS "roomId", rr.room_type_id::text AS "roomTypeId",
             rr.status::text AS status, rr.arrival, rr.departure, rr.adults, rr.children,
             r.group_id::text AS "groupId",
             coalesce(pg.first_name || ' ' || pg.last_name,
                      bg.first_name || ' ' || bg.last_name) AS "guestName",
             (r.group_id IS NOT NULL AND r.booker_guest_id IS NULL) AS "isAllotment"
      FROM reservation_rooms rr
      JOIN reservations r ON r.id = rr.reservation_id
      LEFT JOIN guests bg ON bg.id = r.booker_guest_id
      LEFT JOIN LATERAL (
        SELECT g.first_name, g.last_name FROM reservation_guests rg
        JOIN guests g ON g.id = rg.guest_id
        WHERE rg.reservation_room_id = rr.id
        ORDER BY rg.is_primary DESC, rg.created_at LIMIT 1
      ) pg ON true
      WHERE rr.property_id = ${prop.id}::uuid
        AND rr.arrival < ${q.to}::date AND rr.departure > ${q.from}::date
        AND rr.status NOT IN ('CANCELLED', 'NO_SHOW')
      ORDER BY rr.arrival, rr.id`,
  ]);
  const holding = new Set<string>(HOLDING_STATUSES);
  const inv = buildInventory(
    { from: q.from, to: q.to, roomTypeIds: roomTypes.map((t) => t.id), allowance },
    rooms,
    blocks,
    unitNights,
    segments
      .filter((s) => !s.roomId && holding.has(s.status))
      .map((s) => ({ roomTypeId: s.roomTypeId, arrival: s.arrival, departure: s.departure })),
  );
  const roomsByType = new Map<string, typeof rooms>();
  for (const r of rooms) {
    const list = roomsByType.get(r.roomTypeId) ?? [];
    list.push(r);
    roomsByType.set(r.roomTypeId, list);
  }
  return {
    propertyId: prop.id,
    from: q.from,
    to: q.to,
    businessDate: prop.businessDate,
    roomTypes: roomTypes.map((t) => ({
      id: t.id,
      code: t.code,
      name: t.name,
      rooms: (roomsByType.get(t.id) ?? []).map((r) => ({
        id: r.id,
        number: r.number,
        floor: r.floor,
        building: r.building,
        hkStatus: r.hkStatus,
      })),
      freeByNight: (inv.perType.get(t.id) ?? []).map((n) => ({ date: n.date, free: n.free })),
    })),
    segments: segments.map((s) => ({
      id: s.id,
      reservationId: s.reservationId,
      number: s.number,
      roomId: s.roomId,
      roomTypeId: s.roomTypeId,
      guestName: s.isAllotment ? '' : (s.guestName ?? ''),
      kind: s.isAllotment ? 'allotment' : s.groupId ? 'group' : 'reservation',
      status: s.status,
      arrival: formatDay(s.arrival),
      departure: formatDay(s.departure),
      adults: s.adults,
      children: s.children,
      groupId: s.groupId,
      colorKey: s.isAllotment ? 'allotment' : s.groupId ? 'group' : s.status.toLowerCase(),
    })),
    blocks: blocks.map((b) => ({
      id: b.id,
      roomId: b.roomId,
      fromDate: formatDay(b.fromDate),
      toDate: formatDay(b.toDate),
      reason: b.reason,
      note: b.note,
    })),
  };
}
