import type { AdminClient } from '@hm/database';
import type { SubscriptionStatus } from '@hm/shared';
import type { JsonCache } from '../lib/redis.js';

/** Kind of host a request arrived on. */
export type HostKind = 'admin' | 'platform' | 'tenant';

export interface ResolvedTenant {
  id: string;
  slug: string;
  name: string;
  /** TenantStatus (ACTIVE | SUSPENDED | ARCHIVED). */
  status: string;
  hostname: string;
  domainType: 'SUBDOMAIN' | 'CUSTOM';
}

/** `NONE`: the tenant has no subscription row (treated as read-only by the guard). */
export type EffectiveSubscriptionStatus = SubscriptionStatus | 'NONE';

export interface TenantDirectoryOptions {
  adminHosts: readonly string[];
  platformHosts: readonly string[];
  hostTtlSeconds: number;
  subscriptionTtlSeconds: number;
  /** TTL of the negative cache for unknown hosts (default 30 s). */
  missTtlSeconds?: number;
}

const MISS = { miss: true } as const;
const hostKey = (host: string) => `hm:tenant-host:${host}`;
const subKey = (tenantId: string) => `hm:tenant-sub:${tenantId}`;

/** Normalizes a Host header: lowercase, no port, no trailing dot. */
export function normalizeHost(raw: string | undefined): string {
  if (!raw) return '';
  let host = raw.trim().toLowerCase();
  if (host.startsWith('[')) host = host.slice(0, host.indexOf(']') + 1);
  else host = host.split(':')[0] ?? '';
  return host.replace(/\.$/, '');
}

/**
 * Host → tenant resolution through `tenant_domains` (admin client, platform table), with a
 * Redis cache (5 min by default). Only verified domains resolve (sub-domains are verified by
 * construction; custom domains need `verified_at`). Archived or deleted tenants never resolve.
 */
export class TenantDirectory {
  private readonly adminHosts: Set<string>;
  private readonly platformHosts: Set<string>;

  constructor(
    private readonly admin: AdminClient,
    private readonly cache: JsonCache,
    private readonly opts: TenantDirectoryOptions,
  ) {
    this.adminHosts = new Set(opts.adminHosts.map(normalizeHost));
    this.platformHosts = new Set(opts.platformHosts.map(normalizeHost));
  }

  classify(host: string): HostKind {
    if (this.adminHosts.has(host)) return 'admin';
    if (this.platformHosts.has(host)) return 'platform';
    return 'tenant';
  }

  async resolveHost(rawHost: string): Promise<ResolvedTenant | null> {
    const host = normalizeHost(rawHost);
    if (!host || this.classify(host) !== 'tenant') return null;
    const cached = await this.cache.get<ResolvedTenant | typeof MISS>(hostKey(host));
    if (cached) return 'miss' in cached ? null : cached;

    const domain = await this.admin.tenantDomain.findUnique({
      where: { hostname: host },
      include: {
        tenant: { select: { id: true, slug: true, name: true, status: true, deletedAt: true } },
      },
    });
    const usable =
      domain &&
      (domain.type === 'SUBDOMAIN' || domain.verifiedAt !== null) &&
      domain.tenant.deletedAt === null &&
      domain.tenant.status !== 'ARCHIVED';
    if (!usable) {
      await this.cache.set(hostKey(host), MISS, this.opts.missTtlSeconds ?? 30);
      return null;
    }
    const resolved: ResolvedTenant = {
      id: domain.tenant.id,
      slug: domain.tenant.slug,
      name: domain.tenant.name,
      status: domain.tenant.status,
      hostname: host,
      domainType: domain.type,
    };
    await this.cache.set(hostKey(host), resolved, this.opts.hostTtlSeconds);
    return resolved;
  }

  /** Status of the tenant's current (latest) subscription, cached briefly. */
  async subscriptionStatus(tenantId: string): Promise<EffectiveSubscriptionStatus> {
    const cached = await this.cache.get<{ status: EffectiveSubscriptionStatus }>(subKey(tenantId));
    if (cached) return cached.status;
    const sub = await this.admin.subscription.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    const status: EffectiveSubscriptionStatus = sub?.status ?? 'NONE';
    await this.cache.set(subKey(tenantId), { status }, this.opts.subscriptionTtlSeconds);
    return status;
  }

  /** CORS: is `origin`'s host a verified domain of an active tenant? */
  async isTenantOrigin(origin: string): Promise<boolean> {
    try {
      return (await this.resolveHost(new URL(origin).host)) !== null;
    } catch {
      return false;
    }
  }

  /** Drops cached host resolutions and subscription status of a tenant. */
  async invalidateTenant(tenantId: string): Promise<void> {
    const domains = await this.admin.tenantDomain.findMany({
      where: { tenantId },
      select: { hostname: true },
    });
    await this.cache.del(
      subKey(tenantId),
      ...domains.map((d) => hostKey(normalizeHost(d.hostname))),
    );
  }

  async invalidateHost(host: string): Promise<void> {
    await this.cache.del(hostKey(normalizeHost(host)));
  }
}
