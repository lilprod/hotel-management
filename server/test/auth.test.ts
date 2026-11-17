import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { overrideAuthMailer, generateTotp } from '../src/modules/auth/index.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import {
  bearer,
  captureMail,
  cookiesOf,
  PASSWORD,
  refreshReq,
  setPassword,
  setPolicy,
  staffLogin,
  tokenFrom,
} from './helpers/auth.js';
import type { AuthMessage } from '../src/modules/auth/index.js';

let env: TestEnv;
let app: Express;
let A: TenantFixture;
let B: TenantFixture;
let emailA: string;
let mail: AuthMessage[];

const T = '/api/v1/t';
const WHOAMI = `${T}/system/whoami`;

beforeAll(async () => {
  env = createTestEnv();
  ({ app } = createApp(env.services));
  A = await createTenantFixture(env.services.admin, { label: 'aa' });
  B = await createTenantFixture(env.services.admin, { label: 'ab' });
  emailA = await setPassword(env.services, A.userId);
  await setPassword(env.services, B.userId);
  mail = captureMail();
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

async function newUser(t: TenantFixture, permissions = ['*']) {
  const id = await addUser(env.services.admin, t.tenantId, permissions);
  const email = await setPassword(env.services, id);
  return { id, email };
}

describe('login', () => {
  it('opens a session: access token, httpOnly refresh cookie, /me', async () => {
    const res = await request(app)
      .post(`${T}/auth/login`)
      .set('Host', A.host)
      .send({ email: emailA.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.tokenType).toBe('Bearer');
    expect(res.body.expiresIn).toBe(900);
    const raw = (res.headers['set-cookie'] as unknown as string[]).join('\n');
    expect(raw).toMatch(
      /hm_rt=[^;]+; Max-Age=\d+; Path=\/api\/v1\/t\/auth; Expires=[^;]+; HttpOnly; Secure; SameSite=Lax/,
    );
    const me = await request(app)
      .get(`${T}/auth/me`)
      .set('Host', A.host)
      .set(bearer(res.body.accessToken as string));
    expect(me.status, JSON.stringify(me.body)).toBe(200);
    expect(me.body.user.id).toBe(A.userId);
    expect(me.body.permissions).toEqual(['*']);
    expect(me.body.allProperties).toBe(true);
    expect(me.body.properties).toEqual([{ id: A.propertyId, name: expect.any(String) }]);
    expect(me.body.permVer).toEqual(expect.any(Number));
    expect(me.body.entitlements.features).toContain('lodging.core');
    expect(me.body.legal.blocked).toBe(false);
    const audit = await env.services.admin.auditLog.findMany({
      where: { tenantId: A.tenantId, action: 'auth.login', entityId: A.userId },
    });
    expect(audit.length).toBeGreaterThan(0);
  });

  it('refuses a user of another tenant (cross-tenant login)', async () => {
    const res = await request(app)
      .post(`${T}/auth/login`)
      .set('Host', B.host)
      .send({ email: emailA, password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.meta.reason).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after N failures (per policy) and audits it', async () => {
    const u = await newUser(A);
    await setPolicy(env.services, A.tenantId, { lockoutThreshold: 3, lockoutMinutes: 10 });
    for (let i = 0; i < 2; i++) {
      const r = await request(app)
        .post(`${T}/auth/login`)
        .set('Host', A.host)
        .send({ email: u.email, password: 'wrong-password' });
      expect(r.status).toBe(401);
    }
    const locked = await request(app)
      .post(`${T}/auth/login`)
      .set('Host', A.host)
      .send({ email: u.email, password: 'wrong-password' });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
    // Even the right password is refused while locked.
    const still = await request(app)
      .post(`${T}/auth/login`)
      .set('Host', A.host)
      .send({ email: u.email, password: PASSWORD });
    expect(still.status).toBe(423);
    const row = await env.services.admin.user.findUnique({ where: { id: u.id } });
    expect(row!.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    const audit = await env.services.admin.auditLog.findMany({
      where: { tenantId: A.tenantId, entityId: u.id, action: 'auth.account_locked' },
    });
    expect(audit).toHaveLength(1);
    await setPolicy(env.services, A.tenantId, { lockoutThreshold: 5, lockoutMinutes: 15 });
  });

  it('refuses a disabled account with the generic error', async () => {
    const u = await newUser(A);
    await env.services.admin.user.update({ where: { id: u.id }, data: { status: 'DISABLED' } });
    const r = await request(app)
      .post(`${T}/auth/login`)
      .set('Host', A.host)
      .send({ email: u.email, password: PASSWORD });
    expect(r.status).toBe(401);
    expect(r.body.meta.reason).toBe('INVALID_CREDENTIALS');
  });
});

describe('refresh rotation', () => {
  it('rotates the refresh token and detects reuse (whole family revoked)', async () => {
    const s = await staffLogin(app, A.host, emailA);
    const first = await refreshReq(app, A.host, s.refresh, s.csrf);
    expect(first.status).toBe(200);
    const c1 = cookiesOf(first);
    expect(c1.hm_rt).toBeTruthy();
    expect(c1.hm_rt).not.toBe(s.refresh);

    // Replay of the old token → reuse → family revoked.
    const replay = await refreshReq(app, A.host, s.refresh, s.csrf);
    expect(replay.status).toBe(401);
    expect(replay.body.meta.reason).toBe('REFRESH_REUSED');
    const next = await refreshReq(app, A.host, c1.hm_rt!, c1.hm_csrf!);
    expect(next.status).toBe(401);
    const me = await request(app)
      .get(`${T}/auth/me`)
      .set('Host', A.host)
      .set(bearer(first.body.accessToken as string));
    expect(me.status).toBe(401);
    const audit = await env.services.admin.auditLog.findMany({
      where: { tenantId: A.tenantId, action: 'auth.refresh_reuse_detected' },
    });
    expect(audit.length).toBeGreaterThan(0);
  });

  it('requires the CSRF double-submit header', async () => {
    const s = await staffLogin(app, A.host, emailA);
    const r = await request(app)
      .post(`${T}/auth/refresh`)
      .set('Host', A.host)
      .set('Cookie', `hm_rt=${s.refresh}; hm_csrf=${s.csrf}`);
    expect(r.status).toBe(403);
    expect(r.body.meta.reason).toBe('CSRF_INVALID');
  });

  it('refuses a refresh token on another tenant host', async () => {
    const s = await staffLogin(app, A.host, emailA);
    const r = await refreshReq(app, B.host, s.refresh, s.csrf);
    expect(r.status).toBe(401);
  });

  it('logout revokes the session at once', async () => {
    const s = await staffLogin(app, A.host, emailA);
    const out = await request(app)
      .post(`${T}/auth/logout`)
      .set('Host', A.host)
      .set(bearer(s.accessToken));
    expect(out.status).toBe(204);
    const me = await request(app).get(WHOAMI).set('Host', A.host).set(bearer(s.accessToken));
    expect(me.status).toBe(401);
    expect((await refreshReq(app, A.host, s.refresh, s.csrf)).status).toBe(401);
  });
});

describe('sessions', () => {
  it('enforces the idle timeout', async () => {
    const s = await staffLogin(app, A.host, emailA);
    const sid = JSON.parse(Buffer.from(s.accessToken.split('.')[1]!, 'base64url').toString())
      .sid as string;
    expect(
      (await request(app).get(WHOAMI).set('Host', A.host).set(bearer(s.accessToken))).status,
    ).toBe(200);
    await env.services.redis.del(`hm:sid-idle:${sid}`); // idle period elapsed
    const r = await request(app).get(WHOAMI).set('Host', A.host).set(bearer(s.accessToken));
    expect(r.status).toBe(401);
    expect(r.body.meta.reason).toBe('SESSION_IDLE');
    expect((await refreshReq(app, A.host, s.refresh, s.csrf)).status).toBe(401);
  });

  it('caps the number of sessions (oldest revoked), lists and revokes', async () => {
    const u = await newUser(A);
    await setPolicy(env.services, A.tenantId, { maxSessions: 2 });
    const s1 = await staffLogin(app, A.host, u.email);
    const s2 = await staffLogin(app, A.host, u.email);
    const s3 = await staffLogin(app, A.host, u.email);
    expect(
      (await request(app).get(WHOAMI).set('Host', A.host).set(bearer(s1.accessToken))).status,
    ).toBe(401);
    const list = await request(app)
      .get(`${T}/auth/sessions`)
      .set('Host', A.host)
      .set(bearer(s3.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.filter((i: { current: boolean }) => i.current)).toHaveLength(1);
    const other = list.body.items.find((i: { current: boolean }) => !i.current);
    const del = await request(app)
      .delete(`${T}/auth/sessions/${other.id as string}`)
      .set('Host', A.host)
      .set(bearer(s3.accessToken));
    expect(del.status).toBe(204);
    expect(
      (await request(app).get(WHOAMI).set('Host', A.host).set(bearer(s2.accessToken))).status,
    ).toBe(401);
    await setPolicy(env.services, A.tenantId, { maxSessions: null });
  });
});

describe('TOTP 2FA', () => {
  async function enrol(host: string, token: string) {
    const setup = await request(app)
      .post(`${T}/auth/mfa/setup`)
      .set('Host', host)
      .set(bearer(token))
      .send({});
    expect(setup.status).toBe(200);
    expect(setup.body.otpauthUri).toMatch(/^otpauth:\/\/totp\/.+secret=/);
    const secret = setup.body.secret as string;
    const act = await request(app)
      .post(`${T}/auth/mfa/activate`)
      .set('Host', host)
      .set(bearer(token))
      .send({ code: generateTotp(secret) });
    expect(act.status).toBe(200);
    return { secret, backupCodes: act.body.backupCodes as string[] };
  }

  it('requires the second factor once enabled; backup codes are single use', async () => {
    const u = await newUser(A);
    const s = await staffLogin(app, A.host, u.email);
    const { secret, backupCodes } = await enrol(A.host, s.accessToken);
    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10);

    const login = await request(app)
      .post(`${T}/auth/login`)
      .set('Host', A.host)
      .send({ email: u.email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.accessToken).toBeUndefined();
    // The challenge is not an access token.
    const misuse = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set(bearer(login.body.challengeToken as string));
    expect(misuse.status).toBe(401);

    const bad = await request(app)
      .post(`${T}/auth/mfa/verify`)
      .set('Host', A.host)
      .send({ challengeToken: login.body.challengeToken, code: '000000' });
    expect(bad.status).toBe(401);

    const ok = await request(app)
      .post(`${T}/auth/mfa/verify`)
      .set('Host', A.host)
      .send({ challengeToken: login.body.challengeToken, code: backupCodes[0] });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    const me = await request(app)
      .get(`${T}/auth/me`)
      .set('Host', A.host)
      .set(bearer(ok.body.accessToken as string));
    expect(me.body.session.mfa).toBe(true);
    expect(me.body.user.mfaEnabled).toBe(true);

    // Challenge is single use.
    const again = await request(app)
      .post(`${T}/auth/mfa/verify`)
      .set('Host', A.host)
      .send({ challengeToken: login.body.challengeToken, code: backupCodes[1] });
    expect(again.status).toBe(401);

    // The same backup code cannot be used twice.
    const login2 = await request(app)
      .post(`${T}/auth/login`)
      .set('Host', A.host)
      .send({ email: u.email, password: PASSWORD });
    const reused = await request(app)
      .post(`${T}/auth/mfa/verify`)
      .set('Host', A.host)
      .send({ challengeToken: login2.body.challengeToken, code: backupCodes[0] });
    expect(reused.status).toBe(401);
    // A TOTP code of the next step works (the activation step cannot be replayed).
    const totp = await request(app)
      .post(`${T}/auth/mfa/verify`)
      .set('Host', A.host)
      .send({
        challengeToken: login2.body.challengeToken,
        code: generateTotp(secret, Date.now() + 30_000),
      });
    expect(totp.status).toBe(200);
  });

  it('forces enrolment when the policy requires MFA for the role', async () => {
    const u = await newUser(A);
    const role = await env.services.admin.userRole.findFirst({ where: { userId: u.id } });
    await setPolicy(env.services, A.tenantId, {
      mfaMode: 'REQUIRED_FOR_ROLES',
      mfaRoles: [role!.roleId],
    });
    const login = await request(app)
      .post(`${T}/auth/login`)
      .set('Host', A.host)
      .send({ email: u.email, password: PASSWORD });
    expect(login.body.mfaSetupRequired).toBe(true);
    const ch = login.body.challengeToken as string;
    const setup = await request(app)
      .post(`${T}/auth/mfa/setup`)
      .set('Host', A.host)
      .send({ challengeToken: ch });
    expect(setup.status).toBe(200);
    const act = await request(app)
      .post(`${T}/auth/mfa/activate`)
      .set('Host', A.host)
      .send({ challengeToken: ch, code: generateTotp(setup.body.secret as string) });
    expect(act.status).toBe(200);
    expect(act.body.accessToken).toBeTruthy();
    expect(act.body.backupCodes).toHaveLength(10);
    // Cannot disable while mandatory.
    const dis = await request(app)
      .post(`${T}/auth/mfa/disable`)
      .set('Host', A.host)
      .set(bearer(act.body.accessToken as string))
      .send({ password: PASSWORD });
    expect(dis.status).toBe(403);
    expect(dis.body.meta.reason).toBe('MFA_MANDATORY');
    await setPolicy(env.services, A.tenantId, { mfaMode: 'OPTIONAL', mfaRoles: [] });
  });
});

describe('password policy', () => {
  it('validates length, classes, common passwords and history', async () => {
    const u = await newUser(A);
    await setPolicy(env.services, A.tenantId, {
      pwdMinLength: 12,
      pwdRequireClasses: 3,
      pwdHistory: 3,
    });
    const s = await staffLogin(app, A.host, u.email);
    const change = (currentPassword: string, newPassword: string, token = s.accessToken) =>
      request(app)
        .post(`${T}/auth/password`)
        .set('Host', A.host)
        .set(bearer(token))
        .send({ currentPassword, newPassword });

    const short = await change(PASSWORD, 'Ab1!');
    expect(short.status).toBe(422);
    expect(short.body.meta.rules).toContain('PASSWORD_TOO_SHORT');
    const classes = await change(PASSWORD, 'alllowercaseletters');
    expect(classes.body.meta.rules).toContain('PASSWORD_CLASSES');
    const wrongCurrent = await change('nope-nope', 'Another-Good-Pass-1');
    expect(wrongCurrent.status).toBe(422);
    const same = await change(PASSWORD, PASSWORD);
    expect(same.body.meta.rules).toContain('PASSWORD_REUSED');

    const p2 = 'Second-Strong-Pass-2';
    const p3 = 'Third-Strong-Pass-3';
    const r2 = await change(PASSWORD, p2);
    expect(r2.status).toBe(200);
    const t2 = r2.body.accessToken as string;
    const r3 = await change(p2, p3, t2);
    expect(r3.status).toBe(200);
    // Back to the first password: still in the 3-entry history.
    const back = await change(p3, PASSWORD, r3.body.accessToken as string);
    expect(back.status).toBe(422);
    expect(back.body.meta.rules).toContain('PASSWORD_REUSED');
    await setPolicy(env.services, A.tenantId, { pwdMinLength: 10, pwdHistory: 0 });
  });

  it('expired password → must_change_password: only /auth is usable until changed', async () => {
    const u = await newUser(A);
    await env.services.admin.user.update({
      where: { id: u.id },
      data: { passwordChangedAt: new Date(Date.now() - 5 * 86_400_000) },
    });
    await setPolicy(env.services, A.tenantId, { pwdExpiryDays: 2 });
    const s = await staffLogin(app, A.host, u.email);
    expect(s.body.mustChangePassword).toBe(true);
    const blocked = await request(app).get(WHOAMI).set('Host', A.host).set(bearer(s.accessToken));
    expect(blocked.status).toBe(403);
    expect(blocked.body.meta.reason).toBe('PASSWORD_CHANGE_REQUIRED');
    const me = await request(app)
      .get(`${T}/auth/me`)
      .set('Host', A.host)
      .set(bearer(s.accessToken));
    expect(me.body.user.mustChangePassword).toBe(true);
    const changed = await request(app)
      .post(`${T}/auth/password`)
      .set('Host', A.host)
      .set(bearer(s.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'Renewed-Strong-Pass-7' });
    expect(changed.status).toBe(200);
    const ok = await request(app)
      .get(WHOAMI)
      .set('Host', A.host)
      .set(bearer(changed.body.accessToken as string));
    expect(ok.status).toBe(200);
    await setPolicy(env.services, A.tenantId, { pwdExpiryDays: null });
  });
});

describe('password reset', () => {
  it('sends a single-use 30-min link and revokes sessions', async () => {
    const u = await newUser(A);
    const s = await staffLogin(app, A.host, u.email);
    const unknown = await request(app)
      .post(`${T}/auth/password/forgot`)
      .set('Host', A.host)
      .send({ email: 'nobody@nowhere.test' });
    expect(unknown.status).toBe(202);
    const res = await request(app)
      .post(`${T}/auth/password/forgot`)
      .set('Host', A.host)
      .send({ email: u.email });
    expect(res.status).toBe(202);
    const token = tokenFrom(mail, 'password_reset');
    const msg = mail.at(-1)!;
    expect(msg.to.email).toBe(u.email);
    expect((msg.data as { reset: { expiresInMinutes: number } }).reset.expiresInMinutes).toBe(30);
    const ttl = await env.services.redis.ttl(
      (await env.services.redis.keys(`hm:pwreset:staff:${A.tenantId}:*`))[0]!,
    );
    expect(ttl).toBeGreaterThan(1700);

    const weak = await request(app)
      .post(`${T}/auth/password/reset`)
      .set('Host', A.host)
      .send({ token, newPassword: 'short' });
    expect(weak.status).toBe(422);
    const ok = await request(app)
      .post(`${T}/auth/password/reset`)
      .set('Host', A.host)
      .send({ token, newPassword: 'Brand-New-Secret-42' });
    expect(ok.status).toBe(200);
    const reuse = await request(app)
      .post(`${T}/auth/password/reset`)
      .set('Host', A.host)
      .send({ token, newPassword: 'Brand-New-Secret-43' });
    expect(reuse.status).toBe(400);
    expect(
      (await request(app).get(WHOAMI).set('Host', A.host).set(bearer(s.accessToken))).status,
    ).toBe(401);
    await staffLogin(app, A.host, u.email, 'Brand-New-Secret-42');
    // The token of tenant A is useless on tenant B.
    await request(app)
      .post(`${T}/auth/password/forgot`)
      .set('Host', A.host)
      .send({ email: u.email });
    const t2 = tokenFrom(mail, 'password_reset');
    const cross = await request(app)
      .post(`${T}/auth/password/reset`)
      .set('Host', B.host)
      .send({ token: t2, newPassword: 'Brand-New-Secret-44' });
    expect(cross.status).toBe(400);
  });
});

describe('rate limiting', () => {
  it('limits login attempts per account', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const r = await request(app)
        .post(`${T}/auth/login`)
        .set('Host', B.host)
        .send({ email: 'ghost@b.test', password: 'whatever' });
      statuses.push(r.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
