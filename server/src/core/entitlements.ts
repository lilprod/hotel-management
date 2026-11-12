import { createHash } from 'node:crypto';
import type { AdminClient } from '@hm/database';
import type { JsonCache } from '../lib/redis.js';

/** Effective rights of a tenant (doc 02 §1 bis, doc 03 §5 bis X2/X3). */
export interface Entitlements {
  tenantId: string;
  planCode: string | null;
  features: string[];
  /** `null` = unlimited; a missing key = not granted (limit 0). */
  quotas: Record<string, number | null>;
  computedAt: string;
}

export const ENTITLEMENTS_CHANGED = 'entitlements.changed';

const cacheKey = (tenantId: string) => `hm:entitlements:${tenantId}`;

/** Deterministic bucket in [0, 100) of a tenant for a progressive rollout. */
export function rolloutBucket(featureKey: string, tenantId: string): number {
  return createHash('sha256').update(`${featureKey}:${tenantId}`).digest().readUInt32BE(0) % 100;
}

function asBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value && typeof value === 'object' && 'enabled' in value) {
    const e = (value as { enabled: unknown }).enabled;
    if (typeof e === 'boolean') return e;
  }
  return undefined;
}

function asLimit(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (value && typeof value === 'object' && 'limit' in value)
    return asLimit((value as { limit: unknown }).limit);
  return undefined;
}

/**
 * entitlements.resolve(tenantId) = plan features ∪ active add-ons ∪ active rollouts, then
 * tenant overrides (FEATURE overrides can grant or revoke; QUOTA overrides set the limit).
 * Quotas: plan limit + Σ add-on deltas (`null` stays unlimited).
 * Cached in Redis; invalidated on `entitlements.changed` (see core module).
 */
export class EntitlementsService {
  constructor(
    private readonly admin: AdminClient,
    private readonly cache: JsonCache,
    private readonly ttlSeconds: number,
  ) {}

  resolve(tenantId: string): Promise<Entitlements> {
    return this.cache.wrap(cacheKey(tenantId), this.ttlSeconds, () => this.compute(tenantId));
  }

  async invalidate(tenantId: string): Promise<void> {
    await this.cache.del(cacheKey(tenantId));
  }

  async has(tenantId: string, featureKey: string): Promise<boolean> {
    return (await this.resolve(tenantId)).features.includes(featureKey);
  }

  /** Limit of a quota (`null` = unlimited, 0 when not granted). */
  async limit(tenantId: string, quotaKey: string): Promise<number | null> {
    const q = (await this.resolve(tenantId)).quotas;
    return quotaKey in q ? (q[quotaKey] ?? null) : 0;
  }

  async compute(tenantId: string, now = new Date()): Promise<Entitlements> {
    const [subscription, addons, overrides, rollouts] = await Promise.all([
      this.admin.subscription.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        include: { plan: { include: { planFeatures: true, planQuotas: true } } },
      }),
      this.admin.tenantAddon.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
          addon: { isActive: true },
        },
        include: { addon: true },
      }),
      this.admin.tenantOverride.findMany({
        where: {
          tenantId,
          kind: { in: ['FEATURE', 'QUOTA'] },
          OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.admin.featureRollout.findMany({ where: { status: { in: ['ACTIVE', 'COMPLETED'] } } }),
    ]);

    const features = new Set<string>();
    const quotas: Record<string, number | null> = {};
    const plan = subscription?.plan;

    if (plan && plan.isActive && plan.deletedAt === null) {
      for (const f of plan.planFeatures) if (f.enabled) features.add(f.featureKey);
      for (const q of plan.planQuotas) quotas[q.quotaKey] = q.limit;
    }

    for (const ta of addons) {
      for (const f of ta.addon.featureKeys) features.add(f);
      const deltas = ta.addon.quotaDeltas;
      if (deltas && typeof deltas === 'object' && !Array.isArray(deltas)) {
        for (const [key, raw] of Object.entries(deltas)) {
          if (typeof raw !== 'number' || !Number.isInteger(raw)) continue;
          const current = quotas[key];
          if (current === null) continue; // already unlimited
          quotas[key] = (current ?? 0) + raw;
        }
      }
    }

    for (const r of rollouts) {
      if (
        r.status === 'COMPLETED' ||
        r.tenantIds.includes(tenantId) ||
        rolloutBucket(r.featureKey, tenantId) < r.percentage
      )
        features.add(r.featureKey);
    }

    for (const o of overrides) {
      if (o.kind === 'FEATURE') {
        const enabled = asBool(o.value);
        if (enabled === true) features.add(o.key);
        else if (enabled === false) features.delete(o.key);
      } else if (o.kind === 'QUOTA') {
        const limit = asLimit(o.value);
        if (limit !== undefined) quotas[o.key] = limit;
      }
    }

    return {
      tenantId,
      planCode: plan?.code ?? null,
      features: [...features].sort(),
      quotas,
      computedAt: now.toISOString(),
    };
  }
}
