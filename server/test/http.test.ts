import { PROBLEM_CONTENT_TYPE, problemSchema } from '@hm/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  ADMIN_HOST,
  createTestEnv,
  mintToken,
  PLATFORM_DOMAIN,
  type TestEnv,
} from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import { probeModule } from './helpers/probe-module.js';

let env: TestEnv;
let app: Express;
let openapi: ReturnType<typeof createApp>['openapi'];
let A: TenantFixture;
let B: TenantFixture;
let suspended: TenantFixture;
let cancelled: TenantFixture;
let tokenA: string;
let tokenB: string;

const WHOAMI = '/api/v1/t/system/whoami';

function expectProblem(res: request.Response, status: number, code: string) {
  expect(res.status).toBe(status);
  expect(res.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
  const body = problemSchema.parse(res.body);
  expect(body.code).toBe(code);
  return body;
}

beforeAll(async () => {
  env = createTestEnv([probeModule]);
  ({ app, openapi } = createApp(env.services));
  const { admin, config } = env.services;
  A = await createTenantFixture(admin, { label: 'a', features: ['lodging.core'] });
  B = await createTenantFixture(admin, { label: 'b', features: ['lodging.core', 'spa'] });
  suspended = await createTenantFixture(admin, { label: 's', subscription: 'SUSPENDED' });
  cancelled = await createTenantFixture(admin, { label: 'c', subscription: 'CANCELLED' });
  tokenA = await mintToken(config, { sub: A.userId, tid: A.tenantId });
  tokenB = await mintToken(config, { sub: B.userId, tid: B.tenantId });
});

afterAll(async () => {
  await env?.close();
});

describe('health', () => {
  it('GET /health answers without a tenant host', async () => {
    const res = await request(app).get('/health').set('Host', 'anything.example');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeTruthy();
  });

  it('GET /ready checks PostgreSQL and Redis', async () => {
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ database: true, redis: true });
  });
});

describe('tenant resolution', () => {
  it('resolves the tenant from the Host header', async () => {
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(A.tenantId);
    expect(res.body.tenant.slug).toBe(A.slug);
  });

  it('accepts a port in the Host header and is case-insensitive', async () => {
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', `${A.host.toUpperCase()}:8443`)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(A.tenantId);
  });

  it('unknown host → 404 problem', async () => {
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', `nope.${PLATFORM_DOMAIN}`)
      .set('Authorization', `Bearer ${tokenA}`);
    expectProblem(res, 404, 'NOT_FOUND');
  });

  it('unverified custom domain does not resolve', async () => {
    await env.services.admin.tenantDomain.create({
      data: { tenantId: A.tenantId, hostname: 'unverified.example.com', type: 'CUSTOM' },
    });
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', 'unverified.example.com')
      .set('Authorization', `Bearer ${tokenA}`);
    expectProblem(res, 404, 'NOT_FOUND');
  });

  it('tenant surfaces are not served on the admin host, admin API not on tenant hosts', async () => {
    const r1 = await request(app)
      .get(WHOAMI)
      .set('Host', ADMIN_HOST)
      .set('Authorization', `Bearer ${tokenA}`);
    expectProblem(r1, 404, 'NOT_FOUND');
    const r2 = await request(app).get('/api/v1/admin/anything').set('Host', A.host);
    expectProblem(r2, 404, 'NOT_FOUND');
  });
});

describe('authentication', () => {
  it('missing token → 401 UNAUTHENTICATED', async () => {
    const res = await request(app).get(WHOAMI).set('Host', A.host);
    expectProblem(res, 401, 'UNAUTHENTICATED');
  });

  it('invalid or expired token → 401', async () => {
    const bad = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set('Authorization', 'Bearer abc.def.ghi');
    expectProblem(bad, 401, 'UNAUTHENTICATED');
    const expired = await mintToken(env.services.config, {
      sub: A.userId,
      tid: A.tenantId,
      expiresIn: -10,
    });
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set('Authorization', `Bearer ${expired}`);
    expectProblem(res, 401, 'UNAUTHENTICATED');
  });

  it('token of tenant A on tenant B host → 403 TENANT_MISMATCH', async () => {
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', B.host)
      .set('Authorization', `Bearer ${tokenA}`);
    expectProblem(res, 403, 'TENANT_MISMATCH');
  });

  it('portal token on the staff API → 403', async () => {
    const portal = await mintToken(env.services.config, {
      sub: A.userId,
      tid: A.tenantId,
      scope: 'portal',
    });
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set('Authorization', `Bearer ${portal}`);
    expectProblem(res, 403, 'FORBIDDEN');
  });

  it('revoked session → 401', async () => {
    const sid = crypto.randomUUID();
    const token = await mintToken(env.services.config, { sub: A.userId, tid: A.tenantId, sid });
    await env.services.revocations.revoke(sid);
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set('Authorization', `Bearer ${token}`);
    expectProblem(res, 401, 'UNAUTHENTICATED');
  });
});

describe('whoami', () => {
  it('returns only the caller tenant data', async () => {
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(A.userId);
    expect(res.body.tenant.id).toBe(A.tenantId);
    expect(res.body.propertyIds).toEqual([A.propertyId]);
    expect(res.body.entitlements.features).toEqual(['lodging.core']);
    expect(res.body.subscription.status).toBe('ACTIVE');
    expect(JSON.stringify(res.body)).not.toContain(B.tenantId);
    expect(JSON.stringify(res.body)).not.toContain(B.userId);
  });

  it('a user of tenant B in a token claiming tenant A is not found (RLS) → 401', async () => {
    const forged = await mintToken(env.services.config, { sub: B.userId, tid: A.tenantId });
    const res = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set('Authorization', `Bearer ${forged}`);
    expectProblem(res, 401, 'UNAUTHENTICATED');
  });
});

describe('permissions and features', () => {
  it('permission denied → 403 FORBIDDEN', async () => {
    const uid = await addUser(env.services.admin, A.tenantId, ['reservations.*', 'guests.read']);
    const token = await mintToken(env.services.config, { sub: uid, tid: A.tenantId });
    const denied = await request(app)
      .get('/api/v1/t/probe/users')
      .set('Host', A.host)
      .set('Authorization', `Bearer ${token}`);
    const body = expectProblem(denied, 403, 'FORBIDDEN');
    expect(body.meta).toEqual({ permission: 'users.manage' });
    const allowed = await request(app)
      .post('/api/v1/t/probe/echo')
      .set('Host', A.host)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ok', nights: 2 });
    expect(allowed.status).toBe(200);
  });

  it('feature not in plan → FEATURE_NOT_IN_PLAN; in plan → 200', async () => {
    const resA = await request(app)
      .get('/api/v1/t/probe/spa')
      .set('Host', A.host)
      .set('Authorization', `Bearer ${tokenA}`);
    const body = expectProblem(resA, 402, 'FEATURE_NOT_IN_PLAN');
    expect(body.meta).toEqual({ feature: 'spa' });
    const resB = await request(app)
      .get('/api/v1/t/probe/spa')
      .set('Host', B.host)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(resB.status).toBe(200);
  });
});

describe('subscription guard', () => {
  it('SUSPENDED: GET works, POST → SUBSCRIPTION_SUSPENDED', async () => {
    const token = await mintToken(env.services.config, {
      sub: suspended.userId,
      tid: suspended.tenantId,
    });
    const get = await request(app)
      .get(WHOAMI)
      .set('Host', suspended.host)
      .set('Authorization', `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.headers['x-subscription-status']).toBe('SUSPENDED');
    const post = await request(app)
      .post('/api/v1/t/probe/echo')
      .set('Host', suspended.host)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ok', nights: 1 });
    expectProblem(post, 402, 'SUBSCRIPTION_SUSPENDED');
  });

  it('CANCELLED: even reads are refused outside export', async () => {
    const token = await mintToken(env.services.config, {
      sub: cancelled.userId,
      tid: cancelled.tenantId,
    });
    const get = await request(app)
      .get(WHOAMI)
      .set('Host', cancelled.host)
      .set('Authorization', `Bearer ${token}`);
    const body = expectProblem(get, 402, 'SUBSCRIPTION_SUSPENDED');
    expect(body.meta).toMatchObject({ access: 'export_only' });
  });
});

describe('errors', () => {
  it('validation error is problem+json with the field list', async () => {
    const res = await request(app)
      .post('/api/v1/t/probe/echo')
      .set('Host', A.host)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ name: 'x', nights: -1, extra: true });
    const body = expectProblem(res, 422, 'VALIDATION_ERROR');
    expect(body.errors?.map((e) => e.path).sort()).toEqual(['body.name', 'body.nights']);
    expect(body.requestId).toBe(res.headers['x-request-id']);
    expect(body.instance).toBe('/api/v1/t/probe/echo');
  });

  it('malformed JSON → 400 BAD_REQUEST', async () => {
    const res = await request(app)
      .post('/api/v1/t/probe/echo')
      .set('Host', A.host)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Content-Type', 'application/json')
      .send('{"name":');
    expectProblem(res, 400, 'BAD_REQUEST');
  });

  it('unique violation → 409 CONFLICT', async () => {
    const send = () =>
      request(app)
        .post('/api/v1/t/probe/roles')
        .set('Host', A.host)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ name: 'Réception' });
    expect((await send()).status).toBe(201);
    expectProblem(await send(), 409, 'CONFLICT');
  });

  it('unknown route → 404 problem', async () => {
    const res = await request(app)
      .get('/api/v1/t/nope')
      .set('Host', A.host)
      .set('Authorization', `Bearer ${tokenA}`);
    expectProblem(res, 404, 'NOT_FOUND');
  });
});

describe('audit hook', () => {
  it('writes an audit entry for a successful write, in the request tenant', async () => {
    const res = await request(app)
      .post('/api/v1/t/probe/roles')
      .set('Host', B.host)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ name: 'Audit me' });
    expect(res.status).toBe(201);
    let rows: { tenantId: string; userId: string | null; action: string }[] = [];
    for (let i = 0; i < 50 && !rows.length; i++) {
      rows = await env.services.admin.auditLog.findMany({
        where: { tenantId: B.tenantId, action: 'POST /api/v1/t/probe/roles' },
      });
      if (!rows.length) await new Promise((r) => setTimeout(r, 20));
    }
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(B.userId);
  });
});

describe('openapi', () => {
  it('openapi.json lists the system route', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.paths[WHOAMI]?.get).toBeTruthy();
    expect(res.body.paths['/api/v1/t/probe/echo']?.post?.['x-permission']).toBe(
      'reservations.create',
    );
    expect(openapi.paths?.[WHOAMI]).toBeTruthy();
  });

  it('serves Swagger UI at /api/docs', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger');
  });
});

describe('CORS', () => {
  it('allows verified tenant domains and platform origins, rejects others', async () => {
    const ok = await request(app)
      .options(WHOAMI)
      .set('Host', A.host)
      .set('Origin', `https://${A.host}`)
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe(`https://${A.host}`);
    const admin = await request(app).get('/health').set('Origin', `https://${ADMIN_HOST}`);
    expect(admin.headers['access-control-allow-origin']).toBe(`https://${ADMIN_HOST}`);
    const ko = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(ko.headers['access-control-allow-origin']).toBeUndefined();
  });
});
