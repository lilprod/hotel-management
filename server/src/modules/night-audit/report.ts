import type { NightAudit } from '@hm/database';
import type { NightAuditReportData } from '@hm/templates';
import { formatDay } from '../property/common.js';
import type { RCtx } from '../reservations/context.js';
import { renderPdf } from '../notifications/jobs.js';
import { METHOD_LABELS, sellerParty } from '../folio/parties.js';
import { asTx } from '../folio/repository.js';
import type { DayStats } from './stats.js';

/** Manager report of a closed day (KPIs, revenue by department, payments by method, taxes). */
export async function buildReportData(
  ctx: RCtx,
  audit: NightAudit,
  k: DayStats | null,
): Promise<NightAuditReportData> {
  const s = (audit.summary ?? {}) as { warnings?: { code: string; count: number }[] };
  if (!k) throw new Error('The day statistics are not computed');
  const m = (amount: number) => ({ amount, currency: k.currency });
  const [hotel, departments, starter] = await Promise.all([
    sellerParty(ctx.services, asTx(ctx.db), ctx.tenantId, audit.propertyId),
    ctx.db.department.findMany({
      where: { propertyId: audit.propertyId, deletedAt: null },
      select: { code: true, name: true },
    }),
    audit.startedBy
      ? ctx.db.user.findFirst({ where: { id: audit.startedBy }, select: { name: true } })
      : Promise.resolve(null),
  ]);
  const deptName = new Map(departments.map((d) => [d.code, d.name]));
  return {
    hotel,
    businessDate: formatDay(audit.businessDate),
    closedAt: (audit.lockedAt ?? new Date()).toISOString(),
    ...(starter ? { closedBy: starter.name } : {}),
    kpis: {
      occupancy: k.occupancy,
      roomsSold: k.roomsSold,
      roomsAvailable: k.roomsAvailable,
      adr: m(k.adr),
      revpar: m(k.revpar),
      roomRevenue: m(k.roomRevenue),
      totalRevenue: m(k.totalRevenue),
      arrivals: k.arrivals,
      departures: k.departures,
      inHouse: k.inHouse,
      noShows: k.noShows,
    },
    revenueByDepartment: Object.entries(k.revenueByDept).map(([code, amount]) => ({
      code,
      ...(deptName.has(code) ? { label: deptName.get(code)! } : {}),
      amount: m(amount),
    })),
    payments: k.payments.map((p) => ({
      method: p.method,
      ...(METHOD_LABELS[p.method] ? { label: METHOD_LABELS[p.method] } : {}),
      amount: m(p.amount),
    })),
    taxes: k.taxes.map((t) => ({ code: t.code, name: t.name, kind: t.kind, amount: m(t.amount) })),
    warnings: s.warnings ?? [],
  };
}

export async function renderAuditReport(ctx: RCtx, audit: NightAudit, kpis: DayStats | null) {
  const data = await buildReportData(ctx, audit, kpis);
  return renderPdf(ctx.services, {
    type: 'night_audit_report',
    data,
    fileName: `cloture-${data.businessDate}.pdf`,
    ...(ctx.actorId ? { createdBy: ctx.actorId } : {}),
  });
}
