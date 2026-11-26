import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderDocumentHtml } from '@hm/templates';
import { createApp } from '../src/app.js';
import {
  ManualPaymentProvider,
  NoneFiscalInvoiceProvider,
  ProviderRegistry,
} from '../src/lib/providers/index.js';
import { overrideNotificationDeps } from '../src/modules/notifications/index.js';
import type { NotifyInput } from '../src/modules/notifications/service.js';
import { closeReservationQueues, overrideGuestNotifier } from '../src/modules/reservations/index.js';
import { dueAt, runNightAuditCheck, setNightAuditFault } from '../src/modules/night-audit/index.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import { seedLodging, type LodgingSeed } from './helpers/lodging-seed.js';

let env: TestEnv;
let app: Express;
const sent: NotifyInput[] = [];
const htmls: string[] = [];

const T = '/api/v1/t';
type Method = 'get' | 'post' | 'put';

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

interface Hotel {
  f: TenantFixture;
  s: LodgingSeed;
  tok: string;
  api: (method: Method, path: string, tok?: string) => request.Test;
}

/** A fresh tenant + property per scenario (the business date moves with each audit). */
async function hotel(label: string): Promise<Hotel> {
  const { admin, config } = env.services;
  const f = await createTenantFixture(admin, { label, features: ['lodging.core', 'billing.core'] });
  const s = await seedLodging(admin, f.tenantId, f.propertyId);
  await admin.tax.create({
    data: {
      tenantId: f.tenantId,
      propertyId: f.propertyId,
      code: 'TVA18',
      name: 'TVA 18 %',
      type: 'PERCENT',
      value: '18',
      appliesTo: ['LODGING', 'FOLIO'],
    },
  });
  await admin.tax.create({
    data: {
      tenantId: f.tenantId,
      propertyId: f.propertyId,
      code: 'TS',
      name: 'Taxe de séjour',
      type: 'FIXED_PER_PERSON_NIGHT',
      value: '1000',
      appliesTo: ['LODGING'],
    },
  });
  const tok = await mintToken(config, { sub: f.userId, tid: f.tenantId });
  const api = (method: Method, path: string, t = tok) =>
    request(app)[method](`${T}${path}`).set('Host', f.host).set('Authorization', `Bearer ${t}`);
  return { f, s, tok, api };
}

function nightsOf(arrival: string, departure: string) {
  const out: string[] = [];
  for (let t = Date.parse(arrival); t < Date.parse(departure); t += 86_400_000)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

interface StayOpts {
  arrival?: string;
  departure?: string;
  adults?: number;
  price?: number;
  status?: 'CHECKED_IN' | 'CONFIRMED';
  room?: string | null;
  plan?: 'bar' | 'flex';
}

async function stay(h: Hotel, o: StayOpts = {}) {
  const { admin } = env.services;
  const arrival = o.arrival ?? '2026-11-10';
  const departure = o.departure ?? '2026-11-14';
  const adults = o.adults ?? 2;
  const status = o.status ?? 'CHECKED_IN';
  const price = o.price ?? 30_000;
  const guest = await admin.guest.create({
    data: { tenantId: h.f.tenantId, firstName: 'Ama', lastName: 'Kodjo', email: `ama-${uniq()}@example.com` },
  });
  const r = await admin.reservation.create({
    data: {
      tenantId: h.f.tenantId,
      propertyId: h.f.propertyId,
      number: `RES-${uniq()}`,
      status,
      arrival: new Date(arrival),
      departure: new Date(departure),
      adults,
      bookerGuestId: guest.id,
    },
  });
  const rr = await admin.reservationRoom.create({
    data: {
      tenantId: h.f.tenantId,
      propertyId: h.f.propertyId,
      reservationId: r.id,
      roomTypeId: h.s.std,
      roomId: o.room === null ? null : h.s.rooms[o.room ?? '101']!,
      ratePlanId: o.plan === 'flex' ? h.s.flex : h.s.bar,
      arrival: new Date(arrival),
      departure: new Date(departure),
      adults,
      status,
      dailyPrices: nightsOf(arrival, departure).map((date) => ({
        date,
        rateId: null,
        seasonId: null,
        base: price,
        extraAdultAmount: 0,
        extraChildAmount: 0,
        total: price,
      })),
    },
  });
  await admin.reservationGuest.create({
    data: { tenantId: h.f.tenantId, reservationRoomId: rr.id, guestId: guest.id, isPrimary: true },
  });
  const st =
    status === 'CHECKED_IN'
      ? await admin.stay.create({
          data: { tenantId: h.f.tenantId, propertyId: h.f.propertyId, reservationRoomId: rr.id, checkedInAt: new Date() },
        })
      : null;
  return { reservationId: r.id, number: r.number, rrId: rr.id, stayId: st?.id ?? null };
}

const precheck = async (h: Hotel) => {
  const r = await h.api('get', `/night-audit/precheck?propertyId=${h.f.propertyId}`);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as {
    businessDate: string;
    canRun: boolean;
    closedDate: string | null;
    running: { status: string } | null;
    checks: { code: string; severity: string; count: number; items: Record<string, unknown>[] }[];
  };
};
const check = (p: Awaited<ReturnType<typeof precheck>>, code: string) => p.checks.find((c) => c.code === code)!;

const run = (h: Hotel, body: Record<string, unknown> = {}, tok?: string) =>
  h.api('post', '/night-audit/run', tok).send({ propertyId: h.f.propertyId, businessDate: '2026-11-12', ...body });

const roomLines = async (rrId: string) =>
  env.services.admin.folioLine.findMany({
    where: { sourceType: 'room_night', sourceId: rrId, type: 'ROOM' },
    orderBy: { businessDate: 'asc' },
  });
const day = (d: Date) => d.toISOString().slice(0, 10);

async function folioOf(h: Hotel, rrId: string) {
  const r = await h.api('post', '/folios/resolve').send({ reservationRoomId: rrId });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body as { id: string; balance: number; status: string; lines: { id: string; type: string; businessDate: string; amount: number; label: string; reversalOfId: string | null }[] };
}

beforeAll(async () => {
  overrideNotificationDeps({
    providers: new ProviderRegistry({
      name: 'fake-pdf',
      renderHtml: (html: string) => {
        htmls.push(html);
        return Promise.resolve(Buffer.from('%PDF-1.4 fake'));
      },
    })
      .addPayment(new ManualPaymentProvider())
      .addFiscal(new NoneFiscalInvoiceProvider()),
    storage: {
      put: (i) => Promise.resolve({ key: `t/x/${i.key}`, size: 12 }),
      signedUrl: (k) => Promise.resolve(`https://files.test/${k}?sig=1`),
    },
  });
  overrideGuestNotifier((_s, input) => {
    sent.push(input);
    return Promise.resolve([]);
  });
  env = createTestEnv();
  ({ app } = createApp(env.services));
});

afterEach(() => setNightAuditFault(null));

afterAll(async () => {
  overrideGuestNotifier(null);
  overrideNotificationDeps({});
  if (env) await closeReservationQueues(env.services);
  await env?.close();
});

describe('pre-checks', () => {
  it('detects pending arrivals (with the no-show penalty), departures, cash sessions, credit folios, unassigned stays', async () => {
    const h = await hotel('napc');
    const arr = await stay(h, { status: 'CONFIRMED', arrival: '2026-11-12', departure: '2026-11-14', room: '102' });
    const dep = await stay(h, { arrival: '2026-11-10', departure: '2026-11-12', room: '103' });
    await stay(h, { arrival: '2026-11-11', departure: '2026-11-15', room: null });
    await stay(h, { status: 'CONFIRMED', arrival: '2026-11-13', departure: '2026-11-14', room: '201' }); // tomorrow
    const open = await h.api('post', '/cash-sessions').send({ propertyId: h.f.propertyId, openingFloat: 0 });
    expect(open.status, JSON.stringify(open.body)).toBe(201);
    const credit = await folioOf(h, dep.rrId);
    await h.api('post', `/folios/${credit.id}/payments`).send({ method: 'CARD', amount: 5_000, reference: 'TPE-1' });

    const p = await precheck(h);
    expect(p.businessDate).toBe('2026-11-12');
    expect(p.closedDate).toBeNull();
    const a = check(p, 'PENDING_ARRIVALS');
    expect(a).toMatchObject({ severity: 'DECISION', count: 1 });
    // BAR policy: no-show = 100 % of the stay (2 × 30 000).
    expect(a.items[0]).toMatchObject({ reservationId: arr.reservationId, canNoShow: true, penalty: { amount: 60_000, currency: 'XOF' }, roomNumber: '102' });
    expect(check(p, 'PENDING_DEPARTURES')).toMatchObject({ severity: 'WARNING', count: 1 });
    expect(check(p, 'PENDING_DEPARTURES').items[0]).toMatchObject({ reservationRoomId: dep.rrId, stayId: dep.stayId, balance: -5_000 });
    expect(check(p, 'OPEN_CASH_SESSIONS')).toMatchObject({ severity: 'WARNING', count: 1 });
    expect(check(p, 'NEGATIVE_BALANCES')).toMatchObject({ count: 1, items: [{ folioId: credit.id, balance: -5_000 }] });
    expect(check(p, 'UNASSIGNED_IN_HOUSE').count).toBe(1);
    expect(p.canRun).toBe(true);

    // Settings turn the warnings into blockers.
    const { admin } = env.services;
    for (const key of ['night_audit.cash_sessions_policy', 'night_audit.departures_policy'])
      await admin.setting.create({ data: { tenantId: h.f.tenantId, scope: 'PROPERTY', scopeId: h.f.propertyId, key, value: 'BLOCK' } });
    const blocked = await precheck(h);
    expect(blocked.canRun).toBe(false);
    expect(check(blocked, 'OPEN_CASH_SESSIONS').severity).toBe('BLOCKING');
    const r = await run(h, { decisions: [{ reservationId: arr.reservationId, action: 'KEEP' }] });
    expect(r.status).toBe(409);
    expect(r.body.meta).toMatchObject({ reason: 'PRECHECK_BLOCKED', checks: ['PENDING_DEPARTURES', 'OPEN_CASH_SESSIONS'] });
  });

  it('cross-tenant and permissions: other tenant refused, read-only user cannot run, no permission no pre-check', async () => {
    const h = await hotel('naperm');
    const other = await hotel('naother');
    // RLS: the property of another tenant does not exist for this token.
    const x = await other.api('get', `/night-audit/precheck?propertyId=${h.f.propertyId}`);
    expect(x.status).toBe(404);
    const xr = await other.api('post', '/night-audit/run').send({ propertyId: h.f.propertyId, businessDate: '2026-11-12' });
    expect(xr.status).toBe(404);
    const { admin, config } = env.services;
    const reader = await addUser(admin, h.f.tenantId, ['night_audit.read']);
    const nobody = await addUser(admin, h.f.tenantId, ['folio.read']);
    for (const u of [reader, nobody])
      await admin.userProperty.create({ data: { tenantId: h.f.tenantId, userId: u, propertyId: h.f.propertyId } });
    const tokReader = await mintToken(config, { sub: reader, tid: h.f.tenantId });
    const tokNobody = await mintToken(config, { sub: nobody, tid: h.f.tenantId });
    expect((await h.api('get', `/night-audit/precheck?propertyId=${h.f.propertyId}`, tokReader)).status).toBe(200);
    const denied = await run(h, {}, tokReader);
    expect(denied.status).toBe(403);
    expect(denied.body.meta).toMatchObject({ permission: 'night_audit.run' });
    expect((await h.api('get', `/night-audit/precheck?propertyId=${h.f.propertyId}`, tokNobody)).status).toBe(403);

    // An audit of A is invisible from B.
    const done = await run(h);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect((await other.api('get', `/night-audit/${done.body.audit.id}`)).status).toBe(404);
    expect((await other.api('get', `/night-audit?propertyId=${h.f.propertyId}`)).body.items).toEqual([]);
    expect((await other.api('get', `/night-audit/${done.body.audit.id}/report`)).status).toBe(404);
  });
});

describe('run', () => {
  it('requires a decision per pending arrival; no-show posts the policy penalty once, keep leaves it expected', async () => {
    const h = await hotel('nans');
    const ns = await stay(h, { status: 'CONFIRMED', arrival: '2026-11-12', departure: '2026-11-14', room: '102' });
    const keep = await stay(h, { status: 'CONFIRMED', arrival: '2026-11-12', departure: '2026-11-13', room: '103', plan: 'flex' });
    const missing = await run(h, { decisions: [{ reservationId: ns.reservationId, action: 'NO_SHOW' }] });
    expect(missing.status).toBe(409);
    expect(missing.body.meta).toMatchObject({ reason: 'DECISIONS_REQUIRED', reservationIds: [keep.reservationId] });

    const r = await run(h, {
      decisions: [
        { reservationId: ns.reservationId, action: 'NO_SHOW' },
        { reservationId: keep.reservationId, action: 'KEEP' },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.audit.status).toBe('COMPLETED');
    expect(r.body.audit.steps.find((s: { step: string }) => s.step === 'no_shows').result).toMatchObject({
      noShows: 1,
      kept: 1,
      penaltiesPosted: 1,
      penaltyTotal: 60_000,
    });
    const { admin } = env.services;
    expect((await admin.reservation.findUnique({ where: { id: ns.reservationId } }))?.status).toBe('NO_SHOW');
    expect((await admin.reservation.findUnique({ where: { id: keep.reservationId } }))?.status).toBe('CONFIRMED');
    const pen = await admin.folioLine.findMany({ where: { sourceType: 'no_show', sourceId: ns.rrId } });
    expect(pen.map((l) => [l.type, l.departmentCode, l.amount, day(l.businessDate)])).toEqual([
      ['PENALTY', 'NO_SHOW', 60_000n, '2026-11-12'],
    ]);
    expect(r.body.audit.kpis).toMatchObject({ noShows: 1, revenueByDept: { NO_SHOW: 60_000 } });
  });

  it('posts every in-house night exactly once, even after a failure and a resume or a second run', async () => {
    const h = await hotel('nanights');
    const s1 = await stay(h, { arrival: '2026-11-10', departure: '2026-11-14', room: '101' });
    const s2 = await stay(h, { arrival: '2026-11-12', departure: '2026-11-13', room: '102' });

    setNightAuditFault((step, i) => {
      if (step === 'room_nights' && i === 1) throw new Error('worker crashed');
    });
    const failed = await run(h);
    expect(failed.status).toBe(409);
    expect(failed.body.meta).toMatchObject({ reason: 'NIGHT_AUDIT_FAILED', step: 'room_nights' });
    const p = await precheck(h);
    expect(p.running).toMatchObject({ status: 'FAILED' });
    expect(p.businessDate).toBe('2026-11-12');
    // The first stay got its nights before the failure.
    expect((await roomLines(s1.rrId)).length + (await roomLines(s2.rrId)).length).toBeGreaterThan(0);

    setNightAuditFault((step) => {
      if (step === 'stats') throw new Error('stats down');
    });
    const failed2 = await run(h);
    expect(failed2.body.meta).toMatchObject({ step: 'stats' });
    setNightAuditFault(null);

    const ok = await run(h);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.alreadyCompleted).toBe(false);
    expect(ok.body.audit.steps.every((s: { status: string }) => s.status === 'done')).toBe(true);
    expect((await roomLines(s1.rrId)).map((l) => day(l.businessDate))).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect((await roomLines(s2.rrId)).map((l) => day(l.businessDate))).toEqual(['2026-11-12']);

    // Same business date again: the completed audit is returned, nothing is posted.
    const again = await run(h);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alreadyCompleted: true, audit: { id: ok.body.audit.id } });
    expect(await roomLines(s1.rrId)).toHaveLength(3);

    // Next day: only the night of the 13th is added.
    const next = await run(h, { businessDate: '2026-11-13' });
    expect(next.status, JSON.stringify(next.body)).toBe(200);
    expect((await roomLines(s1.rrId)).map((l) => day(l.businessDate))).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ]);
    const stale = await run(h, { businessDate: '2026-11-20' });
    expect(stale.status).toBe(409);
    expect(stale.body.meta.reason).toBe('BUSINESS_DATE_MISMATCH');
  });

  it('computes the day KPIs and the X13 aggregates (occupancy, ADR, RevPAR, departments, taxes, payments)', async () => {
    const h = await hotel('nastats');
    const { admin } = env.services;
    const a = await stay(h, { arrival: '2026-11-12', departure: '2026-11-14', adults: 2, price: 30_000, room: '101' });
    const b = await stay(h, { arrival: '2026-11-11', departure: '2026-11-13', adults: 1, price: 40_000, room: '102' });
    // Room 301 is out of order tonight: 4 rooms available.
    await admin.roomBlock.create({
      data: { tenantId: h.f.tenantId, roomId: h.s.rooms['301']!, fromDate: new Date('2026-11-12'), toDate: new Date('2026-11-14'), reason: 'MAINTENANCE' },
    });
    const fa = await folioOf(h, a.rrId);
    const water = await admin.product.create({
      data: { tenantId: h.f.tenantId, propertyId: h.f.propertyId, name: 'Eau', price: 1_500n, departmentCode: 'MINIBAR' },
    });
    const c = await h.api('post', `/folios/${fa.id}/charges`).send({ productId: water.id, qty: 2 });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    for (const [method, amount, reference] of [
      ['CARD', 20_000, 'TPE-9'],
      ['MIXX', 10_000, 'MX12345678'],
    ] as const) {
      const p = await h.api('post', `/folios/${fa.id}/payments`).send({ method, amount, reference });
      expect(p.status, JSON.stringify(p.body)).toBe(201);
    }

    const r = await run(h);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const k = r.body.audit.kpis;
    // Nights of the 12th: 30 000 + 40 000 ; the 11th of stay b is another day.
    expect(k).toMatchObject({
      businessDate: '2026-11-12',
      roomsAvailable: 4,
      roomsSold: 2,
      occupancy: '50.0',
      occupancyBp: 5_000,
      roomRevenue: 70_000,
      adr: 35_000,
      revpar: 17_500,
      revenueByDept: { ROOM: 70_000, MINIBAR: 3_000 },
      totalRevenue: 73_000,
      vatTotal: 12_600,
      touristTaxTotal: 3_000,
      payments: [
        { method: 'CARD', amount: 20_000 },
        { method: 'MIXX', amount: 10_000 },
      ],
      paymentsTotal: 30_000,
      arrivals: 2,
      departures: 0,
      inHouse: 2,
      noShows: 0,
    });
    expect(k.taxes).toEqual([
      { code: 'TVA18', name: 'TVA 18 %', kind: 'VAT', amount: 12_600 },
      { code: 'TS', name: 'Taxe de séjour', kind: 'TOURIST', amount: 3_000 },
    ]);
    const dsp = await admin.dailyStatsProperty.findUnique({
      where: { propertyId_businessDate: { propertyId: h.f.propertyId, businessDate: new Date('2026-11-12') } },
    });
    expect(dsp).toMatchObject({ occupied: 2, available: 4, revenueRoom: 70_000n, adr: 35_000n, revpar: 17_500n, revenueByDept: { ROOM: 70_000, MINIBAR: 3_000 } });
    // SCH-2: every KPI is a column; the audit DTO reads them back (not from the summary JSON).
    expect(dsp).toMatchObject({
      revenueTotal: 73_000n,
      vatTotal: 12_600n,
      touristTaxTotal: 3_000n,
      paymentsTotal: 30_000n,
      paymentsByMethod: [
        { method: 'CARD', amount: 20_000 },
        { method: 'MIXX', amount: 10_000 },
      ],
      arrivals: 2,
      departures: 0,
      inHouse: 2,
      noShows: 0,
    });
    const auditRow = await admin.nightAudit.findUniqueOrThrow({ where: { id: r.body.audit.id } });
    expect(auditRow.lockedAt).toBeTruthy();
    expect(Object.keys(auditRow.summary as object)).not.toContain('kpis');
    await admin.dailyStatsProperty.update({ where: { id: dsp!.id }, data: { vatTotal: 12_601n } });
    const reread = await h.api('get', `/night-audit/${r.body.audit.id}`);
    expect(reread.body.kpis.vatTotal).toBe(12_601);
    await admin.dailyStatsProperty.update({ where: { id: dsp!.id }, data: { vatTotal: 12_600n } });
    // The closed day is final: properties.closed_through_date, enforced by the database too.
    const prop = await admin.property.findUniqueOrThrow({ where: { id: h.f.propertyId } });
    expect(day(prop.closedThroughDate!)).toBe('2026-11-12');
    await expect(
      admin.folioLine.create({
        data: {
          tenantId: h.f.tenantId,
          propertyId: h.f.propertyId,
          folioId: fa.id,
          businessDate: new Date('2026-11-12'),
          type: 'EXTRA',
          label: 'Tardif',
          unitAmount: 1n,
          amount: 1n,
        },
      }),
    ).rejects.toThrow(/is closed/);
    const dsd = await admin.dailyStatsDepartment.findMany({
      where: { propertyId: h.f.propertyId, businessDate: new Date('2026-11-12') },
      orderBy: { departmentCode: 'asc' },
    });
    expect(dsd.map((d) => [d.departmentCode, d.revenue])).toEqual([
      ['MINIBAR', 3_000n],
      ['ROOM', 70_000n],
    ]);
    expect((await roomLines(b.rrId)).map((l) => day(l.businessDate))).toEqual(['2026-11-11', '2026-11-12']);

    // Report: rendered and downloadable; the manager is notified (in-app + e-mail).
    expect(r.body.audit.reportFileId).toBeTruthy();
    const html = htmls.find((x) => x.includes('RAPPORT DE CLÔTURE JOURNALIÈRE') && x.includes('Property nastats'));
    expect(html).toBeTruthy();
    expect(html).toContain('50.0 %');
    expect(html).toContain('Mixx by Yas');
    expect(html).toContain('Taxe de séjour');
    const pdf = await h.api('get', `/night-audit/${r.body.audit.id}/report`);
    expect(pdf.status).toBe(200);
    expect(pdf.body.url).toContain('documents/night_audit_report/');
    const notice = sent.find((n) => n.templateCode === 'night_audit_completed' && n.userId === h.f.userId);
    expect(notice).toMatchObject({ channels: ['in_app', 'email'], link: '/night-audit' });
    expect(notice?.data.audit).toMatchObject({ businessDate: '2026-11-12', occupancy: '50.0' });
    const hist = await h.api('get', `/night-audit?propertyId=${h.f.propertyId}`);
    expect(hist.body.items.map((i: { businessDate: string; status: string }) => [i.businessDate, i.status])).toEqual([
      ['2026-11-12', 'COMPLETED'],
    ]);
  });

  it('locks the closed day: no posting dated ≤ closed date, reversals go in the open day, business date advanced', async () => {
    const h = await hotel('nalock');
    const s1 = await stay(h, { arrival: '2026-11-11', departure: '2026-11-15', room: '101' });
    expect((await run(h)).status).toBe(200);
    const bd = await h.api('get', `/business-date?propertyId=${h.f.propertyId}`);
    expect(bd.body.businessDate).toBe('2026-11-13');
    expect((await precheck(h)).closedDate).toBe('2026-11-12');

    // A late check-in of a closed day: its old night cannot be posted any more.
    const late = await stay(h, { arrival: '2026-11-12', departure: '2026-11-15', room: '102' });
    const old = await h.api('post', '/folios/room-nights').send({ reservationRoomId: late.rrId, businessDate: '2026-11-12' });
    expect(old.status).toBe(409);
    expect(old.body.meta).toMatchObject({ reason: 'DAY_CLOSED', closedDate: '2026-11-12' });
    // Up-to skips the closed night and posts the open one only.
    const upTo = await h.api('post', '/folios/room-nights/up-to').send({ reservationRoomId: late.rrId, upTo: '2026-11-13' });
    expect(upTo.body.items.map((i: { date: string }) => i.date)).toEqual(['2026-11-13']);
    // Already posted nights stay idempotent.
    const again = await h.api('post', '/folios/room-nights').send({ reservationRoomId: s1.rrId, businessDate: '2026-11-12' });
    expect(again.body.posted).toBe(false);

    // Correction of a closed-day line: a reversal dated in the open day.
    const folio = await folioOf(h, s1.rrId);
    const closedLine = folio.lines.find((l) => l.type === 'ROOM' && l.businessDate === '2026-11-12')!;
    const rev = await h.api('post', `/folios/${folio.id}/lines/${closedLine.id}/reverse`).send({ reason: 'Erreur de tarif' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    const after = await folioOf(h, s1.rrId);
    expect(after.lines.filter((l) => l.reversalOfId === closedLine.id).map((l) => l.businessDate)).toEqual(['2026-11-13']);
    // New charges are dated in the open day.
    const charge = await h.api('post', `/folios/${folio.id}/charges`).send({ qty: 1, amount: 2_000, label: 'Blanchisserie', departmentCode: 'LAUNDRY' });
    expect(charge.status, JSON.stringify(charge.body)).toBe(201);
    // The business date cannot go back into a closed day.
    const back = await h.api('put', '/business-date').send({ propertyId: h.f.propertyId, businessDate: '2026-11-12' });
    expect(back.status).toBe(409);
    expect(back.body.meta.reason).toBe('DAY_CLOSED');
  });

  it('runs one audit at a time per property: concurrent runs close the day once', async () => {
    const h = await hotel('naconc');
    await stay(h, { arrival: '2026-11-11', departure: '2026-11-14', room: '101' });
    const res = await Promise.all([run(h), run(h), run(h)]);
    const ok = res.filter((r) => r.status === 200 && r.body.alreadyCompleted === false);
    expect(ok).toHaveLength(1);
    for (const r of res)
      if (r !== ok[0])
        expect(r.status === 409 ? r.body.meta.reason : r.body.alreadyCompleted).toSatisfy(
          (v: unknown) => v === 'NIGHT_AUDIT_RUNNING' || v === true,
        );
    const { admin } = env.services;
    expect(await admin.nightAudit.count({ where: { propertyId: h.f.propertyId } })).toBe(1);
    const p = await admin.property.findUnique({ where: { id: h.f.propertyId } });
    expect(day(p!.businessDate)).toBe('2026-11-13');
  });
});

describe('automatic audit (night_audit.auto)', () => {
  it('is due at the local time, runs when the pre-checks do not block, otherwise notifies the managers', async () => {
    expect(dueAt('2026-11-12', { time: '03:00' }, 'Africa/Lome').toISOString()).toBe('2026-11-13T03:00:00.000Z');
    expect(dueAt('2026-11-12', { time: '23:30' }, 'Europe/Paris').toISOString()).toBe('2026-11-12T22:30:00.000Z');

    const { admin } = env.services;
    const go = await hotel('naauto');
    const held = await hotel('naheld');
    await stay(go, { arrival: '2026-11-11', departure: '2026-11-14', room: '101' });
    const kept = await stay(go, { status: 'CONFIRMED', arrival: '2026-11-12', departure: '2026-11-13', room: '102' });
    await stay(held, { status: 'CONFIRMED', arrival: '2026-11-12', departure: '2026-11-13', room: '102' });
    for (const [h, pendingArrivals] of [
      [go, 'KEEP'],
      [held, 'BLOCK'],
    ] as const)
      await admin.setting.create({
        data: {
          tenantId: h.f.tenantId,
          scope: 'PROPERTY',
          scopeId: h.f.propertyId,
          key: 'night_audit.auto',
          value: { enabled: true, time: '03:00', pendingArrivals },
        },
      });
    const mine = (o: { propertyId: string }[]) =>
      o.filter((x) => x.propertyId === go.f.propertyId || x.propertyId === held.f.propertyId);

    // 02:00 in Lomé: not due yet.
    expect(mine(await runNightAuditCheck(env.services, new Date('2026-11-13T02:00:00Z')))).toEqual([]);
    const out = mine(await runNightAuditCheck(env.services, new Date('2026-11-13T03:05:00Z')));
    expect(out).toEqual(
      expect.arrayContaining([
        { propertyId: go.f.propertyId, businessDate: '2026-11-12', outcome: 'completed' },
        { propertyId: held.f.propertyId, businessDate: '2026-11-12', outcome: 'blocked', reasons: ['PENDING_ARRIVALS'] },
      ]),
    );
    const audit = await admin.nightAudit.findFirst({ where: { propertyId: go.f.propertyId } });
    expect(audit).toMatchObject({ status: 'COMPLETED', startedBy: null });
    expect(audit?.summary).toMatchObject({ trigger: 'auto', decisions: [{ reservationId: kept.reservationId, action: 'KEEP' }] });
    expect(day((await admin.property.findUnique({ where: { id: go.f.propertyId } }))!.businessDate)).toBe('2026-11-13');
    expect(day((await admin.property.findUnique({ where: { id: held.f.propertyId } }))!.businessDate)).toBe('2026-11-12');
    const blocked = sent.find((n) => n.templateCode === 'night_audit_blocked' && n.tenantId === held.f.tenantId);
    expect(blocked?.data.audit).toMatchObject({ businessDate: '2026-11-12', reasons: 'PENDING_ARRIVALS' });
    // Next tick for the new date (13th) is not due before the 14th, 03:00.
    expect(mine(await runNightAuditCheck(env.services, new Date('2026-11-13T04:00:00Z'))).map((o) => o.propertyId)).toEqual([
      held.f.propertyId,
    ]);
  });
});

describe('folio follow-ups', () => {
  it('an interim invoice keeps the folio open: later nights are posted; the final invoice closes it', async () => {
    const h = await hotel('naint');
    const s1 = await stay(h, { arrival: '2026-11-10', departure: '2026-11-14', room: '101' });
    const upTo = await h.api('post', '/folios/room-nights/up-to').send({ reservationRoomId: s1.rrId, upTo: '2026-11-11' });
    expect(upTo.status).toBe(200);
    let f = await folioOf(h, s1.rrId);
    await h.api('post', `/folios/${f.id}/payments`).send({ method: 'CARD', amount: f.balance, reference: 'TPE-A' });
    const interim = await h.api('post', '/invoices').send({ folioId: f.id });
    expect(interim.status, JSON.stringify(interim.body)).toBe(201);
    expect(interim.body).toMatchObject({ documentKind: 'INTERIM', totals: { stay: { nights: 4, invoicedNights: 2 } } });
    f = await folioOf(h, s1.rrId);
    expect(f.status).toBe('OPEN');
    // The night audit posts the next night on the same folio.
    expect((await run(h)).status).toBe(200);
    f = await folioOf(h, s1.rrId);
    expect(f.lines.filter((l) => l.type === 'ROOM').map((l) => l.businessDate)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    await h.api('post', `/folios/${f.id}/payments`).send({ method: 'CARD', amount: f.balance, reference: 'TPE-B' });
    await env.services.admin.reservationRoom.update({ where: { id: s1.rrId }, data: { status: 'CHECKED_OUT' } });
    const final = await h.api('post', '/invoices').send({ folioId: f.id });
    expect(final.status, JSON.stringify(final.body)).toBe(201);
    expect(final.body.totals.interim).toBeUndefined();
    expect(final.body.totals.lines.map((l: { nightDate?: string }) => l.nightDate)).toEqual(['2026-11-12']);
    expect((await folioOf(h, s1.rrId)).status).toBe('CLOSED');
  });

  it('a final invoice after interim invoices covering everything closes the folio without a new document', async () => {
    const h = await hotel('nafin');
    const s1 = await stay(h, { arrival: '2026-11-10', departure: '2026-11-12', room: '101' });
    await h.api('post', '/folios/room-nights/up-to').send({ reservationRoomId: s1.rrId, upTo: '2026-11-11' });
    let f = await folioOf(h, s1.rrId);
    await h.api('post', `/folios/${f.id}/payments`).send({ method: 'CARD', amount: f.balance, reference: 'TPE-C' });
    const interim = await h.api('post', '/invoices').send({ folioId: f.id });
    await env.services.admin.reservationRoom.update({ where: { id: s1.rrId }, data: { status: 'CHECKED_OUT' } });
    const final = await h.api('post', '/invoices').send({ folioId: f.id });
    expect(final.body.id).toBe(interim.body.id);
    f = await folioOf(h, s1.rrId);
    expect(f.status).toBe('CLOSED');
    expect(await env.services.admin.invoice.count({ where: { folioId: f.id } })).toBe(1);
  });

  it('formats the night of room lines per locale at render time (dd/mm/yyyy in French)', async () => {
    const h = await hotel('nadate');
    const s1 = await stay(h, { arrival: '2026-11-10', departure: '2026-11-12', room: '101' });
    await h.api('post', '/folios/room-nights/up-to').send({ reservationRoomId: s1.rrId, upTo: '2026-11-11' });
    const f = await folioOf(h, s1.rrId);
    // The stored label carries no ISO date any more.
    expect(f.lines.filter((l) => l.type === 'ROOM').every((l) => !/\d{4}-\d{2}-\d{2}/.test(l.label))).toBe(true);
    await h.api('post', `/folios/${f.id}/payments`).send({ method: 'CARD', amount: f.balance, reference: 'TPE-D' });
    const before = htmls.length;
    const inv = await h.api('post', '/invoices').send({ folioId: f.id });
    expect(inv.status).toBe(201);
    const lines = inv.body.totals.lines as { description: string; nightDate: string }[];
    expect(lines.map((l) => l.nightDate)).toEqual(['2026-11-10', '2026-11-11']);
    const html = htmls.slice(before).join('');
    expect(html).toContain('Hébergement Type STD — ch. 101 — nuit du 10/11/2026');
    expect(html).toContain('nuit du 11/11/2026');
    expect(html).not.toContain('nuit du 2026-11-10');
    // English rendering of the same data.
    const en = renderDocumentHtml(
      'invoice',
      {
        number: 'X',
        issuedOn: '2026-11-12',
        seller: { name: 'H' },
        buyer: { name: 'B' },
        lines: [{ description: lines[0]!.description, nightDate: lines[0]!.nightDate, quantity: 1, unitPrice: { amount: 1, currency: 'XOF' }, net: { amount: 1, currency: 'XOF' }, taxRate: '18' }],
        taxBreakdown: [],
        totalNet: { amount: 1, currency: 'XOF' },
        totalTax: { amount: 0, currency: 'XOF' },
        totalGross: { amount: 1, currency: 'XOF' },
      },
      {},
      'en',
    );
    expect(en).toContain('night of 2026-11-10');
  });
});
