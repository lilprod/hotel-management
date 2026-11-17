import { runWithTenant, type AppClient } from '@hm/database';
import type { Redis } from '../lib/redis.js';

/** Internal (unregistered) setting holding the tenant permission version. */
export const PERM_VER_SETTING = '_iam.perm_ver';
const key = (tenantId: string) => `hm:permver:${tenantId}`;
const TTL_S = 24 * 3600;

/**
 * Tenant-wide permission version (doc 05 §2: `perm_ver`, incremented on every role change).
 * Stored durably in `settings` (TENANT scope), mirrored in Redis. Any change of roles, role
 * permissions, assignments, properties or user status bumps it: cached grants keyed by the
 * previous version are no longer read, so the change applies on the very next request.
 */
export class PermVersionService {
  constructor(
    private readonly db: AppClient,
    private readonly redis: Redis,
  ) {}

  async current(tenantId: string): Promise<number> {
    const hit = await this.redis.get(key(tenantId));
    if (hit !== null) return Number(hit) || 0;
    const row = await runWithTenant(tenantId, () =>
      this.db.setting.findFirst({
        where: { scope: 'TENANT', scopeId: tenantId, key: PERM_VER_SETTING },
        select: { value: true },
      }),
    );
    const v = typeof row?.value === 'number' ? row.value : 0;
    await this.redis.set(key(tenantId), String(v), 'EX', TTL_S);
    return v;
  }

  /** Increments the version (call inside or outside the tenant context). */
  async bump(tenantId: string): Promise<number> {
    const next = await runWithTenant(tenantId, async () => {
      const row = await this.db.setting.findFirst({
        where: { scope: 'TENANT', scopeId: tenantId, key: PERM_VER_SETTING },
        select: { id: true, value: true },
      });
      const v = (typeof row?.value === 'number' ? row.value : 0) + 1;
      if (row) await this.db.setting.update({ where: { id: row.id }, data: { value: v } });
      else
        await this.db.setting.create({
          data: { tenantId, scope: 'TENANT', scopeId: tenantId, key: PERM_VER_SETTING, value: v },
        });
      return v;
    });
    await this.redis.set(key(tenantId), String(next), 'EX', TTL_S);
    return next;
  }
}
