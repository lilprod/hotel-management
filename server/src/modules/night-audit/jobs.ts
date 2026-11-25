import type { Services } from '../../core/container.js';
import { defineJob } from '../../jobs/context.js';
import { AppError } from '../../lib/errors.js';
import { addDays, formatDay, localDay } from '../availability/dates.js';
import { now, runSystem, sendGuestNotice, type RCtx } from '../reservations/context.js';
import { blockingCodes, precheck } from './precheck.js';
import { managersOf, runNightAudit, type Decision } from './service.js';
import { nightAuditSettings, type AutoSettings } from './settings.js';
import { zonedMidnight } from './stats.js';

export const NIGHT_AUDIT_QUEUE = 'night-audit';

export interface AutoOutcome {
  propertyId: string;
  businessDate: string;
  outcome: 'completed' | 'blocked' | 'failed';
  reasons?: string[];
}

/**
 * Instant the automatic audit of business date `D` is due: `time` on D itself for an evening
 * time (≥ 12:00), on D + 1 for a night/morning time (03:00 closes the previous day).
 */
export function dueAt(businessDate: string, auto: Pick<AutoSettings, 'time'>, timeZone: string): Date {
  const [hh, mm] = auto.time.split(':').map(Number) as [number, number];
  const day = hh >= 12 ? businessDate : addDays(businessDate, 1);
  return new Date(zonedMidnight(day, timeZone).getTime() + (hh * 60 + mm) * 60_000);
}

async function notifyBlocked(ctx: RCtx, propertyId: string, D: string, reasons: string[]) {
  const prop = await ctx.db.property.findUniqueOrThrow({ where: { id: propertyId }, select: { name: true } });
  for (const u of await managersOf(ctx, propertyId))
    await sendGuestNotice(ctx.services, {
      tenantId: ctx.tenantId,
      channels: ['in_app', 'email'],
      to: { email: u.email },
      userId: u.id,
      templateCode: 'night_audit_blocked',
      data: { hotel: { name: prop.name }, audit: { businessDate: D, reasons: reasons.join(', '), url: '' } },
      link: '/night-audit',
      idempotencyKey: `night_audit:blocked:${propertyId}:${D}`,
    }).catch((err: unknown) =>
      ctx.services.logger.warn('night audit blocked notice failed', { err: (err as Error).message }),
    );
}

/** Automatic run of one property: only when the pre-checks do not block, else the managers are told. */
export async function autoRun(ctx: RCtx, propertyId: string, D: string, auto: AutoSettings): Promise<AutoOutcome> {
  const pc = await precheck(ctx, propertyId);
  const reasons: string[] = blockingCodes(pc);
  const arrivals = pc.checks.find((c) => c.code === 'PENDING_ARRIVALS')?.items ?? [];
  if (arrivals.length && auto.pendingArrivals === 'BLOCK') reasons.push('PENDING_ARRIVALS');
  if (!pc.running && reasons.length) {
    await notifyBlocked(ctx, propertyId, D, reasons);
    return { propertyId, businessDate: D, outcome: 'blocked', reasons };
  }
  const decisions: Decision[] = arrivals.map((a) => ({
    reservationId: a.reservationId!,
    action: auto.pendingArrivals === 'NO_SHOW' && a.canNoShow ? 'NO_SHOW' : 'KEEP',
  }));
  try {
    await runNightAudit(ctx, { propertyId, businessDate: D, decisions, trigger: 'auto' });
    return { propertyId, businessDate: D, outcome: 'completed' };
  } catch (err) {
    const reason = err instanceof AppError ? String(err.meta?.reason ?? err.code) : 'ERROR';
    if (reason === 'NIGHT_AUDIT_RUNNING') return { propertyId, businessDate: D, outcome: 'blocked', reasons: [reason] };
    await notifyBlocked(ctx, propertyId, D, [reason]);
    return { propertyId, businessDate: D, outcome: 'failed', reasons: [reason] };
  }
}

/**
 * `night-audit-check` (doc 03 §5): for every property with `night_audit.auto.enabled`, runs the
 * audit of its business date once its local time is past the configured time.
 */
export async function runNightAuditCheck(services: Services, at: Date = now()): Promise<AutoOutcome[]> {
  const out: AutoOutcome[] = [];
  const properties = await services.admin.property.findMany({
    where: { deletedAt: null },
    select: { id: true, tenantId: true, timezone: true, businessDate: true },
  });
  for (const p of properties) {
    const auto = await services.settings.get(nightAuditSettings.auto, { tenantId: p.tenantId, propertyId: p.id });
    if (!auto.enabled) continue;
    const D = formatDay(p.businessDate);
    // Never close a day that has not started locally yet.
    if (D > localDay(at, p.timezone) || at < dueAt(D, auto, p.timezone)) continue;
    try {
      out.push(await runSystem(services, p.tenantId, (ctx) => autoRun(ctx, p.id, D, auto)));
    } catch (err) {
      services.logger.error('automatic night audit failed', { propertyId: p.id, err: (err as Error).message });
      out.push({ propertyId: p.id, businessDate: D, outcome: 'failed' });
    }
  }
  return out;
}

export interface CheckData {
  /** ISO instant (tests / manual replays); defaults to the clock. */
  now?: string;
}

export const nightAuditCheckJob = defineJob<CheckData>({
  name: 'night-audit-check',
  queue: NIGHT_AUDIT_QUEUE,
  tenantScoped: false,
  repeat: { pattern: '*/5 * * * *' },
  options: { attempts: 1 },
  handler: (data, { services }) => runNightAuditCheck(services, data?.now ? new Date(data.now) : now()),
});
