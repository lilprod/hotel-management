import { QUOTA_KEYS } from '@hm/shared';
import type { Services } from '../../core/container.js';
import type { Db } from './common.js';

export type QuotaUsage = Record<(typeof QUOTA_KEYS)[number], number>;

/**
 * Current consumption of the quotas (doc 02 §1: properties, units, users, storage, SMS of the
 * month). Platform-plane counts through the admin client, always filtered by tenant id.
 */
export async function quotaUsage(db: Db, tenantId: string, now = new Date()): Promise<QuotaUsage> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [properties, units, users, storage, sms] = await Promise.all([
    db.property.count({ where: { tenantId, deletedAt: null } }),
    db.room.count({ where: { tenantId, deletedAt: null } }),
    db.user.count({
      where: {
        tenantId,
        deletedAt: null,
        status: { in: ['ACTIVE', 'INVITED', 'PENDING_VERIFICATION'] },
      },
    }),
    db.file.aggregate({ where: { tenantId }, _sum: { size: true } }),
    db.communication.count({
      where: { tenantId, channel: 'SMS', direction: 'OUTBOUND', createdAt: { gte: monthStart } },
    }),
  ]);
  const bytes = storage._sum.size ?? 0n;
  return {
    properties,
    units,
    users,
    storage_mb: Number((bytes + 1_048_575n) / 1_048_576n),
    sms_per_month: sms,
  };
}

/** Usage with the effective limits (`null` = unlimited). */
export async function quotaReport(services: Services, tenantId: string) {
  const [usage, ent] = await Promise.all([
    quotaUsage(services.admin, tenantId),
    services.entitlements.resolve(tenantId),
  ]);
  return QUOTA_KEYS.map((key) => ({
    key,
    used: usage[key],
    limit: key in ent.quotas ? (ent.quotas[key] ?? null) : 0,
  }));
}

/** Limits a plan (+ active add-ons) would give: quota check before a downgrade (SA-22). */
export async function planLimits(
  db: Db,
  planId: string,
  tenantId: string,
): Promise<Record<string, number | null>> {
  const [quotas, addons] = await Promise.all([
    db.planQuota.findMany({ where: { planId } }),
    db.tenantAddon.findMany({
      where: { tenantId, status: 'ACTIVE', OR: [{ endsAt: null }, { endsAt: { gt: new Date() } }] },
      include: { addon: true },
    }),
  ]);
  const out: Record<string, number | null> = {};
  for (const q of quotas) out[q.quotaKey] = q.limit;
  for (const ta of addons) {
    const deltas = ta.addon.quotaDeltas as Record<string, unknown> | null;
    for (const [k, v] of Object.entries(deltas ?? {})) {
      if (typeof v !== 'number' || !Number.isInteger(v)) continue;
      const cur = out[k];
      if (cur === null) continue;
      out[k] = (cur ?? 0) + v;
    }
  }
  return out;
}

export async function quotaViolations(db: Db, planId: string, tenantId: string) {
  const [usage, limits] = await Promise.all([
    quotaUsage(db, tenantId),
    planLimits(db, planId, tenantId),
  ]);
  return QUOTA_KEYS.filter((k) => k !== 'sms_per_month')
    .map((key) => ({ key, used: usage[key], limit: key in limits ? limits[key]! : 0 }))
    .filter((v) => v.limit !== null && v.used > v.limit);
}
