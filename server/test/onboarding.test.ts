import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';

let env: TestEnv;
let app: Express;
let A: TenantFixture;
let B: TenantFixture;
let Small: TenantFixture;
let tokA: string;
let tokB: string;
let tokSmall: string;
let tokNoRights: string;

const O = '/api/v1/t/onboarding';
const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  f: TenantFixture,
  tok: string,
  path = '',
) => request(app)[method](`${O}${path}`).set('Host', f.host).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  env = createTestEnv();
  ({ app } = createApp(env.services));
  const { admin, config } = env.services;
  const opts = { features: ['lodging.core'], quotas: { units: 50, users: 10 } };
  A = await createTenantFixture(admin, { label: 'oa', ...opts });
  B = await createTenantFixture(admin, { label: 'ob', ...opts });
  Small = await createTenantFixture(admin, {
    label: 'os',
    features: ['lodging.core'],
    quotas: { units: 3 },
  });
  tokA = await mintToken(config, { sub: A.userId, tid: A.tenantId });
  tokB = await mintToken(config, { sub: B.userId, tid: B.tenantId });
  tokSmall = await mintToken(config, { sub: Small.userId, tid: Small.tenantId });
  const nobody = await addUser(admin, A.tenantId, ['lodging.read']);
  tokNoRights = await mintToken(config, { sub: nobody, tid: A.tenantId });
});
afterAll(async () => {
  await env?.close();
});

describe('onboarding state', () => {
  it('starts in progress at step 0, then saves the progress and resumes', async () => {
    const first = await call('get', A, tokA);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'in_progress', step: 0, completedSteps: [] });
    expect(first.body.facts.rooms).toBe(0);

    const saved = await call('put', A, tokA).send({ step: 2, completedSteps: [0, 1] });
    expect(saved.status).toBe(200);
    const merged = await call('put', A, tokA).send({ completedSteps: [1, 2], step: 3 });
    expect(merged.body.completedSteps).toEqual([0, 1, 2]);
    const again = await call('get', A, tokA);
    expect(again.body).toMatchObject({ step: 3, status: 'in_progress' });

    const skipped = await call('put', A, tokA).send({ status: 'skipped' });
    expect(skipped.body.status).toBe('skipped');
    expect(skipped.body.finishedAt).not.toBeNull();
    const done = await call('put', A, tokA).send({ status: 'completed' });
    expect(done.body.status).toBe('completed');
    expect((await call('put', A, tokA).send({ status: 'in_progress' })).body.finishedAt).toBeNull();
    // Audit rows are written once the response is sent.
    await new Promise((r) => setTimeout(r, 300));
    expect(
      await env.services.admin.auditLog.count({
        where: { tenantId: A.tenantId, action: 'onboarding.completed' },
      }),
    ).toBe(1);
  });

  it('rejects invalid input', async () => {
    expect((await call('put', A, tokA).send({})).status).toBe(422);
    expect((await call('put', A, tokA).send({ step: 99 })).status).toBe(422);
    expect((await call('put', A, tokA).send({ status: 'nope' })).status).toBe(422);
  });

  it('is isolated per tenant', async () => {
    await call('put', A, tokA).send({ step: 5 });
    const b = await call('get', B, tokB);
    expect(b.body.step).toBe(0);
    // A token of tenant A is refused on tenant B's host.
    expect((await call('get', B, tokA)).status).toBe(403);
  });

  it('refuses users without settings.manage', async () => {
    expect((await call('get', A, tokNoRights)).status).toBe(403);
    expect((await call('put', A, tokNoRights).send({ step: 1 })).status).toBe(403);
    expect((await call('post', A, tokNoRights, '/demo-data')).status).toBe(403);
    expect((await call('delete', A, tokNoRights, '/demo-data')).status).toBe(403);
    expect((await request(app).get(O).set('Host', A.host)).status).toBe(401);
  });

  it('treats a hand-configured tenant (rooms, no stored state) as completed', async () => {
    const rt = await env.services.admin.roomType.create({
      data: {
        tenantId: B.tenantId,
        propertyId: B.propertyId,
        code: 'X',
        name: 'X',
        maxAdults: 2,
        baseOccupancy: 2,
      },
    });
    await env.services.admin.room.create({
      data: { tenantId: B.tenantId, propertyId: B.propertyId, roomTypeId: rt.id, number: '1' },
    });
    expect((await call('get', B, tokB)).body.status).toBe('completed');
  });
});

describe('demonstration data', () => {
  it('loads tracked demo data, refuses a second load, and deletes exactly those rows', async () => {
    const { admin } = env.services;
    const own = await admin.guest.create({
      data: { tenantId: A.tenantId, firstName: 'Vrai', lastName: 'Client' },
    });
    const load = await call('post', A, tokA, '/demo-data');
    expect(load.status, JSON.stringify(load.body)).toBe(201);
    expect(load.body.loaded).toBe(true);
    expect(load.body.counts).toMatchObject({ roomTypes: 2, rooms: 7, ratePlans: 1, guests: 5 });
    expect(await admin.room.count({ where: { tenantId: A.tenantId } })).toBe(7);
    expect((await call('get', A, tokA)).body.demo.loaded).toBe(true);

    expect((await call('post', A, tokA, '/demo-data')).status).toBe(409);
    // Tenant B is not touched.
    expect(await admin.room.count({ where: { tenantId: B.tenantId } })).toBe(1);

    const del = await call('delete', A, tokA, '/demo-data');
    expect(del.status, JSON.stringify(del.body)).toBe(200);
    expect(del.body.removed.rooms).toBe(7);
    expect(await admin.room.count({ where: { tenantId: A.tenantId } })).toBe(0);
    expect(await admin.roomType.count({ where: { tenantId: A.tenantId } })).toBe(0);
    expect(await admin.guest.count({ where: { tenantId: A.tenantId } })).toBe(1);
    expect(await admin.guest.findUnique({ where: { id: own.id } })).not.toBeNull();
    expect((await call('get', A, tokA)).body.demo.loaded).toBe(false);
    expect((await call('delete', A, tokA, '/demo-data')).status).toBe(409);
  });

  it('respects the units quota', async () => {
    const res = await call('post', Small, tokSmall, '/demo-data');
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('QUOTA_EXCEEDED');
    expect(res.body.meta).toMatchObject({ quota: 'units', limit: 3 });
    expect(await env.services.admin.room.count({ where: { tenantId: Small.tenantId } })).toBe(0);
  });
});
