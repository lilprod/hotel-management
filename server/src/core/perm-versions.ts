import type { AdminClient } from '@hm/database';
import type { Redis } from '../lib/redis.js';

const key = (tenantId: string) => `hm:permver:${tenantId}`;
const TTL_S = 24 * 3600;

/**
 * Tenant-wide permission version (doc 05 §2: `perm_ver`, incremented on every role change).
 * Stored durably in `tenants.perm_ver` (platform table: admin client), mirrored in Redis. Any
 * change of roles, role permissions, assignments, properties or user status bumps it: cached
 * grants keyed by the previous version are no longer read, so the change applies on the very
 * next request.
 */
export class PermVersionService {
  constructor(
    private readonly admin: AdminClient,
    private readonly redis: Redis,
  ) {}

  async current(tenantId: string): Promise<number> {
    const hit = await this.redis.get(key(tenantId));
    if (hit !== null) return Number(hit) || 0;
    const row = await this.admin.tenant.findUnique({
      where: { id: tenantId },
      select: { permVer: true },
    });
    const v = row?.permVer ?? 0;
    await this.redis.set(key(tenantId), String(v), 'EX', TTL_S);
    return v;
  }

  /** Increments the version atomically (inside or outside the tenant context). */
  async bump(tenantId: string): Promise<number> {
    const { permVer } = await this.admin.tenant.update({
      where: { id: tenantId },
      data: { permVer: { increment: 1 } },
      select: { permVer: true },
    });
    await this.redis.set(key(tenantId), String(permVer), 'EX', TTL_S);
    return permVer;
  }
}
