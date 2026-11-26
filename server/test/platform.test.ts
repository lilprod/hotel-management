import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { generateTotp } from '../src/modules/auth/index.js';
import { hashPassword } from '../src/modules/auth/passwords.js';
import { ADMIN_HOST, createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import {
  bearer,
  captureMail,
  cookiesOf,
  eventually,
  PASSWORD,
  refreshReq,
  setPassword,
  setPolicy,
} from './helpers/auth.js';

let env: TestEnv;
let app: Express;
let T: TenantFixture;
let superToken: string;
let superId: string;

const ADMIN = '/api/v1/admin';
let seq = 0;

async function platformUser(role: 'SUPER_ADMIN' | 'FINANCE' | 'SUPPORT' | 'READ_ONLY') {
  const u = await env.services.admin.platformUser.create({
    data: {
      email: `p${Date.now()}${seq++}@platform.test`,
      name: `P ${role}`,
      role,
      passwordHash: await hashPassword(PASSWORD),
    },
  });
  return u;
}

/** Full platform login: password → enrolment (first time) → session. */
async function platformLogin(email: string) {
  const login = await request(app)
    .post(`${ADMIN}/auth/login`)
    .set('Host', ADMIN_HOST)
    .send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  expect(login.body.accessToken).toBeUndefined();
  expect(login.body.mfaSetupRequired).toBe(true);
  const ch = login.body.challengeToken as string;
  const setup = await request(app)
    .post(`${ADMIN}/auth/mfa/setup`)
    .set('Host', ADMIN_HOST)
    .send({ challengeToken: ch });
  expect(setup.status).toBe(200);
  const act = await request(app)
    .post(`${ADMIN}/auth/mfa/activate`)
    .set('Host', ADMIN_HOST)
    .send({ challengeToken: ch, code: generateTotp(setup.body.secret as string) });
  expect(act.status, JSON.stringify(act.body)).toBe(200);
  return { token: act.body.accessToken as string, secret: setup.body.secret as string, res: act };
}

beforeAll(async () => {
  env = createTestEnv();
  ({ app } = createApp(env.services));
  captureMail();
  T = await createTenantFixture(env.services.admin, { label: 'pt' });
  await setPassword(env.services, T.userId);
  const sa = await platformUser('SUPER_ADMIN');
  superId = sa.id;
  superToken = (await platformLogin(sa.email)).token;
});

afterAll(async () => {
  await env?.close();
});

beforeEach(async () => {
  await env.services.redis.eval(
    "for _,k in ipairs(redis.call('keys','hm:auth-rl:*')) do redis.call('del',k) end",
    0,
  );
});

describe('platform authentication (TOTP mandatory)', () => {
  it('locks the account after 5 failures (failed_attempts / locked_until columns)', async () => {
    const u = await platformUser('READ_ONLY');
    const attempt = (password: string) =>
      request(app)
        .post(`${ADMIN}/auth/login`)
        .set('Host', ADMIN_HOST)
        .send({ email: u.email, password });
    for (let i = 0; i < 4; i++) expect((await attempt('wrong-password')).status).toBe(401);
    expect(
      (await env.services.admin.platformUser.findUniqueOrThrow({ where: { id: u.id } }))
        .failedAttempts,
    ).toBe(4);
    expect((await attempt('wrong-password')).status).toBe(401);
    const locked = await attempt(PASSWORD);
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    const row = await env.services.admin.platformUser.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    // Lock expired: the right password works and resets the counters.
    await env.services.admin.platformUser.update({
      where: { id: u.id },
      data: { lockedUntil: new Date(Date.now() - 1000), failedAttempts: 0 },
    });
    expect((await attempt(PASSWORD)).status).toBe(200);
    expect(
      await env.services.admin.platformUser.findUniqueOrThrow({ where: { id: u.id } }),
    ).toMatchObject({ failedAttempts: 0, lockedUntil: null });
  });

  it('enrols at first login, then always asks for the TOTP', async () => {
    const u = await platformUser('SUPPORT');
    const { token, secret, res } = await platformLogin(u.email);
    expect(res.body.backupCodes).toHaveLength(10);
    const me = await request(app)
      .get(`${ADMIN}/auth/me`)
      .set('Host', ADMIN_HOST)
      .set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('SUPPORT');
    expect(me.body.mfaEnabled).toBe(true);

    const login = await request(app)
      .post(`${ADMIN}/auth/login`)
      .set('Host', ADMIN_HOST)
      .send({ email: u.email, password: PASSWORD });
    expect(login.body.mfaRequired).toBe(true);
    const verify = await request(app)
      .post(`${ADMIN}/auth/mfa/verify`)
      .set('Host', ADMIN_HOST)
      .send({
        challengeToken: login.body.challengeToken,
        code: generateTotp(secret, Date.now() + 30_000),
      });
    expect(verify.status).toBe(200);
    // Refresh rotation + reuse detection on the platform too.
    const c = cookiesOf(verify);
    const r1 = await refreshReq(app, ADMIN_HOST, c.hm_art!, c.hm_csrf!, `${ADMIN}/auth/refresh`);
    expect(r1.status).toBe(200);
    const r2 = await refreshReq(app, ADMIN_HOST, c.hm_art!, c.hm_csrf!, `${ADMIN}/auth/refresh`);
    expect(r2.status).toBe(401);
    expect(r2.body.meta.reason).toBe('REFRESH_REUSED');
    expect(
      (
        await request(app)
          .get(`${ADMIN}/auth/me`)
          .set('Host', ADMIN_HOST)
          .set(bearer(r1.body.accessToken as string))
      ).status,
    ).toBe(401);
  });

  it('refuses a platform route without a verified TOTP', async () => {
    const noMfa = await mintToken(env.services.config, { sub: superId, scope: 'platform' });
    const res = await request(app)
      .get(`${ADMIN}/platform-users`)
      .set('Host', ADMIN_HOST)
      .set(bearer(noMfa));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MFA_REQUIRED');
    const anon = await request(app).get(`${ADMIN}/platform-users`).set('Host', ADMIN_HOST);
    expect(anon.status).toBe(401);
  });

  it('refuses staff tokens on the admin API and platform tokens on tenants', async () => {
    const staff = await mintToken(env.services.config, { sub: T.userId, tid: T.tenantId });
    const a = await request(app)
      .get(`${ADMIN}/platform-users`)
      .set('Host', ADMIN_HOST)
      .set(bearer(staff));
    expect(a.status).toBe(403);
    const b = await request(app)
      .get('/api/v1/t/auth/me')
      .set('Host', T.host)
      .set(bearer(superToken));
    expect(b.status).toBe(403);
  });
});

describe('platform roles', () => {
  it('SUPER_ADMIN manages platform users; other roles are refused', async () => {
    const created = await request(app)
      .post(`${ADMIN}/platform-users`)
      .set('Host', ADMIN_HOST)
      .set(bearer(superToken))
      .send({
        email: `fin${Date.now()}@platform.test`,
        name: 'Fin',
        role: 'FINANCE',
        password: 'Finance-Strong-Pass-1',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.mfaEnabled).toBe(false);
    const weak = await request(app)
      .post(`${ADMIN}/platform-users`)
      .set('Host', ADMIN_HOST)
      .set(bearer(superToken))
      .send({
        email: `w${Date.now()}@platform.test`,
        name: 'W',
        role: 'FINANCE',
        password: 'short',
      });
    expect(weak.status).toBe(422);
    const self = await request(app)
      .patch(`${ADMIN}/platform-users/${superId}`)
      .set('Host', ADMIN_HOST)
      .set(bearer(superToken))
      .send({ role: 'READ_ONLY' });
    expect(self.status).toBe(409);

    const fin = await platformUser('FINANCE');
    const finToken = (await platformLogin(fin.email)).token;
    const denied = await request(app)
      .get(`${ADMIN}/platform-users`)
      .set('Host', ADMIN_HOST)
      .set(bearer(finToken));
    expect(denied.status).toBe(403);
    const audit = await request(app)
      .get(`${ADMIN}/audit`)
      .set('Host', ADMIN_HOST)
      .set(bearer(finToken));
    expect(audit.status).toBe(200);

    const ro = await platformUser('READ_ONLY');
    const roToken = (await platformLogin(ro.email)).token;
    const write = await request(app)
      .post(`${ADMIN}/impersonations`)
      .set('Host', ADMIN_HOST)
      .set(bearer(roToken))
      .send({ tenantId: T.tenantId, reason: 'Investigating an issue' });
    expect(write.status).toBe(403);

    // Deactivation applies at once.
    await request(app)
      .patch(`${ADMIN}/platform-users/${fin.id}`)
      .set('Host', ADMIN_HOST)
      .set(bearer(superToken))
      .send({ isActive: false })
      .expect(200);
    expect(
      (await request(app).get(`${ADMIN}/audit`).set('Host', ADMIN_HOST).set(bearer(finToken)))
        .status,
    ).toBe(401);
    const trail = await eventually(() =>
      env.services.admin.platformAuditLog.findMany({
        where: { action: 'platform.user_updated', entityId: fin.id },
      }),
    );
    expect(trail[0]!.actorId).toBe(superId);
  });
});

describe('impersonation', () => {
  it('requires tenant consent, a reason and ≤ 30 minutes', async () => {
    await setPolicy(env.services, T.tenantId, { allowImpersonation: false });
    const refused = await request(app)
      .post(`${ADMIN}/impersonations`)
      .set('Host', ADMIN_HOST)
      .set(bearer(superToken))
      .send({ tenantId: T.tenantId, reason: 'Helping with the night audit' });
    expect(refused.status).toBe(403);
    expect(refused.body.meta.reason).toBe('IMPERSONATION_NOT_ALLOWED');
    await setPolicy(env.services, T.tenantId, { allowImpersonation: true });
    const noReason = await request(app)
      .post(`${ADMIN}/impersonations`)
      .set('Host', ADMIN_HOST)
      .set(bearer(superToken))
      .send({ tenantId: T.tenantId });
    expect(noReason.status).toBe(422);
    const tooLong = await request(app)
      .post(`${ADMIN}/impersonations`)
      .set('Host', ADMIN_HOST)
      .set(bearer(superToken))
      .send({ tenantId: T.tenantId, reason: 'Helping with the night audit', durationMinutes: 60 });
    expect(tooLong.status).toBe(422);
  });

  it('acts as the owner with restrictions, audited on both sides', async () => {
    await setPolicy(env.services, T.tenantId, { allowImpersonation: true });
    const support = await platformUser('SUPPORT');
    const supportToken = (await platformLogin(support.email)).token;
    const start = await request(app)
      .post(`${ADMIN}/impersonations`)
      .set('Host', ADMIN_HOST)
      .set(bearer(supportToken))
      .send({
        tenantId: T.tenantId,
        reason: 'Ticket #42: rates not displayed',
        durationMinutes: 20,
      });
    expect(start.status, JSON.stringify(start.body)).toBe(201);
    expect(start.body.user.id).toBe(T.userId);
    expect(start.body.tenant.host).toBe(T.host);
    expect(start.body.expiresIn).toBe(1200);
    const token = start.body.accessToken as string;
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    expect(claims.impersonated_by).toBe(support.id);
    const session = await env.services.admin.session.findUniqueOrThrow({
      where: { id: start.body.sessionId as string },
    });
    expect(session).toMatchObject({ kind: 'IMPERSONATION', impersonatedBy: support.id });

    const me = await request(app).get('/api/v1/t/auth/me').set('Host', T.host).set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.impersonation).toEqual({ by: support.id });
    expect(
      (await request(app).get('/api/v1/t/iam/users').set('Host', T.host).set(bearer(token))).status,
    ).toBe(200);

    const blocked = [
      request(app)
        .post('/api/v1/t/auth/password')
        .send({ currentPassword: PASSWORD, newPassword: 'Another-Pass-123' }),
      request(app).put('/api/v1/t/iam/security-policy').send({ allowImpersonation: false }),
      request(app)
        .post('/api/v1/t/iam/users')
        .send({ email: 'x@y.test', name: 'X', roleIds: [T.roleId] }),
      request(app)
        .put(`/api/v1/t/iam/roles/${T.roleId}/permissions`)
        .send({ permissions: ['*'] }),
      request(app).post('/api/v1/t/billing/pay').send({}),
    ];
    for (const r of blocked) {
      const res = await r.set('Host', T.host).set(bearer(token));
      expect(res.status).toBe(403);
      expect(res.body.meta.reason).toBe('IMPERSONATION_RESTRICTED');
    }

    // Platform trail + tenant trail (with impersonated_by), and the tenant can list it.
    const platformTrail = await env.services.admin.platformAuditLog.findFirst({
      where: { action: 'impersonation.started', entityId: T.tenantId, actorId: support.id },
    });
    expect(platformTrail!.after).toMatchObject({ reason: 'Ticket #42: rates not displayed' });
    const ownerToken = await mintToken(env.services.config, { sub: T.userId, tid: T.tenantId });
    const list = await request(app)
      .get('/api/v1/t/iam/impersonations')
      .set('Host', T.host)
      .set(bearer(ownerToken));
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({
      action: 'impersonation.started',
      platformUserId: support.id,
    });
    const sessions = await request(app)
      .get('/api/v1/t/auth/sessions')
      .set('Host', T.host)
      .set(bearer(ownerToken));
    expect(sessions.body.items.some((s: { impersonation: boolean }) => s.impersonation)).toBe(true);

    // Actions during impersonation carry impersonated_by in the tenant audit.
    await request(app).get('/api/v1/t/audit').set('Host', T.host).set(bearer(token)).expect(200);
    const end = await request(app)
      .post(`${ADMIN}/impersonations/${start.body.sessionId as string}/end`)
      .set('Host', ADMIN_HOST)
      .set(bearer(supportToken));
    expect(end.status).toBe(204);
    expect(
      (await request(app).get('/api/v1/t/auth/me').set('Host', T.host).set(bearer(token))).status,
    ).toBe(401);
    const tenantTrail = await env.services.admin.auditLog.findMany({
      where: { tenantId: T.tenantId, impersonatedBy: support.id },
      orderBy: { at: 'asc' },
    });
    expect(tenantTrail.map((e) => e.action)).toEqual([
      'impersonation.started',
      'impersonation.ended',
    ]);
  });
});
