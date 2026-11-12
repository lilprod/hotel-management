import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { Services } from '../src/core/container.js';
import { checkQuota } from '../src/http/helpers.js';
import { createLogger } from '../src/lib/logger.js';
import {
  ConsoleNotificationProvider,
  GotenbergPdfRenderer,
  ManualPaymentProvider,
  NoneFiscalInvoiceProvider,
} from '../src/lib/providers/index.js';
import { upload } from '../src/lib/upload.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { memoryLogs } from './helpers/env.js';

const logger = createLogger({ silent: true });

function miniApp(services: Partial<Services>, ...handlers: express.RequestHandler[]) {
  const app = express();
  app.use((req, _res, next) => {
    req.services = services as Services;
    req.tenant = {
      id: '00000000-0000-7000-8000-000000000001',
      slug: 's',
      name: 'n',
      status: 'ACTIVE',
      hostname: 'h',
      domainType: 'SUBDOMAIN',
    };
    next();
  });
  app.post('/x', ...handlers, (req, res) => {
    res.json({ file: req.file ? { size: req.file.size, mime: req.file.mimetype } : null });
  });
  app.use(errorHandler(logger, true));
  return app;
}

describe('upload helper', () => {
  const app = miniApp({}, upload({ mimeTypes: ['image/*', 'application/pdf'], maxBytes: 1024 }));

  it('accepts allowed types within the size limit (memory storage)', async () => {
    const res = await request(app)
      .post('/x')
      .attach('file', Buffer.from('%PDF-1.4'), {
        filename: 'a.pdf',
        contentType: 'application/pdf',
      });
    expect(res.status).toBe(200);
    expect(res.body.file).toEqual({ size: 8, mime: 'application/pdf' });
  });

  it('rejects other MIME types with VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post('/x')
      .attach('file', Buffer.from('x'), {
        filename: 'a.exe',
        contentType: 'application/x-msdownload',
      });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects files over the size limit with 413', async () => {
    const res = await request(app)
      .post('/x')
      .attach('file', Buffer.alloc(2048), { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toContain('application/problem+json');
  });
});

describe('checkQuota', () => {
  const entitlements = { limit: async () => 2 } as unknown as Services['entitlements'];

  it('allows below the limit and refuses at the limit with QUOTA_EXCEEDED', async () => {
    const ok = miniApp({ entitlements }, checkQuota('users', { used: () => 1 }));
    expect((await request(ok).post('/x')).status).toBe(200);
    const full = miniApp({ entitlements }, checkQuota('users', { used: () => 2 }));
    const res = await request(full).post('/x');
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      meta: { quota: 'users', limit: 2, used: 2 },
    });
  });

  it('unlimited quota (null) never blocks', async () => {
    const unlimited = { limit: async () => null } as unknown as Services['entitlements'];
    const app = miniApp({ entitlements: unlimited }, checkQuota('units', { used: () => 10_000 }));
    expect((await request(app).post('/x')).status).toBe(200);
  });
});

describe('providers (v1)', () => {
  it('manual payment stays pending validation, fiscal none is not applicable', async () => {
    const intent = await new ManualPaymentProvider().createIntent({
      tenantId: 't',
      reference: 'PAY-1',
      money: { amount: 25_000n, currency: 'XOF' },
      method: 'MIXX',
    });
    expect(intent).toMatchObject({
      provider: 'manual',
      status: 'PENDING_VALIDATION',
      providerRef: 'PAY-1',
    });
    const fiscal = await new NoneFiscalInvoiceProvider().submit({
      tenantId: 't',
      documentType: 'INVOICE',
      number: 'F-1',
      issuedAt: new Date(),
      total: { amount: 1n, currency: 'XOF' },
      payload: {},
    });
    expect(fiscal.status).toBe('NOT_APPLICABLE');
  });

  it('SMS console stub logs without the phone number', async () => {
    const sink = memoryLogs();
    const sms = new ConsoleNotificationProvider(
      'sms',
      createLogger({ transports: [sink.transport] }),
    );
    const r = await sms.send({ to: '+22890123456', text: 'Votre code : 1234' });
    expect(r.accepted).toBe(true);
    expect(sink.lines.length).toBe(1);
    expect(JSON.stringify(sink.lines)).not.toContain('90123456');
  });

  it('Gotenberg renderer posts HTML to the chromium route', async () => {
    let called: { url: string; body: FormData } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      called = { url, body: init.body as FormData };
      return new Response(Buffer.from('%PDF-1.7'), { status: 200 });
    }) as unknown as typeof fetch;
    const pdf = await new GotenbergPdfRenderer('http://gotenberg:3000/', fakeFetch).renderHtml(
      '<h1>Facture</h1>',
    );
    expect(pdf.toString()).toBe('%PDF-1.7');
    expect(called?.url).toBe('http://gotenberg:3000/forms/chromium/convert/html');
    expect(called?.body.get('files')).toBeTruthy();
  });
});
