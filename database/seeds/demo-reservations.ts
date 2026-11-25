import type {
  AdminClient,
  HkStatus,
  Prisma,
  ReservationChannel,
  ReservationStatus,
} from '../src/index.js';
import { seedId, SEED_CURRENCY, type Logger } from './common.js';
import { demoIds, type DemoTenantSpec, type RoomTypeSpec } from './demo-common.js';
import { JESS_SPEC } from './demo-jess.js';
import { KPALIME_SPEC } from './demo-kpalime.js';
import { LOME_SPEC } from './demo-lome.js';

/**
 * Demo reservations of the three demo tenants, relative to the reference date (UTC date of the
 * seed run, unless `referenceDate` is given). Every row has a deterministic id derived from its
 * slot (tenant + stay key), so running the seeds again upserts the same rows; when the reference
 * date moves, the same slots are re-dated and their unit nights rewritten.
 *
 * Numbering follows the server: `RES-{YYYY}-{seq:6}` from the `reservation` sequence of each
 * property. The sequence is advanced above the seeded numbers. Prices are the seeded rates
 * (base or season, per night, integer XOF) stored as a daily_prices snapshot.
 */

const DAY_MS = 86_400_000;
/** Statuses that hold a unit: only these get unit_nights rows. */
const ACTIVE_STATUSES: ReadonlySet<ReservationStatus> = new Set([
  'PENDING',
  'CONFIRMED',
  'CHECKED_IN',
]);
/** Rooms of a cancelled or no-show stay are released. */
const RELEASED_STATUSES: ReadonlySet<ReservationStatus> = new Set(['CANCELLED', 'NO_SHOW']);
const WAITLIST_KEY = 'SUI-request';

export interface StaySpec {
  /** Stable slot key, unique within the tenant. */
  key: string;
  status: ReservationStatus;
  channel: ReservationChannel;
  /** Lookup code of `reservation_source`. */
  source: string;
  /** Lookup code of `guest_segment`. */
  segment: string;
  /** Index (1..10) of the booker in the tenant's demo guests; further lines use the next guests. */
  guest: number;
  /** Arrival, in days relative to the reference date (negative = past). */
  start: number;
  nights: number;
  /** Room type code of each line (one entry per room). */
  lines: readonly string[];
  /** Confirmed lines without a room yet. */
  unassigned?: boolean;
  /** Key of the group dossier this stay belongs to. */
  group?: string;
  cancelReason?: string;
}

export interface WaitlistSpec {
  key: string;
  guest: number;
  roomTypeCode: string;
  start: number;
  nights: number;
}

const S = (
  key: string,
  status: ReservationStatus,
  channel: ReservationChannel,
  source: string,
  segment: string,
  guest: number,
  start: number,
  nights: number,
  lines: readonly string[],
  extra: Partial<Pick<StaySpec, 'unassigned' | 'group' | 'cancelReason'>> = {},
): StaySpec => ({ key, status, channel, source, segment, guest, start, nights, lines, ...extra });

/** Hôtel 2 Février (60 units): 24 stays, 1 waitlist entry. */
export const LOME_STAYS: StaySpec[] = [
  // In house: arrival <= today < departure.
  S('in-1', 'CHECKED_IN', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 1, -2, 5, ['STD']),
  S('in-2', 'CHECKED_IN', 'PHONE', 'PHONE', 'BUSINESS', 2, -1, 3, ['SUP']),
  S('in-3', 'CHECKED_IN', 'PORTAL', 'PORTAL', 'LEISURE', 3, 0, 4, ['BUN']),
  S('in-4', 'CHECKED_IN', 'AGENCY', 'AGENCY', 'LEISURE', 4, -3, 6, ['SUI']),
  // Past stays.
  S('out-1', 'CHECKED_OUT', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 5, -6, 3, ['STD']),
  S('out-2', 'CHECKED_OUT', 'PORTAL', 'PORTAL', 'BUSINESS', 6, -4, 2, ['SUP']),
  S('out-3', 'CHECKED_OUT', 'PHONE', 'PHONE', 'LEISURE', 7, -5, 4, ['BUN']),
  S('noshow-1', 'NO_SHOW', 'PORTAL', 'PORTAL', 'LEISURE', 8, -2, 2, ['STD']),
  S('cancel-1', 'CANCELLED', 'PHONE', 'PHONE', 'LEISURE', 9, 3, 2, ['STD'], {
    cancelReason: 'PRICE',
  }),
  S('cancel-2', 'CANCELLED', 'PORTAL', 'PORTAL', 'BUSINESS', 10, 10, 3, ['SUP'], {
    cancelReason: 'CHANGE_OF_PLANS',
  }),
  // Pending with an option expiry.
  S('opt-1', 'PENDING', 'PHONE', 'PHONE', 'LEISURE', 1, 5, 2, ['STD']),
  S('opt-2', 'PENDING', 'PHONE', 'WHATSAPP', 'LEISURE', 3, 8, 3, ['SUP']),
  S('opt-3', 'PENDING', 'AGENCY', 'AGENCY', 'LEISURE', 4, 12, 2, ['SUI']),
  // Confirmed and assigned.
  S('conf-1', 'CONFIRMED', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 2, 1, 2, ['STD']),
  S('conf-2', 'CONFIRMED', 'PORTAL', 'PORTAL', 'LEISURE', 4, 2, 4, ['STD']),
  S('conf-3', 'CONFIRMED', 'PHONE', 'PHONE', 'LEISURE', 5, 4, 3, ['BUN']),
  S('conf-4', 'CONFIRMED', 'PORTAL', 'PORTAL', 'BUSINESS', 6, 6, 2, ['SUP']),
  S('conf-5', 'CONFIRMED', 'AGENCY', 'AGENCY', 'LEISURE', 7, 9, 5, ['SUI']),
  S('conf-6', 'CONFIRMED', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 8, 11, 2, ['STD']),
  S('conf-7', 'CONFIRMED', 'PORTAL', 'PORTAL', 'LEISURE', 9, 15, 3, ['STD']),
  // Spans the start of the high season (2026-12-15).
  S('conf-8', 'CONFIRMED', 'PHONE', 'PHONE', 'BUSINESS', 10, 18, 5, ['SUP']),
  // Group dossier: three rooms under one group.
  S('group-1', 'CONFIRMED', 'PHONE', 'PHONE', 'GROUP', 1, 7, 3, ['STD', 'STD', 'STD'], {
    group: 'mission-demo',
  }),
  // Confirmed lines without a room yet.
  S('unassigned-1', 'CONFIRMED', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 2, 13, 2, ['SUP'], {
    unassigned: true,
  }),
  S('unassigned-2', 'CONFIRMED', 'PORTAL', 'PORTAL', 'LEISURE', 4, 20, 3, ['BUN'], {
    unassigned: true,
  }),
];

export const LOME_WAITLIST: WaitlistSpec[] = [
  { key: WAITLIST_KEY, guest: 6, roomTypeCode: 'SUI', start: 25, nights: 2 },
];

/** Jess Hôtel (30 rooms): 8 stays. */
export const JESS_STAYS: StaySpec[] = [
  S('conf-1', 'CONFIRMED', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 1, 2, 3, ['STD']),
  S('conf-2', 'CONFIRMED', 'PORTAL', 'PORTAL', 'LEISURE', 2, 5, 2, ['DLX']),
  S('conf-3', 'CONFIRMED', 'PHONE', 'PHONE', 'BUSINESS', 3, 10, 4, ['STD']),
  S('conf-4', 'CONFIRMED', 'AGENCY', 'AGENCY', 'LEISURE', 4, 16, 2, ['DLX']),
  S('opt-1', 'PENDING', 'PHONE', 'WHATSAPP', 'LEISURE', 5, 4, 2, ['STD']),
  S('opt-2', 'PENDING', 'PORTAL', 'PORTAL', 'BUSINESS', 6, 14, 3, ['DLX']),
  S('in-1', 'CHECKED_IN', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 7, -1, 3, ['STD']),
  S('in-2', 'CHECKED_IN', 'PORTAL', 'PORTAL', 'LEISURE', 8, -2, 4, ['DLX']),
];

/** Hôtel Collines Vertes, Kpalimé (20 rooms): 5 stays. */
export const KPALIME_STAYS: StaySpec[] = [
  S('conf-1', 'CONFIRMED', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 1, 3, 2, ['DBL']),
  S('conf-2', 'CONFIRMED', 'PORTAL', 'PORTAL', 'LEISURE', 2, 8, 3, ['FAM']),
  S('conf-3', 'CONFIRMED', 'PHONE', 'PHONE', 'LEISURE', 3, 12, 2, ['DBL']),
  S('opt-1', 'PENDING', 'PHONE', 'PHONE', 'LEISURE', 4, 6, 2, ['DBL']),
  S('in-1', 'CHECKED_IN', 'FRONT_DESK', 'FRONT_DESK', 'LEISURE', 5, -1, 2, ['FAM']),
];

interface TenantSeed {
  spec: DemoTenantSpec;
  stays: StaySpec[];
  waitlist: WaitlistSpec[];
}

const TENANTS: TenantSeed[] = [
  { spec: LOME_SPEC, stays: LOME_STAYS, waitlist: LOME_WAITLIST },
  { spec: JESS_SPEC, stays: JESS_STAYS, waitlist: [] },
  { spec: KPALIME_SPEC, stays: KPALIME_STAYS, waitlist: [] },
];

export interface DemoReservationsOptions {
  /** Reference date `YYYY-MM-DD` (UTC). Defaults to the UTC date of the run. */
  referenceDate?: string;
  log: Logger;
}

export interface DemoReservationsSummary {
  reservations: number;
  reservationRooms: number;
  unitNights: number;
  waitlistEntries: number;
}

// ───────────────────────────── pure planning ─────────────────────────────

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
}

/** Nights of a stay: arrival included, departure excluded. */
export function nightsFrom(arrival: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(arrival, i));
}

interface RoomUnit {
  number: string;
  roomTypeCode: string;
  id: string;
}

function roomsOf(slug: string, spec: DemoTenantSpec): RoomUnit[] {
  return spec.roomTypes.flatMap((rt) =>
    Array.from({ length: rt.count }, (_, i) => {
      const number = `${rt.numberPrefix}${pad(rt.numberStart + i)}`;
      return { number, roomTypeCode: rt.code, id: seedId(`room:${slug}:${number}`) };
    }),
  );
}

interface NightPriceSnapshot {
  date: string;
  rateId: string;
  seasonId: string | null;
  base: number;
  extraAdultAmount: number;
  extraChildAmount: number;
  total: number;
}

/** Base price per night, or the season price for nights inside the high season. */
function priceNights(slug: string, spec: DemoTenantSpec, rt: RoomTypeSpec, nights: string[]) {
  return nights.map((date): NightPriceSnapshot => {
    const inSeason = date >= spec.season.from && date <= spec.season.to;
    const price = inSeason ? rt.seasonPrice : rt.basePrice;
    return {
      date,
      rateId: seedId(`rate:${slug}:${rt.code}:${inSeason ? 'season' : 'base'}`),
      seasonId: inSeason ? seedId(`season:${slug}:${spec.season.name}`) : null,
      base: price,
      extraAdultAmount: 0,
      extraChildAmount: 0,
      total: price,
    };
  });
}

export interface PlannedLine {
  id: string;
  roomTypeId: string;
  roomId: string | null;
  roomNumber: string | null;
  ratePlanId: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  status: ReservationStatus;
  dailyPrices: NightPriceSnapshot[];
  guestIds: string[];
}

export interface PlannedReservation {
  id: string;
  number: string;
  status: ReservationStatus;
  channel: ReservationChannel;
  source: string;
  segment: string;
  bookerGuestId: string;
  groupId: string | null;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  cancelReason: string | null;
  lines: PlannedLine[];
}

export interface TenantPlan {
  slug: string;
  tenantId: string;
  propertyId: string;
  groups: Array<{ id: string; name: string }>;
  reservations: PlannedReservation[];
  waitlist: Array<{
    id: string;
    guestId: string;
    roomTypeId: string;
    arrival: string;
    departure: string;
  }>;
  /** Highest seeded sequence value (the next number is this + 1). */
  maxSequence: number;
  sequenceYear: number;
}

/**
 * Plans the stays of one tenant: assigns rooms (first free unit of the room type, verified against
 * every night already taken), prices every line and numbers the reservations. Pure: no I/O.
 */
export function planTenant(
  slug: string,
  spec: DemoTenantSpec,
  stays: readonly StaySpec[],
  waitlist: readonly WaitlistSpec[],
  referenceDate: string,
): TenantPlan {
  const tenantId = demoIds.tenant(slug);
  const propertyId = demoIds.property(slug);
  const sequenceYear = Number(referenceDate.slice(0, 4));
  const rooms = roomsOf(slug, spec);
  const taken = new Map<string, Set<string>>(); // room id -> nights already booked
  const ratePlanId = demoIds.ratePlan(slug);
  const roomType = (code: string): RoomTypeSpec => {
    const rt = spec.roomTypes.find((r) => r.code === code);
    if (!rt) throw new Error(`${slug}: unknown room type ${code}`);
    return rt;
  };
  const guestOf = (index: number) => seedId(`guest:${slug}:${((index - 1) % 10) + 1}`);

  const groups = new Map<string, { id: string; name: string }>();
  const reservations: PlannedReservation[] = stays.map((stay, index) => {
    const arrival = addDays(referenceDate, stay.start);
    const nights = nightsFrom(arrival, stay.nights);
    const departure = addDays(arrival, stay.nights);
    const holds = !RELEASED_STATUSES.has(stay.status) && !stay.unassigned;
    const id = seedId(`reservation:${slug}:${stay.key}`);
    const groupId = stay.group ? seedId(`group:${slug}:${stay.group}`) : null;
    if (stay.group) groups.set(stay.group, { id: groupId!, name: 'Groupe démo (fictif)' });

    const lines = stay.lines.map((code, i): PlannedLine => {
      const rt = roomType(code);
      let room: RoomUnit | undefined;
      if (holds) {
        room = rooms.find(
          (u) => u.roomTypeCode === code && nights.every((n) => !taken.get(u.id)?.has(n)),
        );
        if (!room) throw new Error(`${slug}: no free ${code} for stay ${stay.key}`);
        const set = taken.get(room.id) ?? new Set<string>();
        for (const n of nights) set.add(n);
        taken.set(room.id, set);
      }
      return {
        id: seedId(`reservation-room:${slug}:${stay.key}:${i + 1}`),
        roomTypeId: demoIds.roomType(slug, code),
        roomId: room?.id ?? null,
        roomNumber: room?.number ?? null,
        ratePlanId,
        arrival,
        departure,
        adults: 2,
        children: 0,
        status: stay.status,
        dailyPrices: priceNights(slug, spec, rt, nights),
        guestIds: [guestOf(stay.guest + i)],
      };
    });

    return {
      id,
      number: `RES-${sequenceYear}-${pad(index + 1, 6)}`,
      status: stay.status,
      channel: stay.channel,
      source: stay.source,
      segment: stay.segment,
      bookerGuestId: guestOf(stay.guest),
      groupId,
      arrival,
      departure,
      adults: lines.reduce((s, l) => s + l.adults, 0),
      children: lines.reduce((s, l) => s + l.children, 0),
      cancelReason: stay.cancelReason ?? null,
      lines,
    };
  });

  return {
    slug,
    tenantId,
    propertyId,
    groups: [...groups.values()],
    reservations,
    waitlist: waitlist.map((w) => {
      const arrival = addDays(referenceDate, w.start);
      return {
        id: seedId(`waitlist:${slug}:${w.key}`),
        guestId: guestOf(w.guest),
        roomTypeId: demoIds.roomType(slug, w.roomTypeCode),
        arrival,
        departure: addDays(arrival, w.nights),
      };
    }),
    maxSequence: reservations.length,
    sequenceYear,
  };
}

/** Unit nights of the planned lines holding a room in an active status. */
export function unitNightsOf(plan: TenantPlan) {
  const rows: Array<{
    id: string;
    tenantId: string;
    unitId: string;
    reservationRoomId: string;
    night: string;
  }> = [];
  for (const r of plan.reservations) {
    for (const l of r.lines) {
      if (!l.roomId || !ACTIVE_STATUSES.has(l.status)) continue;
      for (const night of nightsFrom(l.arrival, dayDiff(l.arrival, l.departure))) {
        rows.push({
          id: seedId(`unit-night:${plan.slug}:${l.roomNumber}:${night}`),
          tenantId: plan.tenantId,
          unitId: l.roomId,
          reservationRoomId: l.id,
          night,
        });
      }
    }
  }
  return rows;
}

function dayDiff(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS,
  );
}

/** Throws when two unit nights share a unit and a night (the database also enforces it). */
export function assertNoOverlap(rows: ReadonlyArray<{ unitId: string; night: string }>): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.unitId}|${row.night}`;
    if (seen.has(key)) throw new Error(`Overlapping unit nights: ${key}`);
    seen.add(key);
  }
}

// ───────────────────────────── housekeeping ─────────────────────────────

export interface PlannedBlock {
  id: string;
  roomId: string;
  roomNumber: string;
  from: string;
  to: string;
}

export interface HousekeepingPlan {
  statuses: Array<{ roomId: string; number: string; status: HkStatus }>;
  blocks: PlannedBlock[];
}

/** Rooms put out of order per demo property (with a maintenance block). */
const OUT_OF_ORDER_COUNT: Record<string, number> = { 'hotel-2-fevrier': 2, 'jess-hotel': 2 };

/**
 * Realistic housekeeping state at the reference date (business date): rooms of in-house stays are
 * CLEAN (arrived today) or alternately DIRTY (awaiting the daily service); rooms about to receive a
 * guest are CLEAN/INSPECTED; other vacant rooms are mostly INSPECTED/CLEAN with a few DIRTY; a
 * couple of rooms free around the date are OUT_OF_ORDER with a room block. Deterministic.
 */
export function planHousekeeping(
  slug: string,
  spec: DemoTenantSpec,
  plan: TenantPlan,
  referenceDate: string,
): HousekeepingPlan {
  const rooms = roomsOf(slug, spec);
  const lines = plan.reservations.flatMap((r) => r.lines);
  const inHouse = new Map<string, PlannedLine>();
  const arrivingSoon = new Set<string>();
  const busy = new Set<string>();
  const windowFrom = addDays(referenceDate, -1);
  const windowTo = addDays(referenceDate, 8);
  for (const l of lines) {
    if (!l.roomId || RELEASED_STATUSES.has(l.status)) continue;
    if (l.status === 'CHECKED_IN' && l.arrival <= referenceDate && referenceDate < l.departure)
      inHouse.set(l.roomId, l);
    if (l.status !== 'CHECKED_OUT' && l.arrival <= addDays(referenceDate, 1) && l.departure > referenceDate)
      arrivingSoon.add(l.roomId);
    if (l.status !== 'CHECKED_OUT' && l.arrival < windowTo && l.departure > windowFrom)
      busy.add(l.roomId);
  }
  const ooo = new Set<string>();
  for (const room of [...rooms].reverse()) {
    if (ooo.size >= (OUT_OF_ORDER_COUNT[slug] ?? 1)) break;
    if (!busy.has(room.id)) ooo.add(room.id);
  }
  let stayover = 0;
  let vacant = 0;
  const statuses = rooms.map((room): HousekeepingPlan['statuses'][number] => {
    let status: HkStatus;
    const line = inHouse.get(room.id);
    if (ooo.has(room.id)) status = 'OUT_OF_ORDER';
    else if (line) status = line.arrival === referenceDate || stayover++ % 2 === 1 ? 'CLEAN' : 'DIRTY';
    else if (arrivingSoon.has(room.id)) status = vacant++ % 2 === 0 ? 'INSPECTED' : 'CLEAN';
    else {
      const k = vacant++;
      status = k % 11 === 4 ? 'DIRTY' : k % 3 === 0 ? 'INSPECTED' : 'CLEAN';
    }
    return { roomId: room.id, number: room.number, status };
  });
  const blocks = statuses
    .filter((r) => r.status === 'OUT_OF_ORDER')
    .map((r) => ({
      id: seedId(`room-block:${slug}:${r.number}`),
      roomId: r.roomId,
      roomNumber: r.number,
      from: windowFrom,
      to: addDays(referenceDate, 7),
    }));
  return { statuses, blocks };
}

// ───────────────────────────── writes ─────────────────────────────

export async function seedDemoReservations(
  admin: AdminClient,
  options: DemoReservationsOptions,
): Promise<DemoReservationsSummary> {
  const referenceDate = options.referenceDate ?? utcDay();
  const plans = TENANTS.map((t) =>
    planTenant(t.spec.slug, t.spec, t.stays, t.waitlist, referenceDate),
  );
  const allUnitNights = plans.flatMap((p) => unitNightsOf(p));
  assertNoOverlap(allUnitNights);

  const summary: DemoReservationsSummary = {
    reservations: 0,
    reservationRooms: 0,
    unitNights: allUnitNights.length,
    waitlistEntries: 0,
  };
  const seededLineIds: string[] = [];

  for (const plan of plans) {
    for (const g of plan.groups) {
      await admin.group.upsert({
        where: { id: g.id },
        create: { id: g.id, tenantId: plan.tenantId, propertyId: plan.propertyId, name: g.name },
        update: { name: g.name },
      });
    }

    for (const r of plan.reservations) {
      const confirmed =
        r.status !== 'PENDING' && r.status !== 'CANCELLED' && r.status !== 'NO_SHOW';
      const cancelled = r.status === 'CANCELLED';
      const pending = r.status === 'PENDING';
      const data = {
        propertyId: plan.propertyId,
        bookerGuestId: r.bookerGuestId,
        groupId: r.groupId,
        number: r.number,
        status: r.status,
        channel: r.channel,
        source: r.source,
        segment: r.segment,
        arrival: new Date(`${r.arrival}T00:00:00Z`),
        departure: new Date(`${r.departure}T00:00:00Z`),
        adults: r.adults,
        children: r.children,
        pendingExpiresAt: pending ? new Date(`${addDays(referenceDate, 3)}T18:00:00Z`) : null,
        optionExpiresAt: pending ? new Date(`${addDays(referenceDate, 3)}T18:00:00Z`) : null,
        confirmedAt: confirmed ? new Date(`${addDays(referenceDate, -5)}T09:00:00Z`) : null,
        cancelledAt: cancelled ? new Date(`${addDays(referenceDate, -1)}T10:00:00Z`) : null,
        cancelReason: r.cancelReason,
      };
      await admin.reservation.upsert({
        where: { id: r.id },
        create: { id: r.id, tenantId: plan.tenantId, ...data },
        update: data,
      });
      summary.reservations += 1;

      for (const l of r.lines) {
        const lineData = {
          propertyId: plan.propertyId,
          reservationId: r.id,
          roomTypeId: l.roomTypeId,
          roomId: l.roomId,
          ratePlanId: l.ratePlanId,
          arrival: new Date(`${l.arrival}T00:00:00Z`),
          departure: new Date(`${l.departure}T00:00:00Z`),
          adults: l.adults,
          children: l.children,
          status: l.status,
          currency: SEED_CURRENCY,
          dailyPrices: l.dailyPrices as unknown as Prisma.InputJsonValue,
        };
        await admin.reservationRoom.upsert({
          where: { id: l.id },
          create: { id: l.id, tenantId: plan.tenantId, ...lineData },
          update: lineData,
        });
        seededLineIds.push(l.id);
        summary.reservationRooms += 1;

        const guests = [...new Set(l.guestIds)];
        await admin.reservationGuest.createMany({
          data: guests.map((guestId, i) => ({
            id: seedId(`reservation-guest:${l.id}:${guestId}`),
            tenantId: plan.tenantId,
            reservationRoomId: l.id,
            guestId,
            isPrimary: i === 0,
          })),
          skipDuplicates: true,
        });
      }
    }

    for (const w of plan.waitlist) {
      const data = {
        propertyId: plan.propertyId,
        guestId: w.guestId,
        roomTypeId: w.roomTypeId,
        arrival: new Date(`${w.arrival}T00:00:00Z`),
        departure: new Date(`${w.departure}T00:00:00Z`),
        adults: 2,
        children: 0,
        status: 'WAITING' as const,
        priority: 1,
        notes: 'Demande de suite (démo)',
      };
      await admin.waitlistEntry.upsert({
        where: { id: w.id },
        create: { id: w.id, tenantId: plan.tenantId, ...data },
        update: data,
      });
      summary.waitlistEntries += 1;
    }

    // Sequence: the next number must be above every seeded number, never backwards.
    const scope = `${plan.tenantId}:${plan.propertyId}`;
    const nextValue = BigInt(plan.maxSequence + 1);
    const existing = await admin.sequence.findFirst({
      where: { scope, key: 'reservation', year: plan.sequenceYear },
    });
    if (!existing) {
      await admin.sequence.create({
        data: {
          id: seedId(`sequence:${scope}:reservation:${plan.sequenceYear}`),
          tenantId: plan.tenantId,
          scope,
          key: 'reservation',
          year: plan.sequenceYear,
          nextValue,
        },
      });
    } else if (existing.nextValue < nextValue) {
      await admin.sequence.update({ where: { id: existing.id }, data: { nextValue } });
    }

    options.log(
      `${plan.slug}: ${plan.reservations.length} reservations, ${plan.waitlist.length} waitlist`,
    );
  }

  // Business date, housekeeping, in-house stays and their police records.
  const specs = new Map(TENANTS.map((t) => [t.spec.slug, t.spec]));
  for (const plan of plans) {
    await admin.property.update({
      where: { id: plan.propertyId },
      data: { businessDate: new Date(`${referenceDate}T00:00:00Z`) },
    });
    const hk = planHousekeeping(plan.slug, specs.get(plan.slug)!, plan, referenceDate);
    for (const r of hk.statuses)
      await admin.room.update({ where: { id: r.roomId }, data: { hkStatus: r.status } });
    for (const b of hk.blocks) {
      const data = {
        roomId: b.roomId,
        fromDate: new Date(`${b.from}T00:00:00Z`),
        toDate: new Date(`${b.to}T00:00:00Z`),
        reason: 'MAINTENANCE' as const,
        note: 'Remise en état (démo)',
      };
      await admin.roomBlock.upsert({
        where: { id: b.id },
        create: { id: b.id, tenantId: plan.tenantId, ...data },
        update: data,
      });
    }
    await seedInHouseStays(admin, plan, referenceDate);
    options.log(
      `${plan.slug}: business date ${referenceDate}, ${hk.statuses.length} rooms, ${hk.blocks.length} out of order`,
    );
  }

  // Unit nights are rebuilt from scratch for every seeded line, so a moved reference date cannot
  // leave stale nights behind.
  await admin.unitNight.deleteMany({ where: { reservationRoomId: { in: seededLineIds } } });
  await admin.unitNight.createMany({
    data: allUnitNights.map((n) => ({
      id: n.id,
      tenantId: n.tenantId,
      unitId: n.unitId,
      reservationRoomId: n.reservationRoomId,
      night: new Date(`${n.night}T00:00:00Z`),
    })),
  });
  options.log(
    `demo reservations: ${summary.reservations} reservations, ${summary.unitNights} unit nights`,
  );
  return summary;
}

/**
 * `stays` rows (and a minimal police record of the primary guest) for the CHECKED_IN lines, so
 * that the lazy creation of the front desk module stays a fallback. Idempotent.
 */
async function seedInHouseStays(admin: AdminClient, plan: TenantPlan, referenceDate: string) {
  const lines = plan.reservations
    .filter((r) => r.status === 'CHECKED_IN')
    .flatMap((r) => r.lines.map((l) => ({ r, l })));
  if (!lines.length) return;
  const guests = await admin.guest.findMany({
    where: { id: { in: lines.flatMap(({ l }) => l.guestIds) } },
  });
  const byId = new Map(guests.map((g) => [g.id, g]));
  for (const { r, l } of lines) {
    const checkedInAt = new Date(`${l.arrival <= referenceDate ? l.arrival : referenceDate}T14:00:00Z`);
    await admin.stay.createMany({
      data: [
        {
          id: seedId(`stay:${l.id}`),
          tenantId: plan.tenantId,
          propertyId: plan.propertyId,
          reservationRoomId: l.id,
          checkedInAt,
        },
      ],
      skipDuplicates: true,
    });
    const stay = await admin.stay.findUniqueOrThrow({ where: { reservationRoomId: l.id } });
    await admin.stay.update({ where: { id: stay.id }, data: { checkedInAt } });
    const guestId = l.guestIds[0];
    const g = guestId ? byId.get(guestId) : undefined;
    if (!guestId || !g) continue;
    await admin.policeRecord.createMany({
      data: [
        {
          id: seedId(`police:${l.id}:${guestId}`),
          tenantId: plan.tenantId,
          stayId: stay.id,
          guestId,
          snapshot: {
            version: 1,
            firstName: g.firstName,
            lastName: g.lastName,
            birthDate: null,
            birthPlace: null,
            nationality: null,
            profession: null,
            address: null,
            idDocType: null,
            idDocNumberEnc: null,
            idIssuedOn: null,
            idIssuedPlace: null,
            provenance: null,
            destination: null,
            purpose: null,
            arrival: l.arrival,
            departure: l.departure,
            businessDate: l.arrival,
            roomNumber: l.roomNumber,
            reservationNumber: r.number,
            primary: true,
            customFields: {},
          } as unknown as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
  }
}
