import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import {
  ManualPaymentProvider,
  NoneFiscalInvoiceProvider,
  ProviderRegistry,
} from '../src/lib/providers/index.js';
import { overrideNotificationDeps } from '../src/modules/notifications/index.js';
import type { NotifyInput } from '../src/modules/notifications/service.js';
import { closeReservationQueues, overrideGuestNotifier } from '../src/modules/reservations/index.js';
import { createTestEnv, mintToken, type TestEnv } from './helpers/env.js';
import { addUser, createTenantFixture, type TenantFixture } from './helpers/fixtures.js';
import { seedLodging, type LodgingSeed } from './helpers/lodging-seed.js';

let env: TestEnv;
let app: Express;
let A: TenantFixture;
let B: TenantFixture;
let SA: LodgingSeed;
let SB: LodgingSeed;
let tokA: string;
let tokB: string;
let tokCashier: string;
let tokReader: string;
let cashierId: string;
let tvaA: string;
let productA: string;
const sent: NotifyInput[] = [];
const htmls: string[] = [];
const stored: { key: string; contentType: string }[] = [];

const T = '/api/v1/t';
type Method = 'get' | 'post' | 'put' | 'delete';
const api = (method: Method, path: string, tok = tokA, f: TenantFixture = A) =>
  request(app)[method](`${T}${path}`).set('Host', f.host).set('Authorization', `Bearer ${tok}`);

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

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
  children?: number;
  price?: number;
  status?: 'CHECKED_IN' | 'CONFIRMED';
  stay?: boolean;
  f?: TenantFixture;
  s?: LodgingSeed;
}

/** A stay written directly (in-house stays of the seeds may have no `stays` row). */
async function stayFixture(o: StayOpts = {}) {
  const f = o.f ?? A;
  const s = o.s ?? SA;
  const arrival = o.arrival ?? '2026-11-10';
  const departure = o.departure ?? '2026-11-14';
  const adults = o.adults ?? 2;
  const children = o.children ?? 0;
  const status = o.status ?? 'CHECKED_IN';
  const price = o.price ?? 30_000;
  const { admin } = env.services;
  const guest = await admin.guest.create({
    data: { tenantId: f.tenantId, firstName: 'Kofi', lastName: 'Agbeko', email: 'kofi@example.com' },
  });
  const r = await admin.reservation.create({
    data: {
      tenantId: f.tenantId,
      propertyId: f.propertyId,
      number: `RES-${uniq()}`,
      status,
      arrival: new Date(arrival),
      departure: new Date(departure),
      adults,
      children,
      bookerGuestId: guest.id,
    },
  });
  const rr = await admin.reservationRoom.create({
    data: {
      tenantId: f.tenantId,
      propertyId: f.propertyId,
      reservationId: r.id,
      roomTypeId: s.std,
      roomId: s.rooms['101']!,
      ratePlanId: s.bar,
      arrival: new Date(arrival),
      departure: new Date(departure),
      adults,
      children,
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
    data: { tenantId: f.tenantId, reservationRoomId: rr.id, guestId: guest.id, isPrimary: true },
  });
  const stay =
    o.stay === false || status !== 'CHECKED_IN'
      ? null
      : await admin.stay.create({
          data: {
            tenantId: f.tenantId,
            propertyId: f.propertyId,
            reservationRoomId: rr.id,
            checkedInAt: new Date(),
          },
        });
  return { reservationId: r.id, number: r.number, rrId: rr.id, guestId: guest.id, stayId: stay?.id ?? null };
}

const postNight = (rrId: string, businessDate: string, tok = tokA, f: TenantFixture = A) =>
  api('post', '/folios/room-nights', tok, f).send({ reservationRoomId: rrId, businessDate });
const resolve = async (body: Record<string, string>, tok = tokA) => {
  const res = await api('post', '/folios/resolve', tok).send(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as FolioBody;
};
const getFolio = async (id: string, tok = tokA) => {
  const res = await api('get', `/folios/${id}`, tok);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as FolioBody;
};
const pay = (folioId: string, body: Record<string, unknown>, tok = tokA) =>
  api('post', `/folios/${folioId}/payments`, tok).send(body);

interface LineBody {
  id: string;
  type: string;
  amount: number;
  qty: number;
  departmentCode: string | null;
  sourceType: string | null;
  sourceId: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  businessDate: string;
}
interface FolioBody {
  id: string;
  number: string;
  status: string;
  balance: number;
  stayId: string | null;
  kind: string;
  reservationRoomId: string | null;
  lines: LineBody[];
  payments: { id: string; method: string; amount: number; status: string; isDeposit: boolean }[];
  taxBreakdown: { net: number; percentTax: number; fixedTax: number; rows: { code: string; rate: string | null; base: number; amount: number }[] };
}

/** In-house stay with the first night posted (30 000 + TVA 5 400 + taxe de séjour 2 000). */
async function stayWithNight(o: StayOpts = {}) {
  const st = await stayFixture(o);
  const f = o.f ?? A;
  const r = await postNight(st.rrId, o.arrival ?? '2026-11-10', f === A ? tokA : tokB, f);
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return { ...st, folioId: r.body.folioId as string, roomLineId: r.body.lineId as string };
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
      put: (i) => {
        const key = `t/x/${i.key}`;
        stored.push({ key, contentType: i.contentType });
        return Promise.resolve({ key, size: 12 });
      },
      signedUrl: (k) => Promise.resolve(`https://files.test/${k}?sig=1`),
    },
  });
  overrideGuestNotifier((_s, input) => {
    sent.push(input);
    return Promise.resolve([]);
  });
  env = createTestEnv();
  ({ app } = createApp(env.services));
  const { admin, config } = env.services;
  A = await createTenantFixture(admin, { label: 'fa', features: ['lodging.core', 'billing.core', 'city_ledger'] });
  B = await createTenantFixture(admin, { label: 'fb', features: ['lodging.core', 'billing.core'] });
  SA = await seedLodging(admin, A.tenantId, A.propertyId);
  SB = await seedLodging(admin, B.tenantId, B.propertyId);
  for (const f of [A, B]) {
    const tva = await admin.tax.create({
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
    if (f === A) tvaA = tva.id;
  }
  productA = (
    await admin.product.create({
      data: {
        tenantId: A.tenantId,
        propertyId: A.propertyId,
        name: 'Eau minérale',
        price: 1_500n,
        taxId: tvaA,
        departmentCode: 'MINIBAR',
      },
    })
  ).id;
  tokA = await mintToken(config, { sub: A.userId, tid: A.tenantId });
  tokB = await mintToken(config, { sub: B.userId, tid: B.tenantId });
  cashierId = await addUser(admin, A.tenantId, [
    'folio.read',
    'folio.post',
    'folio.pay',
    'cash.session',
    'cash.movements',
    'cash.close',
    'invoices.read',
    'invoices.issue',
  ]);
  const reader = await addUser(admin, A.tenantId, ['folio.read']);
  for (const u of [cashierId, reader])
    await admin.userProperty.create({ data: { tenantId: A.tenantId, userId: u, propertyId: A.propertyId } });
  tokCashier = await mintToken(config, { sub: cashierId, tid: A.tenantId });
  tokReader = await mintToken(config, { sub: reader, tid: A.tenantId });
});

afterAll(async () => {
  overrideGuestNotifier(null);
  overrideNotificationDeps({});
  if (env) await closeReservationQueues(env.services);
  await env?.close();
});

describe('room nights', () => {
  it('posts a night once (idempotent, also under concurrency) with TVA and taxe de séjour per person-night', async () => {
    const st = await stayFixture({ adults: 2, children: 1 });
    const r1 = await postNight(st.rrId, '2026-11-10');
    expect(r1.status, JSON.stringify(r1.body)).toBe(200);
    expect(r1.body.posted).toBe(true);
    const r2 = await postNight(st.rrId, '2026-11-10');
    expect(r2.body).toMatchObject({ posted: false, lineId: r1.body.lineId });

    const many = await Promise.all([1, 2, 3].map(() => postNight(st.rrId, '2026-11-11')));
    expect(many.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(many.filter((r) => r.body.posted)).toHaveLength(1);

    const f = await getFolio(r1.body.folioId);
    expect(f.number).toBe(`${st.number}-1-1`);
    expect(f.stayId).toBe(st.stayId);
    expect(f.kind).toBe('STAY');
    expect(f.reservationRoomId).toBe(st.rrId);
    const night = f.lines.filter((l) => l.businessDate === '2026-11-10');
    expect(night.map((l) => [l.type, l.departmentCode, l.qty, l.amount])).toEqual([
      ['ROOM', 'ROOM', 1, 30_000],
      ['TAX', 'TVA18', 1, 5_400],
      ['TAX', 'TS', 3, 3_000],
    ]);
    expect(f.balance).toBe(2 * 38_400);
    expect(f.taxBreakdown.rows).toEqual([
      expect.objectContaining({ code: 'TVA18', rate: '18', base: 60_000, amount: 10_800 }),
      expect.objectContaining({ code: 'TS', rate: null, base: 60_000, amount: 6_000 }),
    ]);
  });

  it('extracts an inclusive VAT from the nightly price', async () => {
    const st = await stayFixture();
    await env.services.admin.tax.update({ where: { id: tvaA }, data: { inclusive: true } });
    try {
      const r = await postNight(st.rrId, '2026-11-12');
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      const f = await getFolio(r.body.folioId);
      expect(f.lines.map((l) => [l.type, l.amount])).toEqual([
        ['ROOM', 25_424],
        ['TAX', 4_576],
        ['TAX', 2_000],
      ]);
      expect(f.balance).toBe(32_000);
    } finally {
      await env.services.admin.tax.update({ where: { id: tvaA }, data: { inclusive: false } });
    }
  });

  it('refuses a night outside the stay or a stay not in house', async () => {
    const st = await stayFixture();
    const out = await postNight(st.rrId, '2026-11-14');
    expect(out.status).toBe(422);
    const conf = await stayFixture({ status: 'CONFIRMED', arrival: '2026-11-20', departure: '2026-11-22' });
    const r = await postNight(conf.rrId, '2026-11-20');
    expect(r.status).toBe(409);
    expect(r.body.meta.reason).toBe('NOT_IN_HOUSE');
  });

  it('postNightsUpTo posts every missing night up to the date', async () => {
    const st = await stayFixture({ stay: false });
    const r = await api('post', '/folios/room-nights/up-to').send({ reservationRoomId: st.rrId, upTo: '2026-11-20' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items.map((i: { date: string }) => i.date)).toEqual([
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
    ]);
    // No `stays` row (seeded in-house stays): the folio is linked by its number.
    const f = await getFolio(r.body.items[0].folioId);
    expect(f.stayId).toBeNull();
    expect(f.reservationRoomId).toBe(st.rrId);
  });
});

describe('charges, discounts and reversals', () => {
  it('posts products and manual charges with their taxes', async () => {
    const st = await stayWithNight();
    const p = await api('post', `/folios/${st.folioId}/charges`).send({ productId: productA, qty: 2 });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    const lines = (p.body.folio as FolioBody).lines.filter((l) => l.sourceId === p.body.lineId || l.id === p.body.lineId);
    expect(lines.map((l) => [l.type, l.departmentCode, l.amount])).toEqual([
      ['EXTRA', 'MINIBAR', 3_000],
      ['TAX', 'TVA18', 540],
    ]);
    const m = await api('post', `/folios/${st.folioId}/charges`, tokCashier).send({
      amount: 5_000,
      label: 'Blanchisserie',
      departmentCode: 'LAUNDRY',
      taxIds: [tvaA],
    });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    expect(m.body.folio.balance).toBe(37_400 + 3_540 + 5_900);
    const bad = await api('post', `/folios/${st.folioId}/charges`).send({ amount: 100, label: 'X' });
    expect(bad.status).toBe(422);
    const denied = await api('post', `/folios/${st.folioId}/charges`, tokReader).send({ productId: productA });
    expect(denied.status).toBe(403);
  });

  it('discounts a charge (permission folio.discount) and reduces its VAT', async () => {
    const st = await stayWithNight();
    const body = { lineId: st.roomLineId, percent: 10, reason: 'Geste commercial' };
    const denied = await api('post', `/folios/${st.folioId}/discounts`, tokCashier).send(body);
    expect(denied.status).toBe(403);
    expect(denied.body.meta.permission).toBe('folio.discount');
    const d = await api('post', `/folios/${st.folioId}/discounts`).send(body);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const f = d.body.folio as FolioBody;
    const disc = f.lines.filter((l) => l.id === d.body.lineId || l.sourceId === d.body.lineId);
    expect(disc.map((l) => [l.type, l.amount])).toEqual([
      ['DISCOUNT', -3_000],
      ['TAX', -540],
    ]);
    expect(f.balance).toBe(37_400 - 3_540);
    expect(f.taxBreakdown.rows.find((r) => r.code === 'TVA18')).toMatchObject({ base: 27_000, amount: 4_860 });
    const tooBig = await api('post', `/folios/${st.folioId}/discounts`).send({ lineId: st.roomLineId, amount: 40_000, reason: 'Trop' });
    expect(tooBig.status).toBe(422);
    const noReason = await api('post', `/folios/${st.folioId}/discounts`).send({ lineId: st.roomLineId, amount: 10 });
    expect(noReason.status).toBe(422);
  });

  it('corrects only by reversal (folio.reverse, reason), never twice, never a tax line alone', async () => {
    const st = await stayWithNight();
    const p = await api('post', `/folios/${st.folioId}/charges`).send({ productId: productA, qty: 1 });
    const lineId = p.body.lineId as string;
    const denied = await api('post', `/folios/${st.folioId}/lines/${lineId}/reverse`, tokCashier).send({ reason: 'Erreur de saisie' });
    expect(denied.status).toBe(403);
    const r = await api('post', `/folios/${st.folioId}/lines/${lineId}/reverse`).send({ reason: 'Erreur de saisie' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.reversalLineIds).toHaveLength(2);
    expect(r.body.folio.balance).toBe(37_400);
    const again = await api('post', `/folios/${st.folioId}/lines/${lineId}/reverse`).send({ reason: 'Encore' });
    expect(again.status).toBe(409);
    const f = r.body.folio as FolioBody;
    const tax = f.lines.find((l) => l.type === 'TAX' && l.sourceId === st.roomLineId)!;
    expect((await api('post', `/folios/${st.folioId}/lines/${tax.id}/reverse`).send({ reason: 'Taxe' })).status).toBe(409);
    const rev = r.body.reversalLineIds[0] as string;
    expect((await api('post', `/folios/${st.folioId}/lines/${rev}/reverse`).send({ reason: 'Rev' })).status).toBe(409);

    // Reversing the room night also reverses its taxes and discounts; the night can be posted again.
    await api('post', `/folios/${st.folioId}/discounts`).send({ lineId: st.roomLineId, amount: 1_180, reason: 'Remise' });
    const rr = await api('post', `/folios/${st.folioId}/lines/${st.roomLineId}/reverse`).send({ reason: 'Mauvais tarif' });
    expect(rr.status, JSON.stringify(rr.body)).toBe(201);
    expect(rr.body.reversalLineIds).toHaveLength(5);
    expect(rr.body.folio.balance).toBe(0);
    const again2 = await postNight(st.rrId, '2026-11-10');
    expect(again2.body.posted).toBe(true);
    // Direct UPDATE is refused by the immutability trigger.
    await expect(
      env.services.admin.folioLine.update({ where: { id: st.roomLineId }, data: { amount: 1n } }),
    ).rejects.toThrow();
  });

  it('splits charges: moves lines to another folio by reversal + repost', async () => {
    const st = await stayWithNight();
    const split = await api('post', '/folios').send({ reservationRoomId: st.rrId });
    expect(split.status, JSON.stringify(split.body)).toBe(201);
    expect(split.body.number).toBe(`${st.number}-1-2`);
    await api('post', `/folios/${st.folioId}/charges`).send({ amount: 5_000, label: 'Divers', departmentCode: 'EXTRA' });
    await api('post', `/folios/${st.folioId}/discounts`).send({ lineId: st.roomLineId, amount: 3_540, reason: 'Remise' });
    const mv = await api('post', `/folios/${st.folioId}/lines/move`).send({
      lineIds: [st.roomLineId],
      targetFolioId: split.body.id,
      reason: 'Hébergement payé par la société',
    });
    expect(mv.status, JSON.stringify(mv.body)).toBe(200);
    expect(mv.body.folio.balance).toBe(5_000);
    const target = await getFolio(split.body.id);
    expect(target.balance).toBe(37_400 - 3_540);
    expect(target.lines.map((l) => l.type).sort()).toEqual(['DISCOUNT', 'ROOM', 'TAX', 'TAX', 'TAX']);
    const room = target.lines.find((l) => l.type === 'ROOM')!;
    expect(target.lines.filter((l) => l.sourceId === room.id).length).toBe(3);
    // The night is still posted (now on the split folio).
    const again = await postNight(st.rrId, '2026-11-10');
    expect(again.body).toMatchObject({ posted: false, folioId: split.body.id });
    const list = await api('get', '/folios').query({ reservationRoomId: st.rrId });
    expect(list.body.items).toHaveLength(2);
  });
});

describe('guest payments', () => {
  it('records card / mobile money payments, rejects a duplicate reference per method', async () => {
    const st = await stayWithNight();
    const c = await pay(st.folioId, { method: 'CARD', amount: 10_000, reference: `TPE-${st.number}` });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body.folio.balance).toBe(27_400);
    const other = await stayWithNight();
    const dup = await pay(other.folioId, { method: 'CARD', amount: 1_000, reference: `TPE-${st.number}` });
    expect(dup.status).toBe(409);
    expect(dup.body.meta.reason).toBe('DUPLICATE_REFERENCE');
    const mixx = await pay(other.folioId, { method: 'MIXX', amount: 5_000, reference: `TPE-${st.number}` });
    expect(mixx.status, JSON.stringify(mixx.body)).toBe(201);
    const nothing = await pay(other.folioId, { method: 'CARD' });
    expect(nothing.status).toBe(422);
  });

  it('requires an open cash session for cash, gates loyalty points, replays an Idempotency-Key', async () => {
    const st = await stayWithNight();
    const cash = await pay(st.folioId, { method: 'CASH', amount: 1_000 });
    expect(cash.status).toBe(412);
    expect(cash.body.meta.reason).toBe('NO_OPEN_CASH_SESSION');
    const loyalty = await pay(st.folioId, { method: 'LOYALTY_POINTS', amount: 1_000 });
    expect(loyalty.status).toBe(402);
    expect(loyalty.body.code).toBe('FEATURE_NOT_IN_PLAN');

    const key = `idem-${uniq()}`;
    const body = { method: 'BANK_TRANSFER', amount: 7_400 };
    const a = await pay(st.folioId, body).set('Idempotency-Key', key);
    const b = await pay(st.folioId, body).set('Idempotency-Key', key);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.payment.id).toBe(a.body.payment.id);
    const conflictBody = await pay(st.folioId, { ...body, amount: 1 }).set('Idempotency-Key', key);
    expect(conflictBody.status).toBe(409);
    expect((await getFolio(st.folioId)).payments).toHaveLength(1);
  });

  it('reverses a payment with a reason, never deletes it; renders receipts', async () => {
    const st = await stayWithNight();
    const p = await pay(st.folioId, { method: 'MOOV_MONEY', amount: 5_000, reference: `MM-${st.number}` });
    const pid = p.body.payment.id as string;
    const denied = await api('post', `/folios/${st.folioId}/payments/${pid}/reverse`, tokCashier).send({ reason: 'Erreur' });
    expect(denied.status).toBe(403);
    const r = await api('post', `/folios/${st.folioId}/payments/${pid}/reverse`).send({ reason: 'Paiement en double' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.reversal.amount).toBe(-5_000);
    expect(r.body.folio.balance).toBe(37_400);
    const orig = (r.body.folio as FolioBody).payments.find((x) => x.id === pid)!;
    expect(orig.status).toBe('REVERSED');
    const again = await api('post', `/folios/${st.folioId}/payments/${pid}/reverse`).send({ reason: 'Encore' });
    expect(again.status).toBe(409);
    // The reference is free again once the payment is reversed.
    expect((await pay(st.folioId, { method: 'MOOV_MONEY', amount: 5_000, reference: `MM-${st.number}` })).status).toBe(201);
    await expect(env.services.admin.folioPayment.delete({ where: { id: pid } })).rejects.toThrow();

    for (const format of ['ticket', 'a4']) {
      const rec = await api('post', `/folios/${st.folioId}/payments/${pid}/receipt`).query({ format });
      expect(rec.status, JSON.stringify(rec.body)).toBe(200);
      expect(rec.body.number).toMatch(/^REC-[0-9A-F]{10}$/);
      expect(rec.body.url).toContain('https://files.test/');
    }
    expect(stored.some((s) => s.key.includes('documents/ticket/'))).toBe(true);
    expect(stored.some((s) => s.key.includes('documents/receipt/'))).toBe(true);
  });

  it('takes a deposit on the reservation folio before check-in', async () => {
    const conf = await stayFixture({ status: 'CONFIRMED', arrival: '2026-11-20', departure: '2026-11-22' });
    const f = await resolve({ reservationId: conf.reservationId });
    expect(f.number).toBe(`${conf.number}-1-1`);
    expect(f.stayId).toBeNull();
    const d = await pay(f.id, { method: 'BANK_TRANSFER', amount: 20_000, reference: `VIR-${conf.number}` });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    expect(d.body.payment.isDeposit).toBe(true);
    expect(d.body.folio.balance).toBe(-20_000);
    // Same folio when resolved by room line.
    expect((await resolve({ reservationRoomId: conf.rrId })).id).toBe(f.id);
  });
});

describe('cash sessions and multi-currency tender', () => {
  let sessionId: string;

  it('opens one session per user and property', async () => {
    const o = await api('post', '/cash-sessions', tokCashier).send({ propertyId: A.propertyId, openingFloat: 50_000 });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    sessionId = o.body.id as string;
    expect(o.body.expected).toEqual([{ method: 'CASH', currency: 'XOF', expected: 50_000 }]);
    const twice = await api('post', '/cash-sessions', tokCashier).send({ propertyId: A.propertyId });
    expect(twice.status).toBe(409);
  });

  it('converts a EUR tender at the daily rate and gives change in XOF', async () => {
    const denied = await api('put', '/exchange-rates', tokCashier).send({ base: 'EUR', rate: '655.957', validOn: '2026-11-12' });
    expect(denied.status).toBe(403);
    const rate = await api('put', '/exchange-rates').send({ base: 'EUR', rate: '655.957', validOn: '2026-11-12' });
    expect(rate.status, JSON.stringify(rate.body)).toBe(200);
    expect(rate.body).toMatchObject({ base: 'EUR', quote: 'XOF', rate: '655.957' });

    const st = await stayWithNight();
    const usd = await pay(st.folioId, { method: 'CASH', tenderedCurrency: 'USD', tenderedAmount: 5_000 }, tokCashier);
    expect(usd.status).toBe(412);
    expect(usd.body.meta.reason).toBe('NO_EXCHANGE_RATE');
    const eur = await pay(st.folioId, { method: 'CASH', amount: 30_000, tenderedCurrency: 'EUR', tenderedAmount: 10_000 }, tokCashier);
    expect(eur.status, JSON.stringify(eur.body)).toBe(201);
    expect(eur.body).toMatchObject({ convertedAmount: 65_595, change: 35_595, changeCurrency: 'XOF' });
    expect(eur.body.payment).toMatchObject({ amount: 30_000, tenderedCurrency: 'EUR', tenderedAmount: 10_000, rate: '655.957', cashSessionId: sessionId });
    const xof = await pay(st.folioId, { method: 'CASH', tenderedAmount: 10_000 }, tokCashier);
    expect(xof.status, JSON.stringify(xof.body)).toBe(201);
    expect(xof.body).toMatchObject({ change: 2_600, payment: { amount: 7_400 } });
    expect(xof.body.folio.balance).toBe(0);
    const card = await pay(st.folioId, { method: 'CARD', tenderedAmount: 2_000, amount: 1_000 }, tokCashier);
    expect(card.status).toBe(422);
    await api('post', `/folios/${st.folioId}/charges`, tokCashier).send({ productId: productA, qty: 1 });
    expect((await pay(st.folioId, { method: 'CARD', amount: 1_770 }, tokCashier)).status).toBe(201);
  });

  it('records movements and reports the expected amounts per method (X report)', async () => {
    expect(
      (await api('post', `/cash-sessions/${sessionId}/movements`, tokCashier).send({ type: 'OUT', amount: 5_000, reason: 'Achat fournitures' })).status,
    ).toBe(201);
    expect(
      (await api('post', `/cash-sessions/${sessionId}/movements`, tokCashier).send({ type: 'IN', amount: 1_000, reason: 'Apport monnaie' })).status,
    ).toBe(201);
    const other = await api('post', `/cash-sessions/${sessionId}/movements`).send({ type: 'IN', amount: 1, reason: 'Pas ma caisse' });
    expect(other.status).toBe(403);
    const x = await api('get', `/cash-sessions/${sessionId}/x-report`, tokCashier);
    expect(x.status, JSON.stringify(x.body)).toBe(200);
    // 50 000 float + 10 000 received - 2 600 and 35 595 change - 5 000 out + 1 000 in.
    expect(x.body.expected).toEqual([
      { method: 'CARD', currency: 'XOF', expected: 1_770 },
      { method: 'CASH', currency: 'EUR', expected: 10_000 },
      { method: 'CASH', currency: 'XOF', expected: 17_805 },
    ]);
    expect(x.body.totals).toEqual(
      expect.arrayContaining([expect.objectContaining({ method: 'CASH', currency: 'EUR', count: 1, net: 10_000 })]),
    );
  });

  it('closes with the count; a variance needs cash.close_with_variance (Z report)', async () => {
    const wrong = await api('post', `/cash-sessions/${sessionId}/close`, tokCashier).send({
      counted: [
        { method: 'CASH', amount: 17_000 },
        { method: 'CASH', currency: 'EUR', amount: 10_000 },
        { method: 'CARD', amount: 1_770 },
      ],
    });
    expect(wrong.status).toBe(403);
    expect(wrong.body.meta.permission).toBe('cash.close_with_variance');
    expect(wrong.body.meta.variances).toEqual([
      expect.objectContaining({ method: 'CASH', currency: 'XOF', variance: -805 }),
    ]);
    const z0 = await api('get', `/cash-sessions/${sessionId}/z-report`, tokCashier);
    expect(z0.status).toBe(409);
    const ok = await api('post', `/cash-sessions/${sessionId}/close`, tokCashier).send({
      counted: [
        { method: 'CASH', amount: 17_805 },
        { method: 'CASH', currency: 'EUR', amount: 10_000 },
        { method: 'CARD', amount: 1_770 },
      ],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.kind).toBe('Z');
    expect(ok.body.session).toMatchObject({ status: 'CLOSED', expectedAmount: 17_805, countedAmount: 17_805, variance: 0 });
    expect(ok.body.counted.every((r: { variance: number }) => r.variance === 0)).toBe(true);
    const z = await api('get', `/cash-sessions/${sessionId}/z-report`, tokCashier);
    expect(z.body.counted).toHaveLength(3);
    const st = await stayWithNight();
    expect((await pay(st.folioId, { method: 'CASH', amount: 100 }, tokCashier)).status).toBe(412);

    // A manager may close with a variance.
    const m = await api('post', '/cash-sessions').send({ propertyId: A.propertyId, openingFloat: 1_000 });
    const closed = await api('post', `/cash-sessions/${m.body.id}/close`).send({ counted: [{ method: 'CASH', amount: 900 }], note: 'Manque 100' });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    expect(closed.body.session.variance).toBe(-100);
    const mine = await api('get', '/cash-sessions', tokCashier).query({ propertyId: A.propertyId });
    expect(mine.body.items.every((s: { userId: string }) => s.userId === cashierId)).toBe(true);
    expect((await api('get', `/cash-sessions/${m.body.id}`, tokCashier)).status).toBe(403);
  });
});

async function settledFolio(o: StayOpts = {}) {
  const st = await stayWithNight(o);
  const p = await pay(st.folioId, { method: 'CARD', amount: 37_400 });
  expect(p.status, JSON.stringify(p.body)).toBe(201);
  return st;
}

describe('departments and catalog picker', () => {
  it('lists departments with translated names (table + system codes), by permission', async () => {
    await env.services.admin.department.create({
      data: { tenantId: A.tenantId, propertyId: A.propertyId, code: 'RES', name: 'Restauration et bar' },
    });
    const q = `?propertyId=${A.propertyId}`;
    const fr = await api('get', `/departments${q}`, tokCashier);
    expect(fr.status, JSON.stringify(fr.body)).toBe(200);
    const find = (b: { items: { code: string; name: string }[] }, c: string) => b.items.find((i) => i.code === c)?.name;
    expect(find(fr.body, 'ROOM')).toBe('Hébergement');
    expect(find(fr.body, 'RES')).toBe('Restauration et bar');
    const en = await api('get', `/departments${q}&locale=en`, tokCashier);
    expect(find(en.body, 'ROOM')).toBe('Accommodation');
    const none = await addUser(env.services.admin, A.tenantId, ['reports.read']);
    const tokNone = await mintToken(env.services.config, { sub: none, tid: A.tenantId });
    expect((await api('get', `/departments${q}`, tokNone)).status).toBe(403);
    expect((await api('get', `/departments?propertyId=${B.propertyId}`, tokCashier)).status).toBe(403);
    // Cross-tenant: tenant B never sees the departments of tenant A (RLS).
    const cross = await api('get', `/departments${q}`, tokB, B);
    expect(cross.body.items.some((i: { code: string }) => i.code === 'RES')).toBe(false);
  });

  it('lists products with catalog.read (read only) or settings.read, refuses otherwise', async () => {
    const q = `?propertyId=${A.propertyId}`;
    const mk = async (perms: string[]) => {
      const u = await addUser(env.services.admin, A.tenantId, perms);
      await env.services.admin.userProperty.create({ data: { tenantId: A.tenantId, userId: u, propertyId: A.propertyId } });
      return mintToken(env.services.config, { sub: u, tid: A.tenantId });
    };
    const reader = await mk(['catalog.read']);
    const ok = await api('get', `/catalog/products${q}`, reader);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.items.some((p: { name: string }) => p.name === 'Eau minérale')).toBe(true);
    expect((await api('get', `/catalog/products${q}`, await mk(['settings.read']))).status).toBe(200);
    // Read-only: no creation with catalog.read
    const denied = await api('post', '/catalog/products', reader).send({ propertyId: A.propertyId, name: 'X', price: 1 });
    expect(denied.status).toBe(403);
    expect((await api('get', `/catalog/products${q}`, await mk(['folio.read']))).status).toBe(403);
  });
});

describe('stay period on invoices', () => {
  const upTo = (rrId: string, d: string) =>
    api('post', '/folios/room-nights/up-to').send({ reservationRoomId: rrId, upTo: d });
  const dates = (r: { body: { items: { date: string }[] } }) => r.body.items.map((i) => i.date);

  it('postNightsUpTo: arrival included, departure excluded, nothing before the arrival', async () => {
    const st = await stayFixture({ arrival: '2026-11-10', departure: '2026-11-13', stay: false });
    expect(dates(await upTo(st.rrId, '2026-11-09'))).toEqual([]);
    expect(dates(await upTo(st.rrId, '2026-11-10'))).toEqual(['2026-11-10']);
    // The departure date itself is not a night; the nights stay idempotent.
    const last = await upTo(st.rrId, '2026-11-13');
    expect(dates(last)).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(last.body.items.map((i: { posted: boolean }) => i.posted)).toEqual([false, true, true]);
    expect(dates(await upTo(st.rrId, '2026-12-31'))).toHaveLength(3);
  });

  it('interim invoice (stay in house): planned period kept, invoiced nights stated', async () => {
    const st = await stayFixture({ arrival: '2026-11-10', departure: '2026-11-15' });
    await upTo(st.rrId, '2026-11-13');
    const folioId = (await api('post', '/folios/resolve').send({ reservationRoomId: st.rrId })).body.id as string;
    const f = await getFolio(folioId);
    await pay(folioId, { method: 'CARD', amount: f.balance });
    const inv = await api('post', '/invoices').send({ folioId });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.totals.stay).toMatchObject({ checkIn: '2026-11-10', checkOut: '2026-11-15', nights: 5, invoicedNights: 4 });
    expect(inv.body.totals.lines).toHaveLength(4);
    // Rates carry no unit: the document template adds it ("18 %", never "18 % %").
    expect(inv.body.totals.lines.every((l: { taxRate: string }) => l.taxRate === '18')).toBe(true);
  });

  it('checkout invoice: every night due is invoiced and the period matches it', async () => {
    const st = await stayFixture({ arrival: '2026-11-08', departure: '2026-11-11' });
    const prep = await api('post', '/folios/checkout-preparation').send({ reservationRoomId: st.rrId });
    expect(prep.body.postedNights).toHaveLength(3);
    const folioId = prep.body.folios[0].id as string;
    await pay(folioId, { method: 'CARD', amount: prep.body.balance });
    await env.services.admin.reservationRoom.update({ where: { id: st.rrId }, data: { status: 'CHECKED_OUT' } });
    const inv = await api('post', '/invoices').send({ folioId });
    expect(inv.body.totals.stay).toMatchObject({ checkIn: '2026-11-08', checkOut: '2026-11-11', nights: 3, invoicedNights: 3 });
  });

  it('early departure: only the nights used are on the checkout invoice and in its period', async () => {
    const st = await stayFixture({ arrival: '2026-11-09', departure: '2026-11-16' });
    const prep = await api('post', '/folios/checkout-preparation').send({ reservationRoomId: st.rrId });
    expect(prep.body.postedNights).toHaveLength(3); // 9, 10, 11 (business date 12)
    const folioId = prep.body.folios[0].id as string;
    await pay(folioId, { method: 'CARD', amount: prep.body.balance });
    await env.services.admin.reservationRoom.update({ where: { id: st.rrId }, data: { status: 'CHECKED_OUT' } });
    const inv = await api('post', '/invoices').send({ folioId });
    expect(inv.body.totals.stay).toMatchObject({ checkIn: '2026-11-09', checkOut: '2026-11-12', nights: 3, invoicedNights: 3 });
  });
});

describe('invoices and credit notes', () => {
  it('requires a settled folio, numbers gap-free, closes the folio, renders the PDF and calls the fiscal hook', async () => {
    const st = await stayWithNight();
    const unpaid = await api('post', '/invoices').send({ folioId: st.folioId });
    expect(unpaid.status).toBe(409);
    expect(unpaid.body.meta.reason).toBe('UNPAID_BALANCE');
    await pay(st.folioId, { method: 'CARD', amount: 37_400 });
    const inv = await api('post', '/invoices', tokCashier).send({ folioId: st.folioId });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body.number).toMatch(/^FAC-2026-\d{6}$/);
    expect(inv.body).toMatchObject({
      kind: 'INVOICE',
      status: 'PAID',
      issueDate: '2026-11-12',
      subtotal: 30_000,
      taxTotal: 7_400,
      total: 37_400,
      customer: { type: 'guest', name: 'Kofi Agbeko' },
      fiscal: { provider: 'none', status: 'ACCEPTED', fiscalNumber: null },
    });
    expect(inv.body.pdfFileId).toBeTruthy();
    const html = htmls.at(-1) ?? '';
    expect(html).toContain('12/11/2026');
    expect(html).toContain('Carte bancaire : 37');
    expect(html).not.toContain('Hotel Management');
    expect(html).not.toMatch(/% %/);
    const totals = inv.body.totals;
    expect(totals.breakdown).toMatchObject({ net: 30_000, percentTax: 5_400, fixedTax: 2_000 });
    expect(totals.payments).toEqual([{ method: 'CARD', label: 'Carte bancaire', amount: 37_400 }]);
    expect(totals.stay).toMatchObject({ checkIn: '2026-11-10', checkOut: '2026-11-14', nights: 4 });
    const fd = await env.services.admin.fiscalDocument.findFirst({ where: { invoiceId: inv.body.id } });
    expect(fd?.payload).toMatchObject({ skipped: true });

    const f = await getFolio(st.folioId);
    expect(f.status).toBe('CLOSED');
    const closed = await api('post', `/folios/${st.folioId}/charges`).send({ productId: productA });
    expect(closed.status).toBe(409);
    expect(closed.body.meta.reason).toBe('FOLIO_CLOSED');
    expect((await api('post', '/invoices').send({ folioId: st.folioId })).status).toBe(409);

    const pdf = await api('get', `/invoices/${inv.body.id}/pdf`);
    expect(pdf.body.url).toContain('documents/invoice/');
    const mail = await api('post', `/invoices/${inv.body.id}/email`, tokCashier).send({});
    expect(mail.status, JSON.stringify(mail.body)).toBe(200);
    const notice = sent.find((n) => n.templateCode === 'invoice_issued');
    expect(notice?.to).toEqual({ email: 'kofi@example.com' });
    expect((notice?.data.invoice as { number: string }).number).toBe(inv.body.number);
  });

  it('is immutable once issued (trigger): only status and PDF may change, no DELETE', async () => {
    const st = await settledFolio();
    const inv = await api('post', '/invoices').send({ folioId: st.folioId });
    const { admin } = env.services;
    await expect(admin.invoice.update({ where: { id: inv.body.id }, data: { total: 1n } })).rejects.toThrow(/may only change/);
    await expect(admin.invoice.update({ where: { id: inv.body.id }, data: { customerSnapshot: {} } })).rejects.toThrow();
    await expect(admin.invoice.delete({ where: { id: inv.body.id } })).rejects.toThrow(/forbidden/);
    const upd = await admin.invoice.update({ where: { id: inv.body.id }, data: { status: 'PARTIALLY_PAID' } });
    expect(upd.status).toBe('PARTIALLY_PAID');
    await admin.invoice.update({ where: { id: inv.body.id }, data: { status: 'CREDITED' } });
    await expect(admin.invoice.update({ where: { id: inv.body.id }, data: { status: 'PAID' } })).rejects.toThrow();
  });

  it('numbers concurrently issued invoices without gaps', async () => {
    const folios = [];
    for (let i = 0; i < 5; i++) folios.push((await settledFolio()).folioId);
    const res = await Promise.all(folios.map((folioId) => api('post', '/invoices').send({ folioId })));
    expect(res.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const nums = res.map((r) => Number((r.body.number as string).slice(-6))).sort((a, b) => a - b);
    for (let i = 1; i < nums.length; i++) expect(nums[i]).toBe(nums[i - 1]! + 1);
    const all = await env.services.admin.invoice.findMany({
      where: { tenantId: A.tenantId, creditNoteOfId: null },
      select: { number: true },
    });
    const seqs = all.map((i) => Number(i.number.slice(-6))).sort((a, b) => a - b);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('full credit note reopens the folio balance; refund settles it; partial credit note', async () => {
    const st = await settledFolio();
    const inv = await api('post', '/invoices').send({ folioId: st.folioId });
    const denied = await api('post', `/invoices/${inv.body.id}/credit-notes`, tokCashier).send({ reason: 'Erreur de tarif' });
    expect(denied.status).toBe(403);
    const cn = await api('post', `/invoices/${inv.body.id}/credit-notes`).send({ reason: 'Erreur de tarif' });
    expect(cn.status, JSON.stringify(cn.body)).toBe(201);
    expect(cn.body.number).toMatch(/^AV-2026-\d{6}$/);
    expect(cn.body).toMatchObject({ kind: 'CREDIT_NOTE', creditNoteOfId: inv.body.id, total: -37_400, subtotal: -30_000 });
    expect((await api('get', `/invoices/${inv.body.id}`)).body.status).toBe('CREDITED');
    const f = await getFolio(st.folioId);
    expect(f).toMatchObject({ status: 'OPEN', balance: -37_400 });
    expect((await api('post', `/invoices/${inv.body.id}/credit-notes`).send({ reason: 'Encore' })).status).toBe(409);
    const refund = await api('post', `/folios/${st.folioId}/refunds`).send({ method: 'CARD', amount: 37_400, reason: 'Remboursement avoir' });
    expect(refund.status, JSON.stringify(refund.body)).toBe(201);
    expect(refund.body.folio.balance).toBe(0);
    // The credited night can be posted again (re-billing).
    expect((await postNight(st.rrId, '2026-11-10')).body.posted).toBe(true);

    const st2 = await stayWithNight();
    const prod = await api('post', `/folios/${st2.folioId}/charges`).send({ productId: productA, qty: 2 });
    await pay(st2.folioId, { method: 'CARD', amount: 37_400 + 3_540 });
    const inv2 = await api('post', '/invoices').send({ folioId: st2.folioId });
    expect(inv2.status).toBe(201);
    const part = await api('post', `/invoices/${inv2.body.id}/credit-notes`).send({ lineIds: [prod.body.lineId], reason: 'Eau non consommée' });
    expect(part.status, JSON.stringify(part.body)).toBe(201);
    expect(part.body.total).toBe(-3_540);
    expect((await api('get', `/invoices/${inv2.body.id}`)).body.status).toBe('PAID');
    expect((await getFolio(st2.folioId)).balance).toBe(-3_540);
    const notOnInvoice = await api('post', `/invoices/${inv2.body.id}/credit-notes`).send({ lineIds: [prod.body.lineId], reason: 'Encore' });
    expect(notOnInvoice.status).toBe(422);
  });
});

describe('city ledger', () => {
  let companyId: string;
  it('transfers a balance to a company account, invoices the company with its NIF, enforces the credit limit', async () => {
    const { admin } = env.services;
    companyId = (
      await admin.company.create({ data: { tenantId: A.tenantId, name: 'SOTOCO SA', taxId: 'NIF-123', creditLimit: 100_000n } })
    ).id;
    const noNif = await admin.company.create({ data: { tenantId: A.tenantId, name: 'Sans NIF SARL' } });
    const st = await stayWithNight();
    const t = await pay(st.folioId, { method: 'CITY_LEDGER', companyId });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    expect(t.body.folio.balance).toBe(0);
    expect(t.body.payment).toMatchObject({ method: 'CITY_LEDGER', amount: 37_400 });
    const acc = await api('get', '/city-ledger/accounts').query({ propertyId: A.propertyId });
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body.items).toEqual([expect.objectContaining({ companyId, balance: 37_400, creditLimit: 100_000 })]);
    const bad = await api('post', '/invoices').send({ folioId: st.folioId, customer: { type: 'company', companyId: noNif.id } });
    expect(bad.status).toBe(422);
    const inv = await api('post', '/invoices').send({ folioId: st.folioId, customer: { type: 'company', companyId } });
    expect(inv.status, JSON.stringify(inv.body)).toBe(201);
    expect(inv.body).toMatchObject({ status: 'ISSUED', customer: { type: 'company', taxId: 'NIF-123' } });
    expect(inv.body.totals.payments).toEqual([{ method: 'CITY_LEDGER', label: 'Compte débiteur', amount: 37_400 }]);

    const st2 = await stayWithNight();
    expect((await pay(st2.folioId, { method: 'CITY_LEDGER', companyId })).status).toBe(201);
    const st3 = await stayWithNight();
    const over = await pay(st3.folioId, { method: 'CITY_LEDGER', companyId });
    expect(over.status).toBe(409);
    expect(over.body.meta.reason).toBe('CREDIT_LIMIT_EXCEEDED');
    // A partial transfer reversed: the company account is credited back.
    const part = await pay(st3.folioId, { method: 'CITY_LEDGER', companyId, amount: 10_000 });
    expect(part.status, JSON.stringify(part.body)).toBe(201);
    const rev = await api('post', `/folios/${st3.folioId}/payments/${part.body.payment.id}/reverse`).send({ reason: 'Mauvaise société' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    const acc2 = await api('get', `/city-ledger/accounts/${companyId}`).query({ propertyId: A.propertyId });
    expect(acc2.body).toMatchObject({ kind: 'COMPANY', balance: 74_800 });
  });

  it('settles the company balance, produces a statement and an aging', async () => {
    const s = await api('post', `/city-ledger/accounts/${companyId}/settlements`).send({
      propertyId: A.propertyId,
      method: 'BANK_TRANSFER',
      amount: 50_000,
      reference: `VIR-${uniq()}`,
    });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect(s.body.folio.balance).toBe(24_800);
    const denied = await api('post', `/city-ledger/accounts/${companyId}/settlements`, tokCashier).send({
      propertyId: A.propertyId,
      method: 'CASH',
      amount: 1,
    });
    expect(denied.status).toBe(403);
    const stmt = await api('get', `/city-ledger/accounts/${companyId}/statement`).query({ propertyId: A.propertyId });
    expect(stmt.status, JSON.stringify(stmt.body)).toBe(200);
    expect(stmt.body).toMatchObject({ totalDebit: 37_400 * 2 + 10_000, closingBalance: 24_800 });
    const aging = await api('get', '/city-ledger/aging').query({ propertyId: A.propertyId, asOf: '2026-11-12' });
    expect(aging.status, JSON.stringify(aging.body)).toBe(200);
    expect(aging.body.items[0]).toMatchObject({ companyId, total: 24_800, buckets: { current: 24_800 } });
    const later = await api('get', '/city-ledger/aging').query({ propertyId: A.propertyId, asOf: '2027-01-20' });
    expect(later.body.items[0].buckets.d61_90).toBe(24_800);
  });

  it('is gated by the city_ledger feature', async () => {
    const st = await stayWithNight({ f: B, s: SB });
    const res = await request(app)
      .post(`${T}/folios/${st.folioId}/payments`)
      .set('Host', B.host)
      .set('Authorization', `Bearer ${tokB}`)
      .send({ method: 'CITY_LEDGER', companyId });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('FEATURE_NOT_IN_PLAN');
    const acc = await api('get', '/city-ledger/accounts', tokB, B);
    expect(acc.status).toBe(402);
  });
});

describe('check-out support', () => {
  it('posts the remaining nights and reports blockers until the balance is settled', async () => {
    const st = await stayFixture();
    const prep = await api('post', '/folios/checkout-preparation').send({ reservationRoomId: st.rrId });
    expect(prep.status, JSON.stringify(prep.body)).toBe(200);
    // Business date 2026-11-12: nights of the 10th and 11th are due.
    expect(prep.body.postedNights.map((n: { date: string }) => n.date)).toEqual(['2026-11-10', '2026-11-11']);
    expect(prep.body).toMatchObject({ balance: 74_800, canCheckout: false });
    expect(prep.body.blockers).toEqual([expect.objectContaining({ code: 'UNPAID_BALANCE', amount: 74_800 })]);
    const again = await api('post', '/folios/checkout-preparation').send({ reservationRoomId: st.rrId });
    expect(again.body.postedNights).toEqual([]);
    await pay(prep.body.folios[0].id, { method: 'CARD', amount: 74_800 });
    const ok = await api('post', '/folios/checkout-preparation').send({ reservationRoomId: st.rrId });
    expect(ok.body).toMatchObject({ canCheckout: true, blockers: [], balance: 0 });

    const conf = await stayFixture({ status: 'CONFIRMED', arrival: '2026-11-20', departure: '2026-11-22' });
    const c = await api('post', '/folios/checkout-preparation').send({ reservationRoomId: conf.rrId });
    expect(c.body.blockers[0].code).toBe('NOT_IN_HOUSE');
  });
});

describe('business date, realtime, permissions and isolation', () => {
  it('sets the business date (admin only)', async () => {
    const denied = await api('put', '/business-date', tokCashier).send({ propertyId: A.propertyId, businessDate: '2026-11-13' });
    expect(denied.status).toBe(403);
    const ok = await api('put', '/business-date').send({ propertyId: A.propertyId, businessDate: '2026-11-13' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await api('get', '/business-date', tokReader).query({ propertyId: A.propertyId })).body.businessDate).toBe('2026-11-13');
    await api('put', '/business-date').send({ propertyId: A.propertyId, businessDate: '2026-11-12' });
  });

  it('publishes folio.changed to the property room', async () => {
    expect(env.services.modules.realtimeTarget('folio.changed')).toBe('property');
    const ev = await env.services.admin.outboxEvent.findMany({ where: { tenantId: A.tenantId, type: 'folio.changed' } });
    expect(ev.length).toBeGreaterThan(10);
    expect((ev[0]!.payload as { propertyId: string }).propertyId).toBe(A.propertyId);
  });

  it('denies missing permissions and isolates tenants', async () => {
    const st = await stayWithNight();
    expect((await api('get', `/folios/${st.folioId}`, tokReader)).status).toBe(200);
    expect((await pay(st.folioId, { method: 'CARD', amount: 1 }, tokReader)).status).toBe(403);
    expect((await api('post', '/cash-sessions', tokReader).send({ propertyId: A.propertyId })).status).toBe(403);
    expect((await api('post', '/invoices', tokReader).send({ folioId: st.folioId })).status).toBe(403);
    // Tenant B cannot see or post on tenant A's folios (RLS: 404).
    expect((await api('get', `/folios/${st.folioId}`, tokB, B)).status).toBe(404);
    expect((await api('post', `/folios/${st.folioId}/charges`, tokB, B).send({ amount: 1, label: 'x', departmentCode: 'X' })).status).toBe(404);
    expect((await postNight(st.rrId, '2026-11-11', tokB, B)).status).toBe(404);
    const list = await api('get', '/invoices', tokB, B);
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
    // A token of tenant B is refused on tenant A's host.
    expect((await api('get', `/folios/${st.folioId}`, tokB, A)).status).toBeGreaterThanOrEqual(401);
  });
});
