import type { NightAudit, Prisma } from '@hm/database';
import { hasPermission } from '@hm/shared';
import { AppError, notFound } from '../../lib/errors.js';
import { assertPropertyAccess, conflict, formatDay, invalid, parseDay } from '../property/common.js';
import { now, sendGuestNotice, type RCtx } from '../reservations/context.js';
import { penaltyOf } from '../reservations/repository.js';
import type { PenaltyDto } from '../reservations/schemas.js';
import { markNoShow, requireProperty } from '../reservations/service.js';
import { addDays, postNightsUpTo, postNoShowPenalty } from '../folio/service.js';
import { dayLockKey } from '../folio/repository.js';
import { notificationDeps } from '../notifications/deps.js';
import { NIGHT_AUDIT_EVENTS, publishNightAudit } from './events.js';
import { blockingCodes, precheck, type Precheck } from './precheck.js';
import { renderAuditReport } from './report.js';
import { computeDayStats, statsFromRow, writeDailyStats, zonedMidnight, type DayStats } from './stats.js';

/** Steps of a run, in order; each is idempotent and recorded in `night_audits.summary.steps`. */
export const STEPS = [
  'no_shows',
  'room_nights',
  'lock_day',
  'stats',
  'advance_date',
  'report',
  'notify',
] as const;
export type Step = (typeof STEPS)[number];

export interface Decision {
  reservationId: string;
  action: 'NO_SHOW' | 'KEEP';
  waivePenalty?: boolean | undefined;
}

interface StepState {
  status: 'done' | 'failed';
  at: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface Summary {
  trigger: 'manual' | 'auto';
  decisions: Decision[];
  /** Warnings of the pre-check at start (codes with counts). */
  warnings: { code: string; count: number }[];
  steps: Partial<Record<Step, StepState>>;
  advanced?: boolean;
  reportFileId?: string | null;
  error?: string | null;
}

const summaryOf = (a: Pick<NightAudit, 'summary'>): Summary => {
  const s = (a.summary ?? {}) as Partial<Summary>;
  return { trigger: 'manual', decisions: [], warnings: [], steps: {}, ...s };
};

/**
 * KPIs of an audited day, from `daily_stats_property` (null before the stats step); the window of
 * the time-stamped facts runs from the previous closing (`locked_at`) to this one.
 */
export async function loadKpis(
  db: Pick<RCtx['db'], 'nightAudit' | 'dailyStatsProperty' | 'property'>,
  a: NightAudit,
): Promise<DayStats | null> {
  const row = await db.dailyStatsProperty.findUnique({
    where: { propertyId_businessDate: { propertyId: a.propertyId, businessDate: a.businessDate } },
  });
  if (!row || !a.lockedAt) return null;
  const prev = await db.nightAudit.findFirst({
    where: { propertyId: a.propertyId, businessDate: { lt: a.businessDate }, lockedAt: { not: null } },
    orderBy: { businessDate: 'desc' },
    select: { lockedAt: true },
  });
  const tz = (await db.property.findUnique({ where: { id: a.propertyId }, select: { timezone: true } }))?.timezone ?? 'UTC';
  return statsFromRow(row, { from: prev?.lockedAt ?? zonedMidnight(formatDay(a.businessDate), tz), to: a.lockedAt });
}

export const toAudit = (a: NightAudit, kpis: DayStats | null = null) => {
  const s = summaryOf(a);
  return {
    id: a.id,
    propertyId: a.propertyId,
    businessDate: formatDay(a.businessDate),
    status: a.status,
    trigger: s.trigger,
    startedBy: a.startedBy,
    startedAt: a.startedAt.toISOString(),
    completedAt: a.completedAt?.toISOString() ?? null,
    steps: STEPS.map((step) => ({
      step,
      status: s.steps[step]?.status ?? ('pending' as const),
      at: s.steps[step]?.at ?? null,
      error: s.steps[step]?.error ?? null,
      result: s.steps[step]?.result ?? null,
    })),
    decisions: s.decisions,
    warnings: s.warnings,
    kpis,
    reportFileId: s.reportFileId ?? null,
    error: s.error ?? null,
  };
};
export type AuditDto = ReturnType<typeof toAudit>;

// ───────────────────────────── test seam ─────────────────────────────

type Fault = (step: Step, index: number) => void;
let fault: Fault | null = null;
/** Test seam: throws from inside a step (index = item processed in that step, -1 at its start). */
export function setNightAuditFault(fn: Fault | null): void {
  fault = fn;
}

// ───────────────────────────── steps ─────────────────────────────

interface RunState {
  ctx: RCtx;
  audit: NightAudit;
  summary: Summary;
  propertyId: string;
  businessDate: string;
  currency: string;
  timezone: string;
  /** KPIs computed by the stats step of this run. */
  kpis?: DayStats | undefined;
}

async function saveSummary(ctx: RCtx, id: string, summary: Summary, extra: Prisma.NightAuditUpdateInput = {}) {
  return ctx.db.nightAudit.update({
    where: { id },
    data: { summary: summary as unknown as Prisma.InputJsonValue, ...extra },
  });
}

const PENALTY_LABEL = (number: string) => `Pénalité de non-présentation (no-show) — ${number}`;

async function stepNoShows(st: RunState) {
  const { ctx } = st;
  let noShows = 0;
  let penalties = 0;
  let penaltyTotal = 0;
  let i = 0;
  for (const d of st.summary.decisions) {
    if (d.action !== 'NO_SHOW') continue;
    fault?.('no_shows', i++);
    const r = await ctx.db.reservation.findFirst({
      where: { id: d.reservationId, propertyId: st.propertyId },
      select: {
        id: true,
        number: true,
        status: true,
        penaltyKind: true,
        penaltyAmount: true,
        penaltyComputedAmount: true,
        penaltyCurrency: true,
        penaltyWaived: true,
        penaltyBusinessDate: true,
        penaltyLines: true,
      },
    });
    if (!r) continue;
    let penalty: PenaltyDto | null = null;
    if (r.status === 'CONFIRMED') penalty = (await markNoShow(ctx, r.id, d.waivePenalty ?? false)).penalty;
    else if (r.status === 'NO_SHOW') penalty = penaltyOf(r);
    else continue; // checked in (or cancelled) meanwhile: nothing to do
    noShows++;
    if (!penalty || penalty.waived) continue;
    for (const l of penalty.lines) {
      if (l.amount <= 0) continue;
      const p = await postNoShowPenalty(ctx, l.reservationRoomId, l.amount, PENALTY_LABEL(r.number));
      if (p.posted) penalties++;
      penaltyTotal += l.amount;
    }
  }
  return {
    noShows,
    kept: st.summary.decisions.filter((d) => d.action === 'KEEP').length,
    penaltiesPosted: penalties,
    penaltyTotal,
  };
}

async function stepRoomNights(st: RunState) {
  const { ctx } = st;
  const rows = await ctx.db.reservationRoom.findMany({
    where: { propertyId: st.propertyId, status: 'CHECKED_IN', arrival: { lte: parseDay(st.businessDate) } },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  let posted = 0;
  const failures: string[] = [];
  for (const [i, rr] of rows.entries()) {
    fault?.('room_nights', i);
    try {
      const out = await postNightsUpTo(ctx, rr.id, st.businessDate);
      posted += out.filter((p) => p.posted).length;
    } catch (err) {
      const m = err instanceof AppError ? (err.detail ?? err.message) : (err as Error).message;
      failures.push(`${rr.id}: ${m}`);
    }
  }
  if (failures.length)
    throw new Error(`Room nights could not be posted for ${failures.length} stay(s): ${failures.join('; ')}`);
  return { stays: rows.length, posted };
}

/**
 * Closes the day: `properties.closed_through_date` = D, so no posting may be dated on or before it
 * (folio check + `hm_closed_day_guard` trigger); `night_audits.locked_at` records when.
 */
async function stepLockDay(st: RunState) {
  const { ctx } = st;
  st.audit = await ctx.db.$transaction(async (tx) => {
    // Exclusive day lock: waits for in-flight postings, later ones see the closing.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${dayLockKey(st.propertyId)}, 0))::text AS l`;
    const row = await tx.nightAudit.findUniqueOrThrow({ where: { id: st.audit.id } });
    const day = parseDay(st.businessDate);
    const p = await tx.property.findUniqueOrThrow({ where: { id: st.propertyId }, select: { closedThroughDate: true } });
    if (!p.closedThroughDate || p.closedThroughDate < day)
      await tx.property.update({ where: { id: st.propertyId }, data: { closedThroughDate: day } });
    if (row.lockedAt) return row;
    return tx.nightAudit.update({ where: { id: st.audit.id }, data: { lockedAt: now() } });
  });
  return { lockedAt: st.audit.lockedAt?.toISOString() ?? null };
}

async function stepStats(st: RunState) {
  const { ctx } = st;
  const prev = await ctx.db.nightAudit.findFirst({
    where: { propertyId: st.propertyId, businessDate: { lt: parseDay(st.businessDate) }, lockedAt: { not: null } },
    orderBy: { businessDate: 'desc' },
    select: { lockedAt: true },
  });
  const from = prev?.lockedAt ?? zonedMidnight(st.businessDate, st.timezone);
  const to = st.audit.lockedAt ?? now();
  const noShows = Number(st.summary.steps.no_shows?.result?.noShows ?? 0);
  const kpis = await ctx.db.$transaction(async (tx) => {
    const s = await computeDayStats(tx, {
      propertyId: st.propertyId,
      currency: st.currency,
      businessDate: st.businessDate,
      window: { from, to },
      noShows,
    });
    await writeDailyStats(tx, ctx.tenantId, st.propertyId, s);
    return s;
  });
  st.kpis = kpis;
  return { roomsSold: kpis.roomsSold, occupancy: kpis.occupancy, totalRevenue: kpis.totalRevenue };
}

async function stepAdvance(st: RunState) {
  const { ctx } = st;
  const next = addDays(st.businessDate, 1);
  await ctx.db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM properties WHERE id = ${st.propertyId}::uuid FOR UPDATE`;
    const p = await tx.property.findUniqueOrThrow({ where: { id: st.propertyId } });
    const cur = formatDay(p.businessDate);
    if (cur === st.businessDate)
      await tx.property.update({ where: { id: st.propertyId }, data: { businessDate: parseDay(next) } });
    else if (cur !== next)
      throw conflict(`The business date moved to ${cur} meanwhile`, { reason: 'BUSINESS_DATE_MOVED' });
    st.summary.advanced = true;
    await tx.nightAudit.update({
      where: { id: st.audit.id },
      data: { summary: st.summary as unknown as Prisma.InputJsonValue },
    });
  });
  await ctx.audit({
    action: 'property.business_date.advance',
    entity: 'property',
    entityId: st.propertyId,
    before: { businessDate: st.businessDate },
    after: { businessDate: next, nightAuditId: st.audit.id },
  });
  return { businessDate: next };
}

async function stepReport(st: RunState) {
  try {
    const out = await renderAuditReport(st.ctx, { ...st.audit, summary: st.summary as never }, await kpisOf(st));
    st.summary.reportFileId = out.fileId;
    return { fileId: out.fileId };
  } catch (err) {
    // Never fatal: the PDF is rendered again on download.
    st.ctx.services.logger.error('night audit report failed', { auditId: st.audit.id, err: (err as Error).message });
    st.summary.reportFileId = null;
    return { fileId: null, error: (err as Error).message.slice(0, 300) };
  }
}

/** Active users holding `night_audit.run` on the property (the managers). */
export async function managersOf(ctx: RCtx, propertyId: string) {
  const users = await ctx.db.user.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: {
      id: true,
      email: true,
      name: true,
      userRoles: { select: { role: { select: { rolePermissions: { select: { permissionKey: true } } } } } },
      userProperties: { select: { propertyId: true } },
    },
  });
  return users.filter((u) => {
    const perms = u.userRoles.flatMap((r) => r.role.rolePermissions.map((p) => p.permissionKey));
    return (
      hasPermission(perms, 'night_audit.run') &&
      (perms.includes('*') || u.userProperties.some((p) => p.propertyId === propertyId))
    );
  });
}

async function stepNotify(st: RunState) {
  const { ctx } = st;
  const k = await kpisOf(st);
  const prop = await ctx.db.property.findUniqueOrThrow({ where: { id: st.propertyId }, select: { name: true } });
  let notified = 0;
  for (const u of await managersOf(ctx, st.propertyId))
    try {
      await sendGuestNotice(ctx.services, {
        tenantId: ctx.tenantId,
        channels: ['in_app', 'email'],
        to: { email: u.email },
        userId: u.id,
        templateCode: 'night_audit_completed',
        data: {
          hotel: { name: prop.name },
          audit: {
            businessDate: st.businessDate,
            occupancy: k?.occupancy ?? '0.0',
            roomsSold: k?.roomsSold ?? 0,
            roomRevenue: { amount: k?.roomRevenue ?? 0, currency: st.currency },
            totalRevenue: { amount: k?.totalRevenue ?? 0, currency: st.currency },
            url: '',
          },
        },
        link: '/night-audit',
        idempotencyKey: `night_audit:${st.audit.id}:${u.id}`,
      });
      notified++;
    } catch (err) {
      ctx.services.logger.warn('night audit notification failed', { userId: u.id, err: (err as Error).message });
    }
  return { notified };
}

/** KPIs computed by this run, or read back from the columns when the stats step ran earlier. */
async function kpisOf(st: RunState): Promise<DayStats | null> {
  st.kpis ??= (await loadKpis(st.ctx.db, st.audit)) ?? undefined;
  return st.kpis ?? null;
}

const STEP_FNS: Record<Step, (st: RunState) => Promise<Record<string, unknown>>> = {
  no_shows: stepNoShows,
  room_nights: stepRoomNights,
  lock_day: stepLockDay,
  stats: stepStats,
  advance_date: stepAdvance,
  report: stepReport,
  notify: stepNotify,
};

// ───────────────────────────── run ─────────────────────────────

export interface RunInput {
  propertyId: string;
  /** Business date to close: the idempotency key of the run (must be the current one). */
  businessDate: string;
  decisions?: Decision[] | undefined;
  trigger?: 'manual' | 'auto';
}

function progress(st: RunState, step: Step, status: 'running' | 'done' | 'failed', error?: string) {
  st.ctx.services.realtime?.emitToProperty(st.ctx.tenantId, st.propertyId, NIGHT_AUDIT_EVENTS.progress, {
    propertyId: st.propertyId,
    auditId: st.audit.id,
    businessDate: st.businessDate,
    step,
    index: STEPS.indexOf(step),
    total: STEPS.length,
    status,
    ...(error ? { error } : {}),
  });
}

const LOCK_TX = { maxWait: 20_000, timeout: 15 * 60_000 };

/**
 * Night audit (OP-24) of the current business date `D`, one run at a time per property
 * (advisory lock held for the whole run) and idempotent per `D`: a completed audit is returned
 * as is, an interrupted or failed one resumes at its first unfinished step.
 */
export async function runNightAudit(ctx: RCtx, input: RunInput) {
  assertPropertyAccess(ctx, input.propertyId);
  return ctx.db.$transaction(async (lockTx) => {
    const [r] = await lockTx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${`night_audit:${input.propertyId}`}, 0)) AS ok`;
    if (!r?.ok)
      throw conflict('A night audit is already running for this property', { reason: 'NIGHT_AUDIT_RUNNING' });
    return execute(ctx, input);
  }, LOCK_TX);
}

async function execute(ctx: RCtx, input: RunInput) {
  const prop = await requireProperty(ctx, input.propertyId);
  const D = input.businessDate;
  let audit = await ctx.db.nightAudit.findUnique({
    where: { propertyId_businessDate: { propertyId: prop.id, businessDate: parseDay(D) } },
  });
  if (audit?.status === 'COMPLETED')
    return { audit: toAudit(audit, await loadKpis(ctx.db, audit)), alreadyCompleted: true };
  const resumable = audit && summaryOf(audit).advanced && prop.businessDate === addDays(D, 1);
  if (prop.businessDate !== D && !resumable)
    throw conflict(`The current business date is ${prop.businessDate}, not ${D}`, {
      reason: 'BUSINESS_DATE_MISMATCH',
      businessDate: prop.businessDate,
    });

  if (!audit) {
    const pc = await precheck(ctx, prop.id);
    const blocking = blockingCodes(pc);
    if (blocking.length)
      throw conflict('Blocking pre-checks must be resolved first', { reason: 'PRECHECK_BLOCKED', checks: blocking });
    const decisions = validateDecisions(pc, input.decisions ?? []);
    audit = await ctx.db.nightAudit.create({
      data: {
        tenantId: ctx.tenantId,
        propertyId: prop.id,
        businessDate: parseDay(D),
        status: 'RUNNING',
        startedBy: ctx.actorId,
        summary: {
          trigger: input.trigger ?? 'manual',
          decisions,
          warnings: pc.checks
            .filter((c) => c.severity !== 'DECISION' && c.count > 0)
            .map((c) => ({ code: c.code, count: c.count })),
          steps: {},
        } satisfies Summary as unknown as Prisma.InputJsonValue,
      },
    });
    await ctx.audit({
      action: 'night_audit.start',
      entity: 'night_audit',
      entityId: audit.id,
      after: { businessDate: D, decisions, trigger: input.trigger ?? 'manual' },
    });
  } else {
    const s = summaryOf(audit);
    audit = await saveSummary(ctx, audit.id, { ...s, error: null }, { status: 'RUNNING' });
  }

  const st: RunState = {
    ctx,
    audit,
    summary: summaryOf(audit),
    propertyId: prop.id,
    businessDate: D,
    currency: prop.currency,
    timezone: prop.timezone,
  };
  for (const step of STEPS) {
    if (st.summary.steps[step]?.status === 'done') continue;
    progress(st, step, 'running');
    try {
      fault?.(step, -1);
      const result = await STEP_FNS[step](st);
      st.summary.steps[step] = { status: 'done', at: now().toISOString(), result };
      st.audit = await saveSummary(ctx, audit.id, st.summary);
      progress(st, step, 'done');
    } catch (err) {
      const m = err instanceof AppError ? (err.detail ?? err.message) : (err as Error).message;
      st.summary.steps[step] = { status: 'failed', at: now().toISOString(), error: m.slice(0, 500) };
      st.summary.error = m.slice(0, 500);
      await ctx.db.$transaction(async (tx) => {
        await tx.nightAudit.update({
          where: { id: audit.id },
          data: { status: 'FAILED', summary: st.summary as unknown as Prisma.InputJsonValue },
        });
        await publishNightAudit(tx, NIGHT_AUDIT_EVENTS.failed, {
          propertyId: prop.id,
          auditId: audit.id,
          businessDate: D,
          step,
          error: m.slice(0, 300),
        });
      });
      progress(st, step, 'failed', m);
      ctx.services.logger.error('night audit step failed', { auditId: audit.id, step, err: m });
      throw new AppError('CONFLICT', undefined, {
        detail: `Night audit step ${step} failed: ${m}`,
        meta: { reason: 'NIGHT_AUDIT_FAILED', step, auditId: audit.id },
      });
    }
  }

  const kpis = await kpisOf(st);
  const done = await ctx.db.$transaction(async (tx) => {
    const row = await tx.nightAudit.update({
      where: { id: audit.id },
      data: {
        status: 'COMPLETED',
        completedAt: now(),
        summary: { ...st.summary, error: null } as unknown as Prisma.InputJsonValue,
      },
    });
    await publishNightAudit(tx, NIGHT_AUDIT_EVENTS.completed, {
      propertyId: prop.id,
      auditId: audit.id,
      businessDate: D,
      newBusinessDate: addDays(D, 1),
      occupancy: kpis?.occupancy ?? null,
      roomRevenue: kpis?.roomRevenue ?? 0,
      totalRevenue: kpis?.totalRevenue ?? 0,
    });
    return row;
  });
  await ctx.audit({
    action: 'night_audit.complete',
    entity: 'night_audit',
    entityId: audit.id,
    after: { businessDate: D, kpis },
  });
  return { audit: toAudit(done, kpis), alreadyCompleted: false };
}

function validateDecisions(pc: Precheck, decisions: Decision[]): Decision[] {
  const pending = pc.checks.find((c) => c.code === 'PENDING_ARRIVALS')?.items ?? [];
  const ids = new Set(pending.map((i) => i.reservationId!));
  const byId = new Map<string, Decision>();
  for (const d of decisions) {
    if (!ids.has(d.reservationId))
      throw invalid('decisions', `Reservation ${d.reservationId} is not a pending arrival`, 'NOT_PENDING');
    byId.set(d.reservationId, d);
  }
  const missing = [...ids].filter((id) => !byId.has(id));
  if (missing.length)
    throw conflict('Each pending arrival needs a decision (no-show or keep)', {
      reason: 'DECISIONS_REQUIRED',
      reservationIds: missing,
    });
  for (const i of pending)
    if (!i.canNoShow && byId.get(i.reservationId!)?.action === 'NO_SHOW')
      throw invalid('decisions', `Reservation ${i.number} cannot be marked no-show`, 'NO_SHOW_NOT_ALLOWED');
  return [...byId.values()].map((d) => ({
    reservationId: d.reservationId,
    action: d.action,
    ...(d.waivePenalty ? { waivePenalty: true } : {}),
  }));
}

// ───────────────────────────── reads ─────────────────────────────

export async function listAudits(
  ctx: RCtx,
  q: { propertyId: string; limit: number; cursor?: string | undefined },
) {
  assertPropertyAccess(ctx, q.propertyId);
  const rows = await ctx.db.nightAudit.findMany({
    where: { propertyId: q.propertyId },
    orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
  });
  const more = rows.length > q.limit;
  const items = more ? rows.slice(0, q.limit) : rows;
  const out = [];
  for (const a of items) out.push(toAudit(a, await loadKpis(ctx.db, a)));
  return { items: out, nextCursor: more ? (items[items.length - 1]?.id ?? null) : null };
}

export async function loadAudit(ctx: RCtx, id: string): Promise<NightAudit> {
  const a = await ctx.db.nightAudit.findFirst({ where: { id } });
  if (!a) throw notFound('Night audit not found');
  assertPropertyAccess(ctx, a.propertyId);
  return a;
}

export const getAudit = async (ctx: RCtx, id: string) => {
  const a = await loadAudit(ctx, id);
  return toAudit(a, await loadKpis(ctx.db, a));
};

/** Signed URL of the day report (rendered on demand when missing). */
export async function auditReport(ctx: RCtx, id: string) {
  const a = await loadAudit(ctx, id);
  const s = summaryOf(a);
  const kpis = await loadKpis(ctx.db, a);
  if (!kpis) throw conflict('The day statistics are not computed yet', { reason: 'NO_STATS' });
  const file = s.reportFileId ? await ctx.db.file.findFirst({ where: { id: s.reportFileId } }) : null;
  let key: string;
  let fileId: string;
  if (file) {
    key = file.key;
    fileId = file.id;
  } else {
    const out = await renderAuditReport(ctx, a, kpis);
    key = out.key;
    fileId = out.fileId;
    await saveSummary(ctx, a.id, { ...s, reportFileId: out.fileId });
  }
  return { fileId, url: await notificationDeps(ctx.services).storage.signedUrl(key) };
}
