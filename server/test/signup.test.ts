import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createTenant } from '../src/modules/platform-tenants/service.js';
import { tenantCreateBody } from '../src/modules/platform-tenants/schemas.js';
import { overrideAuthMailer } from '../src/modules/auth/index.js';
import { setCaptchaVerifier } from '../src/modules/signup/index.js';
import { ADMIN_HOST, createTestEnv, PLATFORM_DOMAIN, type TestEnv } from './helpers/env.js';
import type * as Defaults from '../src/modules/platform-tenants/provision-defaults.js';
import { createTenantFixture } from './helpers/fixtures.js';
import { captureMail, PASSWORD, staffLogin, tokenFrom } from './helpers/auth.js';

const failure = vi.hoisted(() => ({ lookups: false }));
vi.mock('../src/modules/platform-tenants/provision-defaults.js', async (orig) => {
  const m = await orig<typeof Defaults>();
  return {
    ...m,
    seedLookups: (...args: Parameters<typeof m.seedLookups>) => {
      if (failure.lookups) throw new Error('boom: lookups');
      return m.seedLookups(...args);
    },
  };
});

let env: TestEnv;
let app: Express;
let sent: ReturnType<typeof captureMail>;
let planCode: string;
let seq = 0;
const legalVersion = `signup-${Date.now()}`;
const PUBLIC = '/api/v1/public';

const post = (path: string, body: unknown, host = PLATFORM_DOMAIN) =>
  request(app)
    .post(`${PUBLIC}${path}`)
    .set('Host', host)
    .send(body as object);
const get = (path: string, host = PLATFORM_DOMAIN) =>
  request(app).get(`${PUBLIC}${path}`).set('Host', host);

function payload(over: Record<string, unknown> = {}) {
  const n = `${Date.now().toString(36)}${seq++}`;
  return {
    hotelName: `Hôtel Test ${n}`,
    slug: `hotel-${n}`,
    ownerName: 'Ama Kodjo',
    email: `owner-${n}@signup.test`,
    phone: '90 12 34 56',
    country: 'TG',
    city: 'Lomé',
    planCode,
    cycle: 'MONTHLY',
    password: PASSWORD,
    acceptTerms: true,
    acceptDpa: true,
    locale: 'fr',
    ...over,
  };
}

beforeAll(async () => {
  env = createTestEnv();
  ({ app } = createApp(env.services));
  sent = captureMail();
  const { admin } = env.services;
  const code = `SIGNUP-${Date.now().toString(36)}`;
  planCode = code;
  await admin.plan.create({
    data: {
      code,
      name: 'Plan signup',
      trialDays: 14,
      sort: -1,
      planFeatures: {
        create: ['lodging.core', 'billing.core', 'branding.custom_domain'].map((featureKey) => ({
          featureKey,
        })),
      },
      planQuotas: {
        create: [
          { quotaKey: 'users', limit: 7 },
          { quotaKey: 'rooms', limit: null },
        ],
      },
      planPrices: {
        create: [
          {
            billingCycle: 'MONTHLY',
            currency: 'XOF',
            amount: 15000n,
            validFrom: new Date('2020-01-01'),
          },
          {
            billingCycle: 'YEARLY',
            currency: 'XOF',
            amount: 150000n,
            validFrom: new Date('2020-01-01'),
          },
        ],
      },
    },
  });
  await admin.taxRule.upsert({
    where: {
      country_code_effectiveFrom: {
        country: 'TG',
        code: 'TVA_NORMAL',
        effectiveFrom: new Date('2026-01-01'),
      },
    },
    create: {
      country: 'TG',
      code: 'TVA_NORMAL',
      name: 'TVA taux normal 18 %',
      kind: 'PERCENT',
      base: 'HT',
      rate: '18',
      effectiveFrom: new Date('2026-01-01'),
    },
    update: {},
  });
  const version = legalVersion;
  for (const type of ['TOS', 'DPA'] as const)
    await admin.legalDocument.create({
      data: { type, version, locale: 'fr', content: type, publishedAt: new Date() },
    });
  await env.services.cache.del('hm:legal:latest');
});

afterAll(async () => {
  // Unpublish our legal documents: other test files must not hit the acceptance gate (EX-04).
  await env?.services.admin.legalDocument.updateMany({
    where: { version: legalVersion },
    data: { publishedAt: null },
  });
  await env?.services.cache.del('hm:legal:latest');
  overrideAuthMailer(null);
  await env?.close();
});

beforeEach(async () => {
  sent.length = 0;
  failure.lookups = false;
  await env.services.redis.eval(
    "for _,k in ipairs(redis.call('keys','hm:auth-rl:*')) do redis.call('del',k) end",
    0,
  );
});

afterEach(() => setCaptchaVerifier(null));

describe('public plans and slug availability', () => {
  it('lists the public plans with prices, trial days, features and quotas (platform host only)', async () => {
    const res = await get('/plans');
    expect(res.status).toBe(200);
    const plan = res.body.items.find((p: { code: string }) => p.code === planCode);
    expect(plan.trialDays).toBe(14);
    expect(plan.features).toEqual(expect.arrayContaining(['lodging.core', 'billing.core']));
    expect(plan.quotas).toMatchObject({ users: 7, rooms: null });
    expect(plan.prices).toEqual(
      expect.arrayContaining([
        { billingCycle: 'MONTHLY', currency: 'XOF', amount: 15000 },
        { billingCycle: 'YEARLY', currency: 'XOF', amount: 150000 },
      ]),
    );
    const T = await createTenantFixture(env.services.admin, { label: 'pub' });
    expect((await get('/plans', T.host)).status).toBe(404);
    expect((await get('/plans', ADMIN_HOST)).status).toBe(404);
  });

  it('answers free / reserved / invalid / taken', async () => {
    const T = await createTenantFixture(env.services.admin, { label: 'slug' });
    const free = await get('/slug-available?slug=Mon-Hotel-Libre');
    expect(free.body).toEqual({ slug: 'mon-hotel-libre', available: true });
    expect((await get('/slug-available?slug=admin')).body.reason).toBe('RESERVED');
    expect((await get('/slug-available?slug=a')).body.reason).toBe('INVALID');
    expect((await get('/slug-available?slug=-bad-')).body.reason).toBe('INVALID');
    expect((await get(`/slug-available?slug=${T.slug}`)).body.reason).toBe('TAKEN');
  });
});

describe('POST /public/signup', () => {
  it('provisions everything in one go and sends the verification e-mail', async () => {
    const body = payload();
    const res = await post('/signup', body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toEqual({
      status: 'pending_verification',
      email: body.email,
      host: `${body.slug}.${PLATFORM_DOMAIN}`,
    });
    const { admin } = env.services;
    const tenant = await admin.tenant.findUniqueOrThrow({
      where: { slug: body.slug },
      include: {
        tenantDomains: true,
        subscriptions: { include: { plan: true } },
        users: { include: { userRoles: { include: { role: true } } } },
        roles: true,
        properties: { include: { departments: true, taxes: true } },
        securityPolicy: true,
        branding: true,
        lookupValues: true,
        legalAcceptances: true,
      },
    });
    expect(tenant).toMatchObject({
      name: body.hotelName,
      country: 'TG',
      timezone: 'Africa/Lome',
      defaultCurrency: 'XOF',
      phone: '+22890123456',
      status: 'ACTIVE',
    });
    expect(tenant.tenantDomains).toHaveLength(1);
    expect(tenant.tenantDomains[0]).toMatchObject({
      hostname: `${body.slug}.${PLATFORM_DOMAIN}`,
      type: 'SUBDOMAIN',
    });
    expect(tenant.tenantDomains[0]!.verifiedAt).not.toBeNull();
    expect(tenant.subscriptions).toHaveLength(1);
    expect(tenant.subscriptions[0]).toMatchObject({ status: 'TRIALING', billingCycle: 'MONTHLY' });
    expect(tenant.subscriptions[0]!.trialEndsAt).not.toBeNull();
    expect(tenant.roles.some((r) => r.name === 'Propriétaire' && r.isSystem)).toBe(true);
    expect(tenant.securityPolicy).not.toBeNull();
    expect(tenant.branding?.docHeader).toBe(body.hotelName);
    expect(tenant.lookupValues.length).toBeGreaterThan(5);
    expect(tenant.legalAcceptances).toHaveLength(2);

    expect(tenant.users).toHaveLength(1);
    const owner = tenant.users[0]!;
    expect(owner).toMatchObject({
      email: body.email,
      status: 'PENDING_VERIFICATION',
      phone: '+22890123456',
    });
    expect(owner.passwordHash).toMatch(/^\$argon2id/);
    expect(owner.userRoles.map((r) => r.role.name)).toEqual(['Propriétaire']);

    const [property] = tenant.properties;
    expect(property).toMatchObject({
      country: 'TG',
      currency: 'XOF',
      timezone: 'Africa/Lome',
      city: 'Lomé',
      name: body.hotelName,
    });
    expect(property!.departments.map((d) => d.code).sort()).toEqual(['HEB', 'HK', 'MAINT', 'RES']);
    expect(property!.taxes).toHaveLength(1);
    expect(property!.taxes[0]).toMatchObject({
      code: 'TVA18',
      type: 'PERCENT',
      taxRuleId: expect.any(String),
    });
    expect(Number(property!.taxes[0]!.value)).toBe(18);
    expect(await admin.userProperty.count({ where: { userId: owner.id } })).toBe(1);

    // Both audit trails.
    expect(
      await admin.platformAuditLog.count({
        where: { action: 'tenant.signup', entityId: tenant.id },
      }),
    ).toBe(1);
    expect(
      await admin.auditLog.count({ where: { action: 'tenant.signup', tenantId: tenant.id } }),
    ).toBe(1);

    // Entitlements come from the plan right away.
    const ent = await env.services.entitlements.resolve(tenant.id);
    expect(ent.planCode).toBe(planCode);
    expect(ent.features).toEqual(
      expect.arrayContaining(['lodging.core', 'billing.core', 'branding.custom_domain']),
    );
    expect(ent.quotas.users).toBe(7);

    expect(sent.filter((m) => m.templateCode === 'tenant_email_verification')).toHaveLength(1);
    expect(sent[0]!.to).toEqual({ email: body.email });
    expect(sent[0]!.locale).toBe('fr');
    // The pending owner cannot log in yet.
    const login = await request(app)
      .post('/api/v1/t/auth/login')
      .set('Host', `${body.slug}.${PLATFORM_DOMAIN}`)
      .send({ email: body.email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it('rejects a taken slug (409) and a reserved slug (422)', async () => {
    const first = payload();
    expect((await post('/signup', first)).status).toBe(201);
    const taken = await post('/signup', payload({ slug: first.slug }));
    expect(taken.status).toBe(409);
    expect(taken.body.meta.reason).toBe('SLUG_TAKEN');
    const reserved = await post('/signup', payload({ slug: 'billing' }));
    expect(reserved.status).toBe(422);
    expect(reserved.body.errors[0]).toMatchObject({ path: 'slug', code: 'SLUG_RESERVED' });
    const bad = await post('/signup', payload({ slug: 'Not A Slug' }));
    expect(bad.status).toBe(422);
  });

  it('rejects an invalid phone, a weak password, an unknown plan and missing consents', async () => {
    const phone = await post('/signup', payload({ phone: '123' }));
    expect(phone.status).toBe(422);
    expect(phone.body.errors[0]).toMatchObject({ path: 'phone', code: 'PHONE_INVALID' });
    const weak = await post('/signup', payload({ password: 'short' }));
    expect(weak.status).toBe(422);
    expect(weak.body.meta.rules).toEqual(expect.arrayContaining(['PASSWORD_TOO_SHORT']));
    const common = await post('/signup', payload({ password: 'Password123' }));
    expect(common.status).toBe(422);
    const plan = await post('/signup', payload({ planCode: 'NOPE' }));
    expect(plan.status).toBe(422);
    expect(plan.body.errors[0].path).toBe('planCode');
    expect((await post('/signup', payload({ acceptTerms: false }))).status).toBe(422);
    expect((await post('/signup', payload({ acceptDpa: undefined }))).status).toBe(422);
  });

  it('normalises +228 phone numbers', async () => {
    const body = payload({ phone: '+228 91 23 45 67' });
    expect((await post('/signup', body)).status).toBe(201);
    const t = await env.services.admin.tenant.findUniqueOrThrow({ where: { slug: body.slug } });
    expect(t.phone).toBe('+22891234567');
  });

  it('is rate-limited per IP', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++)
      statuses.push((await post('/signup', payload({ phone: '1' }))).status);
    expect(statuses.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(statuses[5]).toBe(429);
  });

  it('ignores honeypot submissions without creating anything', async () => {
    const body = payload({ website: 'http://spam.example' });
    const res = await post('/signup', body);
    expect(res.status).toBe(201);
    expect(await env.services.admin.tenant.findUnique({ where: { slug: body.slug } })).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it('honours the captcha hook', async () => {
    setCaptchaVerifier({ verify: (token) => Promise.resolve(token === 'ok') });
    const body = payload();
    const ko = await post('/signup', body);
    expect(ko.status).toBe(422);
    expect(ko.body.errors[0].code).toBe('CAPTCHA_FAILED');
    const ok = await post('/signup', { ...payload(), captchaToken: 'ok' });
    expect(ok.status).toBe(201);
  });

  it('is only served on platform hosts', async () => {
    const T = await createTenantFixture(env.services.admin, { label: 'sg' });
    expect((await post('/signup', payload(), T.host)).status).toBe(404);
    expect((await post('/signup', payload(), ADMIN_HOST)).status).toBe(404);
  });

  it('rolls everything back when a step fails', async () => {
    failure.lookups = true;
    const body = payload();
    const res = await post('/signup', body);
    expect(res.status).toBe(500);
    const { admin } = env.services;
    expect(await admin.tenant.findUnique({ where: { slug: body.slug } })).toBeNull();
    expect(
      await admin.tenantDomain.findUnique({
        where: { hostname: `${body.slug}.${PLATFORM_DOMAIN}` },
      }),
    ).toBeNull();
    expect(await admin.user.count({ where: { email: body.email } })).toBe(0);
    expect(sent).toHaveLength(0);
    // The slug stays available.
    failure.lookups = false;
    expect((await get(`/slug-available?slug=${body.slug}`)).body.available).toBe(true);
  });
});

describe('verification', () => {
  it('activates the owner, sends the welcome e-mail and lets them log in on the tenant host', async () => {
    const body = payload();
    await post('/signup', body);
    const token = tokenFrom(sent, 'tenant_email_verification');
    const res = await post('/signup/verify', { token });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.host).toBe(`${body.slug}.${PLATFORM_DOMAIN}`);
    expect(res.body.loginUrl).toContain(`https://${body.slug}.${PLATFORM_DOMAIN}/login`);
    const user = await env.services.admin.user.findFirstOrThrow({ where: { email: body.email } });
    expect(user.status).toBe('ACTIVE');
    expect(sent.some((m) => m.templateCode === 'tenant_welcome')).toBe(true);
    const { admin } = env.services;
    expect(
      await admin.platformAuditLog.count({ where: { action: 'tenant.owner_email_verified' } }),
    ).toBeGreaterThan(0);
    expect(
      await admin.auditLog.count({
        where: { action: 'tenant.owner_email_verified', userId: user.id },
      }),
    ).toBe(1);

    const session = await staffLogin(app, `${body.slug}.${PLATFORM_DOMAIN}`, body.email);
    expect(session.accessToken).toBeTruthy();

    // The link is single use.
    const again = await post('/signup/verify', { token });
    expect(again.status).toBe(422);
    expect(again.body.errors[0].code).toBe('TOKEN_INVALID');
  });

  it('rejects an unknown token', async () => {
    const res = await post('/signup/verify', { token: 'x'.repeat(43) });
    expect(res.status).toBe(422);
  });

  it('resends a link (same answer for unknown accounts) and the new link works', async () => {
    const body = payload();
    await post('/signup', body);
    sent.length = 0;
    const ok = await post('/signup/resend', { slug: body.slug, email: body.email });
    expect(ok.body).toEqual({ status: 'ok' });
    expect(sent.filter((m) => m.templateCode === 'tenant_email_verification')).toHaveLength(1);
    const ghost = await post('/signup/resend', { slug: body.slug, email: 'ghost@signup.test' });
    expect(ghost.body).toEqual({ status: 'ok' });
    expect(sent).toHaveLength(1);
    const res = await post('/signup/verify', {
      token: tokenFrom(sent, 'tenant_email_verification'),
    });
    expect(res.status).toBe(200);
  });
});

describe('admin tenant creation shares the provisioning', () => {
  it('gives the same defaults (property, departments, taxes, lookups, branding)', async () => {
    const { admin } = env.services;
    const plan = await admin.plan.findUniqueOrThrow({ where: { code: planCode } });
    const slug = `adm-${Date.now().toString(36)}`;
    const t = await createTenant(
      env.services,
      tenantCreateBody.parse({
        name: 'Hôtel Admin',
        slug,
        planId: plan.id,
        owner: { name: 'Kofi', email: `kofi-${slug}@signup.test` },
      }),
      { kind: 'platform', id: null },
    );
    const full = await admin.tenant.findUniqueOrThrow({
      where: { id: t.id },
      include: { properties: { include: { departments: true, taxes: true } }, branding: true },
    });
    expect(full.properties).toHaveLength(1);
    expect(full.properties[0]!.departments).toHaveLength(4);
    expect(full.properties[0]!.taxes.map((x) => x.code)).toEqual(['TVA18']);
    expect(full.branding).not.toBeNull();
    expect(t.subscription?.status).toBe('TRIALING');
  });
});
