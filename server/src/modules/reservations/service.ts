import type { Prisma, ReservationStatus, TransactionClient } from '@hm/database';
import { AppError } from '../../lib/errors.js';
import { addDays, nightsOf } from '../availability/dates.js';
import {
  assertDemands,
  isUniqueViolation,
  loadInventory,
  lockInventory,
  spanOf,
  type Demand,
} from '../availability/inventory.js';
import {
  loadPricing,
  parseNightPrices,
  quoteLine,
  sumNights,
  toNightPrices,
  type NightPrice,
  type PricingData,
} from '../availability/pricing.js';
import { validateCustomFields } from '../custom-fields/validation.js';
import { insertGuest, loadGuest } from '../guests/service.js';
import { requireLookupCode } from '../lookups/service.js';
import { assertPropertyAccess, formatDay, invalid, must, parseDay } from '../property/common.js';
import { cancellationRules } from '../rates/schemas.js';
import { QuoteError } from '../rates/quote.js';
import { formatSequence, nextSequence, sequenceScope } from '../sequences/service.js';
import { now, sendGuestNotice, type RCtx } from './context.js';
import {
  publish,
  publishInventoryReleased,
  publishPlanningChanged,
  RESERVATION_EVENTS,
} from './events.js';
import {
  computePenalty,
  EDITABLE_STATUSES,
  guardTransition,
  type ReservationStatusName,
} from './lifecycle.js';
import {
  joinCustomFields,
  loadReservation,
  reservationInclude,
  splitCustomFields,
  toReservation,
  type ReservationRoomRow,
  type ReservationRow,
  type SysData,
} from './repository.js';
import type {
  CreateReservationInput,
  PenaltyDto,
  ReservationDto,
  UpdateReservationInput,
  Warning,
} from './schemas.js';
import { reservationSettings } from './settings.js';

type Tx = TransactionClient;
export const TX_OPTS = { maxWait: 20_000, timeout: 30_000 };
const HOLDING: readonly ReservationStatusName[] = ['PENDING', 'CONFIRMED', 'CHECKED_IN'];
const isHolding = (s: string) => (HOLDING as readonly string[]).includes(s);

// ───────────────────────────── helpers ─────────────────────────────

export interface PropertyInfo {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  currency: string;
  timezone: string;
  checkinTime: string;
  businessDate: string;
}

export async function requireProperty(ctx: RCtx, propertyId: string): Promise<PropertyInfo> {
  assertPropertyAccess(ctx, propertyId);
  const p = must(
    await ctx.db.property.findFirst({ where: { id: propertyId, deletedAt: null } }),
    'Property',
  );
  return {
    id: p.id,
    name: p.name,
    phone: p.phone,
    address: p.address,
    currency: p.currency,
    timezone: p.timezone,
    checkinTime: p.checkinTime,
    businessDate: formatDay(p.businessDate),
  };
}

export const settingAt = <T>(ctx: RCtx, def: { key: string; default: T }, propertyId: string) =>
  ctx.services.settings.get(def as never, { tenantId: ctx.tenantId, propertyId }) as Promise<T>;

function quoteFailure(e: unknown, path: string): never {
  if (e instanceof QuoteError) throw invalid(path, e.message, e.code);
  throw e;
}

function conflict(detail: string, meta: Record<string, unknown> = {}): AppError {
  return new AppError('CONFLICT', undefined, { detail, meta });
}

/** A reservation room line as written by the engine. */
export interface LineSpec {
  /** Existing reservation room (update) or undefined (new line). */
  id?: string | undefined;
  roomTypeId: string;
  ratePlanId: string;
  roomId: string | null;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  /** Guests of the line, primary first. */
  guestIds: string[];
  currency: string;
  dailyPrices: NightPrice[];
  status: ReservationStatusName;
}

const demandOf = (
  l: Pick<LineSpec, 'roomTypeId' | 'arrival' | 'departure' | 'roomId'>,
): Demand => ({
  roomTypeId: l.roomTypeId,
  arrival: l.arrival,
  departure: l.departure,
  roomId: l.roomId,
});

/** Rooms must exist, be active, belong to the property and match the line's room type. */
async function validateUnits(
  db: Pick<Tx, 'room'>,
  propertyId: string,
  lines: readonly { roomId: string | null; roomTypeId: string }[],
  path: (i: number) => string,
): Promise<void> {
  const ids = [...new Set(lines.flatMap((l) => (l.roomId ? [l.roomId] : [])))];
  if (!ids.length) return;
  const rooms = await db.room.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, propertyId: true, roomTypeId: true, isActive: true },
  });
  const byId = new Map(rooms.map((r) => [r.id, r]));
  lines.forEach((l, i) => {
    if (!l.roomId) return;
    const r = byId.get(l.roomId);
    if (!r || r.propertyId !== propertyId || !r.isActive)
      throw invalid(path(i), 'Unknown or inactive room in this property');
    if (r.roomTypeId !== l.roomTypeId)
      throw invalid(path(i), 'The room belongs to another room type', 'ROOM_TYPE_MISMATCH');
  });
}

/** Writes unit nights of assigned lines; the UNIQUE (unit_id, night) violation → 409. */
async function insertUnitNights(
  tx: Tx,
  tenantId: string,
  lines: readonly { id: string; roomId: string | null; arrival: string; departure: string }[],
) {
  const data = lines.flatMap((l) =>
    l.roomId
      ? nightsOf(l.arrival, l.departure).map((n) => ({
          tenantId,
          unitId: l.roomId!,
          reservationRoomId: l.id,
          night: parseDay(n),
        }))
      : [],
  );
  if (!data.length) return;
  try {
    await tx.unitNight.createMany({ data });
  } catch (err) {
    if (isUniqueViolation(err))
      throw conflict('The unit is already booked on some of these nights', {
        reason: 'UNIT_UNAVAILABLE',
      });
    throw err;
  }
}

function writeGuests(
  tx: Tx,
  tenantId: string,
  reservationRoomId: string,
  guestIds: readonly string[],
) {
  const unique = [...new Set(guestIds)];
  if (!unique.length) return Promise.resolve();
  return tx.reservationGuest.createMany({
    data: unique.map((guestId, i) => ({
      tenantId,
      reservationRoomId,
      guestId,
      isPrimary: i === 0,
    })),
  });
}

async function assertGuests(db: Pick<Tx, 'guest'>, ids: readonly string[], path: string) {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const n = await db.guest.count({ where: { id: { in: unique }, deletedAt: null } });
  if (n !== unique.length) throw invalid(path, 'Unknown guest');
}

/** Price lines from the rate grid. */
function priceNew(
  pricing: PricingData,
  l: Omit<LineSpec, 'dailyPrices' | 'currency' | 'status' | 'guestIds' | 'id'>,
  path: string,
) {
  try {
    const q = quoteLine(pricing, l);
    return {
      currency: q.currency,
      dailyPrices: toNightPrices(q.nightly),
      total: q.total,
      taxes: q.exclusiveTaxTotal,
    };
  } catch (e) {
    return quoteFailure(e, path);
  }
}

function headerOf(lines: readonly LineSpec[]) {
  const active = lines.filter((l) => isHolding(l.status));
  const list = active.length ? active : lines;
  const { from, to } = spanOf(list);
  return {
    arrival: parseDay(from),
    departure: parseDay(to),
    adults: list.reduce((s, l) => s + l.adults, 0),
    children: list.reduce((s, l) => s + l.children, 0),
  };
}

function specOf(rr: ReservationRoomRow): LineSpec {
  return {
    id: rr.id,
    roomTypeId: rr.roomTypeId,
    ratePlanId: rr.ratePlanId,
    roomId: rr.roomId,
    arrival: formatDay(rr.arrival),
    departure: formatDay(rr.departure),
    adults: rr.adults,
    children: rr.children,
    guestIds: rr.reservationGuests
      .slice()
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
      .map((g) => g.guestId),
    currency: rr.currency,
    dailyPrices: parseNightPrices(rr.dailyPrices),
    status: rr.status,
  };
}

/** (type, night) pairs given back between `before` and `after`. */
function released(before: readonly LineSpec[], after: readonly LineSpec[]) {
  const count = (lines: readonly LineSpec[]) => {
    const m = new Map<string, number>();
    for (const l of lines)
      if (isHolding(l.status))
        for (const n of nightsOf(l.arrival, l.departure)) {
          const k = `${l.roomTypeId}|${n}`;
          m.set(k, (m.get(k) ?? 0) + 1);
        }
    return m;
  };
  const a = count(after);
  const types = new Set<string>();
  const nights: string[] = [];
  for (const [k, c] of count(before)) {
    if ((a.get(k) ?? 0) >= c) continue;
    const [t, n] = k.split('|') as [string, string];
    types.add(t);
    nights.push(n);
  }
  if (!nights.length) return null;
  nights.sort();
  return { roomTypeIds: [...types], from: nights[0]!, to: addDays(nights[nights.length - 1]!, 1) };
}

async function auditReservation(
  ctx: RCtx,
  action: string,
  before: ReservationDto | null,
  after: ReservationDto,
) {
  await ctx.audit({
    action,
    entity: 'reservation',
    entityId: after.id,
    ...(before ? { before: before as unknown as Record<string, unknown> } : {}),
    after: after as unknown as Record<string, unknown>,
  });
}

// ───────────────────────────── create ─────────────────────────────

export interface CreateOptions {
  groupId?: string;
  sys?: SysData;
  /** Reservation rooms deleted in the same transaction before the check (group pick-up). */
  releaseLineIds?: readonly string[];
  /** Reuse the caller's transaction (group pick-up of a rooming list). */
  tx?: Tx;
  bookerGuestId?: string | null;
}

export interface CreateResult {
  reservation: ReservationDto;
  warnings: Warning[];
  quotes: { reservationRoomId: string; total: number; taxes: number }[];
}

/** Validated, priced plan of a creation (everything that can be checked before the lock). */
interface CreatePlan {
  prop: PropertyInfo;
  lines: LineSpec[];
  totals: { total: number; taxes: number }[];
  bookerId: string | null;
  newGuest: CreateReservationInput['guest'] | null;
  warnings: Warning[];
  customFields: Record<string, unknown>;
  allowance: number;
  pattern: string;
  pendingExpiresAt: Date | null;
}

async function planCreate(
  ctx: RCtx,
  input: CreateReservationInput,
  opts: CreateOptions,
): Promise<CreatePlan> {
  const prop = await requireProperty(ctx, input.propertyId);
  const warnings: Warning[] = [];
  let bookerId: string | null = opts.bookerGuestId ?? null;
  let newGuest: CreatePlan['newGuest'] = null;
  if (opts.bookerGuestId === undefined) {
    if ('id' in input.guest) {
      const g = await loadGuest(ctx.db as never, input.guest.id);
      bookerId = g.id;
      if (g.isBlacklisted)
        warnings.push({
          code: 'GUEST_BLACKLISTED',
          message: `${g.firstName} ${g.lastName} is on the blacklist`,
          meta: { guestId: g.id },
        });
    } else newGuest = input.guest;
  }
  if (input.source) await requireLookupCode(ctx.db, 'reservation_source', input.source, 'source');
  if (input.segment) await requireLookupCode(ctx.db, 'guest_segment', input.segment, 'segment');
  const customFields = await validateCustomFields(ctx.db, 'reservation', input.customFields ?? {});

  const raw = input.rooms.map((r) => ({
    roomTypeId: r.roomTypeId,
    ratePlanId: r.ratePlanId,
    roomId: r.roomId ?? null,
    arrival: r.arrival ?? input.arrival,
    departure: r.departure ?? input.departure,
    adults: r.adults,
    children: r.children,
    extraGuests: r.guestIds ?? [],
  }));
  raw.forEach((l, i) => {
    if (l.departure <= l.arrival)
      throw invalid(`rooms.${i}.departure`, 'Departure must be after arrival');
    if (l.arrival < prop.businessDate)
      throw invalid(
        `rooms.${i}.arrival`,
        `Arrival is before the business date ${prop.businessDate}`,
        'BEFORE_BUSINESS_DATE',
      );
  });
  await assertGuests(
    ctx.db as never,
    raw.flatMap((l) => l.extraGuests),
    'rooms.guestIds',
  );
  await validateUnits(ctx.db as never, prop.id, raw, (i) => `rooms.${i}.roomId`);

  const pricing = await loadPricing(ctx.db as never, prop.id, {
    roomTypeIds: [...new Set(raw.map((l) => l.roomTypeId))],
    ratePlanIds: [...new Set(raw.map((l) => l.ratePlanId))],
  });
  const totals: CreatePlan['totals'] = [];
  const status: ReservationStatusName = input.status;
  const lines: LineSpec[] = raw.map((l, i) => {
    const p = priceNew(pricing, l, `rooms.${i}`);
    totals.push({ total: p.total, taxes: p.taxes });
    return {
      roomTypeId: l.roomTypeId,
      ratePlanId: l.ratePlanId,
      roomId: l.roomId,
      arrival: l.arrival,
      departure: l.departure,
      adults: l.adults,
      children: l.children,
      guestIds: l.extraGuests,
      currency: p.currency,
      dailyPrices: p.dailyPrices,
      status,
    };
  });
  const [allowance, pattern, optionHours] = await Promise.all([
    settingAt(ctx, reservationSettings.overbookingAllowance, prop.id),
    settingAt(ctx, reservationSettings.numberPattern, prop.id),
    settingAt(ctx, reservationSettings.optionHours, prop.id),
  ]);
  let pendingExpiresAt: Date | null = null;
  if (status === 'PENDING') {
    pendingExpiresAt = input.optionExpiresAt
      ? new Date(input.optionExpiresAt)
      : new Date(now().getTime() + optionHours * 3_600_000);
    if (pendingExpiresAt.getTime() <= now().getTime())
      throw invalid('optionExpiresAt', 'The option expiry must be in the future');
  }
  return {
    prop,
    lines,
    totals,
    bookerId,
    newGuest,
    warnings,
    customFields,
    allowance,
    pattern,
    pendingExpiresAt,
  };
}

async function writeCreate(
  ctx: RCtx,
  tx: Tx,
  input: CreateReservationInput,
  plan: CreatePlan,
  opts: CreateOptions,
): Promise<{ id: string; lineIds: string[] }> {
  const { prop, lines } = plan;
  let releasedTypes: string[] = [];
  if (opts.releaseLineIds?.length) {
    const rel = await tx.reservationRoom.findMany({
      where: { id: { in: [...opts.releaseLineIds] }, propertyId: prop.id },
      select: { id: true, roomTypeId: true },
    });
    if (rel.length !== opts.releaseLineIds.length)
      throw conflict('Held rooms are no longer available');
    releasedTypes = rel.map((r) => r.roomTypeId);
  }
  await lockInventory(tx, prop.id, [...lines.map((l) => l.roomTypeId), ...releasedTypes]);
  if (opts.releaseLineIds?.length)
    await tx.reservationRoom.deleteMany({ where: { id: { in: [...opts.releaseLineIds] } } });
  const { from, to } = spanOf(lines);
  const inv = await loadInventory(tx, {
    propertyId: prop.id,
    from,
    to,
    roomTypeIds: [...new Set(lines.map((l) => l.roomTypeId))],
    allowance: plan.allowance,
  });
  assertDemands(inv, lines.map(demandOf));

  let bookerId = plan.bookerId;
  if (plan.newGuest && !('id' in plan.newGuest))
    bookerId = (await insertGuest(ctx, tx, plan.newGuest)).id;

  const year = Number(prop.businessDate.slice(0, 4));
  const seq = await nextSequence(tx, sequenceScope(ctx.tenantId, prop.id), 'reservation', { year });
  const number = formatSequence(plan.pattern, seq, year);
  const header = headerOf(lines);
  const status = lines[0]!.status;
  const at = now();
  const r = await tx.reservation.create({
    data: {
      tenantId: ctx.tenantId,
      propertyId: prop.id,
      number,
      status,
      channel: input.channel,
      source: input.source ?? null,
      segment: input.segment ?? null,
      bookerGuestId: bookerId,
      companyId: input.companyId ?? null,
      groupId: opts.groupId ?? null,
      ...header,
      notes: input.notes ?? null,
      pendingExpiresAt: plan.pendingExpiresAt,
      optionExpiresAt: plan.pendingExpiresAt,
      confirmedAt: status === 'CONFIRMED' ? at : null,
      customFields: joinCustomFields(plan.customFields, opts.sys ?? {}),
      createdBy: ctx.actorId,
    },
  });
  const created: { id: string; roomId: string | null; arrival: string; departure: string }[] = [];
  for (const l of lines) {
    const rr = await tx.reservationRoom.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: prop.id,
        reservationId: r.id,
        roomTypeId: l.roomTypeId,
        roomId: l.roomId,
        ratePlanId: l.ratePlanId,
        arrival: parseDay(l.arrival),
        departure: parseDay(l.departure),
        adults: l.adults,
        children: l.children,
        status: l.status,
        currency: l.currency,
        dailyPrices: l.dailyPrices as unknown as Prisma.InputJsonValue,
      },
    });
    created.push({ id: rr.id, roomId: l.roomId, arrival: l.arrival, departure: l.departure });
    await writeGuests(tx, ctx.tenantId, rr.id, bookerId ? [bookerId, ...l.guestIds] : l.guestIds);
  }
  await insertUnitNights(tx, ctx.tenantId, created);
  await publishPlanningChanged(tx, {
    propertyId: prop.id,
    reservationId: r.id,
    action: 'created',
    from,
    to,
    reservationRoomIds: created.map((c) => c.id),
  });
  await publish(tx, RESERVATION_EVENTS.created, {
    propertyId: prop.id,
    reservationId: r.id,
    number,
    status,
  });
  return { id: r.id, lineIds: created.map((c) => c.id) };
}

/** Creates a reservation dossier (multi-room), anti-overbooking checked under lock. */
export async function createReservation(
  ctx: RCtx,
  input: CreateReservationInput,
  opts: CreateOptions = {},
): Promise<CreateResult> {
  const plan = await planCreate(ctx, input, opts);
  const out = opts.tx
    ? await writeCreate(ctx, opts.tx, input, plan, opts)
    : await ctx.db.$transaction((tx) => writeCreate(ctx, tx, input, plan, opts), TX_OPTS);
  const db: unknown = opts.tx ? opts.tx : (ctx.db as unknown);
  const dto = toReservation(await loadReservation(db as never, out.id));
  if (!opts.tx) await afterCreate(ctx, dto, plan, input.notifyGuest);
  return {
    reservation: dto,
    warnings: plan.warnings,
    quotes: out.lineIds.map((id, i) => ({ reservationRoomId: id, ...plan.totals[i]! })),
  };
}

export async function afterCreate(
  ctx: RCtx,
  dto: ReservationDto,
  plan: { prop: PropertyInfo },
  notifyGuest: boolean,
) {
  await auditReservation(ctx, 'reservation.create', null, dto);
  if (dto.status === 'CONFIRMED' && notifyGuest) await sendConfirmation(ctx, dto, plan.prop);
}

// ───────────────────────────── notifications ─────────────────────────────

export async function sendConfirmation(ctx: RCtx, dto: ReservationDto, prop: PropertyInfo) {
  const b = dto.booker;
  if (!b || (!b.email && !b.phone)) return;
  const channels = await settingAt(ctx, reservationSettings.reminderChannels, prop.id);
  const roomType = await ctx.db.roomType.findUnique({
    where: { id: dto.rooms[0]!.roomTypeId },
    select: { name: true },
  });
  try {
    await sendGuestNotice(ctx.services, {
      tenantId: ctx.tenantId,
      channels,
      to: { ...(b.email ? { email: b.email } : {}), ...(b.phone ? { phone: b.phone } : {}) },
      templateCode: 'booking_confirmation',
      guestId: b.id,
      data: {
        guest: { firstName: b.firstName, lastName: b.lastName },
        hotel: { name: prop.name, phone: prop.phone ?? '' },
        reservation: {
          number: dto.number,
          checkIn: dto.arrival,
          checkOut: dto.departure,
          nights: nightsOf(dto.arrival, dto.departure).length,
          guests: dto.adults + dto.children,
          roomType: roomType?.name ?? '',
          total: { amount: dto.roomTotal, currency: dto.currency },
        },
      },
      idempotencyKey: `reservation:${dto.id}:confirmation`,
    });
  } catch (err) {
    ctx.services.logger.warn('booking confirmation not sent', { err, reservationId: dto.id });
  }
}

/** Cancellation notice to the booker, with the penalty actually charged (0 when waived). */
export async function sendCancellation(
  ctx: RCtx,
  dto: ReservationDto,
  prop: PropertyInfo,
  penalty: PenaltyDto,
) {
  const b = dto.booker;
  if (!b || (!b.email && !b.phone)) return;
  try {
    const channels = await settingAt(ctx, reservationSettings.reminderChannels, prop.id);
    const roomType = await ctx.db.roomType.findUnique({
      where: { id: dto.rooms[0]!.roomTypeId },
      select: { name: true },
    });
    await sendGuestNotice(ctx.services, {
      tenantId: ctx.tenantId,
      channels,
      to: { ...(b.email ? { email: b.email } : {}), ...(b.phone ? { phone: b.phone } : {}) },
      templateCode: 'reservation_cancelled',
      guestId: b.id,
      data: {
        guest: { firstName: b.firstName, lastName: b.lastName },
        hotel: { name: prop.name, phone: prop.phone ?? '' },
        reservation: {
          number: dto.number,
          checkIn: dto.arrival,
          checkOut: dto.departure,
          roomType: roomType?.name ?? '',
        },
        penalty: {
          applies: penalty.amount > 0,
          amount: { amount: penalty.amount, currency: penalty.currency },
        },
      },
      idempotencyKey: `reservation:${dto.id}:cancelled`,
    });
  } catch (err) {
    ctx.services.logger.warn('cancellation notice not sent', { err, reservationId: dto.id });
  }
}

// ───────────────────────────── read ─────────────────────────────

export async function getReservation(ctx: RCtx, id: string): Promise<ReservationDto> {
  const r = await loadReservation(ctx.db as never, id);
  assertPropertyAccess(ctx, r.propertyId);
  return toReservation(r);
}

export interface ListQuery {
  propertyId: string;
  from?: string | undefined;
  to?: string | undefined;
  arrivalFrom?: string | undefined;
  arrivalTo?: string | undefined;
  status?: ReservationStatusName[] | undefined;
  guestId?: string | undefined;
  groupId?: string | undefined;
  source?: string | undefined;
  search?: string | undefined;
  includeAllotments: boolean;
  limit: number;
  cursor?: string | undefined;
}

export async function listReservations(ctx: RCtx, q: ListQuery) {
  assertPropertyAccess(ctx, q.propertyId);
  const and: Prisma.ReservationWhereInput[] = [{ propertyId: q.propertyId }];
  if (q.from) and.push({ departure: { gt: parseDay(q.from) } });
  if (q.to) and.push({ arrival: { lt: parseDay(q.to) } });
  if (q.arrivalFrom) and.push({ arrival: { gte: parseDay(q.arrivalFrom) } });
  if (q.arrivalTo) and.push({ arrival: { lte: parseDay(q.arrivalTo) } });
  if (q.status) and.push({ status: { in: q.status as ReservationStatus[] } });
  if (q.groupId) and.push({ groupId: q.groupId });
  if (q.source) and.push({ source: q.source });
  if (q.guestId)
    and.push({
      OR: [
        { bookerGuestId: q.guestId },
        { reservationRooms: { some: { reservationGuests: { some: { guestId: q.guestId } } } } },
      ],
    });
  if (q.search) {
    const s = q.search;
    and.push({
      OR: [
        { number: { contains: s, mode: 'insensitive' } },
        { bookerGuest: { lastName: { contains: s, mode: 'insensitive' } } },
        { bookerGuest: { firstName: { contains: s, mode: 'insensitive' } } },
        { bookerGuest: { email: { contains: s, mode: 'insensitive' } } },
        { bookerGuest: { phone: { contains: s } } },
      ],
    });
  }
  // Allotment holders (group blocks) are the only dossiers without a booker.
  if (!q.includeAllotments) and.push({ NOT: { groupId: { not: null }, bookerGuestId: null } });
  const rows = await ctx.db.reservation.findMany({
    where: { AND: and },
    include: reservationInclude,
    orderBy: [{ arrival: 'asc' }, { id: 'asc' }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > q.limit;
  const items = (hasMore ? rows.slice(0, q.limit) : rows).map(toReservation);
  return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
}

// ───────────────────────────── rebook (update / move / assign / dates) ─────────────────────────────

export interface LineChange {
  id?: string | undefined;
  remove?: boolean | undefined;
  roomTypeId?: string | undefined;
  ratePlanId?: string | undefined;
  /** undefined = keep, null = unassign. */
  roomId?: string | null | undefined;
  arrival?: string | undefined;
  departure?: string | undefined;
  adults?: number | undefined;
  children?: number | undefined;
  guestIds?: string[] | undefined;
  /** Keep the snapshot prices even when the room type changes (upgrade by assignment). */
  keepPrices?: boolean | undefined;
}

export interface RebookOptions {
  action: string;
  requote?: boolean;
  header?: Prisma.ReservationUncheckedUpdateInput;
  sys?: SysData;
  /** Only the departure may change (CHECKED_IN extension / early departure). */
  departureOnly?: boolean;
  /** Computes prices and checks availability, then stops (nothing written): see MovePreviewSignal. */
  dryRun?: boolean;
}

/** Thrown by a dry-run rebook with the re-quoted totals; never reaches the HTTP layer. */
class MovePreviewSignal {
  constructor(
    readonly preview: { currency: string; currentTotal: number; newTotal: number; delta: number },
  ) {}
}

/** Loads a reservation for a write and checks scope + status. */
async function loadForWrite(ctx: RCtx, id: string, db: Pick<Tx, 'reservation'> = ctx.db as never) {
  const r = await loadReservation(db, id);
  assertPropertyAccess(ctx, r.propertyId);
  return r;
}

/**
 * Applies line changes atomically: re-quote, availability re-check (excluding the changed lines'
 * own nights) under the inventory lock, unit nights rewritten, events published.
 */
export async function rebook(
  ctx: RCtx,
  reservationId: string,
  changes: readonly LineChange[],
  opts: RebookOptions,
): Promise<ReservationDto> {
  const cur = await loadForWrite(ctx, reservationId);
  const prop = await requireProperty(ctx, cur.propertyId);
  const before = toReservation(cur);
  const status = cur.status as ReservationStatusName;
  const checkedIn = status === 'CHECKED_IN';
  if (!EDITABLE_STATUSES.includes(status) && !(checkedIn && opts.departureOnly))
    throw conflict(`A ${status} reservation cannot be modified`, {
      reason: 'NOT_EDITABLE',
      status,
    });

  const existing = cur.reservationRooms.filter((rr) => isHolding(rr.status));
  const byId = new Map(existing.map((rr) => [rr.id, rr]));
  const oldSpecs = new Map(existing.map((rr) => [rr.id, specOf(rr)]));
  const changed: LineSpec[] = [];
  const removed: string[] = [];
  const priceJobs: {
    spec: LineSpec;
    mode: 'quote' | 'merge' | 'keep';
    old?: LineSpec;
    path: string;
  }[] = [];

  changes.forEach((c, i) => {
    const path = `rooms.${i}`;
    if (c.id && !byId.has(c.id))
      throw invalid(`${path}.id`, 'Unknown room line of this reservation');
    if (
      checkedIn &&
      (c.roomTypeId || c.ratePlanId || c.roomId !== undefined || c.arrival || !c.id || c.remove)
    )
      throw conflict('Only the departure of an in-house stay can change here', {
        reason: 'IN_HOUSE',
      });
    if (c.remove) {
      if (!c.id) throw invalid(`${path}.id`, 'id is required to remove a room');
      removed.push(c.id);
      return;
    }
    const old = c.id ? oldSpecs.get(c.id)! : undefined;
    if (!old && (!c.roomTypeId || !c.ratePlanId || !c.adults))
      throw invalid(path, 'roomTypeId, ratePlanId and adults are required for a new room');
    const spec: LineSpec = {
      id: c.id,
      roomTypeId: c.roomTypeId ?? old!.roomTypeId,
      ratePlanId: c.ratePlanId ?? old!.ratePlanId,
      roomId: c.roomId !== undefined ? c.roomId : (old?.roomId ?? null),
      arrival: c.arrival ?? old?.arrival ?? before.arrival,
      departure: c.departure ?? old?.departure ?? before.departure,
      adults: c.adults ?? old!.adults,
      children: c.children ?? old?.children ?? 0,
      guestIds: c.guestIds
        ? [
            ...(old?.guestIds.slice(0, 1) ?? (cur.bookerGuestId ? [cur.bookerGuestId] : [])),
            ...c.guestIds,
          ]
        : (old?.guestIds ?? (cur.bookerGuestId ? [cur.bookerGuestId] : [])),
      currency: old?.currency ?? prop.currency,
      dailyPrices: old?.dailyPrices ?? [],
      status: old?.status ?? status,
    };
    if (spec.departure <= spec.arrival)
      throw invalid(`${path}.departure`, 'Departure must be after arrival');
    if (checkedIn) {
      if (spec.departure <= prop.businessDate)
        throw invalid(`${path}.departure`, 'Departure must be after the business date');
    } else if ((!old || spec.arrival !== old.arrival) && spec.arrival < prop.businessDate)
      throw invalid(
        `${path}.arrival`,
        `Arrival is before the business date ${prop.businessDate}`,
        'BEFORE_BUSINESS_DATE',
      );
    const pricingChanged =
      !old ||
      (!c.keepPrices &&
        (spec.roomTypeId !== old.roomTypeId || spec.ratePlanId !== old.ratePlanId)) ||
      spec.adults !== old.adults ||
      spec.children !== old.children;
    const datesChanged =
      !!old && (spec.arrival !== old.arrival || spec.departure !== old.departure);
    if (pricingChanged || opts.requote) priceJobs.push({ spec, mode: 'quote', path });
    else if (datesChanged) {
      const oldNights = new Set(old.dailyPrices.map((d) => d.date));
      const allKept = nightsOf(spec.arrival, spec.departure).every((n) => oldNights.has(n));
      priceJobs.push({ spec, mode: allKept ? 'keep' : 'merge', old, path });
    }
    changed.push(spec);
  });
  if (!changed.length && !removed.length && !opts.header && !opts.sys) return before;

  await assertGuests(
    ctx.db as never,
    changed.flatMap((l) => l.guestIds),
    'rooms.guestIds',
  );
  await validateUnits(ctx.db as never, prop.id, changed, (i) => `rooms.${i}.roomId`);
  if (priceJobs.some((j) => j.mode !== 'keep')) {
    const pricing = await loadPricing(ctx.db as never, prop.id, {
      roomTypeIds: [...new Set(changed.map((l) => l.roomTypeId))],
      ratePlanIds: [...new Set(changed.map((l) => l.ratePlanId))],
    });
    for (const j of priceJobs) {
      if (j.mode === 'keep') continue;
      const p = priceNew(pricing, j.spec, j.path);
      j.spec.currency = p.currency;
      if (j.mode === 'quote') j.spec.dailyPrices = p.dailyPrices;
      else {
        const old = new Map(j.old!.dailyPrices.map((d) => [d.date, d]));
        j.spec.dailyPrices = p.dailyPrices.map((d) => old.get(d.date) ?? d);
      }
    }
  }
  for (const j of priceJobs)
    if (j.mode === 'keep') {
      const keep = new Set(nightsOf(j.spec.arrival, j.spec.departure));
      j.spec.dailyPrices = j.old!.dailyPrices.filter((d) => keep.has(d.date));
    }

  const allowance = await settingAt(ctx, reservationSettings.overbookingAllowance, prop.id);
  const touchedIds = [...changed.flatMap((l) => (l.id ? [l.id] : [])), ...removed];
  const oldTouched = touchedIds.map((id) => oldSpecs.get(id)!);
  const afterLines = [
    ...existing.filter((rr) => !touchedIds.includes(rr.id)).map(specOf),
    ...changed,
  ];
  if (!afterLines.length)
    throw invalid('rooms', 'A reservation keeps at least one room (cancel it instead)');

  if (opts.dryRun) {
    if (changed.length) {
      const { from, to } = spanOf(changed);
      const inv = await loadInventory(ctx.db as never, {
        propertyId: prop.id,
        from,
        to,
        roomTypeIds: [...new Set(changed.map((l) => l.roomTypeId))],
        exclude: touchedIds,
        allowance,
      });
      assertDemands(inv, changed.map(demandOf));
    }
    const newTotal = afterLines
      .filter((l) => isHolding(l.status))
      .reduce((s, l) => s + sumNights(l.dailyPrices), 0);
    throw new MovePreviewSignal({
      currency: afterLines[0]?.currency ?? before.currency,
      currentTotal: before.roomTotal,
      newTotal,
      delta: newTotal - before.roomTotal,
    });
  }

  await ctx.db.$transaction(async (tx) => {
    await lockInventory(
      tx,
      prop.id,
      [...changed, ...oldTouched].map((l) => l.roomTypeId),
    );
    if (changed.length) {
      const { from, to } = spanOf(changed);
      const inv = await loadInventory(tx, {
        propertyId: prop.id,
        from,
        to,
        roomTypeIds: [...new Set(changed.map((l) => l.roomTypeId))],
        exclude: touchedIds,
        allowance,
      });
      assertDemands(inv, changed.map(demandOf));
    }
    if (removed.length) await tx.reservationRoom.deleteMany({ where: { id: { in: removed } } });
    const written: { id: string; roomId: string | null; arrival: string; departure: string }[] = [];
    for (const l of changed) {
      const data = {
        roomTypeId: l.roomTypeId,
        roomId: l.roomId,
        ratePlanId: l.ratePlanId,
        arrival: parseDay(l.arrival),
        departure: parseDay(l.departure),
        adults: l.adults,
        children: l.children,
        currency: l.currency,
        dailyPrices: l.dailyPrices as unknown as Prisma.InputJsonValue,
      };
      let id = l.id;
      if (id) {
        await tx.unitNight.deleteMany({ where: { reservationRoomId: id } });
        await tx.reservationRoom.update({ where: { id }, data });
        const old = oldSpecs.get(id)!;
        if (old.guestIds.join() !== l.guestIds.join()) {
          await tx.reservationGuest.deleteMany({ where: { reservationRoomId: id } });
          await writeGuests(tx, ctx.tenantId, id, l.guestIds);
        }
      } else {
        const rr = await tx.reservationRoom.create({
          data: {
            ...data,
            tenantId: ctx.tenantId,
            propertyId: prop.id,
            reservationId,
            status: l.status,
          },
        });
        id = rr.id;
        await writeGuests(tx, ctx.tenantId, id, l.guestIds);
      }
      written.push({ id, roomId: l.roomId, arrival: l.arrival, departure: l.departure });
    }
    await insertUnitNights(tx, ctx.tenantId, written);
    const header: Prisma.ReservationUncheckedUpdateInput = {
      ...(afterLines.length ? headerOf(afterLines) : {}),
      ...opts.header,
    };
    if (opts.sys) {
      const { user, sys } = splitCustomFields(cur.customFields);
      header.customFields = joinCustomFields(
        (header.customFields as Record<string, unknown> | undefined) ?? user,
        { ...sys, ...opts.sys },
      );
    }
    await tx.reservation.update({ where: { id: reservationId }, data: header });
    const span = spanOf([
      ...oldTouched,
      ...changed,
      ...(oldTouched.length || changed.length ? [] : [before]),
    ]);
    await publishPlanningChanged(tx, {
      propertyId: prop.id,
      reservationId,
      action: opts.action,
      from: span.from,
      to: span.to,
      reservationRoomIds: [...new Set([...touchedIds, ...written.map((w) => w.id)])],
    });
    const rel = released(oldTouched, changed);
    if (rel)
      await publishInventoryReleased(tx, { propertyId: prop.id, ...rel, cause: opts.action });
    await publish(tx, RESERVATION_EVENTS.updated, {
      propertyId: prop.id,
      reservationId,
      action: opts.action,
    });
  }, TX_OPTS);

  const after = toReservation(await loadReservation(ctx.db as never, reservationId));
  await auditReservation(ctx, `reservation.${opts.action}`, before, after);
  return after;
}

/** PATCH: dossier dates, room lines, rate, occupancy, guests and header fields. */
export async function updateReservation(ctx: RCtx, id: string, input: UpdateReservationInput) {
  const cur = await loadForWrite(ctx, id);
  const changes: LineChange[] = (input.rooms ?? []).map((r) => ({ ...r, roomId: r.roomId }));
  if (input.arrival || input.departure) {
    const listed = new Set(changes.flatMap((c) => (c.id ? [c.id] : [])));
    for (const rr of cur.reservationRooms) {
      if (!isHolding(rr.status) || listed.has(rr.id)) continue;
      changes.push({ id: rr.id, arrival: input.arrival, departure: input.departure });
    }
    for (const c of changes)
      if (c.id && !c.remove) {
        c.arrival ??= input.arrival;
        c.departure ??= input.departure;
      }
  }
  const header: Prisma.ReservationUncheckedUpdateInput = {};
  if (input.source !== undefined) {
    if (input.source) await requireLookupCode(ctx.db, 'reservation_source', input.source, 'source');
    header.source = input.source;
  }
  if (input.segment !== undefined) {
    if (input.segment) await requireLookupCode(ctx.db, 'guest_segment', input.segment, 'segment');
    header.segment = input.segment;
  }
  if (input.companyId !== undefined) header.companyId = input.companyId;
  if (input.notes !== undefined) header.notes = input.notes;
  if (input.optionExpiresAt) {
    if (cur.status !== 'PENDING')
      throw invalid('optionExpiresAt', 'Only a PENDING reservation has an option');
    const at = new Date(input.optionExpiresAt);
    if (at.getTime() <= now().getTime())
      throw invalid('optionExpiresAt', 'The option expiry must be in the future');
    header.pendingExpiresAt = at;
    header.optionExpiresAt = at;
  }
  if (input.customFields !== undefined) {
    const { user } = splitCustomFields(cur.customFields);
    const merged = await validateCustomFields(ctx.db, 'reservation', {
      ...user,
      ...input.customFields,
    });
    header.customFields = merged as Prisma.InputJsonValue;
  }
  const headerOnly = !changes.length;
  if (
    headerOnly &&
    cur.status !== 'PENDING' &&
    cur.status !== 'CONFIRMED' &&
    cur.status !== 'CHECKED_IN'
  )
    throw conflict(`A ${cur.status} reservation cannot be modified`, { reason: 'NOT_EDITABLE' });
  if (header.customFields) {
    const { sys } = splitCustomFields(cur.customFields);
    header.customFields = joinCustomFields(header.customFields as Record<string, unknown>, sys);
  }
  if (headerOnly) {
    const before = toReservation(cur);
    await ctx.db.reservation.update({ where: { id }, data: header });
    const after = toReservation(await loadReservation(ctx.db as never, id));
    await auditReservation(ctx, 'reservation.update', before, after);
    return after;
  }
  return rebook(ctx, id, changes, {
    action: 'update',
    requote: input.requote,
    header,
    departureOnly: cur.status === 'CHECKED_IN',
  });
}

function lineOf(cur: ReservationRow, roomLineId: string) {
  const rr = cur.reservationRooms.find((x) => x.id === roomLineId);
  if (!rr) throw must(null, 'Reservation room');
  if (!isHolding(rr.status))
    throw conflict(`The room line is ${rr.status}`, { reason: 'NOT_EDITABLE' });
  return rr;
}

/** Assigns a unit (or moves to another unit). Room type change only when allowed (upgrade). */
export async function assignRoom(
  ctx: RCtx,
  id: string,
  roomLineId: string,
  input: { roomId: string; changeRoomType: boolean },
) {
  const cur = await loadForWrite(ctx, id);
  const rr = lineOf(cur, roomLineId);
  const room = must(
    await ctx.db.room.findFirst({
      where: { id: input.roomId, propertyId: cur.propertyId, deletedAt: null },
    }),
    'Room',
  );
  if (room.roomTypeId !== rr.roomTypeId && !input.changeRoomType)
    throw invalid(
      'roomId',
      'The room belongs to another room type (set changeRoomType)',
      'ROOM_TYPE_MISMATCH',
    );
  return rebook(
    ctx,
    id,
    [{ id: rr.id, roomId: room.id, roomTypeId: room.roomTypeId, keepPrices: true }],
    {
      action: rr.roomId ? 'move' : 'assign',
    },
  );
}

export async function unassignRoom(ctx: RCtx, id: string, roomLineId: string) {
  const cur = await loadForWrite(ctx, id);
  const rr = lineOf(cur, roomLineId);
  if (!rr.roomId) return toReservation(cur);
  return rebook(ctx, id, [{ id: rr.id, roomId: null }], { action: 'unassign' });
}

/** Drag & drop: other unit and/or other dates in one atomic step. */
export async function moveRoom(
  ctx: RCtx,
  id: string,
  roomLineId: string,
  input: {
    roomId?: string | null | undefined;
    roomTypeId?: string | undefined;
    arrival?: string | undefined;
    departure?: string | undefined;
    changeRoomType: boolean;
    requote: boolean;
  },
  dryRun = false,
) {
  const cur = await loadForWrite(ctx, id);
  const rr = lineOf(cur, roomLineId);
  const change: LineChange = { id: rr.id, keepPrices: !input.requote };
  if (input.roomTypeId && !input.roomId && input.roomTypeId !== rr.roomTypeId) {
    if (!input.changeRoomType)
      throw invalid(
        'roomTypeId',
        'The room type changes (set changeRoomType)',
        'ROOM_TYPE_MISMATCH',
      );
    must(
      await ctx.db.roomType.findFirst({
        where: { id: input.roomTypeId, propertyId: cur.propertyId, deletedAt: null },
      }),
      'Room type',
    );
    change.roomTypeId = input.roomTypeId;
    change.roomId = null;
    change.keepPrices = false; // another room type is re-quoted
  } else if (input.roomId !== undefined) {
    change.roomId = input.roomId;
    if (input.roomId) {
      const room = must(
        await ctx.db.room.findFirst({
          where: { id: input.roomId, propertyId: cur.propertyId, deletedAt: null },
        }),
        'Room',
      );
      if (room.roomTypeId !== rr.roomTypeId && !input.changeRoomType)
        throw invalid(
          'roomId',
          'The room belongs to another room type (set changeRoomType)',
          'ROOM_TYPE_MISMATCH',
        );
      change.roomTypeId = room.roomTypeId;
    }
  }
  if (input.arrival) {
    change.arrival = input.arrival;
    const len = nightsOf(formatDay(rr.arrival), formatDay(rr.departure)).length;
    change.departure = input.departure ?? addDays(input.arrival, len);
  } else if (input.departure) change.departure = input.departure;
  if (!dryRun) return rebook(ctx, id, [change], { action: 'move', requote: input.requote });
  try {
    await rebook(ctx, id, [change], { action: 'move', requote: input.requote, dryRun: true });
  } catch (err) {
    if (err instanceof MovePreviewSignal) return err.preview;
    throw err;
  }
  throw new Error('Dry run did not stop');
}

/** Re-quote shown before a risky planning move (room type change): nothing is written. */
export async function previewMove(
  ctx: RCtx,
  id: string,
  roomLineId: string,
  input: Parameters<typeof moveRoom>[3],
) {
  return (await moveRoom(ctx, id, roomLineId, input, true)) as {
    currency: string;
    currentTotal: number;
    newTotal: number;
    delta: number;
  };
}

/** Extension / early departure: every room leaving on the dossier departure follows. */
export async function changeDeparture(
  ctx: RCtx,
  id: string,
  departure: string,
  mode: 'extend' | 'shorten',
) {
  const cur = await loadForWrite(ctx, id);
  const old = formatDay(cur.departure);
  if (mode === 'extend' && departure <= old)
    throw invalid('departure', 'The new departure must be later');
  if (mode === 'shorten' && departure >= old)
    throw invalid('departure', 'The new departure must be earlier');
  const changes = cur.reservationRooms
    .filter((rr) => isHolding(rr.status) && formatDay(rr.departure) === old)
    .map((rr) => ({ id: rr.id, departure }));
  return rebook(ctx, id, changes, { action: mode, departureOnly: true });
}

// ───────────────────────────── status changes ─────────────────────────────

async function transitionFacts(ctx: RCtx, r: ReservationRow) {
  const prop = await requireProperty(ctx, r.propertyId);
  return {
    prop,
    facts: {
      businessDate: prop.businessDate,
      arrival: formatDay(r.arrival),
      departure: formatDay(r.departure),
      allRoomsAssigned: r.reservationRooms
        .filter((x) => isHolding(x.status))
        .every((x) => !!x.roomId),
    },
  };
}

function assertGuard(
  from: ReservationStatusName,
  to: ReservationStatusName,
  facts: Parameters<typeof guardTransition>[2],
) {
  const g = guardTransition(from, to, facts);
  if (!g.ok) throw conflict(g.message, { reason: g.reason, from, to });
}

export async function confirmReservation(ctx: RCtx, id: string, notifyGuest: boolean) {
  const cur = await loadForWrite(ctx, id);
  const { prop, facts } = await transitionFacts(ctx, cur);
  assertGuard(cur.status, 'CONFIRMED', facts);
  const before = toReservation(cur);
  await ctx.db.$transaction(async (tx) => {
    const n = await tx.reservation.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CONFIRMED', confirmedAt: now(), pendingExpiresAt: null },
    });
    if (n.count !== 1) throw conflict('The reservation is no longer pending');
    await tx.reservationRoom.updateMany({
      where: { reservationId: id, status: 'PENDING' },
      data: { status: 'CONFIRMED' },
    });
    await publishPlanningChanged(tx, {
      propertyId: prop.id,
      reservationId: id,
      action: 'confirmed',
      from: facts.arrival,
      to: facts.departure,
    });
    await publish(tx, RESERVATION_EVENTS.confirmed, { propertyId: prop.id, reservationId: id });
  }, TX_OPTS);
  const after = toReservation(await loadReservation(ctx.db as never, id));
  await auditReservation(ctx, 'reservation.confirm', before, after);
  if (notifyGuest) await sendConfirmation(ctx, after, prop);
  return after;
}

/** Penalty of a reservation per its rate plans' cancellation policies (pure inputs loaded). */
async function computeReservationPenalty(
  ctx: RCtx,
  r: ReservationRow,
  businessDate: string,
  kind: 'CANCELLATION' | 'NO_SHOW',
  waived: boolean,
): Promise<PenaltyDto> {
  const lines = r.reservationRooms.filter((x) => isHolding(x.status));
  const plans = await ctx.db.ratePlan.findMany({
    where: { id: { in: [...new Set(lines.map((l) => l.ratePlanId))] } },
    select: { id: true, cancellationPolicy: { select: { id: true, kind: true, rules: true } } },
  });
  const byPlan = new Map(plans.map((p) => [p.id, p.cancellationPolicy]));
  const out: PenaltyDto['lines'] = [];
  for (const l of lines) {
    const policy = byPlan.get(l.ratePlanId) ?? null;
    const parsed =
      policy && policy.kind === 'CANCELLATION' ? cancellationRules.safeParse(policy.rules) : null;
    const daily = parseNightPrices(l.dailyPrices);
    // An option (PENDING) is not guaranteed: cancelling it costs nothing.
    const rules = l.status === 'PENDING' ? null : parsed?.success ? parsed.data : null;
    const p = computePenalty(rules, {
      today: businessDate,
      arrival: formatDay(l.arrival),
      stayTotal: sumNights(daily),
      firstNight: daily[0]?.total ?? 0,
      noShow: kind === 'NO_SHOW',
    });
    out.push({ reservationRoomId: l.id, policyId: policy?.id ?? null, ...p });
  }
  const computed = out.reduce((s, l) => s + l.amount, 0);
  return {
    kind,
    amount: waived ? 0 : computed,
    computedAmount: computed,
    waived,
    currency: lines[0]?.currency ?? 'XOF',
    businessDate,
    lines: out,
  };
}

async function closeReservation(
  ctx: RCtx,
  cur: ReservationRow,
  to: 'CANCELLED' | 'NO_SHOW',
  opts: { reason: string | null; penalty: PenaltyDto | null; action: string },
): Promise<ReservationDto> {
  const id = cur.id;
  const before = toReservation(cur);
  const lines = cur.reservationRooms.filter((x) => isHolding(x.status));
  const specs = lines.map(specOf);
  await ctx.db.$transaction(async (tx) => {
    await lockInventory(
      tx,
      cur.propertyId,
      specs.map((l) => l.roomTypeId),
    );
    const n = await tx.reservation.updateMany({
      where: { id, status: cur.status },
      data: {
        status: to,
        ...(to === 'CANCELLED' ? { cancelledAt: now(), cancelReason: opts.reason } : {}),
        pendingExpiresAt: null,
        ...(opts.penalty
          ? (() => {
              const { user, sys } = splitCustomFields(cur.customFields);
              return { customFields: joinCustomFields(user, { ...sys, penalty: opts.penalty }) };
            })()
          : {}),
      },
    });
    if (n.count !== 1) throw conflict('The reservation changed meanwhile, retry');
    await tx.unitNight.deleteMany({ where: { reservationRoomId: { in: lines.map((l) => l.id) } } });
    await tx.reservationRoom.updateMany({
      where: { id: { in: lines.map((l) => l.id) } },
      data: { status: to },
    });
    if (specs.length) {
      const { from, to: end } = spanOf(specs);
      await publishPlanningChanged(tx, {
        propertyId: cur.propertyId,
        reservationId: id,
        action: opts.action,
        from,
        to: end,
        reservationRoomIds: lines.map((l) => l.id),
      });
      const rel = released(specs, []);
      if (rel)
        await publishInventoryReleased(tx, {
          propertyId: cur.propertyId,
          ...rel,
          cause: opts.action,
        });
    }
    await publish(
      tx,
      to === 'CANCELLED' ? RESERVATION_EVENTS.cancelled : RESERVATION_EVENTS.noShow,
      {
        propertyId: cur.propertyId,
        reservationId: id,
        reason: opts.reason,
        penalty: (opts.penalty ?? null) as unknown as Record<string, unknown>,
      },
    );
  }, TX_OPTS);
  const after = toReservation(await loadReservation(ctx.db as never, id));
  await auditReservation(ctx, `reservation.${opts.action}`, before, after);
  return after;
}

export async function cancelReservation(
  ctx: RCtx,
  id: string,
  input: {
    reasonCode: string;
    note?: string | undefined;
    waivePenalty: boolean;
    notifyGuest?: boolean | undefined;
  },
) {
  const cur = await loadForWrite(ctx, id);
  const { prop, facts } = await transitionFacts(ctx, cur);
  assertGuard(cur.status, 'CANCELLED', facts);
  await requireLookupCode(ctx.db, 'cancel_reason', input.reasonCode, 'reasonCode');
  const penalty = await computeReservationPenalty(
    ctx,
    cur,
    facts.businessDate,
    'CANCELLATION',
    input.waivePenalty,
  );
  const reason = input.note ? `${input.reasonCode}: ${input.note}` : input.reasonCode;
  const reservation = await closeReservation(ctx, cur, 'CANCELLED', {
    reason,
    penalty,
    action: 'cancel',
  });
  if (input.notifyGuest ?? true) await sendCancellation(ctx, reservation, prop, penalty);
  return { reservation, penalty };
}

/** Read-only penalty the cancellation / no-show would cost right now (same policy and maths). */
export async function previewPenalty(ctx: RCtx, id: string, kind: 'CANCELLATION' | 'NO_SHOW') {
  const cur = await loadForWrite(ctx, id);
  const { facts } = await transitionFacts(ctx, cur);
  assertGuard(cur.status, kind === 'NO_SHOW' ? 'NO_SHOW' : 'CANCELLED', facts);
  return computeReservationPenalty(ctx, cur, facts.businessDate, kind, false);
}

export async function markNoShow(ctx: RCtx, id: string, waivePenalty: boolean) {
  const cur = await loadForWrite(ctx, id);
  const { facts } = await transitionFacts(ctx, cur);
  assertGuard(cur.status, 'NO_SHOW', facts);
  const penalty = await computeReservationPenalty(
    ctx,
    cur,
    facts.businessDate,
    'NO_SHOW',
    waivePenalty,
  );
  const reservation = await closeReservation(ctx, cur, 'NO_SHOW', {
    reason: null,
    penalty,
    action: 'no_show',
  });
  return { reservation, penalty };
}

/** Job: an option past its expiry becomes CANCELLED (no penalty) and frees its nights. */
export async function expireOption(ctx: RCtx, id: string, at: Date): Promise<boolean> {
  const cur = await loadReservation(ctx.db as never, id);
  if (cur.status !== 'PENDING' || !cur.pendingExpiresAt || cur.pendingExpiresAt > at) return false;
  try {
    await closeReservation(ctx, cur, 'CANCELLED', {
      reason: 'OPTION_EXPIRED',
      penalty: null,
      action: 'expire',
    });
    return true;
  } catch (err) {
    if (err instanceof AppError && err.code === 'CONFLICT') return false;
    throw err;
  }
}

export { loadReservation, toReservation };
