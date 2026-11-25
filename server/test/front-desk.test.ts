import { SYSTEM_ROLE_PERMISSIONS } from '@hm/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  ManualPaymentProvider,
  NoneFiscalInvoiceProvider,
  ProviderRegistry,
} from '../src/lib/providers/index.js';
import { overrideNotificationDeps } from '../src/modules/notifications/index.js';
import type { NotifyInput } from '../src/modules/notifications/service.js';
import { closeReservationQueues, overrideGuestNotifier } from '../src/modules/reservations/index.js';
import { eventually } from './helpers/auth.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import { seedLodging, type LodgingSeed } from './helpers/lodging-seed.js';

let env: TestEnv;
let app: Express;
let A: TenantFixture;
let B: TenantFixture;
let SA: LodgingSeed;
let SB: LodgingSeed;
let tokA: string; // owner: every permission
let tokB: string;
let tokDesk: string; // front desk without override_dirty / checkout_with_balance / guests.export
let tokExport: string; // desk + guests.export + checkout_with_balance
let tokReader: string; // front_desk.read only
let tokRole: string; // the real FRONT_DESK system role grants
const sent: NotifyInput[] = [];
const PDF = Buffer.from('%PDF-1.4 fake');

const T = '/api/v1/t';
type Method = 'get' | 'post' | 'put' | 'delete';
const api = (method: Method, path: string, tok = tokA, f: TenantFixture = A) =>
  request(app)[method](`${T}${path}`).set('Host', f.host).set('Authorization', `Bearer ${tok}`);

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;
const BD = '2026-11-12';
const addDay = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

const DESK_PERMS = [
  'front_desk.read',
  'front_desk.check_in',
  'front_desk.check_out',
  'front_desk.move',
  'front_desk.police_form',
  'reservations.read',
  'reservations.create',
  'reservations.update',
  'reservations.assign',
  'reservations.cancel',
  'guests.read',
  'guests.create',
  'folio.read',
  'folio.pay',
  'invoices.read',
  'invoices.issue',
];

const identity = {
  birthDate: '1985-03-02',
  birthPlace: 'Lomé',
  nationality: 'TG',
  profession: 'Ingénieur',
  address: 'Rue des Fleurs, Lomé',
  idDocType: 'PASSPORT',
  idDocNumber: 'TG1234567',
  idIssuedOn: '2020-01-01',
  idIssuedPlace: 'Lomé',
};
const police = { provenance: 'Accra', destination: 'Cotonou', purpose: 'Affaires' };
const checkInBody = (rrId: string, extra: Record<string, unknown> = {}) => ({
  reservationRoomId: rrId,
  guests: [identity],
  police,
  notifyGuest: false,
  ...extra,
});

async function newRoom(hk: 'CLEAN' | 'DIRTY' | 'OUT_OF_ORDER' | 'INSPECTED' = 'CLEAN', f = A, s = SA) {
  const r = await env.services.admin.room.create({
    data: {
      tenantId: f.tenantId,
      propertyId: f.propertyId,
      roomTypeId: s.std,
      number: `R${uniq()}`,
      hkStatus: hk,
    },
  });
  return r;
}

interface Booked {
  reservationId: string;
  rrId: string;
  guestId: string;
  number: string;
}

async function book(
  o: {
    arrival?: string;
    departure?: string;
    roomId?: string | null;
    f?: TenantFixture;
    s?: LodgingSeed;
    tok?: string;
    adults?: number;
    companyId?: string;
    guest?: Record<string, unknown>;
  } = {},
): Promise<Booked> {
  const f = o.f ?? A;
  const s = o.s ?? SA;
  const res = await api('post', '/reservations', o.tok ?? (f === A ? tokA : tokB), f).send({
    propertyId: f.propertyId,
    arrival: o.arrival ?? BD,
    departure: o.departure ?? addDay(BD, 2),
    guest: o.guest ?? { firstName: 'Kofi', lastName: `Agbeko${uniq()}`, email: 'kofi@example.com', phone: '+22890112233' },
    rooms: [
      {
        roomTypeId: s.std,
        ratePlanId: s.bar,
        adults: o.adults ?? 2,
        ...(o.roomId === undefined ? { roomId: (await newRoom('CLEAN', f, s)).id } : o.roomId ? { roomId: o.roomId } : {}),
      },
    ],
    ...(o.companyId ? { companyId: o.companyId } : {}),
    notifyGuest: false,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const r = res.body.reservation;
  return {
    reservationId: r.id,
    rrId: r.rooms[0].id,
    guestId: r.booker.id,
    number: r.number,
  };
}

async function checkedIn(o: Parameters<typeof book>[0] = {}, extra: Record<string, unknown> = {}) {
  const b = await book(o);
  const res = await api('post', '/front-desk/stays', o.tok ?? tokA, o.f ?? A).send(checkInBody(b.rrId, extra));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...b, stayId: res.body.stayId as string, roomId: res.body.roomId as string, result: res.body };
}

const folioOf = async (rrId: string) => {
  const res = await api('post', '/folios/resolve').send({ reservationRoomId: rrId });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { id: string; balance: number; payments: { amount: number; isDeposit: boolean }[]; stayId: string | null };
};

const auditOf = (action: string, entityId?: string) =>
  eventually(() =>
    env.services.admin.auditLog.findMany({
      where: { tenantId: A.tenantId, action, ...(entityId ? { entityId } : {}) },
    }),
  );

beforeAll(async () => {
  overrideNotificationDeps({
    providers: new ProviderRegistry({
      name: 'fake-pdf',
      renderHtml: () => Promise.resolve(PDF),
    })
      .addPayment(new ManualPaymentProvider())
      .addFiscal(new NoneFiscalInvoiceProvider()),
    storage: {
      put: (i) => Promise.resolve({ key: `t/x/${i.key}`, size: 12 }),
      signedUrl: (k) => Promise.resolve(`https://files.test/${k}?sig=1`),
    },
  });
  overrideGuestNotifier((_s, input) => {
    sent.push(input);
    return Promise.resolve([]);
  });
  env = createTestEnv();
  ({ app } = createApp(env.services));
  const { admin, config } = env.services;
  A = await createTenantFixture(admin, { label: 'fd', features: ['lodging.core', 'billing.core', 'city_ledger'] });
  B = await createTenantFixture(admin, { label: 'fe', features: ['lodging.core', 'billing.core'] });
  SA = await seedLodging(admin, A.tenantId, A.propertyId);
  SB = await seedLodging(admin, B.tenantId, B.propertyId);
  for (const f of [A, B]) {
    await admin.tax.create({
      data: {
        tenantId: f.tenantId,
        propertyId: f.propertyId,
        code: 'TVA18',
        name: 'TVA 18 %',
        type: 'PERCENT',
        value: '18',
        appliesTo: ['LODGING', 'FOLIO'],
      },
    });
  }
  tokA = await mintToken(config, { sub: A.userId, tid: A.tenantId });
  tokB = await mintToken(config, { sub: B.userId, tid: B.tenantId });
  const mk = async (perms: string[]) => {
    const id = await addUser(admin, A.tenantId, perms);
    await admin.userProperty.create({ data: { tenantId: A.tenantId, userId: id, propertyId: A.propertyId } });
    return mintToken(config, { sub: id, tid: A.tenantId });
  };
  tokDesk = await mk(DESK_PERMS);
  tokExport = await mk([...DESK_PERMS, 'guests.export', 'front_desk.checkout_with_balance']);
  tokReader = await mk(['front_desk.read', 'reservations.read']);
  tokRole = await mk([...SYSTEM_ROLE_PERMISSIONS.FRONT_DESK, 'invoices.read']);
});

afterAll(async () => {
  overrideGuestNotifier(null);
  overrideNotificationDeps({});
  if (env) await closeReservationQueues(env.services);
  await env?.close();
});

describe('FRONT_DESK system role', () => {
  it('cannot override a dirty room nor check out with a balance (sensitive permissions)', async () => {
    const dirty = await newRoom('DIRTY');
    const b = await book({ roomId: dirty.id });
    const ci = await api('post', '/front-desk/stays', tokRole).send(checkInBody(b.rrId, { overrideDirty: true }));
    expect(ci.status).toBe(403);
    const s = await checkedIn({ departure: addDay(BD, 1) });
    const co = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokRole).send({ overrideReason: 'Client parti sans payer' });
    expect(co.status).toBe(403);
  });
});

describe('day lists and KPIs', () => {
  it('lists arrivals, in-house, departures and no-show candidates with counts', async () => {
    const arriving = await book({ departure: addDay(BD, 3) });
    const late = await book({ arrival: BD, departure: addDay(BD, 1) });
    // A confirmed reservation whose arrival is before the business date (no-show candidate).
    const { admin } = env.services;
    const ns = await book({ arrival: BD, departure: addDay(BD, 5) });
    await admin.reservation.update({ where: { id: ns.reservationId }, data: { arrival: new Date(addDay(BD, -1)) } });
    await admin.reservationRoom.update({ where: { id: ns.rrId }, data: { arrival: new Date(addDay(BD, -1)) } });
    const inHouse = await checkedIn({ departure: addDay(BD, 1) });
    // Departing today (seeded-style data: the engine never lets a stay end on its check-in day).
    await admin.reservation.update({ where: { id: inHouse.reservationId }, data: { arrival: new Date(addDay(BD, -1)), departure: new Date(BD) } });
    await admin.reservationRoom.update({ where: { id: inHouse.rrId }, data: { arrival: new Date(addDay(BD, -1)), departure: new Date(BD) } });

    const q = `propertyId=${A.propertyId}`;
    const arrivals = await api('get', `/front-desk/arrivals?${q}`);
    expect(arrivals.status, JSON.stringify(arrivals.body)).toBe(200);
    expect(arrivals.body.businessDate).toBe(BD);
    const ids = arrivals.body.items.map((i: { reservationRoomId: string }) => i.reservationRoomId);
    expect(ids).toEqual(expect.arrayContaining([arriving.rrId, late.rrId, ns.rrId]));
    expect(ids).not.toContain(inHouse.rrId);
    const lateRow = arrivals.body.items.find((i: { reservationRoomId: string }) => i.reservationRoomId === ns.rrId);
    expect(lateRow.late).toBe(true);

    const deps = await api('get', `/front-desk/departures?${q}`);
    expect(deps.body.items.map((i: { reservationRoomId: string }) => i.reservationRoomId)).toContain(inHouse.rrId);
    const inh = await api('get', `/front-desk/in-house?${q}`);
    const row = inh.body.items.find((i: { reservationRoomId: string }) => i.reservationRoomId === inHouse.rrId);
    expect(row).toMatchObject({ stayId: inHouse.stayId, status: 'CHECKED_IN', hkStatus: 'CLEAN' });
    const nos = await api('get', `/front-desk/no-shows?${q}`);
    expect(nos.body.items.map((i: { reservationRoomId: string }) => i.reservationRoomId)).toEqual([ns.rrId]);

    const s = await api('get', `/front-desk/summary?${q}`);
    expect(s.status).toBe(200);
    expect(s.body.arrivals).toBe(arrivals.body.items.length);
    expect(s.body.departures).toBe(deps.body.items.length);
    expect(s.body.inHouse).toBe(inh.body.items.length);
    expect(s.body.noShows).toBe(1);
    expect(s.body.availableCleanRooms).toBeGreaterThan(0);

    const found = await api('get', `/front-desk/arrivals?${q}&search=${arriving.number}`);
    expect(found.body.items).toHaveLength(1);
  });

  it('suggests clean rooms only and flags dirty ones', async () => {
    const dirty = await newRoom('DIRTY');
    const ooo = await newRoom('OUT_OF_ORDER');
    const res = await api('get', `/front-desk/available-rooms?propertyId=${A.propertyId}&from=${BD}&to=${addDay(BD, 1)}&roomTypeId=${SA.std}`);
    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((r: { id: string; clean: boolean }) => [r.id, r]));
    expect(byId.get(dirty.id)).toMatchObject({ clean: false, hkStatus: 'DIRTY' });
    expect(byId.has(ooo.id)).toBe(false);
  });
});

describe('check-in', () => {
  it('creates the stay, the police record (encrypted number), statuses, folio link, events, welcome notice and audit', async () => {
    const b = await book();
    const before = sent.length;
    const res = await api('post', '/front-desk/stays', tokA).send(
      checkInBody(b.rrId, { notifyGuest: true, guests: [{ ...identity, idDocNumber: 'PASS-998877' }] }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.policeRecordIds).toHaveLength(1);
    expect(res.body.notified).toBe(true);

    const { admin } = env.services;
    const stay = await admin.stay.findFirstOrThrow({ where: { reservationRoomId: b.rrId } });
    expect(stay.checkedInBy).toBe(A.userId);
    const rr = await admin.reservationRoom.findFirstOrThrow({ where: { id: b.rrId } });
    const r = await admin.reservation.findFirstOrThrow({ where: { id: b.reservationId } });
    expect([rr.status, r.status]).toEqual(['CHECKED_IN', 'CHECKED_IN']);

    const rec = await admin.policeRecord.findFirstOrThrow({ where: { stayId: stay.id } });
    const snap = rec.snapshot as Record<string, unknown>;
    expect(snap).toMatchObject({ lastName: expect.any(String), provenance: 'Accra', destination: 'Cotonou', purpose: 'Affaires' });
    expect(JSON.stringify(snap)).not.toContain('PASS-998877');
    expect(typeof snap.idDocNumberEnc).toBe('string');
    const guest = await admin.guest.findFirstOrThrow({ where: { id: b.guestId } });
    expect(guest.idDocNumberEnc).toBeTruthy();
    expect(guest.idDocNumberEnc).not.toContain('PASS-998877');
    expect(guest.birthPlace).toBe('Lomé');

    const folio = await folioOf(b.rrId);
    expect(folio.stayId).toBe(stay.id);
    const events = await admin.outboxEvent.findMany({ where: { tenantId: A.tenantId, type: { in: ['planning.changed', 'stay.checked_in'] } } });
    expect(events.some((e) => e.type === 'stay.checked_in' && (e.payload as { stayId: string }).stayId === stay.id)).toBe(true);
    expect(
      events.some((e) => e.type === 'planning.changed' && (e.payload as { action: string; reservationId: string }).action === 'check_in' && (e.payload as { reservationId: string }).reservationId === b.reservationId),
    ).toBe(true);
    const welcome = sent.slice(before).find((n) => n.templateCode === 'welcome');
    expect(welcome?.data).toMatchObject({ reservation: { roomNumber: res.body.roomNumber } });
    const audit = await auditOf('front_desk.check_in', stay.id);
    expect(JSON.stringify(audit[0]!.after)).not.toContain('PASS-998877');

    const again = await api('post', '/front-desk/stays', tokA).send(checkInBody(b.rrId));
    expect(again.status).toBe(409);
    expect(again.body.meta.reason).toBe('ALREADY_CHECKED_IN');
  });

  it('prefills identity from the guest profile and validates the mandatory police fields', async () => {
    const b = await book();
    const missing = await api('post', '/front-desk/stays', tokA).send({
      reservationRoomId: b.rrId,
      guests: [{ idDocType: 'CNI' }],
    });
    expect(missing.status).toBe(422);
    const paths = missing.body.errors.map((e: { path: string }) => e.path);
    expect(paths).toEqual(expect.arrayContaining(['guests.0.birthDate', 'guests.0.nationality', 'guests.0.idDocNumber']));
    expect(await env.services.admin.stay.count({ where: { reservationRoomId: b.rrId } })).toBe(0);

    await env.services.admin.customFieldDefinition.create({
      data: { tenantId: A.tenantId, entity: 'police_record', key: 'vehicle_plate', labelI18n: { fr: 'Plaque' }, type: 'TEXT', required: true },
    });
    try {
      const noCf = await api('post', '/front-desk/stays', tokA).send(checkInBody(b.rrId));
      expect(noCf.status).toBe(422);
      expect(noCf.body.errors[0].path).toContain('police.customFields');
      const ok = await api('post', '/front-desk/stays', tokA).send(
        checkInBody(b.rrId, { police: { ...police, customFields: { vehicle_plate: 'TG-123-AB' } } }),
      );
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const rec = await env.services.admin.policeRecord.findFirstOrThrow({ where: { stayId: ok.body.stayId } });
      expect((rec.snapshot as { customFields: unknown }).customFields).toEqual({ vehicle_plate: 'TG-123-AB' });
    } finally {
      await env.services.admin.customFieldDefinition.deleteMany({ where: { tenantId: A.tenantId, entity: 'police_record' } });
    }

    // Second stay of the same guest: profile prefilled, only overrides needed.
    const b2 = await book({ guest: { id: b.guestId } });
    const pre = await api('post', '/front-desk/stays', tokA).send({
      reservationRoomId: b2.rrId,
      guests: [{ idDocNumber: 'NEW-9999' }],
    });
    expect(pre.status, JSON.stringify(pre.body)).toBe(201);
    const rec2 = await env.services.admin.policeRecord.findFirstOrThrow({ where: { stayId: pre.body.stayId } });
    expect(rec2.snapshot).toMatchObject({ birthPlace: 'Lomé', idIssuedPlace: 'Lomé', nationality: 'TG' });
  });

  it('refuses a dirty room unless override_dirty, and an out-of-order room always', async () => {
    const dirty = await newRoom('DIRTY');
    const b = await book({ roomId: dirty.id });
    const refused = await api('post', '/front-desk/stays', tokDesk).send(checkInBody(b.rrId));
    expect(refused.status).toBe(409);
    expect(refused.body.meta).toMatchObject({ reason: 'ROOM_NOT_CLEAN', hkStatus: 'DIRTY' });
    const noPerm = await api('post', '/front-desk/stays', tokDesk).send(checkInBody(b.rrId, { overrideDirty: true }));
    expect(noPerm.status).toBe(403);
    const ok = await api('post', '/front-desk/stays', tokA).send(checkInBody(b.rrId, { overrideDirty: true }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const audit = await auditOf('front_desk.check_in', ok.body.stayId);
    expect((audit[0]!.after as { overrideDirty: boolean }).overrideDirty).toBe(true);

    const ooo = await newRoom('CLEAN');
    const b2 = await book({ roomId: ooo.id });
    await env.services.admin.room.update({ where: { id: ooo.id }, data: { hkStatus: 'OUT_OF_ORDER' } });
    const never = await api('post', '/front-desk/stays', tokA).send(checkInBody(b2.rrId, { overrideDirty: true }));
    expect(never.status).toBe(409);
    expect(never.body.meta.reason).toBe('ROOM_UNUSABLE');
  });

  it('requires an assigned room, or assigns it in the same call with an availability check', async () => {
    const b = await book({ roomId: null });
    const none = await api('post', '/front-desk/stays', tokA).send(checkInBody(b.rrId));
    expect(none.status).toBe(409);
    expect(none.body.meta.reason).toBe('ROOM_NOT_ASSIGNED');

    const room = await newRoom('CLEAN');
    const ok = await api('post', '/front-desk/stays', tokA).send(checkInBody(b.rrId, { roomId: room.id }));
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.roomId).toBe(room.id);

    // The unit is taken by another stay: refused with the availability conflict.
    const b2 = await book({ roomId: null });
    const clash = await api('post', '/front-desk/stays', tokA).send(checkInBody(b2.rrId, { roomId: room.id }));
    expect(clash.status).toBe(409);
    expect(clash.body.meta.reason).toBe('UNIT_UNAVAILABLE');
    expect(await env.services.admin.stay.count({ where: { reservationRoomId: b2.rrId } })).toBe(0);
  });

  it('refuses a future arrival and an unconfirmed reservation', async () => {
    const future = await book({ arrival: addDay(BD, 3), departure: addDay(BD, 5) });
    const r = await api('post', '/front-desk/stays', tokA).send(checkInBody(future.rrId));
    expect(r.status).toBe(409);
    expect(r.body.meta.reason).toBe('TOO_EARLY');
    const pending = await api('post', '/reservations', tokA).send({
      propertyId: A.propertyId,
      arrival: BD,
      departure: addDay(BD, 1),
      guest: { firstName: 'P', lastName: 'Pending' },
      rooms: [{ roomTypeId: SA.std, ratePlanId: SA.bar, adults: 1 }],
      status: 'PENDING',
      notifyGuest: false,
    });
    expect(pending.status, JSON.stringify(pending.body)).toBe(201);
    const p = await api('post', '/front-desk/stays', tokA).send(checkInBody(pending.body.reservation.rooms[0].id));
    expect(p.status).toBe(409);
  });

  it('takes a deposit through the folio API (needs folio.pay), reported apart', async () => {
    const b = await book();
    const res = await api('post', '/front-desk/stays', tokA).send(
      checkInBody(b.rrId, { deposit: { method: 'CARD', amount: 20_000, reference: 'AUTH-1' } }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.deposit).toMatchObject({ ok: true });
    const f = await folioOf(b.rrId);
    expect(f.payments).toEqual([expect.objectContaining({ amount: 20_000, isDeposit: true })]);
    expect(f.balance).toBe(-20_000);

    // A cash deposit without an open cash session fails but never undoes the check-in.
    const b2 = await book();
    const cash = await api('post', '/front-desk/stays', tokA).send(
      checkInBody(b2.rrId, { deposit: { method: 'CASH', amount: 5_000 } }),
    );
    expect(cash.status).toBe(201);
    expect(cash.body.deposit.ok).toBe(false);
    expect(cash.body.warnings[0]).toContain('DEPOSIT_FAILED');

    const reader = await addUser(env.services.admin, A.tenantId, ['front_desk.check_in', 'reservations.read']);
    await env.services.admin.userProperty.create({ data: { tenantId: A.tenantId, userId: reader, propertyId: A.propertyId } });
    const tok = await mintToken(env.services.config, { sub: reader, tid: A.tenantId });
    const b3 = await book();
    const denied = await api('post', '/front-desk/stays', tok).send(
      checkInBody(b3.rrId, { deposit: { method: 'CARD', amount: 1_000 } }),
    );
    expect(denied.status).toBe(403);
  });

  it('records the signature and the ID scan uploaded beforehand', async () => {
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(16)]);
    const up = await api('post', '/front-desk/files?kind=signature').attach('file', png, { filename: 'sig.png', contentType: 'image/png' });
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const fake = await api('post', '/front-desk/files?kind=signature').attach('file', Buffer.from('not a png'), { filename: 'x.png', contentType: 'image/png' });
    expect(fake.status).toBe(422);
    const b = await book();
    const res = await api('post', '/front-desk/stays', tokA).send(checkInBody(b.rrId, { signatureFileId: up.body.fileId }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rec = await env.services.admin.policeRecord.findFirstOrThrow({ where: { stayId: res.body.stayId } });
    expect(rec.signatureFileId).toBe(up.body.fileId);
    const unknown = await api('post', '/front-desk/stays', tokA).send(
      checkInBody((await book()).rrId, { signatureFileId: '00000000-0000-4000-8000-000000000000' }),
    );
    expect(unknown.status).toBe(422);
  });
});

describe('walk-in', () => {
  it('creates guest + confirmed reservation + check-in in one call, picking a clean free unit', async () => {
    const { admin } = env.services;
    const dlxRoom = SA.rooms['201']!;
    await admin.room.update({ where: { id: dlxRoom }, data: { hkStatus: 'DIRTY' } });
    const res = await api('post', '/front-desk/walk-ins', tokA).send({
      propertyId: A.propertyId,
      departure: addDay(BD, 2),
      roomTypeId: SA.dlx,
      ratePlanId: SA.bar,
      adults: 1,
      guest: { firstName: 'Ama', lastName: 'Walkin', ...identity },
      guests: [{}],
      police,
      notifyGuest: false,
    });
    expect(res.status).toBe(409);
    expect(res.body.meta.reason).toBe('NO_CLEAN_ROOM');
    await admin.room.update({ where: { id: dlxRoom }, data: { hkStatus: 'CLEAN' } });

    const ok = await api('post', '/front-desk/walk-ins', tokA).send({
      propertyId: A.propertyId,
      departure: addDay(BD, 2),
      roomTypeId: SA.dlx,
      ratePlanId: SA.bar,
      adults: 1,
      guest: { firstName: 'Ama', lastName: 'Walkin', ...identity },
      guests: [{}],
      police,
      notifyGuest: false,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.roomId).toBe(dlxRoom);
    const rr = await admin.reservationRoom.findFirstOrThrow({ where: { id: ok.body.reservationRoomId }, include: { reservation: true } });
    expect(rr.status).toBe('CHECKED_IN');
    expect(rr.reservation).toMatchObject({ status: 'CHECKED_IN', channel: 'FRONT_DESK' });
    expect(rr.reservation.arrival.toISOString().slice(0, 10)).toBe(BD);
    expect(rr.dailyPrices).toHaveLength(2);
    const rec = await admin.policeRecord.findFirstOrThrow({ where: { stayId: ok.body.stayId } });
    expect(rec.snapshot).toMatchObject({ lastName: 'Walkin', nationality: 'TG' });
    await auditOf('front_desk.walk_in', rr.reservationId);

    // The unit is now taken: a second walk-in on the single DLX room is refused, nothing is created.
    const count = await admin.reservation.count({ where: { tenantId: A.tenantId } });
    const full = await api('post', '/front-desk/walk-ins', tokA).send({
      propertyId: A.propertyId,
      departure: addDay(BD, 1),
      roomTypeId: SA.dlx,
      ratePlanId: SA.bar,
      adults: 1,
      guest: { firstName: 'Bob', lastName: 'Second', ...identity },
      guests: [{}],
      police,
      notifyGuest: false,
    });
    expect(full.status).toBe(409);
    expect(await admin.reservation.count({ where: { tenantId: A.tenantId } })).toBe(count);
  });

  it('rolls back the reservation when the police form is incomplete', async () => {
    const count = await env.services.admin.reservation.count({ where: { tenantId: A.tenantId } });
    const res = await api('post', '/front-desk/walk-ins', tokA).send({
      propertyId: A.propertyId,
      departure: addDay(BD, 1),
      roomTypeId: SA.sgl,
      ratePlanId: SA.bar,
      adults: 1,
      guest: { firstName: 'No', lastName: 'Papers' },
      guests: [{}],
      notifyGuest: false,
    });
    expect(res.status).toBe(422);
    expect(await env.services.admin.reservation.count({ where: { tenantId: A.tenantId } })).toBe(count);
  });
});

describe('in-stay operations', () => {
  it('changes room: remaining nights move, the old room turns DIRTY, reason audited', async () => {
    const s = await checkedIn({ departure: addDay(BD, 3) });
    const target = await newRoom('CLEAN');
    const { admin } = env.services;
    const res = await api('post', `/front-desk/stays/${s.stayId}/room-change`, tokA).send({
      roomId: target.id,
      reason: 'Climatisation en panne',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.movedNights).toBe(3);
    const nights = await admin.unitNight.findMany({ where: { reservationRoomId: s.rrId } });
    expect(nights.map((n) => n.unitId)).toEqual(Array(3).fill(target.id));
    expect((await admin.room.findFirstOrThrow({ where: { id: s.roomId } })).hkStatus).toBe('DIRTY');
    expect((await admin.reservationRoom.findFirstOrThrow({ where: { id: s.rrId } })).roomId).toBe(target.id);
    expect(await admin.roomStatusHistory.count({ where: { roomId: s.roomId, toStatus: 'DIRTY' } })).toBe(1);
    const audit = await auditOf('front_desk.room_change', s.stayId);
    expect(audit[0]!.after).toMatchObject({ reason: 'Climatisation en panne', movedNights: 3 });

    // Target occupied → 409; dirty target → refused without override; same room → 422.
    const other = await checkedIn({ departure: addDay(BD, 2) });
    const clash = await api('post', `/front-desk/stays/${s.stayId}/room-change`, tokA).send({ roomId: other.roomId, reason: 'Test conflit' });
    expect(clash.status).toBe(409);
    const dirty = await newRoom('DIRTY');
    const nd = await api('post', `/front-desk/stays/${s.stayId}/room-change`, tokDesk).send({ roomId: dirty.id, reason: 'Test sale' });
    expect(nd.status).toBe(409);
    expect(nd.body.meta.reason).toBe('ROOM_NOT_CLEAN');
    const same = await api('post', `/front-desk/stays/${s.stayId}/room-change`, tokA).send({ roomId: target.id, reason: 'Test même' });
    expect(same.status).toBe(422);
  });

  it('extends (re-quoted, availability checked), shortens and handles an early departure', async () => {
    const s = await checkedIn({ departure: addDay(BD, 2) });
    const ext = await api('post', `/front-desk/stays/${s.stayId}/extend`, tokA).send({ departure: addDay(BD, 4) });
    expect(ext.status, JSON.stringify(ext.body)).toBe(200);
    const rr = ext.body.reservation.rooms[0];
    expect(rr.departure).toBe(addDay(BD, 4));
    expect(rr.dailyPrices).toHaveLength(4);
    expect(rr.total).toBe(4 * 30_000 + 0 * 5_000);

    const short = await api('post', `/front-desk/stays/${s.stayId}/shorten`, tokA).send({ departure: addDay(BD, 3) });
    expect(short.status, JSON.stringify(short.body)).toBe(200);
    expect(await env.services.admin.unitNight.count({ where: { reservationRoomId: s.rrId } })).toBe(3);

    const wrong = await api('post', `/front-desk/stays/${s.stayId}/extend`, tokA).send({ departure: addDay(BD, 1) });
    expect(wrong.status).toBe(422);

    const early = await api('post', `/front-desk/stays/${s.stayId}/early-departure`, tokA).send({});
    expect(early.status, JSON.stringify(early.body)).toBe(200);
    expect(early.body.reservation.rooms[0].departure).toBe(addDay(BD, 1));
    await auditOf('front_desk.early_departure', s.stayId);

    // Extending into a night another reservation holds on the same unit is refused.
    const blocker = await book({ roomId: s.roomId, arrival: addDay(BD, 1), departure: addDay(BD, 3) });
    expect(blocker.rrId).toBeTruthy();
    const clash = await api('post', `/front-desk/stays/${s.stayId}/extend`, tokA).send({ departure: addDay(BD, 2) });
    expect(clash.status).toBe(409);
  });

  it('a room change keeps the nights already spent and does not break a later extension', async () => {
    const { admin } = env.services;
    const old = await newRoom('CLEAN');
    // Arrival before the business date is only possible on seeded data: build it directly.
    const b = await book({ roomId: old.id, departure: addDay(BD, 2) });
    await admin.reservationRoom.update({ where: { id: b.rrId }, data: { arrival: new Date(addDay(BD, -1)) } });
    await admin.reservation.update({ where: { id: b.reservationId }, data: { arrival: new Date(addDay(BD, -1)) } });
    await admin.unitNight.create({ data: { tenantId: A.tenantId, unitId: old.id, reservationRoomId: b.rrId, night: new Date(addDay(BD, -1)) } });
    const ci = await api('post', '/front-desk/stays', tokA).send(checkInBody(b.rrId));
    expect(ci.status, JSON.stringify(ci.body)).toBe(201);
    const target = await newRoom('CLEAN');
    const mv = await api('post', `/front-desk/stays/${ci.body.stayId}/room-change`, tokA).send({ roomId: target.id, reason: 'Bruit' });
    expect(mv.status, JSON.stringify(mv.body)).toBe(200);
    expect(mv.body.movedNights).toBe(2);
    const nights = await admin.unitNight.findMany({ where: { reservationRoomId: b.rrId }, orderBy: { night: 'asc' } });
    expect(nights.map((n) => [n.night.toISOString().slice(0, 10), n.unitId])).toEqual([
      [addDay(BD, -1), old.id],
      [BD, target.id],
      [addDay(BD, 1), target.id],
    ]);
    const ext = await api('post', `/front-desk/stays/${ci.body.stayId}/extend`, tokA).send({ departure: addDay(BD, 3) });
    expect(ext.status, JSON.stringify(ext.body)).toBe(200);
    expect(await admin.unitNight.count({ where: { reservationRoomId: b.rrId, unitId: target.id } })).toBe(3);
  });
});

describe('check-out', () => {
  const settle = async (rrId: string) => {
    const f = await folioOf(rrId);
    const p = await api('post', `/folios/${f.id}/payments`, tokA).send({ method: 'CARD', amount: f.balance });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
  };

  it('previews folios, balance and blockers; refuses an unpaid balance', async () => {
    const s = await checkedIn({ departure: addDay(BD, 1) });
    const pre = await api('post', `/front-desk/stays/${s.stayId}/checkout-preview`, tokA);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body.balance).toBeGreaterThan(0);
    expect(pre.body.canCheckout).toBe(false);
    expect(pre.body.blockers.map((b: { code: string }) => b.code)).toContain('UNPAID_BALANCE');
    expect(pre.body.summary).toEqual(expect.arrayContaining([expect.objectContaining({ department: 'ROOM', amount: 30_000 })]));
    expect(pre.body.folios).toHaveLength(1);

    const res = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokA).send({});
    expect(res.status).toBe(409);
    expect(res.body.meta.reason).toBe('CHECKOUT_BLOCKED');
    expect(res.body.meta.blockers[0].code).toBe('UNPAID_BALANCE');
    const rr = await env.services.admin.reservationRoom.findFirstOrThrow({ where: { id: s.rrId } });
    expect(rr.status).toBe('CHECKED_IN');
  });

  it('checks out a settled stay: COMPLETED, room DIRTY, invoice issued, post_stay notice, events and audit', async () => {
    const s = await checkedIn({ departure: addDay(BD, 1) });
    await api('post', `/front-desk/stays/${s.stayId}/checkout-preview`, tokA);
    await settle(s.rrId);
    const before = sent.length;
    const res = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokA).send({
      invoice: { issue: true, customer: { type: 'guest', guestId: s.guestId } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ reservationStatus: 'COMPLETED', balance: 0 });
    expect(res.body.invoices).toHaveLength(1);
    const { admin } = env.services;
    const stay = await admin.stay.findFirstOrThrow({ where: { id: s.stayId } });
    expect(stay.checkedOutBy).toBe(A.userId);
    expect(stay.checkedOutAt).toBeTruthy();
    expect((await admin.room.findFirstOrThrow({ where: { id: s.roomId } })).hkStatus).toBe('DIRTY');
    expect((await admin.reservation.findFirstOrThrow({ where: { id: s.reservationId } })).status).toBe('COMPLETED');
    expect(sent.slice(before).some((n) => n.templateCode === 'post_stay')).toBe(true);
    const events = await admin.outboxEvent.findMany({ where: { tenantId: A.tenantId, type: 'stay.checked_out' } });
    expect(events.some((e) => (e.payload as { stayId: string }).stayId === s.stayId)).toBe(true);
    await auditOf('front_desk.check_out', s.stayId);
    const again = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokA).send({});
    expect(again.status).toBe(409);
  });

  it('transfers the balance to a company account (NIF mandatory) then checks out', async () => {
    const { admin } = env.services;
    const noNif = await admin.company.create({ data: { tenantId: A.tenantId, name: 'Sans NIF' } });
    const corp = await admin.company.create({ data: { tenantId: A.tenantId, name: 'Togo Corp', taxId: '1000123456' } });
    const s = await checkedIn({ departure: addDay(BD, 1) });
    const bad = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokA).send({ transferToCompanyId: noNif.id });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].code).toBe('NIF_REQUIRED');
    const res = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokA).send({
      transferToCompanyId: corp.id,
      invoice: { issue: true, customer: { type: 'company', companyId: corp.id } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.transferred).toBeGreaterThan(0);
    expect(res.body.reservationStatus).toBe('COMPLETED');
    expect(res.body.invoices).toHaveLength(1);
    const account = await admin.folio.findFirstOrThrow({ where: { companyId: corp.id, number: { startsWith: 'CL-' } } });
    expect(Number(account.balance)).toBe(res.body.transferred);
  });

  it('check-out with a balance needs checkout_with_balance and a reason (audited)', async () => {
    const s = await checkedIn({ departure: addDay(BD, 1) });
    const noReason = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokDesk).send({});
    expect(noReason.status).toBe(409);
    const denied = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokDesk).send({ overrideReason: 'Client parti sans payer' });
    expect(denied.status).toBe(403);
    const ok = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokExport).send({ overrideReason: 'Accord du directeur' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.reservationStatus).toBe('CHECKED_OUT');
    expect(ok.body.overridden).toContain('UNPAID_BALANCE');
    const audit = await auditOf('front_desk.check_out.override', s.stayId);
    expect(audit[0]!.after).toMatchObject({ overrideReason: 'Accord du directeur' });
  });

  it('an early check-out must be confirmed and releases the remaining nights', async () => {
    const s = await checkedIn({ departure: addDay(BD, 4) });
    const refused = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokA).send({});
    expect(refused.status).toBe(409);
    expect(refused.body.meta.reason).toBe('EARLY_DEPARTURE');
    const ok = await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokA).send({ earlyDeparture: true, overrideReason: 'Départ anticipé impayé' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const rr = await env.services.admin.reservationRoom.findFirstOrThrow({ where: { id: s.rrId } });
    expect(rr.departure.toISOString().slice(0, 10)).toBe(addDay(BD, 1));
  });
});

describe('company picker', () => {
  it('searches companies by name or NIF, tenant-scoped', async () => {
    const { admin } = env.services;
    await admin.company.create({ data: { tenantId: A.tenantId, name: 'Lomé Logistics', taxId: '1000999888' } });
    await admin.company.create({ data: { tenantId: B.tenantId, name: 'Lomé Secret', taxId: '1000777666' } });
    const res = await api('get', '/front-desk/companies?search=lom%C3%A9', tokA);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(['Lomé Logistics']);
    const byNif = await api('get', '/front-desk/companies?search=1000999', tokA);
    expect(byNif.body[0]).toMatchObject({ name: 'Lomé Logistics', taxId: '1000999888' });
    expect((await api('get', '/front-desk/companies', tokReader)).status).toBe(403);
  });
});

describe('"late" flag of the day lists', () => {
  it('in-house stays are not late; arrivals late = arrival before the date; departures late = departure before the date', async () => {
    const { isLate } = await import('../src/modules/front-desk/lists.js');
    expect(isLate('in-house', '2026-11-20', '2026-11-27', '2026-11-25')).toBe(false);
    expect(isLate('in-house', '2026-11-20', '2026-11-25', '2026-11-25')).toBe(false);
    expect(isLate('in-house', '2026-11-20', '2026-11-24', '2026-11-25')).toBe(true);
    expect(isLate('arrivals', '2026-11-25', '2026-11-27', '2026-11-25')).toBe(false);
    expect(isLate('arrivals', '2026-11-24', '2026-11-27', '2026-11-25')).toBe(true);
    expect(isLate('departures', '2026-11-20', '2026-11-25', '2026-11-25')).toBe(false);
    expect(isLate('departures', '2026-11-20', '2026-11-24', '2026-11-25')).toBe(true);
    expect(isLate('no-shows', '2026-11-24', '2026-11-27', '2026-11-25')).toBe(true);
  });

  it('an in-house stay that arrived yesterday and leaves tomorrow is listed as not late', async () => {
    const s = await checkedIn({ departure: addDay(BD, 1) });
    await env.services.admin.reservationRoom.update({ where: { id: s.rrId }, data: { arrival: new Date(addDay(BD, -2)), departure: new Date(addDay(BD, 2)) } });
    const inh = await api('get', `/front-desk/in-house?propertyId=${A.propertyId}`);
    const row = inh.body.items.find((i: { reservationRoomId: string }) => i.reservationRoomId === s.rrId);
    expect(row.late).toBe(false);
  });
});

describe('lazy stay creation (seeded in-house stays)', () => {
  it('creates the stay row on first access and keeps working', async () => {
    const { admin } = env.services;
    const b = await book();
    await admin.reservation.update({ where: { id: b.reservationId }, data: { status: 'CHECKED_IN' } });
    await admin.reservationRoom.update({ where: { id: b.rrId }, data: { status: 'CHECKED_IN' } });
    expect(await admin.stay.count({ where: { reservationRoomId: b.rrId } })).toBe(0);

    const list = await api('get', `/front-desk/in-house?propertyId=${A.propertyId}`);
    const row = list.body.items.find((i: { reservationRoomId: string }) => i.reservationRoomId === b.rrId);
    expect(row.stayId).toBeNull();

    const detail = await api('get', `/front-desk/stays/${b.rrId}`);
    expect(detail.status, JSON.stringify(detail.body)).toBe(200);
    expect(await admin.stay.count({ where: { reservationRoomId: b.rrId } })).toBe(1);
    const again = await api('get', `/front-desk/stays/${b.rrId}`);
    expect(again.body.stayId).toBe(detail.body.stayId);
    await auditOf('front_desk.stay.lazy_create', detail.body.stayId);

    const pre = await api('post', `/front-desk/stays/${b.rrId}/checkout-preview`, tokA);
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    expect(pre.body.stayId).toBe(detail.body.stayId);
    const out = await api('post', `/front-desk/stays/${b.rrId}/checkout`, tokA).send({ earlyDeparture: true, overrideReason: 'Test legacy' });
    expect(out.status, JSON.stringify(out.body)).toBe(200);
    const listed = await api('get', `/front-desk/in-house?propertyId=${A.propertyId}`);
    expect(listed.body.items.some((i: { reservationRoomId: string }) => i.reservationRoomId === b.rrId)).toBe(false);
  });

  it('refuses a reservation that is not in house', async () => {
    const b = await book();
    const r = await api('get', `/front-desk/stays/${b.rrId}`);
    expect(r.status).toBe(409);
  });
});

describe('police register', () => {
  it('masks sensitive fields without guests.export, exports CSV/PDF and audits every access', async () => {
    const s = await checkedIn({}, { guests: [{ ...identity, idDocNumber: 'REG-5550123' }] });
    const q = `propertyId=${A.propertyId}&from=${BD}&to=${BD}`;
    const masked = await api('get', `/front-desk/police-records?${q}`, tokDesk);
    expect(masked.status, JSON.stringify(masked.body)).toBe(200);
    expect(masked.body.masked).toBe(true);
    const row = masked.body.items.find((i: { stayId: string }) => i.stayId === s.stayId);
    expect(row).toMatchObject({
      idDocNumber: '••••0123',
      birthDate: '1985-••-••',
      address: null,
      birthPlace: null,
      masked: true,
      nationality: 'TG',
      provenance: 'Accra',
    });
    expect(JSON.stringify(masked.body)).not.toContain('REG-5550123');

    const full = await api('get', `/front-desk/police-records?${q}`, tokExport);
    const frow = full.body.items.find((i: { stayId: string }) => i.stayId === s.stayId);
    expect(frow).toMatchObject({ idDocNumber: 'REG-5550123', birthDate: '1985-03-02', address: 'Rue des Fleurs, Lomé', masked: false });

    const csvMasked = await api('get', `/front-desk/police-records/export?${q}&format=csv`, tokDesk);
    expect(csvMasked.status).toBe(200);
    expect(csvMasked.headers['content-type']).toContain('text/csv');
    expect(csvMasked.text).toContain('••••0123');
    expect(csvMasked.text).not.toContain('REG-5550123');
    const csvFull = await api('get', `/front-desk/police-records/export?${q}&format=csv`, tokExport);
    expect(csvFull.text).toContain('REG-5550123');
    expect(csvFull.text.split('\r\n')[0]).toContain('Provenance');

    const pdf = await api('get', `/front-desk/police-records/export?${q}&format=pdf`, tokExport);
    expect(pdf.status, JSON.stringify(pdf.body)).toBe(200);
    expect(pdf.body.url).toContain('https://files.test/');
    const form = await api('get', `/front-desk/stays/${s.stayId}/police-form`, tokDesk);
    expect(form.status, JSON.stringify(form.body)).toBe(200);
    expect(form.body.fileId).toBeTruthy();

    const reads = await auditOf('front_desk.police_register.read');
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(reads.map((r) => (r.after as { unmasked: boolean }).unmasked)).toEqual(expect.arrayContaining([true, false]));
    const exports = await auditOf('front_desk.police_register.export');
    expect(exports.map((r) => (r.after as { format: string }).format)).toEqual(expect.arrayContaining(['csv', 'pdf']));

    const none = await api('get', `/front-desk/police-records?propertyId=${A.propertyId}&from=2020-01-01&to=2020-01-02`, tokDesk);
    expect(none.body.items).toEqual([]);
  });
});

describe('permissions and tenant isolation', () => {
  it('denies each action without its permission', async () => {
    const b = await book();
    const p = A.propertyId;
    const checks: [Method, string, Record<string, unknown>?][] = [
      ['post', '/front-desk/stays', checkInBody(b.rrId)],
      ['post', `/front-desk/stays/${b.rrId}/checkout`, {}],
      ['post', `/front-desk/stays/${b.rrId}/room-change`, { roomId: b.rrId, reason: 'xxx' }],
      ['post', `/front-desk/stays/${b.rrId}/extend`, { departure: addDay(BD, 5) }],
      ['get', `/front-desk/police-records?propertyId=${p}&from=${BD}&to=${BD}`],
      ['get', `/front-desk/police-records/export?propertyId=${p}&from=${BD}&to=${BD}`],
    ];
    for (const [m, path, body] of checks) {
      const r = body ? await api(m, path, tokReader).send(body) : await api(m, path, tokReader);
      expect(r.status, `${m} ${path}`).toBe(403);
    }
    const ok = await api('get', `/front-desk/summary?propertyId=${p}`, tokReader);
    expect(ok.status).toBe(200);
  });

  it('keeps tenants apart: another tenant cannot see or act on stays, lists or registers', async () => {
    const s = await checkedIn();
    const bb = await book({ f: B, s: SB });
    const rb = await api('post', '/front-desk/stays', tokB, B).send(checkInBody(bb.rrId));
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);

    expect((await api('post', '/front-desk/stays', tokB, B).send(checkInBody(s.rrId))).status).toBe(404);
    expect((await api('get', `/front-desk/stays/${s.stayId}`, tokB, B)).status).toBe(404);
    expect((await api('post', `/front-desk/stays/${s.stayId}/checkout`, tokB, B).send({})).status).toBe(404);
    expect((await api('get', `/front-desk/stays/${s.stayId}/police-form`, tokB, B)).status).toBe(404);
    const list = await api('get', `/front-desk/in-house?propertyId=${B.propertyId}`, tokB, B);
    expect(list.body.items.map((i: { reservationRoomId: string }) => i.reservationRoomId)).toEqual([bb.rrId]);
    // A's property id through B's token: out of the user's property scope.
    const cross = await api('get', `/front-desk/in-house?propertyId=${A.propertyId}`, tokB, B);
    expect([403, 404]).toContain(cross.status);
    const reg = await api('get', `/front-desk/police-records?propertyId=${B.propertyId}&from=${BD}&to=${BD}`, tokB, B);
    expect(reg.body.items).toHaveLength(1);
    expect(reg.body.items[0].stayId).toBe(rb.body.stayId);
  });
});
