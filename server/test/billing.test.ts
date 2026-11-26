import { renderMessage } from '@hm/templates';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { ManualPaymentProvider, ProviderRegistry } from '../src/lib/providers/index.js';
import {
  nextPlatformNumber,
  overrideBillingNotifier,
  runLifecycle,
  runReminders,
  setBillingClock,
  type BillingNotice,
} from '../src/modules/billing/index.js';
import { overrideNotificationDeps } from '../src/modules/notifications/index.js';
import { captureMail, eventually } from './helpers/auth.js';
import { ADMIN_HOST, createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser } from './helpers/fixtures.js';

let env: TestEnv;
let app: Express;
let now = new Date('2026-11-18T10:00:00Z');
const setDay = (d: string) => {
  now = new Date(`${d}T10:00:00Z`);
};
const notices: BillingNotice[] = [];
const stored: { key: string; contentType: string; body: Buffer }[] = [];
const ADMIN = '/api/v1/admin';
let u = 0;
const uniq = () => `${Date.now().toString(36)}${(u++).toString(36)}`;

type Role = 'SUPER_ADMIN' | 'FINANCE' | 'SUPPORT' | 'READ_ONLY';
const tokens = {} as Record<Role | 'FINANCE2', string>;

async function platformToken(role: Role) {
  const user = await env.services.admin.platformUser.create({
    data: {
      email: `${role.toLowerCase()}-${uniq()}@platform.test`,
      name: role,
      role,
      passwordHash: 'x',
    },
  });
  const { config } = env.services;
  return signAccessToken(
    { sub: user.id, sid: crypto.randomUUID(), scope: 'platform', mfa: true },
    { secret: config.JWT_ACCESS_SECRET, issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE },
  );
}

const adm = (
  method: 'get' | 'post' | 'patch' | 'put' | 'delete',
  path: string,
  token = tokens.SUPER_ADMIN,
) =>
  request(app)
    [method](`${ADMIN}${path}`)
    .set('Host', ADMIN_HOST)
    .set('Authorization', `Bearer ${token}`);

interface T {
  tenantId: string;
  host: string;
  ownerId: string;
  token: string;
}
const staff = (method: 'get' | 'post', t: T, path: string, token = t.token) =>
  request(app)
    [method](`/api/v1/t${path}`)
    .set('Host', t.host)
    .set('Authorization', `Bearer ${token}`);

const plans = {} as Record<'S' | 'M' | 'TINY', string>;

async function newTenant(trialDays: number, plan: keyof typeof plans = 'S'): Promise<T> {
  const slug = `bt-${uniq()}`;
  const res = await adm('post', '/tenants').send({
    name: `Hôtel ${slug}`,
    slug,
    planId: plans[plan],
    billingCycle: 'MONTHLY',
    trialDays,
    owner: { name: 'Propriétaire', email: `owner-${slug}@x.test` },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const tenantId = res.body.id as string;
  const owner = await env.services.admin.user.findFirstOrThrow({ where: { tenantId } });
  await env.services.admin.user.update({ where: { id: owner.id }, data: { status: 'ACTIVE' } });
  const token = await mintToken(env.services.config, { sub: owner.id, tid: tenantId });
  return { tenantId, host: res.body.domains[0].hostname as string, ownerId: owner.id, token };
}

const lifecycle = (t: T) =>
  runLifecycle(env.services, { now, tenantIds: [t.tenantId], force: true }).then((r) => r[0]);
const reminders = (t: T) =>
  runReminders(env.services, { now, tenantIds: [t.tenantId], force: true });
const sub = (t: T) =>
  env.services.admin.subscription.findFirstOrThrow({ where: { tenantId: t.tenantId } });
const invoices = (t: T) =>
  env.services.admin.platformInvoice.findMany({
    where: { tenantId: t.tenantId },
    orderBy: { createdAt: 'asc' },
    include: { platformInvoiceLines: true },
  });
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

function pay(t: T, amount: number, extra: Record<string, unknown> = {}, token = tokens.FINANCE) {
  return adm('post', '/payments', token).send({
    tenantId: t.tenantId,
    amount,
    method: 'MIXX',
    paidAt: now.toISOString().slice(0, 10),
    ...extra,
  });
}

beforeAll(async () => {
  overrideNotificationDeps({
    providers: new ProviderRegistry({
      name: 'fake-pdf',
      renderHtml: () => Promise.resolve(Buffer.from('%PDF-1.4 fake')),
    }).addPayment(new ManualPaymentProvider()),
    storage: {
      put: (i) => {
        const body = Buffer.isBuffer(i.body) ? i.body : Buffer.from(i.body as string);
        const key = `t/x/${i.key}`;
        stored.push({ key, contentType: i.contentType, body });
        return Promise.resolve({ key, size: body.length });
      },
      signedUrl: (k) => Promise.resolve(`https://files.test/${k}?sig=1`),
    },
  });
  overrideBillingNotifier((_s, n) => {
    notices.push(n);
    return Promise.resolve();
  });
  captureMail();
  setBillingClock(() => now);
  env = createTestEnv();
  ({ app } = createApp(env.services));
  tokens.SUPER_ADMIN = await platformToken('SUPER_ADMIN');
  tokens.FINANCE = await platformToken('FINANCE');
  tokens.FINANCE2 = await platformToken('FINANCE');
  tokens.SUPPORT = await platformToken('SUPPORT');
  tokens.READ_ONLY = await platformToken('READ_ONLY');

  const quotas = { properties: 5, units: 50, users: 10, storage_mb: 1000, sms_per_month: 0 };
  const mk = async (code: string, monthly: number, features: string[], q = quotas) => {
    const res = await adm('post', '/plans').send({
      code: `${code}-${uniq()}`.toUpperCase(),
      name: `Plan ${code}`,
      trialDays: 14,
      features,
      quotas: q,
      prices: [
        { billingCycle: 'MONTHLY', amount: monthly },
        { billingCycle: 'QUARTERLY', amount: monthly * 3 },
        { billingCycle: 'YEARLY', amount: monthly * 12 },
      ],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  plans.S = await mk('S', 25_000, ['lodging.core', 'billing.core']);
  plans.M = await mk('M', 50_000, ['lodging.core', 'billing.core', 'restaurant']);
  plans.TINY = await mk('TINY', 10_000, ['lodging.core'], { ...quotas, users: 0 });
});

afterAll(async () => {
  overrideNotificationDeps({});
  overrideBillingNotifier(null);
  setBillingClock(null);
  await env?.close();
});

describe('platform numbering', () => {
  it('is gap-free under concurrency (rollbacks give their number back)', async () => {
    const admin = env.services.admin;
    const year = 2099;
    const attempts = Array.from({ length: 16 }, (_, i) =>
      admin
        .$transaction(async (tx) => {
          const n = await nextPlatformNumber(tx, 'invoice', year);
          if (i === 7) throw new Error('rollback');
          return n;
        })
        .catch(() => null),
    );
    const numbers = (await Promise.all(attempts)).filter((n): n is string => n !== null);
    expect(numbers).toHaveLength(15);
    const values = numbers.map((n) => Number(n.split('-')[2])).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(numbers.every((n) => /^PLT-2099-\d{6}$/.test(n))).toBe(true);
    const next = await admin.$transaction((tx) => nextPlatformNumber(tx, 'invoice', year));
    expect(next).toBe('PLT-2099-000016');
  });
});

describe('plans API', () => {
  it('versions prices without retroactive effect', async () => {
    const past = await adm('post', `/plans/${plans.S}/prices`).send({
      billingCycle: 'MONTHLY',
      amount: 30_000,
      validFrom: '2026-01-01',
    });
    expect(past.status).toBe(422);
    const future = await adm('post', `/plans/${plans.S}/prices`).send({
      billingCycle: 'MONTHLY',
      amount: 30_000,
      validFrom: '2030-01-01',
    });
    expect(future.status, JSON.stringify(future.body)).toBe(201);
    const dup = await adm('post', `/plans/${plans.S}/prices`).send({
      billingCycle: 'MONTHLY',
      amount: 31_000,
      validFrom: '2030-01-01',
    });
    expect(dup.status).toBe(409);
    const plan = await adm('get', `/plans/${plans.S}`);
    const monthly = plan.body.priceHistory.filter(
      (p: { billingCycle: string }) => p.billingCycle === 'MONTHLY',
    );
    expect(monthly).toHaveLength(2);
    expect(
      plan.body.prices.find((p: { billingCycle: string }) => p.billingCycle === 'MONTHLY').amount,
    ).toBe(25_000);
  });

  it('only SUPER_ADMIN writes the catalogue; READ_ONLY reads it', async () => {
    expect(
      (await adm('post', '/plans', tokens.FINANCE).send({ code: 'X1', name: 'X' })).status,
    ).toBe(403);
    expect((await adm('get', '/plans', tokens.READ_ONLY)).status).toBe(200);
    expect((await adm('post', '/coupons', tokens.READ_ONLY).send({})).status).toBe(403);
    const c = await adm('post', '/coupons').send({
      code: `WELCOME${uniq()}`.toUpperCase().slice(0, 20),
      type: 'PERCENT',
      value: '10',
      duration: 2,
      maxRedemptions: 1,
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const a = await adm('post', '/addons').send({
      code: `SMS-${uniq()}`.toUpperCase(),
      name: 'Pack SMS',
      quotaDeltas: { sms_per_month: 500 },
      prices: [{ billingCycle: 'MONTHLY', amount: 5_000 }],
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
  });
});

describe('trial → invoice J-7 → reminders → suspension → payment reactivation', () => {
  let A: T;
  let paymentId: string;

  it('creates the tenant in trial with an owner invitation', async () => {
    setDay('2026-11-18');
    A = await newTenant(14);
    const s = await sub(A);
    expect(s.status).toBe('TRIALING');
    expect(iso(s.trialEndsAt)).toBe('2026-12-02');
  });

  it('issues the first period invoice at J-7 (PLT-YYYY-NNNNNN), once', async () => {
    setDay('2026-11-24');
    expect((await lifecycle(A))?.invoices).toHaveLength(0);
    setDay('2026-11-25');
    const r = await lifecycle(A);
    expect(r?.invoices).toHaveLength(1);
    const [inv] = await invoices(A);
    expect(inv!.number).toMatch(/^PLT-2026-\d{6}$/);
    expect(inv!.total).toBe(25_000n);
    expect(iso(inv!.periodStart)).toBe('2026-12-02');
    expect(iso(inv!.dueDate)).toBe('2026-12-02');
    expect(inv!.pdfFileId).toBeTruthy();
    expect(inv!.kind).toBe('SUBSCRIPTION');
    // Same day re-run: claimed; forced re-run of another day: no duplicate invoice.
    expect(await lifecycle(A)).toBeUndefined();
    setDay('2026-11-26');
    await lifecycle(A);
    expect(await invoices(A)).toHaveLength(1);
  });

  it('sends trial J-3 and invoice reminders once (idempotent)', async () => {
    setDay('2026-11-29');
    const sent = await reminders(A);
    const codes = sent.map((n) => n.templateCode).sort();
    expect(codes).toEqual(['invoice_upcoming', 'trial_ending']);
    await env.services.redis.del(`hm:billing:reminders:${A.tenantId}:2026-11-29`);
    expect(await reminders(A)).toHaveLength(0);
    setDay('2026-12-01');
    expect((await reminders(A)).map((n) => n.templateCode)).toEqual(['trial_ending']);
  });

  it('suspends at the end of an unpaid trial: read only enforced, payment page open', async () => {
    setDay('2026-12-02');
    const r = await lifecycle(A);
    expect(r?.transition).toMatchObject({ from: 'TRIALING', to: 'SUSPENDED' });
    expect((await sub(A)).suspendedAt?.toISOString()).toBe(now.toISOString());
    const write = await staff('post', A, '/iam/users').send({});
    expect(write.status).toBe(402);
    expect(write.body.code).toBe('SUBSCRIPTION_SUSPENDED');
    const read = await staff('get', A, '/billing/subscription');
    expect(read.status).toBe(200);
    expect(read.body.subscription.status).toBe('SUSPENDED');
    const banners = await staff('get', A, '/billing/banners');
    expect(banners.body.items.map((b: { kind: string }) => b.kind)).toContain('suspended');
    const instr = await staff('get', A, '/billing/payment-instructions');
    expect(instr.status).toBe(200);
    expect(instr.body.amountDue).toBe(25_000);
  });

  it('a confirmed payment pays the invoice, reactivates, extends the period and issues a receipt', async () => {
    const res = await pay(A, 25_000, { reference: `MX${uniq()}`.toUpperCase() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    paymentId = res.body.id as string;
    expect(res.body.status).toBe('CONFIRMED');
    expect(res.body.receiptNumber).toMatch(/^REC-2026-\d{6}$/);
    const [inv] = await invoices(A);
    expect(inv!.status).toBe('PAID');
    const s = await sub(A);
    expect(s.status).toBe('ACTIVE');
    expect(s.suspendedAt).toBeNull();
    expect(iso(s.currentPeriodEnd)).toBe('2027-01-02');
    expect(
      notices.some(
        (n) => n.templateCode === 'payment_receipt_platform' && n.tenantId === A.tenantId,
      ),
    ).toBe(true);
    const write = await staff('post', A, '/iam/users').send({});
    expect(write.body.code).not.toBe('SUBSCRIPTION_SUSPENDED');
    const receipts = await staff('get', A, '/billing/receipts');
    expect(receipts.body.items[0].receiptNumber).toBe(res.body.receiptNumber);
    const stored = await env.services.admin.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(stored.receiptFileId).toBeTruthy();
    // Set once: the trigger refuses any later change of the receipt file.
    await expect(
      env.services.admin.payment.update({
        where: { id: paymentId },
        data: { receiptFileId: crypto.randomUUID() },
      }),
    ).rejects.toThrow(/receipt file/);
    const pdf = await staff('get', A, `/billing/receipts/${paymentId}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.url).toContain('https://files.test/');
  });

  it('refuses a duplicate (method, reference) with the existing payment id', async () => {
    const first = await env.services.admin.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const dup = await pay(A, 1_000, { reference: first.reference });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('CONFLICT');
    expect(dup.body.meta.existingPaymentId).toBe(paymentId);
    const future = await pay(A, 1_000, { paidAt: '2030-01-01' });
    expect(future.status).toBe(422);
  });

  it('isolates tenants on the subscription routes', async () => {
    setDay('2026-12-02');
    const B = await newTenant(14);
    const [invA] = await invoices(A);
    expect((await staff('get', B, `/billing/invoices/${invA!.id}`)).status).toBe(404);
    expect((await staff('get', B, `/billing/invoices/${invA!.id}/pdf`)).status).toBe(404);
    expect((await staff('get', B, `/billing/receipts/${paymentId}/pdf`)).status).toBe(404);
    const list = await staff('get', B, '/billing/invoices');
    expect(list.body.items).toHaveLength(0);
    const mismatch = await staff('get', B, '/billing/subscription', A.token);
    expect(mismatch.status).toBe(403);
    expect(mismatch.body.code).toBe('TENANT_MISMATCH');
    const reader = await addUser(env.services.admin, B.tenantId, ['lodging.read']);
    const readerToken = await mintToken(env.services.config, { sub: reader, tid: B.tenantId });
    const denied = await staff('get', B, '/billing/subscription', readerToken);
    expect(denied.status).toBe(403);
    expect(denied.body.meta).toEqual({ permission: 'billing.manage' });
    expect((await staff('get', B, '/billing/banners', readerToken)).status).toBe(200);
  });
});

describe('ACTIVE → PAST_DUE → SUSPENDED → CANCELLED, partial payment and reversal', () => {
  let B: T;
  let second: string;

  it('without trial: ACTIVE with the first invoice issued at once', async () => {
    setDay('2026-11-18');
    B = await newTenant(0);
    const s = await sub(B);
    expect(s.status).toBe('ACTIVE');
    const [inv] = await invoices(B);
    expect(iso(inv!.dueDate)).toBe('2026-11-25');
  });

  it('moves to PAST_DUE after the due date, keeps it on a partial payment', async () => {
    setDay('2026-11-26');
    expect((await lifecycle(B))?.transition).toMatchObject({ to: 'PAST_DUE' });
    expect(iso((await sub(B)).graceEndsAt)).toBe('2026-12-02');
    const p = await pay(B, 10_000);
    expect(p.status).toBe(201);
    const [inv] = await invoices(B);
    expect(inv!.status).toBe('PARTIALLY_PAID');
    expect(inv!.amountPaid).toBe(10_000n);
    expect((await sub(B)).status).toBe('PAST_DUE');
    const banners = await staff('get', B, '/billing/banners');
    expect(banners.body.items[0]).toMatchObject({ kind: 'overdue', amount: 15_000 });
  });

  it('suspends when the grace period elapses, reactivates on full payment', async () => {
    setDay('2026-12-02');
    expect((await lifecycle(B))?.transition).toMatchObject({ from: 'PAST_DUE', to: 'SUSPENDED' });
    const p = await pay(B, 15_000);
    second = p.body.id as string;
    expect((await sub(B)).status).toBe('ACTIVE');
    expect((await invoices(B))[0]!.status).toBe('PAID');
  });

  it('reversal: reason mandatory, invoice re-opened, subscription suspended again', async () => {
    const noReason = await adm('post', `/payments/${second}/reverse`, tokens.FINANCE).send({});
    expect(noReason.status).toBe(422);
    const r = await adm('post', `/payments/${second}/reverse`, tokens.FINANCE).send({
      reason: 'Transaction Mixx annulée par l’opérateur',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.payment.status).toBe('REVERSED');
    const [inv] = await invoices(B);
    expect(inv!.status).toBe('PARTIALLY_PAID');
    expect(inv!.amountPaid).toBe(10_000n);
    expect((await sub(B)).status).toBe('SUSPENDED');
    const again = await adm('post', `/payments/${second}/reverse`, tokens.FINANCE).send({
      reason: 'encore',
    });
    expect(again.status).toBe(412);
    // Never deleted.
    expect(await env.services.admin.payment.count({ where: { id: second } })).toBe(1);
  });

  it('cancels after R days of suspension and prepares the export (EX-11)', async () => {
    setDay('2027-03-01');
    expect((await lifecycle(B))?.transition).toBeNull();
    setDay('2027-03-02');
    expect((await lifecycle(B))?.transition).toMatchObject({ to: 'CANCELLED' });
    const cancelled = await sub(B);
    expect(cancelled.cancelledAt?.toISOString()).toBe(now.toISOString());
    expect(iso(cancelled.suspendedAt)).toBe('2026-12-02');
    const zip = await env.services.admin.file.findFirst({
      where: { tenantId: B.tenantId, mime: 'application/zip' },
    });
    expect(zip).toBeTruthy();
    // CANCELLED: export only (core guard) — the subscription page is not reachable.
    const read = await staff('get', B, '/billing/subscription');
    expect(read.status).toBe(402);
    const write = await staff('post', B, '/iam/users').send({});
    expect(write.body.code).toBe('SUBSCRIPTION_SUSPENDED');
  });
});

describe('overpayment, idempotency, double validation, roles', () => {
  let C: T;

  it('Idempotency-Key replays the first response; another body is refused', async () => {
    setDay('2026-11-18');
    C = await newTenant(0);
    const key = `idem-${uniq()}`;
    const body = { tenantId: C.tenantId, amount: 30_000, method: 'CASH', paidAt: '2026-11-18' };
    const first = await adm('post', '/payments', tokens.FINANCE)
      .set('Idempotency-Key', key)
      .send(body);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const replay = await adm('post', '/payments', tokens.FINANCE)
      .set('Idempotency-Key', key)
      .send(body);
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body.id).toBe(first.body.id);
    const other = await adm('post', '/payments', tokens.FINANCE)
      .set('Idempotency-Key', key)
      .send({ ...body, amount: 30_001 });
    expect(other.status).toBe(409);
    expect(other.body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(await env.services.admin.payment.count({ where: { tenantId: C.tenantId } })).toBe(1);
    // Overpayment: 30 000 on a 25 000 invoice → 5 000 credit.
    expect(first.body.credit).toBe(5_000);
    expect((await invoices(C))[0]!.status).toBe('PAID');
  });

  it('the credit is consumed by the next invoice', async () => {
    setDay('2026-12-11');
    const r = await lifecycle(C);
    expect(r?.invoices).toHaveLength(1);
    const renewal = (await invoices(C))[1]!;
    expect(renewal.total).toBe(25_000n);
    expect(renewal.amountPaid).toBe(5_000n);
    expect(renewal.status).toBe('PARTIALLY_PAID');
  });

  it('double validation: pending, refused to the same user, confirmed by another', async () => {
    const on = await adm('patch', '/billing/settings').send({ doubleValidation: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const p = await pay(C, 20_000);
    expect(p.status).toBe(201);
    expect(p.body.status).toBe('PENDING_VALIDATION');
    expect((await invoices(C))[1]!.amountPaid).toBe(5_000n);
    const same = await adm('post', `/payments/${p.body.id}/validate`, tokens.FINANCE);
    expect(same.status).toBe(403);
    const other = await adm('post', `/payments/${p.body.id}/validate`, tokens.FINANCE2);
    expect(other.status, JSON.stringify(other.body)).toBe(200);
    expect(other.body.status).toBe('CONFIRMED');
    expect((await invoices(C))[1]!.status).toBe('PAID');
    await adm('patch', '/billing/settings').send({ doubleValidation: false });
  });

  it('FINANCE writes payments; READ_ONLY and SUPPORT only read', async () => {
    expect((await adm('get', '/payments', tokens.READ_ONLY)).status).toBe(200);
    expect((await pay(C, 1_000, {}, tokens.READ_ONLY)).status).toBe(403);
    expect((await pay(C, 1_000, {}, tokens.SUPPORT)).status).toBe(403);
    expect(
      (await adm('patch', '/billing/settings', tokens.FINANCE).send({ graceDays: 3 })).status,
    ).toBe(403);
    const csv = await adm('get', `/payments/export.csv?tenantId=${C.tenantId}`, tokens.READ_ONLY);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('receiptNumber');
    const dash = await adm('get', '/billing/reports/dashboard?asOf=2026-12-11', tokens.READ_ONLY);
    expect(dash.status).toBe(200);
    expect(dash.body.revenue.byCurrency[0].currency).toBe('XOF');
    const coll = await adm(
      'get',
      '/billing/reports/collections?from=2026-11-01&to=2026-12-31&groupBy=month',
    );
    expect(coll.body.totalsByMethod.length).toBeGreaterThan(0);
    const aged = await adm('get', '/billing/reports/aged-receivables?asOf=2026-12-11');
    expect(aged.status).toBe(200);
  });
});

describe('plan change: prorata upgrade, downgrade at period end with quota check', () => {
  let D: T;

  it('upgrade is immediate with a prorata invoice', async () => {
    setDay('2026-11-18');
    D = await newTenant(0);
    await pay(D, 25_000);
    setDay('2026-12-03');
    const r = await adm('post', `/tenants/${D.tenantId}/plan`).send({ planId: plans.M });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.mode).toBe('immediate');
    const prorata = (await invoices(D)).find((i) => i.kind === 'PRORATA')!;
    expect(prorata.platformInvoiceLines[0]!.label).toMatch(/^Prorata/);
    // (50 000 − 25 000) × 15 / 30
    expect(prorata.total).toBe(12_500n);
    const ent = await env.services.entitlements.resolve(D.tenantId);
    expect(ent.features).toContain('restaurant');
    await pay(D, 12_500);
  });

  it('downgrade refused when the usage exceeds the target quotas', async () => {
    const r = await staff('post', D, '/billing/plan-change').send({ planId: plans.TINY });
    expect(r.status).toBe(412);
    expect(r.body.meta.reason).toBe('QUOTA_EXCEEDED');
  });

  it('downgrade is scheduled at the period end and applied by the lifecycle job', async () => {
    const r = await staff('post', D, '/billing/plan-change').send({ planId: plans.S });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ mode: 'scheduled', effectiveAt: '2026-12-18' });
    const scheduled = await sub(D);
    expect(scheduled).toMatchObject({ pendingPlanId: plans.S, pendingCycle: 'MONTHLY' });
    expect(iso(scheduled.pendingEffectiveAt)).toBe('2026-12-18');
    expect(scheduled.priceSnapshot ?? {}).not.toHaveProperty('pendingChange');
    setDay('2026-12-11');
    await lifecycle(D);
    const renewal = (await invoices(D)).find((i) => iso(i.periodStart) === '2026-12-18')!;
    expect(renewal.total).toBe(25_000n);
    expect(renewal.kind).toBe('RENEWAL');
    setDay('2026-12-18');
    expect((await lifecycle(D))?.planChanged).toBe(true);
    const applied = await sub(D);
    expect(applied.planId).toBe(plans.S);
    expect(applied).toMatchObject({
      pendingPlanId: null,
      pendingCycle: null,
      pendingEffectiveAt: null,
    });
    const ent = await env.services.entitlements.resolve(D.tenantId);
    expect(ent.features).not.toContain('restaurant');
  });
});

describe('void of an unpaid invoice', () => {
  it('records the reason and date, filters by kind, refuses a second void', async () => {
    setDay('2026-11-18');
    const V = await newTenant(0);
    const [inv] = await invoices(V);
    expect(inv!.kind).toBe('SUBSCRIPTION');
    const noReason = await adm('post', `/invoices/${inv!.id}/void`, tokens.FINANCE).send({});
    expect(noReason.status).toBe(422);
    const r = await adm('post', `/invoices/${inv!.id}/void`, tokens.FINANCE).send({
      reason: 'Erreur de plan',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const [voided] = await invoices(V);
    expect(voided).toMatchObject({ status: 'VOID', voidReason: 'Erreur de plan' });
    expect(voided!.voidedAt?.toISOString()).toBe(now.toISOString());
    const list = await adm('get', `/invoices?tenantId=${V.tenantId}&kind=SUBSCRIPTION`);
    expect(list.body.items[0]).toMatchObject({
      kind: 'SUBSCRIPTION',
      voidReason: 'Erreur de plan',
    });
    expect((await adm('get', `/invoices?tenantId=${V.tenantId}&kind=PRORATA`)).body.items).toEqual(
      [],
    );
    const again = await adm('post', `/invoices/${inv!.id}/void`, tokens.FINANCE).send({
      reason: 'encore',
    });
    expect(again.status).toBe(412);
  });
});

describe('payment declarations and tenant administration', () => {
  let E: T;

  it('tenant declares, admin approves (confirmed payment) or rejects (notified)', async () => {
    setDay('2026-11-18');
    E = await newTenant(0);
    const d = await staff('post', E, '/billing/declarations').send({
      method: 'MOOV_MONEY',
      amount: 25_000,
      reference: `MV${uniq()}`.toUpperCase(),
      paidAt: '2026-11-18',
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body.status).toBe('SUBMITTED');
    const queue = await adm('get', '/declarations?status=SUBMITTED', tokens.READ_ONLY);
    expect(queue.body.items.some((x: { id: string }) => x.id === d.body.id)).toBe(true);
    const ok = await adm('post', `/declarations/${d.body.id}/approve`, tokens.FINANCE);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.declaration.status).toBe('APPROVED');
    expect(ok.body.payment.status).toBe('CONFIRMED');
    expect((await invoices(E))[0]!.status).toBe('PAID');
    expect((await adm('post', `/declarations/${d.body.id}/approve`, tokens.FINANCE)).status).toBe(
      412,
    );

    const d2 = await staff('post', E, '/billing/declarations').send({
      method: 'MIXX',
      amount: 5_000,
      paidAt: '2026-11-18',
    });
    const ko = await adm('post', `/declarations/${d2.body.id}/reject`, tokens.FINANCE).send({
      reason: 'Référence introuvable chez l’opérateur',
    });
    expect(ko.status).toBe(200);
    expect(ko.body.status).toBe('REJECTED');
    const rejected = notices.find(
      (n) => n.templateCode === 'payment_declaration_rejected' && n.tenantId === E.tenantId,
    );
    expect(rejected).toBeDefined();
    // the notice renders with the default template (billing fills owner / hotel / url as notify())
    for (const locale of ['fr', 'en'])
      for (const channel of ['EMAIL', 'SMS'] as const) {
        const r = await renderMessage({
          code: 'payment_declaration_rejected',
          channel,
          locale,
          data: {
            owner: { name: 'Owner' },
            hotel: { name: 'Hôtel E' },
            billing: { url: 'https://e.example/settings/subscription' },
            ...rejected!.data,
          },
        });
        expect(r.text).toContain('Référence introuvable');
        if (channel === 'EMAIL') expect(r.text).toMatch(/5\D000/);
      }
  });

  it('proof attachment: signed URL + mime for declarations and payments, tenant name in the queue', async () => {
    setDay('2026-11-18');
    const T2 = await newTenant(0);
    const up = await staff('post', T2, '/billing/declarations/attachments').attach(
      'file',
      Buffer.from('fake png'),
      { filename: 'proof.png', contentType: 'image/png' },
    );
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    const d = await staff('post', T2, '/billing/declarations').send({
      method: 'MOOV_MONEY',
      amount: 4_000,
      paidAt: '2026-11-18',
      attachmentFileId: up.body.fileId,
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const att = await adm('get', `/declarations/${d.body.id}/attachment`, tokens.READ_ONLY);
    expect(att.status).toBe(200);
    expect(att.body.mime).toBe('image/png');
    expect(att.body.url).toContain('https://files.test/');
    expect((await adm('get', `/declarations/${d.body.id}/attachment`, tokens.SUPPORT)).status).toBe(
      403,
    );
    expect(
      (await adm('get', `/declarations/${crypto.randomUUID()}/attachment`, tokens.FINANCE)).status,
    ).toBe(404);
    const queue = await adm('get', `/declarations?tenantId=${T2.tenantId}`, tokens.READ_ONLY);
    expect(queue.body.items[0].tenantName).toMatch(/^Hôtel bt-/);

    const none = await staff('post', T2, '/billing/declarations').send({
      method: 'MIXX',
      amount: 1_000,
      paidAt: '2026-11-18',
    });
    expect((await adm('get', `/declarations/${none.body.id}/attachment`)).status).toBe(404);

    const p = await pay(T2, 1_000, { attachmentFileId: up.body.fileId });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const pa = await adm('get', `/payments/${p.body.id}/attachment`, tokens.FINANCE);
    expect(pa.status).toBe(200);
    expect(pa.body.mime).toBe('image/png');
    expect((await adm('get', `/payments/${p.body.id}/attachment`, tokens.SUPPORT)).status).toBe(
      403,
    );
    const p2 = await pay(T2, 500);
    expect((await adm('get', `/payments/${p2.body.id}/attachment`)).status).toBe(404);
  });

  it('tenant card, overrides, offered days, suspend / reactivate, export', async () => {
    const card = await adm('get', `/tenants/${E.tenantId}`, tokens.SUPPORT);
    expect(card.status).toBe(200);
    expect(card.body.subscription.status).toBe('ACTIVE');
    expect(card.body.quotaUsage.find((q: { key: string }) => q.key === 'users').used).toBe(1);
    const list = await adm(
      'get',
      `/tenants?q=${encodeURIComponent(card.body.slug)}`,
      tokens.READ_ONLY,
    );
    expect(list.body.items).toHaveLength(1);

    const o = await adm('post', `/tenants/${E.tenantId}/overrides`).send({
      kind: 'FEATURE',
      key: 'spa',
      value: { enabled: true },
    });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    expect((await env.services.entitlements.resolve(E.tenantId)).features).toContain('spa');

    const days = await adm('post', `/tenants/${E.tenantId}/offer-days`).send({
      days: 10,
      reason: 'Geste commercial',
    });
    expect(days.status).toBe(200);
    expect(days.body.subscription.currentPeriodEnd).toBe('2026-12-28');

    expect((await adm('post', `/tenants/${E.tenantId}/suspend`).send({})).status).toBe(422);
    const s = await adm('post', `/tenants/${E.tenantId}/suspend`).send({
      reason: 'Fraude suspectée',
    });
    expect(s.body.subscription.status).toBe('SUSPENDED');
    expect((await staff('post', E, '/iam/users').send({})).body.code).toBe(
      'SUBSCRIPTION_SUSPENDED',
    );
    const re = await adm('post', `/tenants/${E.tenantId}/reactivate`).send({
      reason: 'Levée de doute',
    });
    expect(re.body.subscription.status).toBe('ACTIVE');

    const ex = await adm('post', `/tenants/${E.tenantId}/export`);
    expect(ex.status, JSON.stringify(ex.body)).toBe(201);
    const zip = stored.find(
      (x) => x.contentType === 'application/zip' && x.key.includes(ex.body.fileName),
    );
    expect(zip?.body.subarray(0, 2).toString()).toBe('PK');
    expect(zip?.body.includes(Buffer.from('json/users.json'))).toBe(true);

    const audit = await eventually(() =>
      env.services.admin.platformAuditLog.findFirst({
        where: { action: 'tenant.suspend', entityId: E.tenantId },
      }),
    );
    expect(audit).toBeTruthy();
  });
});
