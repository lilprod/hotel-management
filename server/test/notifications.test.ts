import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { runWithTenant } from '@hm/database';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QueueFactory, QUEUES, runJob } from '../src/jobs/index.js';
import {
  GotenbergPdfRenderer,
  HttpSmsProvider,
  ProviderRegistry,
  withDisplayName,
  type NotificationMessage,
  type NotificationProvider,
  type NotificationChannel,
} from '../src/lib/providers/index.js';
import {
  createNotifier,
  deliverJob,
  overrideNotificationDeps,
  renderPdf,
  type Notifier,
} from '../src/modules/notifications/index.js';
import type { RealtimeEmitter } from '../src/realtime/socket.js';
import { createTestEnv, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';

class FakeProvider implements NotificationProvider {
  readonly sent: NotificationMessage[] = [];
  attempts = 0;
  failTimes = 0;
  constructor(
    readonly name: string,
    readonly channel: NotificationChannel,
  ) {}
  send(m: NotificationMessage) {
    this.attempts++;
    if (this.attempts <= this.failTimes) return Promise.reject(new Error('provider down'));
    this.sent.push(m);
    return Promise.resolve({ channel: this.channel, provider: this.name, accepted: true });
  }
}

const email = new FakeProvider('smtp', 'email');
const sms = new FakeProvider('sms-console', 'sms');
const wa = new FakeProvider('whatsapp-console', 'whatsapp');
const stored: { key: string; contentType: string; size: number }[] = [];
const gotenberg: { body: string }[] = [];
const emitted: unknown[][] = [];

let env: TestEnv;
let queues: QueueFactory;
let notifier: Notifier;
let gotenbergServer: Server;
let A: TenantFixture;
let B: TenantFixture;
let guestId: string;
let seq = 0;
const key = () => `k${Date.now()}-${seq++}`;

const data = {
  hotel: { name: 'Hôtel Test', phone: '+228 90' },
  guest: { firstName: 'Kossi' },
  reservation: {
    number: 'R1',
    checkIn: '2026-12-01',
    checkOut: '2026-12-04',
    nights: 3,
    roomType: 'Double',
    total: { amount: 135000, currency: 'XOF' },
  },
};

beforeAll(async () => {
  gotenbergServer = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      gotenberg.push({ body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'application/pdf' }).end('%PDF-1.4 fake');
    });
  });
  await new Promise<void>((r) => gotenbergServer.listen(0, '127.0.0.1', r));
  const port = (gotenbergServer.address() as AddressInfo).port;

  overrideNotificationDeps({
    providers: new ProviderRegistry(new GotenbergPdfRenderer(`http://127.0.0.1:${port}`))
      .addNotification(email)
      .addNotification(sms)
      .addNotification(wa),
    storage: {
      put: (i) => {
        const size = Buffer.byteLength(i.body as Buffer);
        const k = `t/x/${i.key}`;
        stored.push({ key: k, contentType: i.contentType, size });
        return Promise.resolve({ key: k, size });
      },
      signedUrl: () => Promise.resolve('http://127.0.0.1:1/none'),
    },
  });
  env = createTestEnv();
  const emitter: RealtimeEmitter = {
    emitToTenant: () => undefined,
    emitToUser: (...a) => void emitted.push(a),
    emitToProperty: () => undefined,
    emitToGuest: () => undefined,
  };
  env.services.realtime = emitter;
  queues = new QueueFactory(env.services.config.REDIS_URL, `hmnotif${Date.now()}`);
  queues.worker(QUEUES.notifications, (job) => runJob(deliverJob, job, env.services), {
    concurrency: 1,
  });
  notifier = createNotifier(env.services, queues, {
    attempts: 4,
    backoff: { type: 'fixed', delay: 30 },
  });
  A = await createTenantFixture(env.services.admin, { label: 'na' });
  B = await createTenantFixture(env.services.admin, { label: 'nb' });
  const g = await env.services.admin.guest.create({
    data: { tenantId: A.tenantId, firstName: 'Kossi', lastName: 'M', email: 'k@x.test' },
  });
  guestId = g.id;
});

afterAll(async () => {
  overrideNotificationDeps({});
  await queues?.close();
  await env?.close();
  await new Promise((r) => gotenbergServer?.close(r));
});

beforeEach(() => {
  for (const p of [email, sms, wa]) {
    p.sent.length = 0;
    p.attempts = 0;
    p.failTimes = 0;
  }
  emitted.length = 0;
});

async function until(cond: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('timeout');
}

const base = (t: TenantFixture) => ({
  tenantId: t.tenantId,
  channels: ['email'] as const,
  to: { email: 'guest@x.test', phone: '+22890000000' },
  templateCode: 'booking_confirmation',
  data,
});

describe('notify: templates', () => {
  it('uses the default template, escapes variables and sets the tenant sender name', async () => {
    const res = await notifier.notify({
      ...base(A),
      data: { ...data, guest: { firstName: '<script>x</script>' } },
      idempotencyKey: key(),
    });
    expect(res[0]?.status).toBe('queued');
    await until(() => email.sent.length === 1);
    const m = email.sent[0]!;
    expect(m.subject).toContain('R1');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).not.toContain('<script>x');
    expect(m.fromName).toBe('Hotel NA');
  });

  it('prefers the tenant override (per tenant) over the default', async () => {
    await env.services.admin.messageTemplate.create({
      data: {
        tenantId: A.tenantId,
        channel: 'EMAIL',
        code: 'booking_confirmation',
        locale: 'fr',
        subject: 'Sujet maison {{reservation.number}}',
        body: 'Cher {{guest.firstName}}, total {{reservation.total}}',
      },
    });
    await notifier.notify({ ...base(A), idempotencyKey: key() });
    await notifier.notify({ ...base(B), idempotencyKey: key() });
    await until(() => email.sent.length === 2);
    const subjects = email.sent.map((m) => m.subject);
    expect(subjects).toContain('Sujet maison R1');
    expect(subjects.filter((s) => s?.startsWith('Confirmation de votre'))).toHaveLength(1);
    expect(email.sent.find((m) => m.subject === 'Sujet maison R1')?.text).toContain('Cher Kossi');
  });

  it('falls back to French for an unsupported locale and uses English when asked', async () => {
    await notifier.notify({ ...base(B), channels: ['sms'], locale: 'es', idempotencyKey: key() });
    await notifier.notify({ ...base(B), channels: ['sms'], locale: 'en', idempotencyKey: key() });
    await until(() => sms.sent.length === 2);
    const texts = sms.sent.map((m) => m.text);
    expect(texts.some((t) => t.includes('confirmee'))).toBe(true);
    expect(texts.some((t) => t.includes('confirmed'))).toBe(true);
  });

  it('rejects unknown codes and bad recipients', async () => {
    await expect(
      notifier.notify({ ...base(A), templateCode: 'nope', idempotencyKey: key() }),
    ).rejects.toThrow();
    await expect(
      notifier.notify({ ...base(A), to: { email: 'a@b.c\r\nBcc: x@y.z' }, idempotencyKey: key() }),
    ).rejects.toThrow();
  });
});

describe('notify: delivery', () => {
  it('is idempotent per key + code + channel', async () => {
    const k = key();
    const first = await notifier.notify({ ...base(A), idempotencyKey: k });
    const second = await notifier.notify({ ...base(A), idempotencyKey: k });
    expect(first[0]?.status).toBe('queued');
    expect(second[0]?.status).toBe('duplicate');
    await until(() => email.sent.length >= 1);
    await new Promise((r) => setTimeout(r, 150));
    expect(email.sent).toHaveLength(1);
  });

  it('retries with backoff on provider failure, then logs the communication', async () => {
    email.failTimes = 2;
    await notifier.notify({ ...base(A), guestId, idempotencyKey: key() });
    await until(() => email.sent.length === 1);
    expect(email.attempts).toBe(3);
    await until(async () => {
      const rows = await runWithTenant(A.tenantId, () =>
        env.services.db.communication.findMany({ where: { guestId } }),
      );
      return rows.length === 1;
    });
    const [row] = await runWithTenant(A.tenantId, () =>
      env.services.db.communication.findMany({ where: { guestId } }),
    );
    expect(row).toMatchObject({
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      templateCode: 'booking_confirmation',
    });
    expect(row?.sentAt).toBeTruthy();
  });

  it('respects preference opt-out, except for mandatory templates', async () => {
    const uid = await addUser(env.services.admin, A.tenantId, ['*']);
    await env.services.admin.notificationPreference.create({
      data: {
        tenantId: A.tenantId,
        userId: uid,
        type: 'booking_confirmation',
        channels: ['in_app'],
      },
    });
    await env.services.admin.notificationPreference.create({
      data: { tenantId: A.tenantId, userId: uid, type: 'password_reset', channels: [] },
    });
    const res = await notifier.notify({
      ...base(A),
      channels: ['email', 'in_app'],
      userId: uid,
      idempotencyKey: key(),
    });
    expect(res.map((r) => r.status)).toEqual(['skipped_preference', 'delivered_in_app']);
    const rows = await runWithTenant(A.tenantId, () =>
      env.services.db.notification.findMany({ where: { userId: uid } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain('R1');
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.slice(0, 3)).toEqual([A.tenantId, uid, 'notification.created']);

    const mandatory = await notifier.notify({
      tenantId: A.tenantId,
      channels: ['email'],
      to: { email: 'u@x.test' },
      userId: uid,
      templateCode: 'password_reset',
      data: { user: { name: 'U' }, reset: { url: 'https://h.example/r' } },
      idempotencyKey: key(),
    });
    expect(mandatory[0]?.status).toBe('queued');
  });

  it('skips channels without a recipient and refuses a foreign tenant context', async () => {
    const res = await notifier.notify({
      ...base(A),
      channels: ['sms', 'in_app'],
      to: { email: 'g@x.test' },
      idempotencyKey: key(),
    });
    expect(res.map((r) => r.status)).toEqual(['skipped_no_recipient', 'skipped_no_user']);
    await expect(
      runWithTenant(B.tenantId, () => notifier.notify({ ...base(A), idempotencyKey: key() })),
    ).rejects.toThrow(/tenant/);
  });
});

describe('providers', () => {
  it('HTTP SMS aggregator sends token header, sender and fails on non-2xx', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = new HttpSmsProvider(
      { url: 'https://sms.example/send', tokenHeader: 'X-Api-Key', token: 'abc', sender: 'HOTEL' },
      ((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(new Response('{"id":"m1"}', { status: 200 }));
      }) as never,
    );
    const r = await ok.send({ to: '+22890000000', text: 'hi' });
    expect(r).toMatchObject({ accepted: true, messageId: 'm1' });
    expect((calls[0]?.init.headers as Record<string, string>)['X-Api-Key']).toBe('abc');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      to: '+22890000000',
      from: 'HOTEL',
      message: 'hi',
    });
    const ko = new HttpSmsProvider(
      { url: 'https://sms.example/send', tokenHeader: 'Authorization', token: 'x', sender: 'H' },
      (() => Promise.resolve(new Response('', { status: 503 }))) as never,
    );
    await expect(ko.send({ to: '1', text: 'x' })).rejects.toThrow('503');
  });

  it('builds the From header from the tenant sender name', () => {
    expect(withDisplayName('Platform <no-reply@x.test>', 'Hôtel "Lac"\r\n')).toBe(
      '"Hôtel  Lac" <no-reply@x.test>',
    );
    expect(withDisplayName('Platform <no-reply@x.test>')).toBe('Platform <no-reply@x.test>');
  });
});

describe('renderPdf', () => {
  it('renders the invoice HTML through Gotenberg, stores it and returns a file id', async () => {
    const xof = (amount: number) => ({ amount, currency: 'XOF' });
    const out = await runWithTenant(A.tenantId, () =>
      renderPdf(env.services, {
        type: 'invoice',
        fileName: 'FAC 1.pdf',
        data: {
          number: 'FAC-1',
          issuedOn: '2026-12-04',
          seller: { name: 'Hotel NA', legalIds: { nif: '1001234567', rccm: 'TG-LFW-01' } },
          buyer: { name: 'Kossi' },
          lines: [
            {
              description: 'Chambre',
              quantity: 1,
              unitPrice: xof(100000),
              net: xof(100000),
              taxRate: '18',
            },
          ],
          taxBreakdown: [{ rate: '18', base: xof(100000), tax: xof(18000) }],
          totalNet: xof(100000),
          totalTax: xof(18000),
          totalGross: xof(118000),
          paymentMethod: 'Mobile Money',
        },
      }),
    );
    expect(gotenberg.at(-1)?.body).toContain('1001234567');
    expect(gotenberg.at(-1)?.body).toContain('TG-LFW-01');
    expect(stored.at(-1)).toMatchObject({ contentType: 'application/pdf' });
    const file = await runWithTenant(A.tenantId, () =>
      env.services.db.file.findFirst({ where: { id: out.fileId } }),
    );
    expect(file).toMatchObject({
      mime: 'application/pdf',
      isSensitive: true,
      originalName: 'FAC_1.pdf',
    });
    // RLS: tenant B cannot see the file.
    const other = await runWithTenant(B.tenantId, () =>
      env.services.db.file.findFirst({ where: { id: out.fileId } }),
    );
    expect(other).toBeNull();
  });
});
