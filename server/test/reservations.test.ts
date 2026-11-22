import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { NotifyInput } from '../src/modules/notifications/service.js';
import {
  closeReservationQueues,
  overrideGuestNotifier,
  runBookingReminders,
  runPendingExpiry,
} from '../src/modules/reservations/index.js';
import { processDomainEvent, QueueFactory, relayOutbox, runJob } from '../src/jobs/index.js';
import { waitlistMatchJob } from '../src/modules/waitlist/index.js';
import type { RealtimeEmitter } from '../src/realtime/socket.js';
import { eventually } from './helpers/auth.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import { seedLodging, type LodgingSeed } from './helpers/lodging-seed.js';

let env: TestEnv;
let app: Express;
let A: TenantFixture;
let B: TenantFixture;
let S: LodgingSeed;
let tokA: string;
let tokB: string;
let tokReader: string;
const sent: NotifyInput[] = [];

const T = '/api/v1/t';
const call = (method: 'get' | 'post' | 'patch', f: TenantFixture, tok: string, path: string) =>
  request(app)[method](`${T}${path}`).set('Host', f.host).set('Authorization', `Bearer ${tok}`);
const asA = (method: 'get' | 'post' | 'patch', path: string) => call(method, A, tokA, path);

interface Line {
  roomTypeId: string;
  ratePlanId?: string;
  roomId?: string | null;
  adults?: number;
  children?: number;
}
const book = (
  arrival: string,
  departure: string,
  rooms: Line[],
  extra: Record<string, unknown> = {},
) =>
  asA('post', '/reservations').send({
    propertyId: A.propertyId,
    arrival,
    departure,
    guest: {
      firstName: 'Ama',
      lastName: 'Mensah',
      email: 'ama@example.com',
      phone: '+22890000001',
    },
    rooms: rooms.map((r) => ({ ratePlanId: S.bar, adults: 2, ...r })),
    ...extra,
  });

const free = async (arrival: string, departure: string, roomTypeId: string) => {
  const res = await asA('get', '/availability').query({
    propertyId: A.propertyId,
    arrival,
    departure,
    adults: 1,
    roomTypeId,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.roomTypes[0] as {
    freeByNight: { date: string; free: number }[];
    minFree: number;
    sellable: boolean;
    ratePlans: {
      code: string;
      available: boolean;
      reason: string | null;
      quote: { total: number } | null;
    }[];
  };
};

const outbox = (type: string) =>
  env.services.admin.outboxEvent.findMany({
    where: { tenantId: A.tenantId, type },
    orderBy: { createdAt: 'asc' },
  });

beforeAll(async () => {
  env = createTestEnv([], {});
  ({ app } = createApp(env.services));
  const { admin, config } = env.services;
  A = await createTenantFixture(admin, { label: 'ra', features: ['lodging.core', 'groups'] });
  B = await createTenantFixture(admin, { label: 'rb', features: ['lodging.core'] });
  S = await seedLodging(admin, A.tenantId, A.propertyId);
  await seedLodging(admin, B.tenantId, B.propertyId);
  tokA = await mintToken(config, { sub: A.userId, tid: A.tenantId });
  tokB = await mintToken(config, { sub: B.userId, tid: B.tenantId });
  const reader = await addUser(admin, A.tenantId, ['reservations.read', 'guests.read']);
  await admin.userProperty.create({
    data: { tenantId: A.tenantId, userId: reader, propertyId: A.propertyId },
  });
  tokReader = await mintToken(config, { sub: reader, tid: A.tenantId });
  overrideGuestNotifier((_s, input) => {
    sent.push(input);
    return Promise.resolve([]);
  });
});
afterAll(async () => {
  overrideGuestNotifier(null);
  if (env) await closeReservationQueues(env.services);
  await env?.close();
});

describe('availability', () => {
  it('counts units per night; blocks, OOO and bookings reduce it; departure day is reusable', async () => {
    let a = await free('2026-12-01', '2026-12-04', S.std);
    expect(a.freeByNight.map((n) => n.free)).toEqual([3, 3, 3]);
    expect(a.sellable).toBe(true);
    expect(a.ratePlans.find((p) => p.code === 'BAR')?.quote?.total).toBe(90_000);
    expect(a.ratePlans.find((p) => p.code === 'FLEX')?.quote?.total).toBe(105_000);

    await env.services.admin.roomBlock.create({
      data: {
        tenantId: A.tenantId,
        roomId: S.rooms['103']!,
        fromDate: new Date('2026-12-02'),
        toDate: new Date('2026-12-03'),
        reason: 'MAINTENANCE',
      },
    });
    await env.services.admin.room.update({
      where: { id: S.rooms['102']! },
      data: { hkStatus: 'OUT_OF_ORDER' },
    });
    const r = await book('2026-12-01', '2026-12-02', [
      { roomTypeId: S.std, roomId: S.rooms['101'] },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    a = await free('2026-12-01', '2026-12-04', S.std);
    expect(a.freeByNight.map((n) => n.free)).toEqual([1, 1, 2]);

    // 101 is free again on the departure day of the stay.
    const next = await book('2026-12-02', '2026-12-03', [
      { roomTypeId: S.std, roomId: S.rooms['101'] },
    ]);
    expect(next.status, JSON.stringify(next.body)).toBe(201);
    a = await free('2026-12-01', '2026-12-04', S.std);
    expect(a.freeByNight.map((n) => n.free)).toEqual([1, 0, 2]);
    expect(a.sellable).toBe(false);
    await env.services.admin.room.update({
      where: { id: S.rooms['102']! },
      data: { hkStatus: 'CLEAN' },
    });
  });

  it('reports min stay and occupancy through the quote', async () => {
    await env.services.admin.rate.updateMany({
      where: { ratePlanId: S.flex },
      data: { minStay: 3 },
    });
    const a = await free('2026-12-10', '2026-12-12', S.std);
    expect(a.ratePlans.find((p) => p.code === 'FLEX')).toMatchObject({
      available: false,
      reason: 'MIN_STAY',
    });
    expect(a.ratePlans.find((p) => p.code === 'BAR')).toMatchObject({ available: true });
    const res = await asA('get', '/availability').query({
      propertyId: A.propertyId,
      arrival: '2026-12-10',
      departure: '2026-12-12',
      adults: 2,
      roomTypeId: S.sgl,
    });
    expect(res.body.roomTypes[0]).toMatchObject({ fitsOccupancy: false, sellable: false });
  });
});

describe('reservation lifecycle', () => {
  let resId: string;
  let lineId: string;

  it('creates a multi-room dossier with number, price snapshot and new guest', async () => {
    const res = await book(
      '2026-12-14',
      '2026-12-17',
      [
        { roomTypeId: S.std, adults: 3 },
        { roomTypeId: S.dlx, roomId: S.rooms['201'], adults: 2, children: 1 },
      ],
      { source: 'PHONE', segment: 'LEISURE', notes: 'Late arrival' },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const r = res.body.reservation;
    expect(r.number).toMatch(/^RES-2026-\d{6}$/);
    expect(r).toMatchObject({ status: 'CONFIRMED', adults: 5, children: 1, source: 'PHONE' });
    expect(r.rooms).toHaveLength(2);
    const std = r.rooms.find((x: { roomTypeId: string }) => x.roomTypeId === S.std);
    expect(std.dailyPrices.map((n: { total: number }) => n.total)).toEqual([
      35_000, 35_000, 35_000,
    ]);
    expect(std.total).toBe(105_000);
    expect(r.roomTotal).toBe(105_000 + 3 * 52_000);
    expect(r.booker.firstName).toBe('Ama');
    expect(res.body.warnings).toEqual([]);
    expect(sent.some((m) => m.templateCode === 'booking_confirmation' && m.data.reservation)).toBe(
      true,
    );
    resId = r.id;
    lineId = std.id;
    const nights = await env.services.admin.unitNight.count({
      where: { reservationRoom: { reservationId: resId } },
    });
    expect(nights).toBe(3); // only the assigned DLX line holds unit nights
    // Audit entries are written once the response is sent.
    const audit = await eventually(() =>
      env.services.admin.auditLog.findFirst({
        where: { tenantId: A.tenantId, action: 'reservation.create', entityId: resId },
      }),
    );
    expect(audit).toBeTruthy();
  });

  it('rejects arrival before the business date and unknown lookups', async () => {
    const past = await book('2026-11-10', '2026-11-13', [{ roomTypeId: S.std }]);
    expect(past.status).toBe(422);
    const src = await book('2026-12-20', '2026-12-21', [{ roomTypeId: S.std }], { source: 'NOPE' });
    expect(src.status).toBe(422);
  });

  it('replays an Idempotency-Key and warns about a blacklisted guest', async () => {
    const g = await asA('post', '/guests').send({ firstName: 'Kodjo', lastName: 'Blacklisted' });
    await asA('patch', `/guests/${g.body.id}`).send({ isBlacklisted: true });
    const body = {
      propertyId: A.propertyId,
      arrival: '2026-12-20',
      departure: '2026-12-21',
      guest: { id: g.body.id },
      rooms: [{ roomTypeId: S.std, ratePlanId: S.bar, adults: 1 }],
    };
    const first = await asA('post', '/reservations')
      .set('Idempotency-Key', 'idem-key-0001')
      .send(body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(first.body.warnings[0]).toMatchObject({ code: 'GUEST_BLACKLISTED' });
    const again = await asA('post', '/reservations')
      .set('Idempotency-Key', 'idem-key-0001')
      .send(body);
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.reservation.id).toBe(first.body.reservation.id);
    const count = await env.services.admin.reservation.count({
      where: { bookerGuestId: g.body.id },
    });
    expect(count).toBe(1);
  });

  it('assigns, refuses a clashing move with details, moves and unassigns', async () => {
    const other = await book('2026-12-15', '2026-12-16', [
      { roomTypeId: S.std, roomId: S.rooms['102'] },
    ]);
    expect(other.status).toBe(201);
    const ok = await asA('post', `/reservations/${resId}/rooms/${lineId}/assign`).send({
      roomId: S.rooms['101'],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.rooms.find((x: { id: string }) => x.id === lineId).roomNumber).toBe('101');

    const clash = await asA('post', `/reservations/${resId}/rooms/${lineId}/move`).send({
      roomId: S.rooms['102'],
    });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('CONFLICT');
    expect(clash.body.meta.clashes[0]).toMatchObject({
      roomId: S.rooms['102'],
      date: '2026-12-15',
      reason: 'OCCUPIED',
      reservationRoomId: other.body.reservation.rooms[0].id,
    });

    const wrongType = await asA('post', `/reservations/${resId}/rooms/${lineId}/assign`).send({
      roomId: S.rooms['301'],
    });
    expect(wrongType.status).toBe(422);

    // Drag & drop: shift by one day on unit 103 (kept nights keep their price).
    const moved = await asA('post', `/reservations/${resId}/rooms/${lineId}/move`).send({
      roomId: S.rooms['103'],
      arrival: '2026-12-15',
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    const line = moved.body.rooms.find((x: { id: string }) => x.id === lineId);
    expect(line).toMatchObject({
      arrival: '2026-12-15',
      departure: '2026-12-18',
      roomNumber: '103',
    });
    const nights = await env.services.admin.unitNight.findMany({
      where: { reservationRoomId: lineId },
      orderBy: { night: 'asc' },
    });
    expect(nights.map((n) => n.night.toISOString().slice(0, 10))).toEqual([
      '2026-12-15',
      '2026-12-16',
      '2026-12-17',
    ]);
    expect(nights.every((n) => n.unitId === S.rooms['103'])).toBe(true);
    expect((await outbox('inventory.released')).length).toBeGreaterThan(0);

    const un = await asA('post', `/reservations/${resId}/rooms/${lineId}/unassign`);
    expect(un.status).toBe(200);
    expect(await env.services.admin.unitNight.count({ where: { reservationRoomId: lineId } })).toBe(
      0,
    );
  });

  it('updates the room type with re-quote and re-checks availability', async () => {
    const up = await asA('patch', `/reservations/${resId}`).send({
      rooms: [{ id: lineId, roomTypeId: S.dlx, ratePlanId: S.bar, adults: 2 }],
    });
    // The only DLX unit is already taken by the dossier's other room.
    expect(up.status).toBe(409);
    expect(up.body.meta.reason).toBe('NO_AVAILABILITY');
    const plan = await asA('patch', `/reservations/${resId}`).send({
      rooms: [{ id: lineId, adults: 2 }],
      notes: 'Updated',
    });
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    const line = plan.body.rooms.find((x: { id: string }) => x.id === lineId);
    expect(line.dailyPrices.map((n: { total: number }) => n.total)).toEqual([
      30_000, 30_000, 30_000,
    ]);
    expect(plan.body.notes).toBe('Updated');
  });

  it('extends (new night priced) and shortens (nights released)', async () => {
    // The STD line leaves on the dossier departure (12-18): it follows, the DLX line does not.
    await env.services.admin.rate.updateMany({
      where: { ratePlanId: S.bar, roomTypeId: S.std },
      data: { price: 33_000n },
    });
    const ext = await asA('post', `/reservations/${resId}/extend`).send({
      departure: '2026-12-19',
    });
    expect(ext.status, JSON.stringify(ext.body)).toBe(200);
    const line = ext.body.rooms.find((x: { id: string }) => x.id === lineId);
    expect(line.dailyPrices.map((n: { total: number }) => n.total)).toEqual([
      30_000, 30_000, 30_000, 33_000,
    ]);
    const dlx = ext.body.rooms.find((x: { roomTypeId: string }) => x.roomTypeId === S.dlx);
    expect(dlx.departure).toBe('2026-12-17');
    expect(ext.body.departure).toBe('2026-12-19');
    await env.services.admin.rate.updateMany({
      where: { ratePlanId: S.bar, roomTypeId: S.std },
      data: { price: 30_000n },
    });
    const before = (await outbox('inventory.released')).length;
    const sh = await asA('post', `/reservations/${resId}/shorten`).send({
      departure: '2026-12-18',
    });
    expect(sh.status).toBe(200);
    expect(sh.body.departure).toBe('2026-12-18');
    const rel = await outbox('inventory.released');
    expect(rel.length).toBe(before + 1);
    expect(rel[rel.length - 1]!.payload).toMatchObject({
      from: '2026-12-18',
      to: '2026-12-19',
      cause: 'shorten',
    });
  });

  it('cancels with the policy penalty (50 % at 3 days) stored on the reservation', async () => {
    const r = await book('2026-11-15', '2026-11-17', [
      { roomTypeId: S.std, roomId: S.rooms['101'] },
    ]);
    expect(r.status).toBe(201);
    const id = r.body.reservation.id;
    const bad = await asA('post', `/reservations/${id}/cancel`).send({ reasonCode: 'UNKNOWN' });
    expect(bad.status).toBe(422);
    // Preview: same maths as the action, read-only, permission reservations.cancel, tenant scoped.
    const preview = await asA('get', `/reservations/${id}/cancellation-preview`);
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ kind: 'CANCELLATION', amount: 30_000, waived: false });
    expect(
      (await call('get', A, tokReader, `/reservations/${id}/cancellation-preview`)).status,
    ).toBe(403);
    expect((await call('get', B, tokB, `/reservations/${id}/cancellation-preview`)).status).toBe(
      404,
    );
    const noShowPreview = await asA('get', `/reservations/${id}/cancellation-preview`).query({
      kind: 'NO_SHOW',
    });
    expect(noShowPreview.status).toBe(409); // arrival is not the business date yet
    const c = await asA('post', `/reservations/${id}/cancel`).send({
      reasonCode: 'GUEST_REQUEST',
      note: 'changed plans',
    });
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    expect(c.body.penalty).toEqual(preview.body);
    expect(c.body.penalty).toMatchObject({
      kind: 'CANCELLATION',
      amount: 30_000,
      computedAmount: 30_000,
      waived: false,
    });
    expect(c.body.penalty.lines[0]).toMatchObject({
      percent: 50,
      daysBefore: 3,
      tier: 2,
      policyId: S.policyId,
    });
    expect(c.body.reservation).toMatchObject({
      status: 'CANCELLED',
      cancelReason: 'GUEST_REQUEST: changed plans',
    });
    const got = await asA('get', `/reservations/${id}`);
    expect(got.body.penalty.amount).toBe(30_000);
    expect(got.body.customFields).toEqual({});
    expect(
      await env.services.admin.unitNight.count({
        where: { reservationRoom: { reservationId: id } },
      }),
    ).toBe(0);
    const ev = (await outbox('reservation.cancelled')).find(
      (e) => (e.payload as { reservationId: string }).reservationId === id,
    );
    expect(ev?.payload).toMatchObject({ penalty: { amount: 30_000 } });
    const again = await asA('post', `/reservations/${id}/cancel`).send({
      reasonCode: 'GUEST_REQUEST',
    });
    expect(again.status).toBe(409);
  });

  it('no-show on the arrival business date costs the no-show rate', async () => {
    const r = await book('2026-11-12', '2026-11-14', [{ roomTypeId: S.std }]);
    expect(r.status).toBe(201);
    const future = await book('2026-11-20', '2026-11-21', [{ roomTypeId: S.std }]);
    const early = await asA('post', `/reservations/${future.body.reservation.id}/no-show`).send({});
    expect(early.status).toBe(409);
    expect(early.body.meta.reason).toBe('TOO_EARLY');
    const ns = await asA('post', `/reservations/${r.body.reservation.id}/no-show`).send({});
    expect(ns.status, JSON.stringify(ns.body)).toBe(200);
    expect(ns.body.penalty).toMatchObject({ kind: 'NO_SHOW', amount: 60_000 });
    expect(ns.body.reservation.status).toBe('NO_SHOW');
  });

  it('PENDING option: confirm, list filters and cursor pagination', async () => {
    const p = await book('2026-12-22', '2026-12-23', [{ roomTypeId: S.std }], {
      status: 'PENDING',
    });
    expect(p.status).toBe(201);
    expect(p.body.reservation.optionExpiresAt).toBeTruthy();
    const list = await asA('get', '/reservations').query({
      propertyId: A.propertyId,
      status: 'PENDING',
    });
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(p.body.reservation.id);
    const c = await asA('post', `/reservations/${p.body.reservation.id}/confirm`).send({});
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('CONFIRMED');
    const search = await asA('get', '/reservations').query({
      propertyId: A.propertyId,
      search: p.body.reservation.number,
    });
    expect(search.body.items).toHaveLength(1);
    const page1 = await asA('get', '/reservations').query({ propertyId: A.propertyId, limit: 2 });
    expect(page1.body.items).toHaveLength(2);
    const page2 = await asA('get', '/reservations').query({
      propertyId: A.propertyId,
      limit: 2,
      cursor: page1.body.nextCursor,
    });
    expect(page2.body.items[0].id).not.toBe(page1.body.items[1].id);
    const range = await asA('get', '/reservations').query({
      propertyId: A.propertyId,
      from: '2026-12-22',
      to: '2026-12-23',
    });
    expect(range.body.items.every((x: { arrival: string }) => x.arrival <= '2026-12-22')).toBe(
      true,
    );
  });
});

describe('anti-overbooking under concurrency', () => {
  it('20 parallel creates on the last free unit: exactly one succeeds', async () => {
    const tries = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        asA('post', '/reservations').send({
          propertyId: A.propertyId,
          arrival: '2027-01-05',
          departure: '2027-01-07',
          guest: { firstName: `Guest${i}`, lastName: 'Race' },
          rooms: [
            {
              roomTypeId: S.sgl,
              ratePlanId: S.bar,
              adults: 1,
              ...(i % 2 ? { roomId: S.rooms['301'] } : {}),
            },
          ],
        }),
      ),
    );
    const codes = tries.map((t) => t.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    const held = await env.services.admin.reservationRoom.count({
      where: { roomTypeId: S.sgl, arrival: new Date('2027-01-05'), status: 'CONFIRMED' },
    });
    expect(held).toBe(1);
  });
});

describe('option expiry and reminders (fake clock)', () => {
  it('pending-expiry cancels an expired option and frees its nights', async () => {
    const at = new Date();
    const p = await book(
      '2027-01-10',
      '2027-01-11',
      [{ roomTypeId: S.sgl, roomId: S.rooms['301'], adults: 1 }],
      {
        status: 'PENDING',
        optionExpiresAt: new Date(at.getTime() + 3_600_000).toISOString(),
      },
    );
    expect(p.status).toBe(201);
    const id = p.body.reservation.id;
    const early = await runPendingExpiry(env.services, new Date(at.getTime() + 1_800_000));
    expect(early.expiredOptions).not.toContain(id);
    const later = await runPendingExpiry(env.services, new Date(at.getTime() + 2 * 3_600_000));
    expect(later.expiredOptions).toContain(id);
    const r = await asA('get', `/reservations/${id}`);
    expect(r.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'OPTION_EXPIRED' });
    expect(
      await env.services.admin.unitNight.count({
        where: { reservationRoom: { reservationId: id } },
      }),
    ).toBe(0);
  });

  it('booking-reminders sends J-3 pre_arrival and J-1 reminder once', async () => {
    const j3 = await book('2027-02-10', '2027-02-11', [{ roomTypeId: S.std }]);
    const j1 = await book('2027-02-08', '2027-02-09', [{ roomTypeId: S.std }]);
    const at = new Date('2027-02-07T09:00:00Z');
    sent.length = 0;
    await runBookingReminders(env.services, at);
    await runBookingReminders(env.services, at);
    const mine = (code: string, id: string) =>
      sent.filter((m) => m.templateCode === code && m.idempotencyKey.includes(id));
    expect(mine('pre_arrival', j3.body.reservation.id)).toHaveLength(1);
    expect(mine('booking_reminder', j1.body.reservation.id)).toHaveLength(1);
    expect(mine('booking_reminder', j3.body.reservation.id)).toHaveLength(0);
  });
});

describe('waitlist', () => {
  it('offer on release, expiry moves to the next, accept converts to a reservation', async () => {
    const r = await book('2027-03-01', '2027-03-03', [{ roomTypeId: S.sgl, adults: 1 }]);
    expect(r.status).toBe(201);
    const full = await book('2027-03-01', '2027-03-03', [{ roomTypeId: S.sgl, adults: 1 }], {
      guest: { firstName: 'Yao', lastName: 'First', email: 'yao@example.com' },
      joinWaitlistIfUnavailable: true,
    });
    expect(full.status).toBe(409);
    const e1 = full.body.meta.waitlistEntryId as string;
    expect(e1).toBeTruthy();
    const e2 = await asA('post', '/waitlist').send({
      propertyId: A.propertyId,
      guest: { firstName: 'Afi', lastName: 'Second', email: 'afi@example.com' },
      roomTypeId: S.sgl,
      arrival: '2027-03-01',
      departure: '2027-03-03',
      adults: 1,
    });
    expect(e2.status).toBe(201);

    const now0 = Date.now();
    await asA('post', `/reservations/${r.body.reservation.id}/cancel`).send({
      reasonCode: 'GUEST_REQUEST',
    });
    const released = (await outbox('inventory.released')).at(-1)!;
    expect(released.payload).toMatchObject({ propertyId: A.propertyId, cause: 'cancel' });
    // The domain-events worker turns the release into a `waitlist-match` job.
    await processDomainEvent(env.services, {
      id: 'evt',
      data: {
        id: released.id,
        tenantId: A.tenantId,
        type: released.type,
        payload: released.payload,
        createdAt: released.createdAt.toISOString(),
      },
    } as never);
    const q = new QueueFactory(env.services.config.REDIS_URL);
    try {
      const queued = await q.queue('reservations').getJob(`waitlist-match-${released.id}`);
      expect(queued?.data).toEqual({ tenantId: A.tenantId, propertyId: A.propertyId });
      await queued?.remove();
    } finally {
      await q.close();
    }

    sent.length = 0;
    const job = {
      id: 'j1',
      name: 'waitlist-match',
      data: { tenantId: A.tenantId, propertyId: A.propertyId },
    };
    const m1 = (await runJob(waitlistMatchJob, job as never, env.services)) as {
      offered: string[];
    };
    expect(m1.offered).toEqual([e1]);
    expect(sent.find((s) => s.templateCode === 'waitlist_offer')?.to.email).toBe('yao@example.com');
    let list = await asA('get', '/waitlist').query({ propertyId: A.propertyId });
    const byId = (id: string) => list.body.items.find((x: { id: string }) => x.id === id);
    expect(byId(e1)).toMatchObject({ status: 'OFFERED' });
    expect(byId(e2.body.id)).toMatchObject({ status: 'WAITING' });

    // Offer not accepted in time (24 h): expires, the next candidate is offered.
    const exp = await runPendingExpiry(env.services, new Date(now0 + 25 * 3_600_000));
    expect(exp.expiredOffers).toContain(e1);
    expect(exp.offered).toContain(e2.body.id);
    list = await asA('get', '/waitlist').query({ propertyId: A.propertyId });
    expect(byId(e1).status).toBe('EXPIRED');
    expect(byId(e2.body.id).status).toBe('OFFERED');

    const acc = await asA('post', `/waitlist/${e2.body.id}/accept`).send({ ratePlanId: S.bar });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    expect(acc.body.entry.status).toBe('ACCEPTED');
    expect(acc.body.reservation).toMatchObject({ status: 'CONFIRMED', arrival: '2027-03-01' });
    const twice = await asA('post', `/waitlist/${e2.body.id}/accept`).send({ ratePlanId: S.bar });
    expect(twice.status).toBe(409);
  });
});

describe('groups', () => {
  it('allotment holds inventory, pick-up swaps a held room, release gives it back', async () => {
    const g = await asA('post', '/groups').send({
      propertyId: A.propertyId,
      name: 'Séminaire BTP',
      arrival: '2027-04-01',
      departure: '2027-04-03',
      ratePlanId: S.bar,
      releaseDate: '2027-03-25',
      blocks: [{ roomTypeId: S.std, count: 2 }],
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(g.body.block).toEqual([{ roomTypeId: S.std, held: 2, pickedUp: 0 }]);
    expect((await free('2027-04-01', '2027-04-03', S.std)).minFree).toBe(1);

    const p = await asA('post', `/groups/${g.body.id}/pick-up`).send({
      entries: [
        { guest: { firstName: 'Kossi', lastName: 'Member' }, roomTypeId: S.std, adults: 1 },
      ],
    });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.group.block).toEqual([{ roomTypeId: S.std, held: 1, pickedUp: 1 }]);
    expect(p.body.group.roomingList[0]).toMatchObject({
      guestName: 'Kossi Member',
      status: 'CONFIRMED',
    });
    expect(p.body.reservations[0].groupId).toBe(g.body.id);
    expect((await free('2027-04-01', '2027-04-03', S.std)).minFree).toBe(1);

    const tooMany = await asA('post', `/groups/${g.body.id}/pick-up`).send({
      entries: [
        { guest: { firstName: 'A', lastName: 'One' }, roomTypeId: S.std },
        { guest: { firstName: 'B', lastName: 'Two' }, roomTypeId: S.std },
      ],
    });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.meta.reason).toBe('BLOCK_EXHAUSTED');

    const list = await asA('get', '/reservations').query({
      propertyId: A.propertyId,
      groupId: g.body.id,
    });
    expect(list.body.items).toHaveLength(1);

    // Release date reached (business date moved on): held rooms go back.
    await env.services.admin.property.update({
      where: { id: A.propertyId },
      data: { businessDate: new Date('2027-03-25') },
    });
    try {
      const exp = await runPendingExpiry(env.services, new Date());
      expect(exp.releasedAllotments).toContain(g.body.allotmentReservationId);
    } finally {
      await env.services.admin.property.update({
        where: { id: A.propertyId },
        data: { businessDate: new Date('2026-11-12') },
      });
    }
    expect((await free('2027-04-01', '2027-04-03', S.std)).minFree).toBe(2);
    const after = await asA('get', `/groups/${g.body.id}`);
    expect(after.body.block).toEqual([{ roomTypeId: S.std, held: 0, pickedUp: 1 }]);
  });

  it('requires the groups feature', async () => {
    const res = await call('get', B, tokB, '/groups').query({ propertyId: B.propertyId });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('FEATURE_NOT_IN_PLAN');
  });
});

describe('guests', () => {
  it('searches by fuzzy name, phone and e-mail; encrypts the id number', async () => {
    const g = await asA('post', '/guests').send({
      firstName: 'Koffi',
      lastName: 'Agbodjan',
      phone: '+228 90 12 34 56',
      email: 'koffi.agbodjan@example.tg',
      idDocType: 'PASSPORT',
      idDocNumber: 'TG1234567',
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    expect(g.body.idDocNumberMasked).toBe('••••4567');
    const row = await env.services.admin.guest.findUnique({ where: { id: g.body.id } });
    expect(row?.idDocNumberEnc).toBeTruthy();
    expect(row?.idDocNumberEnc).not.toContain('TG1234567');
    for (const search of ['Agbojan', 'koffi agbo', '90123456', 'agbodjan@example']) {
      const s = await asA('get', '/guests').query({ search });
      expect(s.status).toBe(200);
      expect(
        s.body.items.map((x: { id: string }) => x.id),
        search,
      ).toContain(g.body.id);
    }
  });
});

describe('isolation, permissions, realtime and planning', () => {
  it('another tenant cannot see or book on this tenant', async () => {
    const list = await asA('get', '/reservations').query({ propertyId: A.propertyId, limit: 1 });
    const id = list.body.items[0].id as string;
    expect((await call('get', B, tokB, `/reservations/${id}`)).status).toBe(404);
    const av = await call('get', B, tokB, '/availability').query({
      propertyId: A.propertyId,
      arrival: '2026-12-01',
      departure: '2026-12-02',
    });
    expect(av.status).toBe(404);
    const cross = await call('post', B, tokB, '/reservations').send({
      propertyId: A.propertyId,
      arrival: '2026-12-01',
      departure: '2026-12-02',
      guest: { firstName: 'X', lastName: 'Y' },
      rooms: [{ roomTypeId: S.std, ratePlanId: S.bar, adults: 1 }],
    });
    expect(cross.status).toBe(404);
    const guests = await call('get', B, tokB, '/guests').query({ search: 'Agbodjan' });
    expect(guests.body.items).toHaveLength(0);
  });

  it('refuses writes without the permission', async () => {
    const res = await call('post', A, tokReader, '/reservations').send({});
    expect(res.status).toBe(403);
    expect(
      (await call('post', A, tokReader, '/guests').send({ firstName: 'a', lastName: 'b' })).status,
    ).toBe(403);
    const ok = await call('get', A, tokReader, '/planning').query({
      propertyId: A.propertyId,
      from: '2026-12-01',
      to: '2026-12-08',
    });
    expect(ok.status).toBe(200);
  });

  it('relays planning.changed to the property room', async () => {
    const emitted: { pid: string; data: { type: string } }[] = [];
    const emitter: RealtimeEmitter = {
      emitToTenant: () => undefined,
      emitToUser: () => undefined,
      emitToGuest: () => undefined,
      emitToProperty: (_t, pid, _e, data) =>
        void emitted.push({ pid, data: data as { type: string } }),
    };
    const queues = new QueueFactory(env.services.config.REDIS_URL);
    try {
      for (let i = 0; i < 20; i++)
        if ((await relayOutbox(env.services, queues, { emitter, batch: 500 })).relayed === 0) break;
    } finally {
      await queues.close();
    }
    expect(emitted.some((e) => e.pid === A.propertyId && e.data.type === 'planning.changed')).toBe(
      true,
    );
  });

  it('planning grid: rooms by type, segments and blocks', async () => {
    const res = await asA('get', '/planning').query({
      propertyId: A.propertyId,
      from: '2026-12-01',
      to: '2026-12-20',
    });
    expect(res.status).toBe(200);
    const std = res.body.roomTypes.find((t: { id: string }) => t.id === S.std);
    expect(std.rooms.map((r: { number: string }) => r.number)).toEqual(['101', '102', '103']);
    expect(res.body.blocks).toHaveLength(1);
    const seg = res.body.segments.find(
      (s: { guestName: string; roomId: string }) => s.roomId === S.rooms['201'],
    );
    expect(seg).toMatchObject({
      guestName: 'Ama Mensah',
      kind: 'reservation',
      status: 'CONFIRMED',
      colorKey: 'confirmed',
    });
  });
});

describe('planning segments appear exactly once', () => {
  it('an assigned room only on its room, an unassigned one only on its type (no duplicate segment)', async () => {
    const assigned = await book('2027-02-01', '2027-02-04', [
      { roomTypeId: S.std, roomId: S.rooms['101'] },
    ]);
    const loose = await book('2027-02-01', '2027-02-04', [{ roomTypeId: S.std }]);
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(201);
    expect(loose.status, JSON.stringify(loose.body)).toBe(201);
    const res = await asA('get', '/planning').query({
      propertyId: A.propertyId,
      from: '2027-01-30',
      to: '2027-02-10',
    });
    expect(res.status).toBe(200);
    const segs = res.body.segments as {
      id: string;
      reservationId: string;
      roomId: string | null;
      roomTypeId: string;
    }[];
    const ids = segs.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    const a = segs.filter((x) => x.reservationId === assigned.body.reservation.id);
    const l = segs.filter((x) => x.reservationId === loose.body.reservation.id);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ roomId: S.rooms['101'], roomTypeId: S.std });
    expect(l).toHaveLength(1);
    expect(l[0]).toMatchObject({ roomId: null, roomTypeId: S.std });
  });
});

describe('planning: start-edge resize and drop on another room type', () => {
  const lineOf = async (id: string) =>
    (await asA('get', `/reservations/${id}`)).body as {
      roomTotal: number;
      arrival: string;
      rooms: { id: string; roomTypeId: string; roomId: string | null; arrival: string }[];
    };

  it('previews the re-quote without writing, then moves to an unassigned slot of another type', async () => {
    const r = await book('2027-04-10', '2027-04-13', [{ roomTypeId: S.std }]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = r.body.reservation.id as string;
    const line = r.body.reservation.rooms[0].id as string;
    const before = r.body.reservation.roomTotal as number;
    const url = `/reservations/${id}/rooms/${line}`;
    const body = { roomId: null, roomTypeId: S.dlx, changeRoomType: true };

    const prev = await asA('post', `${url}/move-preview`).send(body);
    expect(prev.status, JSON.stringify(prev.body)).toBe(200);
    expect(prev.body).toMatchObject({ currentTotal: before, newTotal: 150_000 });
    expect(prev.body.delta).toBe(150_000 - before);
    // nothing written
    expect((await lineOf(id)).rooms[0]).toMatchObject({ roomTypeId: S.std, roomId: null });
    expect((await lineOf(id)).roomTotal).toBe(before);

    expect((await asA('post', `${url}/move`).send({ ...body, changeRoomType: false })).status).toBe(
      422,
    );
    expect((await call('post', A, tokReader, `${url}/move-preview`).send(body)).status).toBe(403);
    expect((await call('post', B, tokB, `${url}/move-preview`).send(body)).status).toBe(404);

    const done = await asA('post', `${url}/move`).send(body);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.roomTotal).toBe(150_000);
    expect(done.body.rooms[0]).toMatchObject({ roomTypeId: S.dlx, roomId: null });
  });

  it('refuses a preview that is not available, as the move would', async () => {
    const hold = await book('2027-05-10', '2027-05-12', [
      { roomTypeId: S.sgl, roomId: S.rooms['301'], adults: 1 },
    ]);
    const r = await book('2027-05-10', '2027-05-12', [{ roomTypeId: S.std, adults: 1 }]);
    expect(hold.status).toBe(201);
    const id = r.body.reservation.id as string;
    const url = `/reservations/${id}/rooms/${r.body.reservation.rooms[0].id}`;
    const body = { roomId: null, roomTypeId: S.sgl, changeRoomType: true };
    expect((await asA('post', `${url}/move-preview`).send(body)).status).toBe(409);
    expect((await asA('post', `${url}/move`).send(body)).status).toBe(409);
  });

  it('start-edge resize: an earlier arrival prices the new night, a later one releases it', async () => {
    const r = await book('2027-06-10', '2027-06-13', [
      { roomTypeId: S.std, roomId: S.rooms['101'] },
    ]);
    expect(r.status).toBe(201);
    const id = r.body.reservation.id as string;
    const line = r.body.reservation.rooms[0].id as string;
    const url = `/reservations/${id}/rooms/${line}/move`;
    const earlier = await asA('post', url).send({ arrival: '2027-06-09', departure: '2027-06-13' });
    expect(earlier.status, JSON.stringify(earlier.body)).toBe(200);
    expect(earlier.body.arrival).toBe('2027-06-09');
    expect(earlier.body.rooms[0].dailyPrices).toHaveLength(4);
    expect(earlier.body.rooms[0].roomId).toBe(S.rooms['101']);
    // another stay holds 101 on 06-08: arriving one more day earlier clashes (409, nothing changed)
    const other = await book('2027-06-07', '2027-06-09', [
      { roomTypeId: S.std, roomId: S.rooms['101'] },
    ]);
    expect(other.status).toBe(201);
    const clash = await asA('post', url).send({ arrival: '2027-06-08', departure: '2027-06-13' });
    expect(clash.status).toBe(409);
    expect((await lineOf(id)).arrival).toBe('2027-06-09');
    const later = await asA('post', url).send({ arrival: '2027-06-11', departure: '2027-06-13' });
    expect(later.status).toBe(200);
    expect(later.body.rooms[0].dailyPrices).toHaveLength(2);
  });
});

describe('planning performance', () => {
  it('150 rooms × 31 days in < 300 ms', async () => {
    const { admin, config } = env.services;
    const C = await createTenantFixture(admin, { label: 'rp', features: ['lodging.core'] });
    const tok = await mintToken(config, { sub: C.userId, tid: C.tenantId });
    const tenantId = C.tenantId;
    const propertyId = C.propertyId;
    const types = await Promise.all(
      ['A', 'B', 'C', 'D', 'E'].map((code) =>
        admin.roomType.create({
          data: { tenantId, propertyId, code, name: code, maxAdults: 2, baseOccupancy: 2 },
        }),
      ),
    );
    const plan = await admin.ratePlan.create({
      data: { tenantId, propertyId, code: 'BAR', name: 'BAR' },
    });
    await admin.room.createMany({
      data: Array.from({ length: 150 }, (_, i) => ({
        tenantId,
        propertyId,
        roomTypeId: types[i % 5]!.id,
        number: String(1000 + i),
      })),
    });
    const rooms = await admin.room.findMany({ where: { propertyId }, orderBy: { number: 'asc' } });
    const guest = await admin.guest.create({
      data: { tenantId, firstName: 'Perf', lastName: 'Guest' },
    });
    const day = (n: number) => new Date(Date.UTC(2027, 4, 1 + n));
    const resRows = [];
    const rrRows = [];
    const nightRows = [];
    let k = 0;
    for (const room of rooms)
      for (let start = k % 3; start < 31; start += 4) {
        const len = Math.min(3, 31 - start);
        const resId = crypto.randomUUID();
        const rrId = crypto.randomUUID();
        resRows.push({
          id: resId,
          tenantId,
          propertyId,
          number: `P-${k++}`,
          status: 'CONFIRMED' as const,
          bookerGuestId: guest.id,
          arrival: day(start),
          departure: day(start + len),
        });
        rrRows.push({
          id: rrId,
          tenantId,
          propertyId,
          reservationId: resId,
          roomTypeId: room.roomTypeId,
          roomId: room.id,
          ratePlanId: plan.id,
          arrival: day(start),
          departure: day(start + len),
          status: 'CONFIRMED' as const,
        });
        for (let n = 0; n < len; n++)
          nightRows.push({
            tenantId,
            unitId: room.id,
            reservationRoomId: rrId,
            night: day(start + n),
          });
      }
    await admin.reservation.createMany({ data: resRows });
    await admin.reservationRoom.createMany({ data: rrRows });
    await admin.reservationGuest.createMany({
      data: rrRows.map((r) => ({
        tenantId,
        reservationRoomId: r.id,
        guestId: guest.id,
        isPrimary: true,
      })),
    });
    await admin.unitNight.createMany({ data: nightRows });

    const get = () =>
      request(app)
        .get(`${T}/planning`)
        .query({ propertyId, from: '2027-05-01', to: '2027-06-01' })
        .set('Host', C.host)
        .set('Authorization', `Bearer ${tok}`);
    const warm = await get();
    expect(warm.status).toBe(200);
    expect(warm.body.segments.length).toBe(rrRows.length);
    const t0 = performance.now();
    const res = await get();
    const ms = performance.now() - t0;
    expect(res.status).toBe(200);
    expect(
      res.body.roomTypes.reduce((s: number, t: { rooms: unknown[] }) => s + t.rooms.length, 0),
    ).toBe(150);
    expect(ms).toBeLessThan(300);
  });
});
