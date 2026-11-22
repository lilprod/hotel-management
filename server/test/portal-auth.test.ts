import { renderMessage } from '@hm/templates';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { overrideAuthMailer, type AuthMessage } from '../src/modules/auth/index.js';
import { GUEST_VERIFICATION_TEMPLATE } from '../src/modules/portal-auth/index.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import {
  bearer,
  captureMail,
  cookiesOf,
  refreshReq,
  setPassword,
  staffLogin,
  tokenFrom,
} from './helpers/auth.js';

let env: TestEnv;
let app: Express;
let A: TenantFixture;
let B: TenantFixture;
let mail: AuthMessage[];

const P = '/api/v1/portal/auth';
const GUEST_PW = 'Plage-Lome-2026';

beforeAll(async () => {
  env = createTestEnv();
  ({ app } = createApp(env.services));
  A = await createTenantFixture(env.services.admin, { label: 'ga' });
  B = await createTenantFixture(env.services.admin, { label: 'gb' });
  await setPassword(env.services, A.userId);
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

async function registered(host: string, email: string) {
  const reg = await request(app)
    .post(`${P}/register`)
    .set('Host', host)
    .send({ email, password: GUEST_PW, firstName: 'Ama', lastName: 'Mensah' });
  expect(reg.status).toBe(202);
  const token = tokenFrom(mail, GUEST_VERIFICATION_TEMPLATE);
  // the real send path renders with the default template (no unknown template, no empty gaps)
  const sent = mail.filter((m) => m.templateCode === GUEST_VERIFICATION_TEMPLATE).at(-1)!;
  for (const channel of ['EMAIL', 'SMS'] as const) {
    const r = await renderMessage({
      code: sent.templateCode,
      channel,
      locale: sent.locale ?? 'fr',
      data: sent.data,
    });
    if (channel === 'EMAIL') expect(r.text).toContain('Ama');
    expect(r.text).toContain(token);
  }
  return token;
}

async function guestLogin(host: string, email: string) {
  const res = await request(app)
    .post(`${P}/login`)
    .set('Host', host)
    .send({ email, password: GUEST_PW });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

describe('guest accounts', () => {
  it('register → verify e-mail → login → me → refresh rotation → logout', async () => {
    const email = `ama${Date.now()}@guest.test`;
    const verifyToken = await registered(A.host, email);
    const early = await request(app)
      .post(`${P}/login`)
      .set('Host', A.host)
      .send({ email, password: GUEST_PW });
    expect(early.status).toBe(403);
    expect(early.body.meta.reason).toBe('EMAIL_NOT_VERIFIED');
    // Registering twice does not reveal anything.
    const dup = await request(app)
      .post(`${P}/register`)
      .set('Host', A.host)
      .send({ email, password: GUEST_PW, firstName: 'Ama', lastName: 'Mensah' });
    expect(dup.status).toBe(202);

    expect(
      (
        await request(app)
          .post(`${P}/verify-email`)
          .set('Host', B.host)
          .send({ token: verifyToken })
      ).status,
    ).toBe(400);
    const ok = await request(app)
      .post(`${P}/verify-email`)
      .set('Host', A.host)
      .send({ token: verifyToken });
    expect(ok.status).toBe(200);

    const login = await guestLogin(A.host, email);
    const token = login.body.accessToken as string;
    const claims = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    expect(claims.scope).toBe('portal');
    expect(claims.tid).toBe(A.tenantId);
    const me = await request(app).get(`${P}/me`).set('Host', A.host).set(bearer(token));
    expect(me.status).toBe(200);
    expect(me.body.account.email).toBe(email);
    expect(me.body.guest.firstName).toBe('Ama');

    const c = cookiesOf(login);
    expect(c.hm_prt).toBeTruthy();
    const r1 = await refreshReq(app, A.host, c.hm_prt!, c.hm_csrf!, `${P}/refresh`);
    expect(r1.status).toBe(200);
    const replay = await refreshReq(app, A.host, c.hm_prt!, c.hm_csrf!, `${P}/refresh`);
    expect(replay.status).toBe(401);
    expect(replay.body.meta.reason).toBe('REFRESH_REUSED');
    const r1c = cookiesOf(r1);
    expect((await refreshReq(app, A.host, r1c.hm_prt!, r1c.hm_csrf!, `${P}/refresh`)).status).toBe(
      401,
    );

    const again = await guestLogin(A.host, email);
    const t2 = again.body.accessToken as string;
    expect(
      (await request(app).post(`${P}/logout`).set('Host', A.host).set(bearer(t2))).status,
    ).toBe(204);
    expect((await request(app).get(`${P}/me`).set('Host', A.host).set(bearer(t2))).status).toBe(
      401,
    );
  });

  it('accounts are tenant-scoped', async () => {
    const email = `kofi${Date.now()}@guest.test`;
    const t = await registered(A.host, email);
    await request(app).post(`${P}/verify-email`).set('Host', A.host).send({ token: t }).expect(200);
    const other = await request(app)
      .post(`${P}/login`)
      .set('Host', B.host)
      .send({ email, password: GUEST_PW });
    expect(other.status).toBe(401);
    const login = await guestLogin(A.host, email);
    const cross = await request(app)
      .get(`${P}/me`)
      .set('Host', B.host)
      .set(bearer(login.body.accessToken as string));
    expect(cross.status).toBe(403);
    expect(cross.body.code).toBe('TENANT_MISMATCH');
  });

  it('password reset by e-mail link (single use)', async () => {
    const email = `yao${Date.now()}@guest.test`;
    const t = await registered(A.host, email);
    await request(app).post(`${P}/verify-email`).set('Host', A.host).send({ token: t }).expect(200);
    await request(app).post(`${P}/password/forgot`).set('Host', A.host).send({ email }).expect(202);
    const reset = tokenFrom(mail, 'password_reset');
    const weak = await request(app)
      .post(`${P}/password/reset`)
      .set('Host', A.host)
      .send({ token: reset, newPassword: 'abc' });
    expect(weak.status).toBe(422);
    const ok = await request(app)
      .post(`${P}/password/reset`)
      .set('Host', A.host)
      .send({ token: reset, newPassword: 'Nouveau-Pass-9' });
    expect(ok.status).toBe(200);
    expect(
      (
        await request(app)
          .post(`${P}/password/reset`)
          .set('Host', A.host)
          .send({ token: reset, newPassword: 'Nouveau-Pass-8' })
      ).status,
    ).toBe(400);
    const login = await request(app)
      .post(`${P}/login`)
      .set('Host', A.host)
      .send({ email, password: 'Nouveau-Pass-9' });
    expect(login.status).toBe(200);
  });
});

describe('token scopes', () => {
  it('refuses a staff token on portal routes and a portal token on staff routes', async () => {
    const staff = await staffLogin(
      app,
      A.host,
      (await env.services.admin.user.findUnique({ where: { id: A.userId } }))!.email,
    );
    const onPortal = await request(app)
      .get(`${P}/me`)
      .set('Host', A.host)
      .set(bearer(staff.accessToken));
    expect(onPortal.status).toBe(403);

    const email = `esi${Date.now()}@guest.test`;
    const t = await registered(A.host, email);
    await request(app).post(`${P}/verify-email`).set('Host', A.host).send({ token: t }).expect(200);
    const guest = await guestLogin(A.host, email);
    const gt = guest.body.accessToken as string;
    for (const path of ['/api/v1/t/auth/me', '/api/v1/t/system/whoami', '/api/v1/t/iam/users']) {
      const res = await request(app).get(path).set('Host', A.host).set(bearer(gt));
      expect(res.status, path).toBe(403);
    }
  });
});
