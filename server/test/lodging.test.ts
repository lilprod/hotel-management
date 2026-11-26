import { runWithTenant } from '@hm/database';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseCustomFields } from '../src/modules/custom-fields/validation.js';
import { setPhotoStorage } from '../src/modules/property/service.js';
import {
  nextSequence,
  nextSequenceStandalone,
  sequenceScope,
} from '../src/modules/sequences/index.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';

let env: TestEnv;
let app: Express;
let A: TenantFixture;
let B: TenantFixture;
let tokA: string;
let tokB: string;
let tokReader: string;

const P = '/api/v1/t/lodging';
const R = '/api/v1/t/pricing';
const call = (
  method: 'get' | 'post' | 'patch' | 'delete',
  f: TenantFixture,
  tok: string,
  path: string,
) => request(app)[method](path).set('Host', f.host).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  env = createTestEnv();
  ({ app } = createApp(env.services));
  const { admin, config } = env.services;
  A = await createTenantFixture(admin, {
    label: 'la',
    features: ['lodging.core'],
    quotas: { properties: 2, units: 5 },
  });
  B = await createTenantFixture(admin, {
    label: 'lb',
    features: ['lodging.core'],
    quotas: { units: 100 },
  });
  tokA = await mintToken(config, { sub: A.userId, tid: A.tenantId });
  tokB = await mintToken(config, { sub: B.userId, tid: B.tenantId });
  const reader = await addUser(admin, A.tenantId, ['lodging.read']);
  await admin.userProperty.create({
    data: { tenantId: A.tenantId, userId: reader, propertyId: A.propertyId },
  });
  tokReader = await mintToken(config, { sub: reader, tid: A.tenantId });
});
afterAll(async () => {
  await env?.close();
});

describe('room types, rooms and quotas', () => {
  let roomTypeId: string;
  it('creates a room type and bulk rooms within the units quota', async () => {
    const rt = await call('post', A, tokA, `${P}/room-types`).send({
      propertyId: A.propertyId,
      code: 'STD',
      name: 'Standard',
      maxAdults: 3,
      maxChildren: 2,
      baseOccupancy: 2,
    });
    expect(rt.status).toBe(201);
    roomTypeId = rt.body.id;
    const bulk = await call('post', A, tokA, `${P}/rooms/bulk`).send({
      propertyId: A.propertyId,
      roomTypeId,
      from: 101,
      to: 103,
    });
    expect(bulk.status).toBe(201);
    expect(bulk.body.items.map((r: { number: string }) => r.number)).toEqual(['101', '102', '103']);
  });

  it('refuses duplicates and a bulk batch exceeding the quota (nothing created)', async () => {
    const dup = await call('post', A, tokA, `${P}/rooms/bulk`).send({
      propertyId: A.propertyId,
      roomTypeId,
      from: 103,
      to: 104,
    });
    expect(dup.status).toBe(409);
    const over = await call('post', A, tokA, `${P}/rooms/bulk`).send({
      propertyId: A.propertyId,
      roomTypeId,
      from: 201,
      to: 204,
    });
    expect(over.status).toBe(402);
    expect(over.body.code).toBe('QUOTA_EXCEEDED');
    const list = await call('get', A, tokA, `${P}/rooms?propertyId=${A.propertyId}`);
    expect(list.body.items).toHaveLength(3);
  });

  it('enforces the properties quota', async () => {
    const body = { name: 'Annexe', country: 'TG', timezone: 'Africa/Lome' };
    expect((await call('post', A, tokA, `${P}/properties`).send(body)).status).toBe(201);
    const res = await call('post', A, tokA, `${P}/properties`).send(body);
    expect(res.status).toBe(402);
  });

  it('denies writes without lodging.manage', async () => {
    const res = await call('post', A, tokReader, `${P}/room-types`).send({
      propertyId: A.propertyId,
      code: 'X',
      name: 'X',
      maxAdults: 1,
      baseOccupancy: 1,
    });
    expect(res.status).toBe(403);
    const ok = await call('get', A, tokReader, `${P}/room-types?propertyId=${A.propertyId}`);
    expect(ok.status).toBe(200);
  });

  it('isolates tenants', async () => {
    const other = await call('get', B, tokB, `${P}/room-types/${roomTypeId}`);
    expect(other.status).toBe(404);
    const cross = await call('get', B, tokB, `${P}/room-types?propertyId=${A.propertyId}`);
    expect(cross.status).toBe(200);
    expect(cross.body.items).toEqual([]); // RLS: nothing of tenant A is visible
    const patch = await call('patch', B, tokB, `${P}/room-types/${roomTypeId}`).send({
      name: 'Hack',
    });
    expect(patch.status).toBe(404);
  });

  it('blocks a room and refuses overlapping blocks', async () => {
    const rooms = await call('get', A, tokA, `${P}/rooms?propertyId=${A.propertyId}`);
    const roomId = rooms.body.items[0].id;
    const b = { roomId, fromDate: '2026-12-01', toDate: '2026-12-05', reason: 'MAINTENANCE' };
    expect((await call('post', A, tokA, `${P}/room-blocks`).send(b)).status).toBe(201);
    expect(
      (
        await call('post', A, tokA, `${P}/room-blocks`).send({
          ...b,
          fromDate: '2026-12-04',
          toDate: '2026-12-06',
        })
      ).status,
    ).toBe(409);
  });

  it('stores photos through the storage helper', async () => {
    const puts: string[] = [];
    setPhotoStorage(() => ({
      put: async (i) => (puts.push(i.key), { key: `t/x/${i.key}`, size: 3 }),
      signedUrl: async (k) => `https://signed/${k}`,
      delete: async () => undefined,
    }));
    const res = await call('post', A, tokA, `${P}/room-types/${roomTypeId}/photos`).attach(
      'file',
      Buffer.from('abc'),
      { filename: 'a.png', contentType: 'image/png' },
    );
    expect(res.status).toBe(201);
    expect(puts[0]).toContain(`room-types/${roomTypeId}/`);
    const list = await call('get', A, tokA, `${P}/room-types/${roomTypeId}/photos`);
    expect(list.body.items).toHaveLength(1);
  });

  it('a deleted room frees its number (partial unique index), the number is kept', async () => {
    const rooms = await call('get', A, tokA, `${P}/rooms?propertyId=${A.propertyId}`);
    const r103 = rooms.body.items.find((r: { number: string }) => r.number === '103');
    expect((await call('delete', A, tokA, `${P}/rooms/${r103.id}`)).status).toBe(204);
    const again = await call('post', A, tokA, `${P}/rooms`).send({
      propertyId: A.propertyId,
      roomTypeId,
      number: '103',
    });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.id).not.toBe(r103.id);
    const deleted = await env.services.admin.room.findUniqueOrThrow({ where: { id: r103.id } });
    expect(deleted.number).toBe('103');
    expect(deleted.deletedAt).not.toBeNull();
    // Two live rooms with the same number are still refused by the database.
    await expect(
      env.services.admin.room.create({
        data: { tenantId: A.tenantId, propertyId: A.propertyId, roomTypeId, number: '103' },
      }),
    ).rejects.toThrow(/rooms_number_active_key|Unique constraint/);
  });

  it('stores room type translations, name staying the default-locale label', async () => {
    const rt = await call('post', A, tokA, `${P}/room-types`).send({
      propertyId: A.propertyId,
      code: 'ZZ',
      name: 'Suite junior',
      description: 'Vue mer',
      nameI18n: { en: 'Junior suite' },
      maxAdults: 2,
      baseOccupancy: 2,
    });
    expect(rt.status, JSON.stringify(rt.body)).toBe(201);
    expect(rt.body.nameI18n).toEqual({ fr: 'Suite junior', en: 'Junior suite' });
    expect(rt.body.descriptionI18n).toEqual({ fr: 'Vue mer' });
    const upd = await call('patch', A, tokA, `${P}/room-types/${rt.body.id}`).send({
      nameI18n: { fr: 'Junior suite', en: 'Junior suite (sea view)' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('Junior suite');
    expect(upd.body.nameI18n).toEqual({ fr: 'Junior suite', en: 'Junior suite (sea view)' });
    expect(upd.body.description).toBe('Vue mer');
    expect(
      (
        await call('patch', A, tokA, `${P}/room-types/${rt.body.id}`).send({
          nameI18n: { xx1: 'x' },
        })
      ).status,
    ).toBe(422);
    expect((await call('delete', A, tokA, `${P}/room-types/${rt.body.id}`)).status).toBe(204);
  });
});

describe('pricing API', () => {
  it('creates plan, rates and taxes, then quotes a stay', async () => {
    const rts = await call('get', A, tokA, `${P}/room-types?propertyId=${A.propertyId}`);
    const roomTypeId = rts.body.items[0].id;
    const plan = await call('post', A, tokA, `${R}/rate-plans`).send({
      propertyId: A.propertyId,
      code: 'BAR',
      name: 'Best available',
    });
    expect(plan.status).toBe(201);
    const season = await call('post', A, tokA, `${R}/seasons`).send({
      propertyId: A.propertyId,
      name: 'Fêtes',
      fromDate: '2026-12-20',
      toDate: '2026-12-31',
      priority: 5,
    });
    expect(season.status).toBe(201);
    const mk = (extra: object) =>
      call('post', A, tokA, `${R}/rates`).send({
        ratePlanId: plan.body.id,
        roomTypeId,
        price: 30000,
        extraAdult: 5000,
        ...extra,
      });
    expect((await mk({})).status).toBe(201);
    expect((await mk({})).status).toBe(409);
    expect((await mk({ seasonId: season.body.id, price: 45000 })).status).toBe(201);
    const vat = await call('post', A, tokA, `${R}/taxes`).send({
      propertyId: A.propertyId,
      code: 'TVA',
      name: 'TVA',
      type: 'PERCENT',
      value: 18,
    });
    expect(vat.status).toBe(201);
    await call('post', A, tokA, `${R}/taxes`).send({
      propertyId: A.propertyId,
      code: 'TS',
      name: 'Taxe de séjour',
      type: 'FIXED_PER_PERSON_NIGHT',
      value: 500,
    });
    const q = await call('post', A, tokA, `${R}/quote`).send({
      propertyId: A.propertyId,
      roomTypeId,
      ratePlanId: plan.body.id,
      arrival: '2026-12-19',
      departure: '2026-12-21',
      adults: 2,
    });
    expect(q.status).toBe(200);
    // 30000 + 45000 = 75000, VAT 13500, taxe de séjour 2 * 2 * 500
    expect(q.body.total).toBe(75000 + 13500 + 2000);
    const bad = await call('post', A, tokA, `${R}/quote`).send({
      propertyId: A.propertyId,
      roomTypeId,
      ratePlanId: plan.body.id,
      arrival: '2026-12-19',
      departure: '2026-12-21',
      adults: 9,
    });
    expect(bad.status).toBe(422);
  });

  it('enforces max stay, closed to arrival / departure in quotes and availability', async () => {
    const rts = await call('get', A, tokA, `${P}/room-types?propertyId=${A.propertyId}`);
    const roomTypeId = rts.body.items[0].id;
    const plan = await call('post', A, tokA, `${R}/rate-plans`).send({
      propertyId: A.propertyId,
      code: 'RESTR',
      name: 'Restricted',
    });
    expect(plan.status).toBe(201);
    const base = { ratePlanId: plan.body.id, roomTypeId, price: 20000 };
    const bad = await call('post', A, tokA, `${R}/rates`).send({ ...base, minStay: 3, maxStay: 2 });
    expect(bad.status).toBe(422);
    const all = await call('post', A, tokA, `${R}/rates`).send({ ...base, maxStay: 5 });
    expect(all.status, JSON.stringify(all.body)).toBe(201);
    expect(all.body).toMatchObject({
      maxStay: 5,
      closedToArrival: false,
      closedToDeparture: false,
    });
    // Fridays and Saturdays: no arrival; Sundays: no departure.
    const weekend = await call('post', A, tokA, `${R}/rates`).send({
      ...base,
      dowMask: (1 << 5) | (1 << 6),
      closedToArrival: true,
    });
    expect(weekend.status).toBe(201);
    const sunday = await call('post', A, tokA, `${R}/rates`).send({
      ...base,
      dowMask: 1,
      closedToDeparture: true,
    });
    expect(sunday.status).toBe(201);
    const quote = (arrival: string, departure: string) =>
      call('post', A, tokA, `${R}/quote`).send({
        propertyId: A.propertyId,
        roomTypeId,
        ratePlanId: plan.body.id,
        arrival,
        departure,
        adults: 2,
      });
    // 2027-01-08 is a Friday, 2027-01-10 a Sunday.
    const cta = await quote('2027-01-08', '2027-01-09');
    expect(cta.status).toBe(422);
    expect(cta.body.errors[0]).toMatchObject({ path: 'arrival', code: 'CLOSED_TO_ARRIVAL' });
    const ctd = await quote('2027-01-07', '2027-01-10');
    expect(ctd.body.errors[0]).toMatchObject({ path: 'departure', code: 'CLOSED_TO_DEPARTURE' });
    const long = await quote('2027-01-04', '2027-01-10');
    expect(long.body.errors[0]).toMatchObject({ code: 'MAX_STAY' });
    expect((await quote('2027-01-07', '2027-01-09')).status).toBe(200);
    const patched = await call('patch', A, tokA, `${R}/rates/${weekend.body.id}`).send({
      closedToArrival: false,
    });
    expect(patched.body.closedToArrival).toBe(false);
    expect((await quote('2027-01-08', '2027-01-09')).status).toBe(200);
    // Availability reports the restriction per rate plan.
    const av = await call('get', A, tokA, '/api/v1/t/availability').query({
      propertyId: A.propertyId,
      arrival: '2027-01-07',
      departure: '2027-01-10',
      adults: 2,
      roomTypeId,
    });
    expect(av.status, JSON.stringify(av.body)).toBe(200);
    const restricted = av.body.roomTypes[0].ratePlans.find(
      (p: { code: string }) => p.code === 'RESTR',
    );
    expect(restricted).toMatchObject({ available: false, reason: 'CLOSED_TO_DEPARTURE' });
    await call('delete', A, tokA, `${R}/rates/${sunday.body.id}`);
    await call('delete', A, tokA, `${R}/rates/${weekend.body.id}`);
    await call('delete', A, tokA, `${R}/rates/${all.body.id}`);
  });

  it('validates policy rules and hides other tenants data', async () => {
    const bad = await call('post', A, tokA, `${R}/policies`).send({
      propertyId: A.propertyId,
      kind: 'CANCELLATION',
      name: 'Bad',
      rules: { tiers: [] },
    });
    expect(bad.status).toBe(422);
    const ok = await call('post', A, tokA, `${R}/policies`).send({
      propertyId: A.propertyId,
      kind: 'DEPOSIT',
      name: 'Acompte 30%',
      rules: { mode: 'PERCENT', value: 30 },
    });
    expect(ok.status).toBe(201);
    const foreign = await call('get', B, tokB, `${R}/policies?propertyId=${A.propertyId}`);
    expect(foreign.body.items).toEqual([]);
    const denied = await call('post', A, tokReader, `${R}/taxes`).send({});
    expect(denied.status).toBe(403);
  });
});

describe('lookups, custom fields, products', () => {
  it('manages lookup values and tenant-scoped lists', async () => {
    const L = '/api/v1/t/lookups';
    const c = await call('post', A, tokA, `${L}/reservation_source`).send({
      code: 'WALKIN',
      label: { fr: 'Passage' },
    });
    expect(c.status).toBe(201);
    expect((await call('get', B, tokB, `${L}/reservation_source`)).body.items).toHaveLength(0);
  });

  it('custom field definitions drive room validation', async () => {
    const D = '/api/v1/t/custom-fields/definitions';
    const def = await call('post', A, tokA, D).send({
      entity: 'room',
      key: 'view',
      label: { fr: 'Vue' },
      type: 'SELECT',
      required: true,
      options: [
        { value: 'sea', label: { fr: 'Mer' } },
        { value: 'garden', label: { fr: 'Jardin' } },
      ],
    });
    expect(def.status).toBe(201);
    const rooms = await call('get', A, tokA, `${P}/rooms?propertyId=${A.propertyId}`);
    const id = rooms.body.items[0].id;
    expect(
      (await call('patch', A, tokA, `${P}/rooms/${id}`).send({ customFields: { view: 'moon' } }))
        .status,
    ).toBe(422);
    const ok = await call('patch', A, tokA, `${P}/rooms/${id}`).send({
      customFields: { view: 'sea' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.customFields).toEqual({ view: 'sea' });
  });

  it('creates products', async () => {
    const res = await call('post', A, tokA, '/api/v1/t/catalog/products').send({
      propertyId: A.propertyId,
      name: 'Eau minérale',
      price: 500,
    });
    expect(res.status).toBe(201);
    const float = await call('post', A, tokA, '/api/v1/t/catalog/products').send({
      propertyId: A.propertyId,
      name: 'X',
      price: 10.5,
    });
    expect(float.status).toBe(422);
  });
});

describe('custom field validation helper', () => {
  const defs = [
    { key: 'n', type: 'NUMBER', options: { min: 1, max: 5 }, required: true },
    {
      key: 'tags',
      type: 'MULTI_SELECT',
      options: [{ value: 'a', label: { fr: 'A' } }],
      required: false,
    },
    { key: 'd', type: 'DATE', required: false },
  ];
  it('accepts valid values and drops nulls', () => {
    expect(parseCustomFields(defs, { n: 3, tags: ['a'], d: null })).toEqual({ n: 3, tags: ['a'] });
  });
  it('rejects missing required, out of range, unknown keys, bad options and dates', () => {
    for (const v of [
      {},
      { n: 9 },
      { n: 1, x: 1 },
      { n: 1, tags: ['z'] },
      { n: 1, d: '2026-02-30' },
    ])
      expect(() => parseCustomFields(defs, v)).toThrow();
  });
  it('partial mode allows omitting required fields', () => {
    expect(parseCustomFields(defs, { tags: ['a'] }, { partial: true })).toEqual({ tags: ['a'] });
  });
});

describe('sequences', () => {
  it('is gap-free and unique under concurrency, with rollback returning the number', async () => {
    const { db } = env.services;
    const scope = sequenceScope(A.tenantId, A.propertyId);
    const got = await runWithTenant(A.tenantId, async () => {
      const out = await Promise.all(
        Array.from({ length: 25 }, () =>
          nextSequenceStandalone(db, scope, 'invoice', { year: 2026 }),
        ),
      );
      await db
        .$transaction(async (tx) => {
          await nextSequence(tx, scope, 'invoice', { year: 2026 });
          throw new Error('rollback');
        })
        .catch(() => undefined);
      out.push(await nextSequenceStandalone(db, scope, 'invoice', { year: 2026 }));
      return out;
    });
    expect([...got].sort((a, b) => a - b)).toEqual(Array.from({ length: 26 }, (_, i) => i + 1));
  });

  it('refuses another tenant scope', async () => {
    const { db } = env.services;
    await expect(
      runWithTenant(A.tenantId, () =>
        nextSequenceStandalone(db, sequenceScope(B.tenantId, B.propertyId), 'x'),
      ),
    ).rejects.toThrow();
  });
});
