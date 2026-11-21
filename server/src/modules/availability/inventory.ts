import type { TransactionClient } from '@hm/database';
import { AppError } from '../../lib/errors.js';
import { formatDay, nightsOf, parseDay } from './dates.js';

/**
 * Lodging inventory (doc 03 §5, anti-overbooking).
 *
 * A unit (room) is unavailable on a night when it is OUT_OF_ORDER (housekeeping status, applied
 * to every night), covered by a `room_blocks` row, or already holds a `unit_nights` row.
 * Reservation rooms not yet assigned to a unit consume their room type inventory:
 *
 *   free(type, night) = units(type) − unavailable units(type, night) − unassigned(type, night)
 *                       + overbooking allowance
 *
 * Writers serialise on a per-(property, room type) advisory lock taken inside their transaction
 * before reading the inventory ({@link lockInventory}); assigned nights are additionally
 * protected by the `UNIQUE (unit_id, night)` constraint of `unit_nights`.
 */

/** Reservation statuses that hold inventory. */
export const HOLDING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN'] as const;

export type UnavailableReason = 'OUT_OF_ORDER' | 'BLOCKED' | 'OCCUPIED';

/** Minimal client shape (transaction client or RLS app client). */
export type InventoryDb = Pick<
  TransactionClient,
  'room' | 'roomBlock' | 'unitNight' | 'reservationRoom'
>;

export interface InventoryQuery {
  propertyId: string;
  /** First night (YYYY-MM-DD). */
  from: string;
  /** Day after the last night (exclusive). */
  to: string;
  roomTypeIds?: readonly string[] | undefined;
  /** Reservation rooms ignored (their own nights while re-checking an update or a move). */
  exclude?: readonly string[] | undefined;
  /** Extra units sellable per room type and night (setting, default 0). */
  allowance?: number | undefined;
}

export interface TypeNight {
  date: string;
  total: number;
  outOfOrder: number;
  blocked: number;
  occupied: number;
  unassigned: number;
  free: number;
}

export interface UnitNightHolder {
  reservationRoomId: string;
}

export interface Inventory {
  nights: string[];
  allowance: number;
  rooms: Map<string, { roomTypeId: string; hkStatus: string }>;
  /** date → roomId → reason. */
  unavailable: Map<string, Map<string, UnavailableReason>>;
  /** date → roomId → reservation room holding the unit. */
  holders: Map<string, Map<string, string>>;
  perType: Map<string, TypeNight[]>;
}

/** Takes the inventory advisory locks of the given room types (sorted: no deadlock). */
export async function lockInventory(
  tx: Pick<TransactionClient, '$executeRaw'>,
  propertyId: string,
  roomTypeIds: Iterable<string>,
): Promise<void> {
  const key = `inv:${propertyId}`;
  for (const rt of [...new Set(roomTypeIds)].sort())
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}), hashtext(${rt}))`;
}

/** Loads the inventory of a property for `[from, to)` with four queries (no N+1). */
export async function loadInventory(db: InventoryDb, q: InventoryQuery): Promise<Inventory> {
  const from = parseDay(q.from);
  const to = parseDay(q.to);
  const types = q.roomTypeIds?.length ? { roomTypeId: { in: [...q.roomTypeIds] } } : {};
  const exclude = q.exclude?.length ? [...q.exclude] : undefined;
  const [rooms, blocks, unitNights, unassigned] = await Promise.all([
    db.room.findMany({
      where: { propertyId: q.propertyId, deletedAt: null, isActive: true, ...types },
      select: { id: true, roomTypeId: true, hkStatus: true },
    }),
    db.roomBlock.findMany({
      where: {
        room: { propertyId: q.propertyId, deletedAt: null, isActive: true, ...types },
        fromDate: { lt: to },
        toDate: { gt: from },
      },
      select: { roomId: true, fromDate: true, toDate: true },
    }),
    db.unitNight.findMany({
      where: {
        unit: { propertyId: q.propertyId, deletedAt: null, isActive: true, ...types },
        night: { gte: from, lt: to },
        ...(exclude ? { reservationRoomId: { notIn: exclude } } : {}),
      },
      select: { unitId: true, night: true, reservationRoomId: true },
    }),
    db.reservationRoom.findMany({
      where: {
        propertyId: q.propertyId,
        roomId: null,
        status: { in: [...HOLDING_STATUSES] },
        arrival: { lt: to },
        departure: { gt: from },
        ...types,
        ...(exclude ? { id: { notIn: exclude } } : {}),
      },
      select: { roomTypeId: true, arrival: true, departure: true },
    }),
  ]);
  return buildInventory(q, rooms, blocks, unitNights, unassigned);
}

/** Pure part of {@link loadInventory} (exported for unit tests). */
export function buildInventory(
  q: Pick<InventoryQuery, 'from' | 'to' | 'roomTypeIds' | 'allowance'>,
  rooms: readonly { id: string; roomTypeId: string; hkStatus: string }[],
  blocks: readonly { roomId: string; fromDate: Date; toDate: Date }[],
  unitNights: readonly { unitId: string; night: Date; reservationRoomId: string }[],
  unassigned: readonly { roomTypeId: string; arrival: Date; departure: Date }[],
): Inventory {
  const nights = nightsOf(q.from, q.to);
  const allowance = q.allowance ?? 0;
  const roomMap = new Map(
    rooms.map((r) => [r.id, { roomTypeId: r.roomTypeId, hkStatus: r.hkStatus }]),
  );
  const unavailable = new Map<string, Map<string, UnavailableReason>>();
  const holders = new Map<string, Map<string, string>>();
  for (const n of nights) {
    unavailable.set(n, new Map());
    holders.set(n, new Map());
  }
  for (const r of rooms)
    if (r.hkStatus === 'OUT_OF_ORDER')
      for (const n of nights) unavailable.get(n)!.set(r.id, 'OUT_OF_ORDER');
  for (const b of blocks) {
    if (!roomMap.has(b.roomId)) continue;
    const f = formatDay(b.fromDate);
    const t = formatDay(b.toDate);
    for (const n of nights) {
      if (n < f || n >= t) continue;
      const m = unavailable.get(n)!;
      if (!m.has(b.roomId)) m.set(b.roomId, 'BLOCKED');
    }
  }
  for (const u of unitNights) {
    const n = formatDay(u.night);
    holders.get(n)?.set(u.unitId, u.reservationRoomId);
    const m = unavailable.get(n);
    if (m && roomMap.has(u.unitId) && !m.has(u.unitId)) m.set(u.unitId, 'OCCUPIED');
  }

  const typeIds = new Set<string>(q.roomTypeIds ?? []);
  for (const r of rooms) typeIds.add(r.roomTypeId);
  const perType = new Map<string, TypeNight[]>();
  const index = new Map<string, Map<string, TypeNight>>();
  for (const t of typeIds) {
    const list = nights.map((date) => ({
      date,
      total: 0,
      outOfOrder: 0,
      blocked: 0,
      occupied: 0,
      unassigned: 0,
      free: 0,
    }));
    perType.set(t, list);
    index.set(t, new Map(list.map((x) => [x.date, x])));
  }
  for (const r of rooms) for (const tn of perType.get(r.roomTypeId)!) tn.total++;
  for (const [date, m] of unavailable)
    for (const [roomId, reason] of m) {
      const tn = index.get(roomMap.get(roomId)!.roomTypeId)!.get(date)!;
      if (reason === 'OUT_OF_ORDER') tn.outOfOrder++;
      else if (reason === 'BLOCKED') tn.blocked++;
      else tn.occupied++;
    }
  for (const u of unassigned) {
    const byDate = index.get(u.roomTypeId);
    if (!byDate) continue;
    const a = formatDay(u.arrival);
    const d = formatDay(u.departure);
    for (const n of nights) if (n >= a && n < d) byDate.get(n)!.unassigned++;
  }
  for (const list of perType.values())
    for (const tn of list)
      tn.free =
        tn.total -
        tn.outOfOrder -
        tn.blocked -
        tn.occupied -
        tn.unassigned +
        (tn.total ? allowance : 0);
  return { nights, allowance, rooms: roomMap, unavailable, holders, perType };
}

export function freeOn(inv: Inventory, roomTypeId: string, date: string): number {
  return inv.perType.get(roomTypeId)?.find((t) => t.date === date)?.free ?? 0;
}

/** Why a unit cannot take a night (null when free). Unknown/inactive units are unavailable. */
export function unitStatus(
  inv: Inventory,
  roomId: string,
  date: string,
): UnavailableReason | 'UNKNOWN_UNIT' | null {
  if (!inv.rooms.has(roomId)) return 'UNKNOWN_UNIT';
  return inv.unavailable.get(date)?.get(roomId) ?? null;
}

/** A demand on the inventory: one reservation room line. */
export interface Demand {
  roomTypeId: string;
  arrival: string;
  departure: string;
  roomId?: string | null | undefined;
}

export interface ShortNight {
  roomTypeId: string;
  date: string;
  free: number;
  needed: number;
}

export interface UnitClash {
  roomId: string;
  date: string;
  reason: UnavailableReason | 'UNKNOWN_UNIT';
  reservationRoomId?: string | undefined;
}

/** Checks that `demands` fit in `inv` (which must not count them). Pure. */
export function checkDemands(
  inv: Inventory,
  demands: readonly Demand[],
): { short: ShortNight[]; clashes: UnitClash[] } {
  const needed = new Map<string, number>();
  const clashes: UnitClash[] = [];
  const takenUnits = new Set<string>();
  for (const d of demands) {
    for (const n of nightsOf(d.arrival, d.departure)) {
      const k = `${d.roomTypeId}|${n}`;
      needed.set(k, (needed.get(k) ?? 0) + 1);
      if (d.roomId) {
        const reason = unitStatus(inv, d.roomId, n);
        const dup = takenUnits.has(`${d.roomId}|${n}`);
        takenUnits.add(`${d.roomId}|${n}`);
        if (reason || dup)
          clashes.push({
            roomId: d.roomId,
            date: n,
            reason: reason ?? 'OCCUPIED',
            reservationRoomId: inv.holders.get(n)?.get(d.roomId),
          });
      }
    }
  }
  const short: ShortNight[] = [];
  for (const [k, count] of needed) {
    const [roomTypeId, date] = k.split('|') as [string, string];
    const free = freeOn(inv, roomTypeId, date);
    if (free < count) short.push({ roomTypeId, date, free, needed: count });
  }
  short.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { short, clashes };
}

/** Throws CONFLICT (409) with the failing nights / units when `demands` do not fit. */
export function assertDemands(inv: Inventory, demands: readonly Demand[]): void {
  const { short, clashes } = checkDemands(inv, demands);
  if (!short.length && !clashes.length) return;
  throw new AppError('CONFLICT', undefined, {
    detail: clashes.length
      ? 'The requested unit is not available on some nights'
      : 'No availability left for the requested room type on some nights',
    meta: { reason: clashes.length ? 'UNIT_UNAVAILABLE' : 'NO_AVAILABILITY', short, clashes },
  });
}

/** Date range `[from, to)` covering every demand. */
export function spanOf(demands: readonly { arrival: string; departure: string }[]) {
  let from = demands[0]!.arrival;
  let to = demands[0]!.departure;
  for (const d of demands) {
    if (d.arrival < from) from = d.arrival;
    if (d.departure > to) to = d.departure;
  }
  return { from, to };
}

/** True when a Prisma error is the `unit_nights (unit_id, night)` UNIQUE violation. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return !!e && (e.code === 'P2002' || /unique constraint/i.test(e.message ?? ''));
}
