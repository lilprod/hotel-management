import type { Prisma, TransactionClient } from '@hm/database';
import type { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { writeTenantAudit } from '../audit/service.js';
import { assertPropertyAccess, conflict, must, num } from '../property/common.js';
import { publishFinance, FOLIO_EVENTS } from '../folio/events.js';
import { isUniqueViolation } from '../availability/inventory.js';
import { asTx, loadProperty } from '../folio/repository.js';
import { hasPermission, type FCtx } from '../folio/service.js';
import { TX_OPTS } from '../reservations/service.js';
import type { closeSessionBody, listSessionsQuery, movementBody, openSessionBody } from './schemas.js';

type SessionDb = Pick<TransactionClient, 'cashSession' | 'cashMovement' | 'folioPayment'>;
type SessionRow = Awaited<ReturnType<TransactionClient['cashSession']['findUniqueOrThrow']>>;

/** Methods that are not tender (no money in a drawer or a terminal). */
const NON_TENDER = new Set(['CITY_LEDGER', 'LOYALTY_POINTS']);

/** The open session of a user at a property, if any. */
export async function openSessionOf(
  db: Pick<TransactionClient, 'cashSession'>,
  userId: string,
  propertyId: string,
): Promise<SessionRow | null> {
  if (!userId) return null;
  return db.cashSession.findFirst({ where: { userId, propertyId, closedAt: null } });
}

const toSession = (s: SessionRow) => ({
  id: s.id,
  propertyId: s.propertyId,
  userId: s.userId,
  status: s.closedAt ? ('CLOSED' as const) : ('OPEN' as const),
  currency: s.currency,
  openingFloat: num(s.openingFloat),
  openedAt: s.openedAt.toISOString(),
  closedAt: s.closedAt?.toISOString() ?? null,
  expectedAmount: s.expectedAmount === null ? null : num(s.expectedAmount),
  countedAmount: s.countedAmount === null ? null : num(s.countedAmount),
  variance: s.variance === null ? null : num(s.variance),
  note: s.note,
});

async function loadSession(ctx: FCtx, id: string, opts: { owner?: 'required' | 'or-reader' } = {}) {
  const s = must(await ctx.db.cashSession.findFirst({ where: { id } }), 'Cash session');
  assertPropertyAccess(ctx, s.propertyId);
  const owner = s.userId === ctx.userId;
  if (opts.owner === 'required' && !owner)
    throw new AppError('FORBIDDEN', undefined, { detail: 'Only the cashier of the session may do this' });
  if (opts.owner === 'or-reader' && !owner && !hasPermission(ctx, 'cash.read'))
    throw new AppError('FORBIDDEN', undefined, {
      detail: 'Session of another cashier',
      meta: { permission: 'cash.read' },
    });
  return s;
}

const alreadyOpen = (sessionId: string | undefined) =>
  conflict('A cash session is already open', { reason: 'SESSION_ALREADY_OPEN', sessionId });

/**
 * Opens the drawer of the current user: one open session per user and property, guaranteed by
 * the partial UNIQUE index `cash_sessions_one_open_key` (a concurrent open gets a 409).
 */
export async function openSession(ctx: FCtx, input: z.infer<typeof openSessionBody>) {
  assertPropertyAccess(ctx, input.propertyId);
  const prop = await loadProperty(asTx(ctx.db), input.propertyId);
  const open = await openSessionOf(asTx(ctx.db), ctx.userId, input.propertyId);
  if (open) throw alreadyOpen(open.id);
  const s = await ctx.db.cashSession
    .create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: input.propertyId,
        userId: ctx.userId,
        currency: prop.currency,
        openingFloat: BigInt(input.openingFloat),
        note: input.note ?? null,
      },
    })
    .catch(async (err: unknown) => {
      if (!isUniqueViolation(err)) throw err;
      throw alreadyOpen((await openSessionOf(asTx(ctx.db), ctx.userId, input.propertyId))?.id);
    });
  await ctx.audit({ action: 'cash.session.open', entity: 'cash_session', entityId: s.id, after: toSession(s) });
  return { ...toSession(s), expected: (await computeTotals(asTx(ctx.db), s)).expected };
}

export async function addMovement(ctx: FCtx, id: string, input: z.infer<typeof movementBody>) {
  const s = await loadSession(ctx, id, { owner: 'required' });
  if (s.closedAt) throw conflict('The session is closed', { reason: 'SESSION_CLOSED' });
  const m = await ctx.db.cashMovement.create({
    data: {
      tenantId: ctx.tenantId,
      cashSessionId: s.id,
      type: input.type,
      currency: input.currency ?? s.currency,
      amount: BigInt(input.amount),
      reason: input.reason,
      createdBy: ctx.actorId,
    },
  });
  const dto = toMovement(m);
  await ctx.audit({ action: 'cash.movement', entity: 'cash_movement', entityId: m.id, after: dto });
  return dto;
}

const toMovement = (m: {
  id: string;
  cashSessionId: string;
  type: 'IN' | 'OUT';
  currency: string;
  amount: bigint;
  reason: string;
  createdAt: Date;
  createdBy: string | null;
}) => ({
  id: m.id,
  cashSessionId: m.cashSessionId,
  type: m.type,
  currency: m.currency,
  amount: num(m.amount),
  reason: m.reason,
  createdAt: m.createdAt.toISOString(),
  createdBy: m.createdBy,
});

interface TotalRow {
  method: string;
  currency: string;
  count: number;
  received: number;
  paidOut: number;
  net: number;
}
interface ExpectedRow {
  method: string;
  currency: string;
  expected: number;
}

/** Totals of a session per method and currency, and the expected amount per tender. */
export async function computeTotals(db: SessionDb, s: SessionRow) {
  const [payments, movements] = await Promise.all([
    db.folioPayment.findMany({ where: { cashSessionId: s.id, status: { in: ['CONFIRMED', 'REVERSED'] } } }),
    db.cashMovement.findMany({ where: { cashSessionId: s.id } }),
  ]);
  const rows = new Map<string, TotalRow>();
  for (const p of payments) {
    // Cash is counted in the tendered currency (EX-21), other tenders in the folio currency.
    const cash = p.method === 'CASH';
    const currency = cash ? (p.tenderedCurrency ?? p.currency) : p.currency;
    const amount = num(cash ? (p.tenderedAmount ?? p.amount) : p.amount);
    const key = `${p.method}|${currency}`;
    const r = rows.get(key) ?? { method: p.method, currency, count: 0, received: 0, paidOut: 0, net: 0 };
    r.count += 1;
    if (amount >= 0) r.received += amount;
    else r.paidOut += -amount;
    r.net += amount;
    rows.set(key, r);
  }
  const mv = (type: 'IN' | 'OUT') => {
    const by = new Map<string, { currency: string; amount: number; count: number }>();
    for (const m of movements.filter((x) => x.type === type)) {
      const r = by.get(m.currency) ?? { currency: m.currency, amount: 0, count: 0 };
      r.amount += num(m.amount);
      r.count += 1;
      by.set(m.currency, r);
    }
    return [...by.values()].sort((a, b) => a.currency.localeCompare(b.currency));
  };
  const mIn = mv('IN');
  const mOut = mv('OUT');
  const expected = new Map<string, ExpectedRow>();
  const add = (method: string, currency: string, v: number) => {
    const k = `${method}|${currency}`;
    const e = expected.get(k) ?? { method, currency, expected: 0 };
    e.expected += v;
    expected.set(k, e);
  };
  add('CASH', s.currency, num(s.openingFloat));
  for (const r of rows.values()) if (!NON_TENDER.has(r.method)) add(r.method, r.currency, r.net);
  for (const m of mIn) add('CASH', m.currency, m.amount);
  for (const m of mOut) add('CASH', m.currency, -m.amount);
  const sort = <T extends { method: string; currency: string }>(a: T, b: T) =>
    a.method === b.method ? a.currency.localeCompare(b.currency) : a.method.localeCompare(b.method);
  const all = [...rows.values()].sort(sort);
  return {
    totals: all.filter((r) => !NON_TENDER.has(r.method)),
    nonTender: all.filter((r) => NON_TENDER.has(r.method)),
    movements: { in: mIn, out: mOut },
    expected: [...expected.values()].sort(sort),
  };
}

export async function getSession(ctx: FCtx, id: string) {
  const s = await loadSession(ctx, id, { owner: 'or-reader' });
  return { ...toSession(s), expected: (await computeTotals(asTx(ctx.db), s)).expected };
}

export async function currentSession(ctx: FCtx, propertyId: string) {
  assertPropertyAccess(ctx, propertyId);
  const s = await openSessionOf(asTx(ctx.db), ctx.userId, propertyId);
  if (!s) return null;
  return { ...toSession(s), expected: (await computeTotals(asTx(ctx.db), s)).expected };
}

export async function listSessions(ctx: FCtx, q: z.infer<typeof listSessionsQuery>) {
  if (q.propertyId) assertPropertyAccess(ctx, q.propertyId);
  const reader = hasPermission(ctx, 'cash.read');
  const rows = await ctx.db.cashSession.findMany({
    where: {
      ...(q.propertyId
        ? { propertyId: q.propertyId }
        : ctx.grants.permissions.includes('*')
          ? {}
          : { propertyId: { in: ctx.grants.propertyIds } }),
      // Without cash.read a cashier only lists their own sessions.
      ...(reader ? (q.userId ? { userId: q.userId } : {}) : { userId: ctx.userId }),
      ...(q.status === 'OPEN' ? { closedAt: null } : q.status === 'CLOSED' ? { closedAt: { not: null } } : {}),
    },
    orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
    take: q.limit,
  });
  return { items: rows.map(toSession) };
}

/** X report: running totals of a session (open or closed). */
export async function xReport(ctx: FCtx, id: string) {
  const s = await loadSession(ctx, id, { owner: 'or-reader' });
  return { kind: 'X' as const, session: toSession(s), generatedAt: new Date().toISOString(), ...(await computeTotals(asTx(ctx.db), s)), counted: null };
}

type CountedRow = ExpectedRow & { counted: number; variance: number };

/** Z report: closing report with the counted amounts and variances. */
export async function zReport(ctx: FCtx, id: string) {
  const s = await loadSession(ctx, id, { owner: 'or-reader' });
  if (!s.closedAt) throw conflict('The session is still open: use the X report', { reason: 'SESSION_OPEN' });
  const totals = await computeTotals(asTx(ctx.db), s);
  return {
    kind: 'Z' as const,
    session: toSession(s),
    generatedAt: new Date().toISOString(),
    ...totals,
    // Frozen at close (`cash_sessions.expected` / `counted`): later reversals do not rewrite it.
    expected: (s.expected as ExpectedRow[] | null) ?? totals.expected,
    counted: (s.counted as CountedRow[] | null) ?? null,
  };
}

/**
 * Closes a session with the counted amount of every tender (cash per currency, card, Mixx, Moov,
 * transfers). A non-zero variance requires `cash.close_with_variance`.
 */
export async function closeSession(ctx: FCtx, id: string, input: z.infer<typeof closeSessionBody>) {
  const s0 = await loadSession(ctx, id, { owner: 'or-reader' });
  const result = await ctx.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM cash_sessions WHERE id = ${s0.id}::uuid FOR UPDATE`;
    const s = await tx.cashSession.findUniqueOrThrow({ where: { id: s0.id } });
    if (s.closedAt) throw conflict('The session is already closed', { reason: 'SESSION_CLOSED' });
    const totals = await computeTotals(tx, s);
    const counted = new Map<string, number>();
    for (const c of input.counted) {
      const k = `${c.method}|${c.currency ?? s.currency}`;
      counted.set(k, (counted.get(k) ?? 0) + c.amount);
    }
    const keys = new Set([...totals.expected.map((e) => `${e.method}|${e.currency}`), ...counted.keys()]);
    const rows = [...keys].sort().map((k) => {
      const [method, currency] = k.split('|') as [string, string];
      const expected = totals.expected.find((e) => e.method === method && e.currency === currency)?.expected ?? 0;
      const c = counted.get(k) ?? 0;
      return { method, currency, expected, counted: c, variance: c - expected };
    });
    const withVariance = rows.filter((r) => r.variance !== 0);
    if (withVariance.length && !hasPermission(ctx, 'cash.close_with_variance'))
      throw new AppError('FORBIDDEN', undefined, {
        detail: 'Closing with a variance requires cash.close_with_variance',
        meta: { permission: 'cash.close_with_variance', variances: withVariance },
      });
    const cash = rows.find((r) => r.method === 'CASH' && r.currency === s.currency) ?? {
      expected: 0,
      counted: 0,
      variance: 0,
    };
    const closed = await tx.cashSession.update({
      where: { id: s.id },
      data: {
        closedAt: new Date(),
        expectedAmount: BigInt(cash.expected),
        countedAmount: BigInt(cash.counted),
        variance: BigInt(cash.variance),
        expected: totals.expected as unknown as Prisma.InputJsonValue,
        counted: rows as unknown as Prisma.InputJsonValue,
        note: input.note ?? s.note,
      },
    });
    await publishFinance(tx, FOLIO_EVENTS.cashSessionClosed, {
      propertyId: s.propertyId,
      sessionId: s.id,
      userId: s.userId,
      variances: withVariance,
    });
    return { closed, rows };
  }, TX_OPTS);
  await writeTenantAudit(ctx.services, {
    tenantId: ctx.tenantId,
    userId: ctx.actorId,
    action: 'cash.session.close',
    entity: 'cash_session',
    entityId: result.closed.id,
    before: toSession(s0),
    after: { ...toSession(result.closed), counted: result.rows },
  });
  return zReport(ctx, result.closed.id);
}
