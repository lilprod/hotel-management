import { runWithTenant } from '@hm/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig, ConfigError } from '../src/config.js';
import { rolloutBucket } from '../src/core/entitlements.js';
import { defineModule } from '../src/core/module.js';
import { defineSetting } from '../src/core/settings.js';
import { REDACTED, redact } from '../src/lib/logger.js';
import { providerSettings } from '../src/lib/providers/index.js';
import { TenantStorage, tenantObjectKey } from '../src/lib/storage.js';
import { accessLevel } from '../src/middleware/subscription-guard.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { createTenantFixture, type TenantFixture } from './helpers/fixtures.js';

const checkInTime = defineSetting({
  key: 'front_desk.check_in_time',
  schema: z.string().regex(/^\d{2}:\d{2}$/),
  default: '14:00',
});
const settingsModule = defineModule({ key: 'settingstest', settings: [checkInTime] });

let env: TestEnv;
let A: TenantFixture;
let B: TenantFixture;

beforeAll(async () => {
  env = createTestEnv([settingsModule]);
  A = await createTenantFixture(env.services.admin, {
    label: 'ca',
    features: ['lodging.core', 'billing.core'],
    quotas: { users: 5, units: 20, storage_mb: null },
  });
  B = await createTenantFixture(env.services.admin, { label: 'cb' });
});

afterAll(async () => {
  await env?.close();
});

describe('config', () => {
  it('rejects an invalid environment with every faulty variable', () => {
    expect(() => loadConfig({ DATABASE_URL: 'nope' })).toThrow(ConfigError);
    try {
      loadConfig({ JWT_ACCESS_SECRET: 'short' });
    } catch (e) {
      expect((e as Error).message).toMatch(/DATABASE_URL/);
      expect((e as Error).message).toMatch(/JWT_ACCESS_SECRET/);
    }
  });
});

describe('logger redaction', () => {
  it('masks passwords, tokens, id numbers and phones', () => {
    const out = redact({
      email: 'a@b.c',
      password: 'secret!',
      refreshToken: 'abc',
      headers: { authorization: 'Bearer xyz' },
      guest: { idNumber: 'TG123456', phone: '+22890123456', documentNumber: 'P1' },
      note: 'call +228 90 12 34 56 with Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig',
    }) as Record<string, unknown>;
    expect(out.email).toBe('a@b.c');
    expect(out.password).toBe(REDACTED);
    expect(out.refreshToken).toBe(REDACTED);
    expect((out.headers as Record<string, unknown>).authorization).toBe(REDACTED);
    expect(out.guest).toEqual({ idNumber: REDACTED, phone: REDACTED, documentNumber: REDACTED });
    expect(out.note).not.toMatch(/90 12 34|eyJ/);
  });

  it('applies to emitted log lines', () => {
    env.services.logger.info('login attempt', { password: 'hunter2', phone: '+22890000000' });
    const line = env.logs.lines.find((l) => l.message === 'login attempt');
    expect(line?.password).toBe(REDACTED);
    expect(line?.phone).toBe(REDACTED);
  });
});

describe('entitlements.resolve', () => {
  it('plan ∪ active add-ons ∪ overrides ∪ rollouts, quotas summed', async () => {
    const { admin, entitlements } = env.services;
    const addon = await admin.addon.create({
      data: {
        code: `SPA-${Date.now()}`,
        name: 'Spa',
        featureKeys: ['spa', 'activities'],
        quotaDeltas: { units: 10, storage_mb: 100 },
      },
    });
    await admin.tenantAddon.create({
      data: { tenantId: A.tenantId, addonId: addon.id, startsAt: new Date(Date.now() - 1000) },
    });
    const expired = await admin.addon.create({
      data: { code: `OLD-${Date.now()}`, name: 'Old', featureKeys: ['mice'] },
    });
    await admin.tenantAddon.create({
      data: {
        tenantId: A.tenantId,
        addonId: expired.id,
        startsAt: new Date('2020-01-01'),
        endsAt: new Date('2021-01-01'),
      },
    });
    await admin.tenantOverride.createMany({
      data: [
        { tenantId: A.tenantId, kind: 'FEATURE', key: 'loyalty', value: true },
        { tenantId: A.tenantId, kind: 'FEATURE', key: 'billing.core', value: false },
        { tenantId: A.tenantId, kind: 'QUOTA', key: 'users', value: 12 },
      ],
    });
    await admin.featureRollout.create({
      data: { featureKey: 'webhooks', status: 'ACTIVE', percentage: 0, tenantIds: [A.tenantId] },
    });
    await entitlements.invalidate(A.tenantId);
    const e = await entitlements.resolve(A.tenantId);
    expect(e.features).toEqual(['activities', 'lodging.core', 'loyalty', 'spa', 'webhooks']);
    expect(e.quotas).toEqual({ users: 12, units: 30, storage_mb: null });
    expect(await entitlements.limit(A.tenantId, 'properties')).toBe(0);

    // Other tenant unaffected.
    const eb = await entitlements.resolve(B.tenantId);
    expect(eb.features).toEqual(['billing.core', 'lodging.core']);
  });

  it('percentage rollouts are deterministic', () => {
    const b = rolloutBucket('x', A.tenantId);
    expect(b).toBe(rolloutBucket('x', A.tenantId));
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThan(100);
  });
});

describe('settings.get', () => {
  it('resolves user > property > tenant > platform > default, per tenant', async () => {
    const { settings, admin } = env.services;
    const at = { tenantId: A.tenantId, propertyId: A.propertyId, userId: A.userId };
    expect(await settings.get(checkInTime, at)).toBe('14:00');
    await admin.setting.create({
      data: { scope: 'PLATFORM', key: checkInTime.key, value: '13:00' },
    });
    expect(await settings.get(checkInTime, at)).toBe('13:00');
    await settings.set(checkInTime, '12:00', { tenantId: A.tenantId, scope: 'TENANT' });
    expect(await settings.get(checkInTime, at)).toBe('12:00');
    await settings.set(checkInTime, '11:00', {
      tenantId: A.tenantId,
      scope: 'PROPERTY',
      scopeId: A.propertyId,
    });
    expect(await settings.get(checkInTime, at)).toBe('11:00');
    await settings.set(checkInTime, '10:00', {
      tenantId: A.tenantId,
      scope: 'USER',
      scopeId: A.userId,
    });
    expect(await settings.get(checkInTime, at)).toBe('10:00');
    expect(await settings.get(checkInTime.key, { tenantId: A.tenantId })).toBe('12:00');
    // Tenant B sees only the platform default.
    expect(
      await settings.get(checkInTime, { tenantId: B.tenantId, propertyId: A.propertyId }),
    ).toBe('13:00');
    // Invalid stored values fall through.
    await admin.setting.updateMany({
      where: { scope: 'USER', key: checkInTime.key },
      data: { value: 42 },
    });
    expect(await settings.get(checkInTime, at)).toBe('11:00');
    expect(await settings.get(providerSettings.payment, at)).toBe('manual');
  });
});

describe('storage', () => {
  it('prefixes keys with t/{tenantId}/ from the context and refuses traversal / other tenants', async () => {
    expect(tenantObjectKey(A.tenantId, 'invoices/2026/F-1.pdf')).toBe(
      `t/${A.tenantId}/invoices/2026/F-1.pdf`,
    );
    expect(() => tenantObjectKey(A.tenantId, '../x')).toThrow();
    const storage = TenantStorage.fromConfig({
      ...env.services.config,
      S3_ENDPOINT: 'http://127.0.0.1:9',
      S3_ACCESS_KEY: 'k',
      S3_SECRET_KEY: 's',
      S3_FORCE_PATH_STYLE: true,
    });
    expect(() => storage.keyFor('a.pdf')).toThrow(/runWithTenant/);
    const url = await runWithTenant(A.tenantId, () => storage.signedUrl('docs/a.pdf'));
    expect(url).toContain(`/t/${A.tenantId}/docs/a.pdf`);
    expect(url).toContain('X-Amz-Expires=300');
    await expect(
      runWithTenant(A.tenantId, () => storage.signedUrl(`t/${B.tenantId}/docs/a.pdf`)),
    ).rejects.toThrow(/another tenant/);
  });
});

describe('subscription access table', () => {
  it('maps statuses as in doc 02 §2', () => {
    expect(accessLevel('TRIALING', 'ACTIVE')).toBe('full');
    expect(accessLevel('ACTIVE', 'ACTIVE')).toBe('full');
    expect(accessLevel('PAST_DUE', 'ACTIVE')).toBe('full');
    expect(accessLevel('SUSPENDED', 'ACTIVE')).toBe('read_only');
    expect(accessLevel('NONE', 'ACTIVE')).toBe('read_only');
    expect(accessLevel('ACTIVE', 'SUSPENDED')).toBe('read_only');
    expect(accessLevel('CANCELLED', 'ACTIVE')).toBe('export_only');
  });
});
