import { runWithTenant, type AppClient } from '@hm/database';
import { hasPermission } from '@hm/shared';
import type { JsonCache } from '../lib/redis.js';

/** Effective grants of a staff user, loaded through the RLS-bound app client. */
export interface UserGrants {
  userId: string;
  tenantId: string;
  name: string;
  email: string;
  permissions: string[];
  /** Properties the user is attached to (`user_properties`). */
  propertyIds: string[];
}

const cacheKey = (tenantId: string, userId: string, permVer: number) =>
  `hm:perm:${tenantId}:${userId}:${permVer}`;

/**
 * Loads role permissions of a user. The cache key carries `perm_ver` (token claim, incremented
 * on every role change), so a role change takes effect with the next token without explicit
 * invalidation; old entries simply expire.
 */
export class PermissionService {
  constructor(
    private readonly db: AppClient,
    private readonly cache: JsonCache,
    private readonly ttlSeconds: number,
  ) {}

  async load(tenantId: string, userId: string, permVer: number): Promise<UserGrants | null> {
    const key = cacheKey(tenantId, userId, permVer);
    const hit = await this.cache.get<UserGrants>(key);
    if (hit) return hit;
    const grants = await this.fetch(tenantId, userId);
    if (grants) await this.cache.set(key, grants, this.ttlSeconds);
    return grants;
  }

  /** Bypasses the cache. Returns null when the user does not exist in this tenant or is not active. */
  fetch(tenantId: string, userId: string): Promise<UserGrants | null> {
    return runWithTenant(tenantId, async () => {
      const user = await this.db.user.findFirst({
        where: { id: userId, status: 'ACTIVE', deletedAt: null },
        select: {
          id: true,
          tenantId: true,
          name: true,
          email: true,
          userRoles: {
            select: { role: { select: { rolePermissions: { select: { permissionKey: true } } } } },
          },
          userProperties: { select: { propertyId: true } },
        },
      });
      if (!user || user.tenantId !== tenantId) return null;
      const permissions = new Set<string>();
      for (const ur of user.userRoles)
        for (const rp of ur.role.rolePermissions) permissions.add(rp.permissionKey);
      return {
        userId: user.id,
        tenantId: user.tenantId,
        name: user.name,
        email: user.email,
        permissions: [...permissions].sort(),
        propertyIds: user.userProperties.map((p) => p.propertyId).sort(),
      };
    });
  }

  static allows(grants: Pick<UserGrants, 'permissions'>, permission: string): boolean {
    return hasPermission(grants.permissions, permission);
  }

  /** Property scope: `*` holders reach every property, others only their `user_properties`. */
  static reachesProperty(
    grants: Pick<UserGrants, 'permissions' | 'propertyIds'>,
    propertyId: string,
  ) {
    return grants.permissions.includes('*') || grants.propertyIds.includes(propertyId);
  }
}
