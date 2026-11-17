import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  overrideBrandingDeps,
  type BrandingStorage,
  type DnsTxtResolver,
} from '../src/modules/branding/index.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';

let env: TestEnv;
let app: Express;
let A: TenantFixture; // PREMIUM: custom domain feature
let B: TenantFixture; // no custom domain feature
let tokA: string;
let tokB: string;
let tokReader: string;
let tokNoPerm: string;

const P = '/api/v1/t/branding';
const stored = new Map<string, Buffer>();
const storage: BrandingStorage = {
  async put({ key, body }) {
    const buf = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body);
    stored.set(key, buf);
    return { key, size: buf.byteLength };
  },
  async signedUrl(key) {
    return `https://files.test/${key}?sig=1`;
  },
  async delete(key) {
    stored.delete(key);
  },
};
let txt: string[] = [];
const dns: DnsTxtResolver = { resolveTxt: async () => txt };

/** Minimal PNG header carrying the given pixel size (the parser reads the IHDR only). */
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const call = (
  method: 'get' | 'post' | 'put' | 'delete',
  f: TenantFixture,
  tok: string,
  path: string,
) => request(app)[method](path).set('Host', f.host).set('Authorization', `Bearer ${tok}`);

beforeAll(async () => {
  env = createTestEnv();
  ({ app } = createApp(env.services));
  const { admin, config } = env.services;
  A = await createTenantFixture(admin, {
    label: 'ba',
    features: ['branding.custom_domain'],
  });
  B = await createTenantFixture(admin, { label: 'bb', features: [] });
  tokA = await mintToken(config, { sub: A.userId, tid: A.tenantId });
  tokB = await mintToken(config, { sub: B.userId, tid: B.tenantId });
  tokReader = await mintToken(config, {
    sub: await addUser(admin, A.tenantId, ['branding.read']),
    tid: A.tenantId,
  });
  tokNoPerm = await mintToken(config, {
    sub: await addUser(admin, A.tenantId, ['lodging.read']),
    tid: A.tenantId,
  });
  overrideBrandingDeps({ storage, dns });
});
afterEach(() => {
  txt = [];
});
afterAll(async () => {
  overrideBrandingDeps({});
  await env?.close();
});

describe('permissions', () => {
  it('lets branding.read read but not write; refuses users without permission', async () => {
    expect((await call('get', A, tokReader, P)).status).toBe(200);
    expect((await call('put', A, tokReader, P).send({ primaryColor: '#112233' })).status).toBe(403);
    expect((await call('get', A, tokNoPerm, P)).status).toBe(403);
    expect((await call('get', A, tokNoPerm, `${P}/templates`)).status).toBe(403);
    expect((await request(app).get(P).set('Host', A.host)).status).toBe(401);
  });
});

describe('branding settings', () => {
  it('stores colours, legal identifiers and returns contrast warnings', async () => {
    const res = await call('put', A, tokA, P).send({
      primaryColor: '#FFEE00',
      secondaryColor: '#1F2A37',
      emailSenderName: 'Hôtel Aurore',
      loginMessage: 'Bienvenue',
      legal: { nif: '1001234567', rccm: 'TG-LFW-01-2020-B12-00001', taxRegime: 'RSI' },
    });
    expect(res.status).toBe(200);
    expect(res.body.primaryColor).toBe('#ffee00');
    expect(res.body.legal.nif).toBe('1001234567');
    expect(res.body.contrast.warnings.length).toBeGreaterThan(0);
    const get = await call('get', A, tokA, P);
    expect(get.body.emailSenderName).toBe('Hôtel Aurore');
    expect(get.body.defaults.taxRegimes).toContain('RSI');
  });

  it('rejects invalid colours and header-injection in the sender name', async () => {
    expect((await call('put', A, tokA, P).send({ primaryColor: 'red' })).status).toBe(422);
    expect(
      (await call('put', A, tokA, P).send({ emailSenderName: 'Evil\r\nBcc: x@y.z' })).status,
    ).toBe(422);
  });

  it('isolates tenants', async () => {
    const b = await call('get', B, tokB, P);
    expect(b.status).toBe(200);
    expect(b.body.primaryColor).toBeNull();
    expect(b.body.legal.nif).toBeNull();
    // A's token on B's host is refused
    expect((await call('get', B, tokA, P)).status).toBeGreaterThanOrEqual(401);
  });
});

describe('asset uploads', () => {
  const up = (f: TenantFixture, tok: string, kind: string, buf: Buffer, mime: string) =>
    call('post', f, tok, `${P}/assets/${kind}`).attach('file', buf, {
      filename: 'x.bin',
      contentType: mime,
    });

  it('stores a valid logo and serves it on the public endpoint', async () => {
    const res = await up(A, tokA, 'logo', png(200, 100), 'image/png');
    expect(res.status).toBe(201);
    expect(res.body.width).toBe(200);
    expect(stored.size).toBeGreaterThan(0);
    const pub = await request(app).get('/api/v1/portal/branding').set('Host', A.host);
    expect(pub.body.logoUrl).toContain('/api/v1/portal/branding/assets/logo');
  });

  it('rejects wrong type, mismatching content, bad dimensions and oversize', async () => {
    expect((await up(A, tokA, 'logo', Buffer.from('<svg/>'), 'image/svg+xml')).status).toBe(422);
    expect(
      (await up(A, tokA, 'logo', Buffer.from('not an image at all....'), 'image/png')).status,
    ).toBe(422);
    expect((await up(A, tokA, 'logo', png(8, 8), 'image/png')).status).toBe(422);
    expect((await up(A, tokA, 'logo', png(5000, 5000), 'image/png')).status).toBe(422);
    expect((await up(A, tokA, 'favicon', png(64, 16), 'image/png')).status).toBe(422);
    const big = Buffer.concat([png(200, 100), Buffer.alloc(2 * 1024 * 1024)]);
    expect([413, 422]).toContain((await up(A, tokA, 'logo', big, 'image/png')).status);
  });

  it('requires branding.manage', async () => {
    expect((await up(A, tokReader, 'logo', png(200, 100), 'image/png')).status).toBe(403);
  });

  it('removes an asset', async () => {
    expect((await call('delete', A, tokA, `${P}/assets/logo`)).status).toBe(204);
    const pub = await request(app).get('/api/v1/portal/branding').set('Host', A.host);
    expect(pub.body.logoUrl).toBeNull();
  });
});

describe('message templates', () => {
  let id: string;
  it('creates, lists, updates and deletes a template', async () => {
    const c = await call('post', A, tokA, `${P}/templates`).send({
      channel: 'EMAIL',
      code: 'booking_confirmation',
      locale: 'fr',
      subject: 'Confirmation {{reservation.number}}',
      body: 'Bonjour {{guest.firstName}}, merci de votre réservation.',
    });
    expect(c.status).toBe(201);
    id = c.body.id;
    const list = await call('get', A, tokA, `${P}/templates?locale=fr`);
    expect(list.body.items).toHaveLength(1);
    expect((await call('get', B, tokB, `${P}/templates`)).body.items).toHaveLength(0);
    expect((await call('get', B, tokB, `${P}/templates/${id}`)).status).toBe(404);
    const u = await call('put', A, tokA, `${P}/templates/${id}`).send({
      body: 'Salut {{guest.lastName}}',
    });
    expect(u.body.body).toBe('Salut {{guest.lastName}}');
    expect((await call('delete', A, tokA, `${P}/templates/${id}`)).status).toBe(204);
  });

  it('refuses variables outside the whitelist, helpers and raw output', async () => {
    const base = { channel: 'EMAIL', code: 'booking_confirmation', locale: 'fr' };
    for (const body of [
      'Hello {{secret.token}}',
      '{{{guest.firstName}}}',
      '{{lookup guest "x"}}',
      '{{#each guest}}x{{/each}}',
    ]) {
      const r = await call('post', A, tokA, `${P}/templates`).send({ ...base, body });
      expect(r.status, body).toBe(422);
    }
    expect(
      (
        await call('post', A, tokA, `${P}/templates`).send({
          ...base,
          code: 'unknown.code',
          body: 'x',
        })
      ).status,
    ).toBe(422);
  });

  it('previews with escaped output', async () => {
    const r = await call('post', A, tokA, `${P}/templates/preview`).send({
      channel: 'EMAIL',
      code: 'booking_confirmation',
      body: 'Bonjour {{guest.firstName}}',
      data: { 'guest.firstName': '<script>alert(1)</script>' },
    });
    expect(r.status).toBe(200);
    expect(r.body.body).not.toContain('<script>');
    expect(r.body.body).toContain('&lt;script&gt;');
    const bad = await call('post', A, tokA, `${P}/templates/preview`).send({
      channel: 'EMAIL',
      code: 'booking_confirmation',
      body: 'x',
      data: { 'hack.var': 'y' },
    });
    expect(bad.status).toBe(422);
  });
});

describe('custom domain', () => {
  it('is gated by the branding.custom_domain feature', async () => {
    const r = await call('get', B, tokB, `${P}/domain`);
    expect(r.status).toBe(402);
    expect(
      (await call('post', B, tokB, `${P}/domain`).send({ hostname: 'hotel-b.example.com' })).status,
    ).toBe(402);
  });

  it('adds, verifies through DNS TXT, then resolves the tenant by the new host', async () => {
    expect(
      (await call('post', A, tokA, `${P}/domain`).send({ hostname: 'localhost' })).status,
    ).toBe(422);
    expect(
      (await call('post', A, tokA, `${P}/domain`).send({ hostname: 'admin.hm.test' })).status,
    ).toBe(422);
    const host = 'www.hotel-aurore.example.com';
    const add = await call('post', A, tokA, `${P}/domain`).send({ hostname: host });
    expect(add.status).toBe(201);
    expect(add.body.custom.status).toBe('PENDING_VERIFICATION');
    const { name, value } = add.body.custom.txtRecord;
    expect(name).toBe(`_hm-challenge.${host}`);

    // another tenant cannot claim it
    expect(
      (await call('post', A, tokA, `${P}/domain`).send({ hostname: 'other.example.com' })).status,
    ).toBe(409);

    txt = ['unrelated'];
    const miss = await call('post', A, tokA, `${P}/domain/verify`);
    expect(miss.body.check.matched).toBe(false);
    expect(miss.body.custom.status).toBe('PENDING_VERIFICATION');
    // unverified custom host does not resolve to the tenant
    expect((await request(app).get('/api/v1/portal/branding').set('Host', host)).status).not.toBe(
      200,
    );

    txt = [value];
    const ok = await call('post', A, tokA, `${P}/domain/verify`);
    expect(ok.body.check.matched).toBe(true);
    expect(ok.body.custom.status).toBe('VERIFIED');
    const pub = await request(app).get('/api/v1/portal/branding').set('Host', host);
    expect(pub.status).toBe(200);

    expect((await call('delete', A, tokA, `${P}/domain`)).status).toBe(204);
    expect((await request(app).get('/api/v1/portal/branding').set('Host', host)).status).not.toBe(
      200,
    );
    expect((await call('get', A, tokA, `${P}/domain`)).body.custom).toBeNull();
  });
});

describe('public portal branding', () => {
  it('returns tenant branding from the Host, with defaults, and nothing from other tenants', async () => {
    const a = await request(app).get('/api/v1/portal/branding').set('Host', A.host);
    expect(a.status).toBe(200);
    expect(a.body.colors.primary).toBe('#ffee00');
    expect(a.body.name).toBe('Hotel BA');
    expect(a.body.languages).toEqual(['fr']);
    const b = await request(app).get('/api/v1/portal/branding').set('Host', B.host);
    expect(b.body.name).toBe('Hotel BB');
    expect(b.body.colors.primary).toMatch(/^#[0-9a-f]{6}$/);
    expect(b.body.colors.primary).not.toBe('#ffee00');
    expect(JSON.stringify(a.body)).not.toContain('nif');
    expect(
      (await request(app).get('/api/v1/portal/branding').set('Host', 'unknown.hm.test')).status,
    ).toBe(404);
  });
});
