import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { propertyWhere } from '../src/core/property-scope.js';
import { defineModule } from '../src/core/module.js';
import { createModuleRouter } from '../src/core/router.js';
import { anyStaff } from '../src/http/helpers.js';
import { invalidateLegalCache } from '../src/modules/legal/index.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import { bearer, eventually } from './helpers/auth.js';

/** Probe of the per-property scoping helper. */
const scopeModule = defineModule({
  key: 'scope-probe',
  router: {
    t: createModuleRouter().route({
      method: 'get',
      path: '/',
      middleware: [anyStaff()],
      handler: async (req) => ({ where: await propertyWhere(req) }),
    }),
  },
});

let env: TestEnv;
let app: Express;
let T: TenantFixture;
let O: TenantFixture;
let ownerToken: string;
let clerkToken: string;
let clerkId: string;
const docIds: string[] = [];
const version = `test-${Date.now()}`;

async function publish(type: 'TOS' | 'DPA', v: string) {
  const d = await env.services.admin.legalDocument.create({
    data: {
      type,
      version: v,
      locale: 'fr',
      content: `${type} ${v}`,
      publishedAt: new Date(Date.now() - 1000),
    },
  });
  docIds.push(d.id);
  return d;
}

beforeAll(async () => {
  env = createTestEnv([scopeModule]);
  ({ app } = createApp(env.services));
  T = await createTenantFixture(env.services.admin, { label: 'lg' });
  O = await createTenantFixture(env.services.admin, { label: 'lo' });
  ownerToken = await mintToken(env.services.config, { sub: T.userId, tid: T.tenantId });
  clerkId = await addUser(env.services.admin, T.tenantId, ['reservations.read', 'audit.read']);
  clerkToken = await mintToken(env.services.config, { sub: clerkId, tid: T.tenantId });
});

afterAll(async () => {
  // Legal documents are global: remove them so other test files are not gated.
  await env.services.admin.legalAcceptance.deleteMany({
    where: { legalDocumentId: { in: docIds } },
  });
  await env.services.admin.legalDocument.deleteMany({ where: { id: { in: docIds } } });
  await env.services.cache.delPattern('hm:legal:*');
  await env?.close();
});

describe('legal acceptance gate (EX-04)', () => {
  it('blocks the staff API until the owner accepts the latest TOS and DPA', async () => {
    const tos = await publish('TOS', version);
    const dpa = await publish('DPA', version);
    await invalidateLegalCache(env.services, T.tenantId);
    await invalidateLegalCache(env.services, O.tenantId);

    const blocked = await request(app)
      .get('/api/v1/t/system/whoami')
      .set('Host', T.host)
      .set(bearer(clerkToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.meta.reason).toBe('LEGAL_ACCEPTANCE_REQUIRED');
    expect(blocked.body.meta.pending.map((p: { type: string }) => p.type).sort()).toEqual([
      'DPA',
      'TOS',
    ]);

    // Auth and legal endpoints stay reachable.
    const me = await request(app)
      .get('/api/v1/t/auth/me')
      .set('Host', T.host)
      .set(bearer(clerkToken));
    expect(me.status).toBe(200);
    expect(me.body.legal).toMatchObject({ blocked: true, canAccept: false });
    const docs = await request(app)
      .get('/api/v1/t/legal/documents')
      .set('Host', T.host)
      .set(bearer(clerkToken));
    expect(docs.status).toBe(200);
    expect(docs.body.items.find((d: { id: string }) => d.id === tos.id).content).toBe(
      `TOS ${version}`,
    );

    const notOwner = await request(app)
      .post('/api/v1/t/legal/accept')
      .set('Host', T.host)
      .set(bearer(clerkToken))
      .send({ documentIds: [tos.id, dpa.id] });
    expect(notOwner.status).toBe(403);
    expect(notOwner.body.meta.reason).toBe('LEGAL_OWNER_REQUIRED');

    const partial = await request(app)
      .post('/api/v1/t/legal/accept')
      .set('Host', T.host)
      .set(bearer(ownerToken))
      .send({ documentIds: [tos.id] });
    expect(partial.status).toBe(200);
    expect(partial.body.blocked).toBe(true);
    const accept = await request(app)
      .post('/api/v1/t/legal/accept')
      .set('Host', T.host)
      .set(bearer(ownerToken))
      .set('User-Agent', 'vitest')
      .send({ documentIds: [dpa.id] });
    expect(accept.status).toBe(200);
    expect(accept.body).toMatchObject({ blocked: false, pending: [] });
    const rows = await env.services.admin.legalAcceptance.findMany({
      where: { tenantId: T.tenantId },
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.ip && r.userId === T.userId && r.version === version)).toBe(true);
    expect(
      (
        await request(app)
          .get('/api/v1/t/system/whoami')
          .set('Host', T.host)
          .set(bearer(clerkToken))
      ).status,
    ).toBe(200);

    // Another tenant is still blocked (acceptance is per tenant).
    const otherToken = await mintToken(env.services.config, { sub: O.userId, tid: O.tenantId });
    expect(
      (
        await request(app)
          .get('/api/v1/t/system/whoami')
          .set('Host', O.host)
          .set(bearer(otherToken))
      ).status,
    ).toBe(403);

    // A new TOS version blocks again.
    await publish('TOS', `${version}-2`);
    await invalidateLegalCache(env.services, T.tenantId);
    const again = await request(app)
      .get('/api/v1/t/system/whoami')
      .set('Host', T.host)
      .set(bearer(clerkToken));
    expect(again.status).toBe(403);
    expect(again.body.meta.pending).toEqual([
      expect.objectContaining({ type: 'TOS', version: `${version}-2` }),
    ]);
  });
});

describe('audit trail', () => {
  it('lists with filters, exports CSV, stays tenant-scoped and immutable', async () => {
    // Clear the legal gate for this part.
    await env.services.admin.legalAcceptance.deleteMany({
      where: { legalDocumentId: { in: docIds } },
    });
    await env.services.admin.legalDocument.deleteMany({ where: { id: { in: docIds } } });
    await env.services.cache.delPattern('hm:legal:*');

    const { writeTenantAudit } = await import('../src/modules/audit/index.js');
    await writeTenantAudit(env.services, {
      tenantId: T.tenantId,
      userId: T.userId,
      action: 'probe.updated',
      entity: 'probe',
      entityId: 'p-1',
      before: { rate: 1000, passwordHash: 'secret' },
      after: { rate: 1200 },
      ip: '10.1.2.3',
    });
    await writeTenantAudit(env.services, {
      tenantId: O.tenantId,
      action: 'probe.updated',
      entity: 'probe',
      entityId: 'other',
    });
    const res = await request(app)
      .get('/api/v1/t/audit')
      .query({ action: 'probe.*', limit: 10 })
      .set('Host', T.host)
      .set(bearer(clerkToken));
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      entityId: 'p-1',
      before: { rate: 1000 },
      after: { rate: 1200 },
      ip: '10.1.2.3',
    });
    expect(res.body.items[0].before.passwordHash).toBeUndefined();

    const csvDenied = await request(app)
      .get('/api/v1/t/audit/export')
      .set('Host', T.host)
      .set(bearer(clerkToken));
    expect(csvDenied.status).toBe(403);
    const csv = await request(app)
      .get('/api/v1/t/audit/export')
      .query({ entity: 'probe' })
      .set('Host', T.host)
      .set(bearer(ownerToken));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('probe.updated');
    expect(csv.text).not.toContain('other');

    // Append-only: UPDATE / DELETE rejected by the database.
    await expect(
      env.services.admin.auditLog.updateMany({
        where: { tenantId: T.tenantId },
        data: { action: 'x' },
      }),
    ).rejects.toThrow();

    // Explicit entries and generic mutating entries are written by the hook.
    const created = await eventually(() =>
      env.services.admin.auditLog.findMany({
        where: { tenantId: T.tenantId, action: 'legal.accepted' },
      }),
    );
    expect(created.length).toBeGreaterThanOrEqual(2);
  });
});

describe('OpenAPI', () => {
  it('documents the auth, IAM, audit, legal, portal and platform routes', () => {
    const { openapi } = createApp(env.services);
    const paths = Object.keys(openapi.paths ?? {});
    for (const p of [
      '/api/v1/t/auth/login',
      '/api/v1/t/auth/mfa/verify',
      '/api/v1/t/auth/refresh',
      '/api/v1/t/auth/me',
      '/api/v1/t/auth/password/reset',
      '/api/v1/t/auth/invitations/accept',
      '/api/v1/t/iam/users',
      '/api/v1/t/iam/roles/{id}/permissions',
      '/api/v1/t/iam/security-policy',
      '/api/v1/t/audit/export',
      '/api/v1/t/legal/accept',
      '/api/v1/portal/auth/register',
      '/api/v1/portal/auth/me',
      '/api/v1/admin/auth/login',
      '/api/v1/admin/platform-users',
      '/api/v1/admin/impersonations',
      '/api/v1/admin/audit',
    ])
      expect(paths, p).toContain(p);
    const createRole = openapi.paths['/api/v1/t/iam/roles']?.post as unknown as Record<
      string,
      unknown
    >;
    expect(createRole['x-permission']).toBe('roles.manage');
    expect(createRole['x-feature']).toBe('security.custom_roles');
  });
});

describe('per-property scope helper', () => {
  it('returns no filter for owners and the attached properties otherwise', async () => {
    const owner = await request(app)
      .get('/api/v1/t/scope-probe')
      .set('Host', O.host)
      .set(bearer(await mintToken(env.services.config, { sub: O.userId, tid: O.tenantId })));
    expect(owner.body.where).toEqual({});
    const uid = await addUser(env.services.admin, O.tenantId, ['reservations.read']);
    await env.services.admin.userProperty.create({
      data: { tenantId: O.tenantId, userId: uid, propertyId: O.propertyId },
    });
    const scoped = await request(app)
      .get('/api/v1/t/scope-probe')
      .set('Host', O.host)
      .set(bearer(await mintToken(env.services.config, { sub: uid, tid: O.tenantId })));
    expect(scoped.body.where).toEqual({ propertyId: { in: [O.propertyId] } });
  });
});
