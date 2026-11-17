import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { overrideAuthMailer, type AuthMessage } from '../src/modules/auth/index.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import {
  bearer,
  captureMail,
  PASSWORD,
  setPassword,
  setPolicy,
  staffLogin,
  tokenFrom,
  eventually,
} from './helpers/auth.js';

let env: TestEnv;
let app: Express;
/** Premium-like tenant: custom roles + IP restriction. */
let P: TenantFixture;
/** Kpalimé-like tenant on a STANDARD plan (no custom roles, no IP restriction). */
let K: TenantFixture;
let tokenP: string;
let tokenK: string;
let mail: AuthMessage[];

const IAM = '/api/v1/t/iam';
const WHOAMI = '/api/v1/t/system/whoami';
const STANDARD_FEATURES = ['lodging.core', 'billing.core', 'crm.core', 'housekeeping'];

beforeAll(async () => {
  env = createTestEnv();
  ({ app } = createApp(env.services));
  P = await createTenantFixture(env.services.admin, {
    label: 'ip',
    features: [...STANDARD_FEATURES, 'security.custom_roles', 'security.ip_restriction'],
    quotas: { users: 10 },
  });
  K = await createTenantFixture(env.services.admin, {
    label: 'kp',
    features: STANDARD_FEATURES,
    quotas: { users: 3 },
  });
  mail = captureMail();
  tokenP = (await staffLogin(app, P.host, await setPassword(env.services, P.userId))).accessToken;
  tokenK = (await staffLogin(app, K.host, await setPassword(env.services, K.userId))).accessToken;
});

afterAll(async () => {
  overrideAuthMailer(null);
  await env?.close();
});

beforeEach(async () => {
  await env.services.redis.eval(
    "for _,k in ipairs(redis.call('keys','hm:auth-rl:*')) do redis.call('del',k) end",
    0,
  );
});

async function userWith(t: TenantFixture, permissions: string[]) {
  const id = await addUser(env.services.admin, t.tenantId, permissions);
  const email = await setPassword(env.services, id);
  const s = await staffLogin(app, t.host, email);
  return { id, email, token: s.accessToken };
}

describe('invitation flow', () => {
  it('invites, re-sends (old link dead), inspects and accepts', async () => {
    const res = await request(app)
      .post(`${IAM}/users`)
      .set('Host', K.host)
      .set(bearer(tokenK))
      .send({
        email: 'New.Clerk@K.test',
        name: 'Clerk',
        roleIds: [K.roleId],
        propertyIds: [K.propertyId],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('INVITED');
    expect(res.body.email).toBe('new.clerk@k.test');
    const first = tokenFrom(mail, 'user_invitation');
    const msg = mail.at(-1)!;
    expect(msg.to.email).toBe('new.clerk@k.test');
    expect((msg.data as { invitation: { url: string } }).invitation.url).toContain(K.host);

    // Login impossible before acceptance.
    const early = await request(app)
      .post('/api/v1/t/auth/login')
      .set('Host', K.host)
      .send({ email: 'new.clerk@k.test', password: PASSWORD });
    expect(early.status).toBe(401);

    const resend = await request(app)
      .post(`${IAM}/users/${res.body.id as string}/invitation`)
      .set('Host', K.host)
      .set(bearer(tokenK));
    expect(resend.status).toBe(204);
    const second = tokenFrom(mail, 'user_invitation');
    expect(second).not.toBe(first);
    const dead = await request(app)
      .post('/api/v1/t/auth/invitations/inspect')
      .set('Host', K.host)
      .send({ token: first });
    expect(dead.status).toBe(400);

    const inspect = await request(app)
      .post('/api/v1/t/auth/invitations/inspect')
      .set('Host', K.host)
      .send({ token: second });
    expect(inspect.body.email).toBe('new.clerk@k.test');
    const weak = await request(app)
      .post('/api/v1/t/auth/invitations/accept')
      .set('Host', K.host)
      .send({ token: second, password: 'weak' });
    expect(weak.status).toBe(422);
    const cross = await request(app)
      .post('/api/v1/t/auth/invitations/accept')
      .set('Host', P.host)
      .send({ token: second, password: PASSWORD });
    expect(cross.status).toBe(400);
    const ok = await request(app)
      .post('/api/v1/t/auth/invitations/accept')
      .set('Host', K.host)
      .send({ token: second, password: PASSWORD, name: 'Clerk Final' });
    expect(ok.status).toBe(200);
    const s = await staffLogin(app, K.host, 'new.clerk@k.test');
    const me = await request(app)
      .get('/api/v1/t/auth/me')
      .set('Host', K.host)
      .set(bearer(s.accessToken));
    expect(me.body.user.name).toBe('Clerk Final');
    expect(me.body.properties).toEqual([{ id: K.propertyId, name: expect.any(String) }]);
    const again = await request(app)
      .post('/api/v1/t/auth/invitations/accept')
      .set('Host', K.host)
      .send({ token: second, password: PASSWORD });
    expect(again.status).toBe(400);
  });

  it('enforces the users quota at creation', async () => {
    // K has quota 3: owner + clerk invited above + this one = 3, the next one is refused.
    const ok = await request(app)
      .post(`${IAM}/users`)
      .set('Host', K.host)
      .set(bearer(tokenK))
      .send({ email: 'third@k.test', name: 'Third', roleIds: [K.roleId] });
    expect(ok.status).toBe(201);
    const over = await request(app)
      .post(`${IAM}/users`)
      .set('Host', K.host)
      .set(bearer(tokenK))
      .send({ email: 'fourth@k.test', name: 'Fourth', roleIds: [K.roleId] });
    expect(over.status).toBe(402);
    expect(over.body.code).toBe('QUOTA_EXCEEDED');
  });
});

describe('permissions and isolation', () => {
  it('refuses a user without users.manage', async () => {
    const reader = await userWith(P, ['users.read']);
    const list = await request(app)
      .get(`${IAM}/users`)
      .set('Host', P.host)
      .set(bearer(reader.token));
    expect(list.status).toBe(200);
    const res = await request(app)
      .post(`${IAM}/users`)
      .set('Host', P.host)
      .set(bearer(reader.token))
      .send({ email: 'x@p.test', name: 'X', roleIds: [P.roleId] });
    expect(res.status).toBe(403);
    expect(res.body.meta.permission).toBe('users.manage');
    const pol = await request(app)
      .put(`${IAM}/security-policy`)
      .set('Host', P.host)
      .set(bearer(reader.token))
      .send({ pwdMinLength: 8 });
    expect(pol.status).toBe(403);
  });

  it('never exposes another tenant users or roles', async () => {
    const res = await request(app)
      .get(`${IAM}/users/${K.userId}`)
      .set('Host', P.host)
      .set(bearer(tokenP));
    expect(res.status).toBe(404);
    const list = await request(app).get(`${IAM}/users`).set('Host', P.host).set(bearer(tokenP));
    expect(list.body.items.map((u: { id: string }) => u.id)).not.toContain(K.userId);
    const assign = await request(app)
      .patch(`${IAM}/users/${P.userId}`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ roleIds: [K.roleId] });
    expect(assign.status).toBe(422);
    // A token of P on K's host is refused.
    const mismatch = await request(app).get(`${IAM}/users`).set('Host', K.host).set(bearer(tokenP));
    expect(mismatch.status).toBe(403);
  });

  it('prevents privilege escalation through roles', async () => {
    const admin = await userWith(P, ['users.*', 'roles.*', 'reservations.*']);
    const res = await request(app)
      .post(`${IAM}/roles`)
      .set('Host', P.host)
      .set(bearer(admin.token))
      .send({ name: 'Escalate', permissions: ['billing.manage'] });
    expect(res.status).toBe(403);
    expect(res.body.meta.reason).toBe('PRIVILEGE_ESCALATION');
    const fine = await request(app)
      .post(`${IAM}/roles`)
      .set('Host', P.host)
      .set(bearer(admin.token))
      .send({ name: 'Resa only', permissions: ['reservations.read'] });
    expect(fine.status).toBe(201);
    // Cannot give the owner role ('*') to someone.
    const give = await request(app)
      .post(`${IAM}/users`)
      .set('Host', P.host)
      .set(bearer(admin.token))
      .send({ email: 'owner2@p.test', name: 'O2', roleIds: [P.roleId] });
    expect(give.status).toBe(403);
  });
});

describe('roles', () => {
  it('custom roles are blocked on a STANDARD plan (feature security.custom_roles)', async () => {
    const res = await request(app)
      .post(`${IAM}/roles`)
      .set('Host', K.host)
      .set(bearer(tokenK))
      .send({ name: 'Night auditor', permissions: ['night_audit.run'] });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('FEATURE_NOT_IN_PLAN');
    expect(res.body.meta.feature).toBe('security.custom_roles');
    const clone = await request(app)
      .post(`${IAM}/roles/${K.roleId}/clone`)
      .set('Host', K.host)
      .set(bearer(tokenK))
      .send({ name: 'Copy' });
    expect(clone.status).toBe(402);
    const list = await request(app).get(`${IAM}/roles`).set('Host', K.host).set(bearer(tokenK));
    expect(list.status).toBe(200);
  });

  it('system roles are non-deletable, read-only and cloneable', async () => {
    const sys = await env.services.admin.role.create({
      data: {
        tenantId: P.tenantId,
        name: 'Réception (système)',
        isSystem: true,
        rolePermissions: {
          create: ['reservations.*', 'front_desk.*'].map((permissionKey) => ({
            tenantId: P.tenantId,
            permissionKey,
          })),
        },
      },
    });
    const del = await request(app)
      .delete(`${IAM}/roles/${sys.id}`)
      .set('Host', P.host)
      .set(bearer(tokenP));
    expect(del.status).toBe(403);
    expect(del.body.meta.reason).toBe('SYSTEM_ROLE');
    const edit = await request(app)
      .put(`${IAM}/roles/${sys.id}/permissions`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ permissions: ['*'] });
    expect(edit.status).toBe(403);
    const clone = await request(app)
      .post(`${IAM}/roles/${sys.id}/clone`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ name: 'Réception soir' });
    expect(clone.status).toBe(201);
    expect(clone.body.isSystem).toBe(false);
    expect(clone.body.permissions).toEqual(['front_desk.*', 'reservations.*']);
    const unknown = await request(app)
      .put(`${IAM}/roles/${clone.body.id as string}/permissions`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ permissions: ['nope.read'] });
    expect(unknown.status).toBe(422);
  });

  it('editing role permissions bumps perm_ver: grants change on the next request', async () => {
    const role = await request(app)
      .post(`${IAM}/roles`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ name: 'Housekeeper', permissions: ['housekeeping.read'] });
    expect(role.status).toBe(201);
    const u = await userWith(P, []);
    await request(app)
      .patch(`${IAM}/users/${u.id}`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ roleIds: [role.body.id] })
      .expect(200);
    const before = await request(app).get(WHOAMI).set('Host', P.host).set(bearer(u.token));
    expect(before.body.permissions).toEqual(['housekeeping.read']);
    const v1 = await env.services.permVersions.current(P.tenantId);
    await request(app)
      .put(`${IAM}/roles/${role.body.id as string}/permissions`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ permissions: ['housekeeping.read', 'housekeeping.update'] })
      .expect(200);
    expect(await env.services.permVersions.current(P.tenantId)).toBe(v1 + 1);
    const after = await request(app).get(WHOAMI).set('Host', P.host).set(bearer(u.token));
    expect(after.body.permissions).toEqual(['housekeeping.read', 'housekeeping.update']);
    // Assigned role cannot be deleted.
    const del = await request(app)
      .delete(`${IAM}/roles/${role.body.id as string}`)
      .set('Host', P.host)
      .set(bearer(tokenP));
    expect(del.status).toBe(409);
  });
});

describe('activation', () => {
  it('deactivation revokes sessions; self and last owner are protected', async () => {
    const u = await userWith(P, ['reservations.read']);
    const res = await request(app)
      .post(`${IAM}/users/${u.id}/deactivate`)
      .set('Host', P.host)
      .set(bearer(tokenP));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISABLED');
    expect((await request(app).get(WHOAMI).set('Host', P.host).set(bearer(u.token))).status).toBe(
      401,
    );
    const back = await request(app)
      .post(`${IAM}/users/${u.id}/activate`)
      .set('Host', P.host)
      .set(bearer(tokenP));
    expect(back.body.status).toBe('ACTIVE');
    const self = await request(app)
      .post(`${IAM}/users/${P.userId}/deactivate`)
      .set('Host', P.host)
      .set(bearer(tokenP));
    expect(self.status).toBe(409);
    const lastOwner = await request(app)
      .patch(`${IAM}/users/${P.userId}`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({
        roleIds: [
          (await env.services.admin.role.findFirst({
            where: { tenantId: P.tenantId, name: 'Housekeeper' },
          }))!.id,
        ],
      });
    expect(lastOwner.status).toBe(409);
    expect(lastOwner.body.meta.reason).toBe('LAST_OWNER');
  });
});

describe('security policy and IP allowlist', () => {
  it('reads and updates the policy, audited', async () => {
    const get = await request(app)
      .get(`${IAM}/security-policy`)
      .set('Host', K.host)
      .set(bearer(tokenK));
    expect(get.status).toBe(200);
    expect(get.body.pwdMinLength).toBe(10);
    const put = await request(app)
      .put(`${IAM}/security-policy`)
      .set('Host', K.host)
      .set(bearer(tokenK))
      .send({ pwdMinLength: 14, allowImpersonation: true });
    expect(put.status).toBe(200);
    expect(put.body.pwdMinLength).toBe(14);
    const tenant = await env.services.admin.tenant.findUnique({ where: { id: K.tenantId } });
    expect(tenant!.allowImpersonation).toBe(true);
    const audit = await eventually(() =>
      env.services.admin.auditLog.findFirst({
        where: { tenantId: K.tenantId, action: 'security.policy_updated' },
      }),
    );
    expect(audit.after).toMatchObject({ pwdMinLength: 14 });
    await setPolicy(env.services, K.tenantId, { pwdMinLength: 10 });
  });

  it('IP allowlist needs the feature, refuses self lock-out, then is enforced', async () => {
    const noFeature = await request(app)
      .put(`${IAM}/security-policy`)
      .set('Host', K.host)
      .set(bearer(tokenK))
      .send({ ipAllowlist: ['127.0.0.0/8'] });
    expect(noFeature.status).toBe(402);
    const bad = await request(app)
      .put(`${IAM}/security-policy`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ ipAllowlist: ['not-an-ip'] });
    expect(bad.status).toBe(422);
    const lockout = await request(app)
      .put(`${IAM}/security-policy`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ ipAllowlist: ['10.0.0.0/8'] });
    expect(lockout.status).toBe(422);
    expect(lockout.body.meta.reason).toBe('IP_LOCKOUT');
    const ok = await request(app)
      .put(`${IAM}/security-policy`)
      .set('Host', P.host)
      .set(bearer(tokenP))
      .send({ ipAllowlist: ['127.0.0.0/8', '::1'] });
    expect(ok.status).toBe(200);
    expect((await request(app).get(WHOAMI).set('Host', P.host).set(bearer(tokenP))).status).toBe(
      200,
    );

    // The office network changes: the current IP is no longer allowed.
    await setPolicy(env.services, P.tenantId, { ipAllowlist: ['10.0.0.0/8'] });
    const blocked = await request(app).get(WHOAMI).set('Host', P.host).set(bearer(tokenP));
    expect(blocked.status).toBe(403);
    expect(blocked.body.meta.reason).toBe('IP_NOT_ALLOWED');
    const login = await request(app)
      .post('/api/v1/t/auth/login')
      .set('Host', P.host)
      .send({ email: 'whoever@p.test', password: PASSWORD });
    expect(login.status).toBe(403);
    // Without the feature, a stored allowlist is not enforced (plan downgrade).
    await setPolicy(env.services, K.tenantId, { ipAllowlist: ['10.0.0.0/8'] });
    expect((await request(app).get(WHOAMI).set('Host', K.host).set(bearer(tokenK))).status).toBe(
      200,
    );
    await setPolicy(env.services, P.tenantId, { ipAllowlist: [] });
    await setPolicy(env.services, K.tenantId, { ipAllowlist: [] });
  });
});
