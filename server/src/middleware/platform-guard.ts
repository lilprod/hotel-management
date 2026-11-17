import type { RequestHandler } from 'express';
import { asyncHandler } from '../http/helpers.js';
import type { PlatformPrincipal } from '../http/types.js';
import { AppError, forbidden, unauthenticated } from '../lib/errors.js';

export const PLATFORM_ROLES = ['SUPER_ADMIN', 'FINANCE', 'SUPPORT', 'READ_ONLY'] as const;
export type PlatformRoleKey = (typeof PLATFORM_ROLES)[number];

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const cacheKey = (id: string) => `hm:platform-user:${id}`;
const TTL_S = 60;

export async function invalidatePlatformUser(
  services: Parameters<RequestHandler>[0]['services'],
  id: string,
): Promise<void> {
  await services.cache.del(cacheKey(id));
}

/**
 * Guard of every authenticated /api/v1/admin request (SA-40):
 * - the platform token must carry a verified second factor (TOTP is mandatory) → MFA_REQUIRED;
 * - the platform user must exist and be active → UNAUTHENTICATED;
 * - READ_ONLY users never write.
 * Sets `req.platformUser`; finer checks use `platformRole(...)` on the route.
 */
export function platformGuard(): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    if (req.surface !== 'admin' || !req.auth) return next();
    if (req.auth.scope !== 'platform') throw forbidden('Platform token required');
    if (!req.auth.mfa)
      throw new AppError('MFA_REQUIRED', undefined, {
        detail: 'Two-factor authentication is mandatory on the platform',
      });
    const { cache, admin } = req.services;
    const user = await cache.wrap<PlatformPrincipal | null>(
      cacheKey(req.auth.userId),
      TTL_S,
      async () => {
        const u = await admin.platformUser.findUnique({
          where: { id: req.auth!.userId },
          select: { id: true, email: true, name: true, role: true, isActive: true },
        });
        return u?.isActive ? { id: u.id, email: u.email, name: u.name, role: u.role } : null;
      },
    );
    if (!user) throw unauthenticated('Platform user not found or inactive');
    req.platformUser = user;
    if (user.role === 'READ_ONLY' && !SAFE.has(req.method) && !req.path.includes('/auth/'))
      throw forbidden('Read-only platform role', { role: user.role });
    next();
  });
}

/** Route guard: the platform user must have one of `roles` (SUPER_ADMIN always passes). */
export function platformRole(...roles: PlatformRoleKey[]): RequestHandler {
  const handler: RequestHandler = (req, _res, next) => {
    const user = req.platformUser;
    if (!user) return next(unauthenticated());
    if (user.role !== 'SUPER_ADMIN' && !roles.includes(user.role))
      return next(forbidden('Platform role not allowed', { role: user.role, required: roles }));
    next();
  };
  return Object.assign(handler, { permission: `platform:${roles.join('|') || 'SUPER_ADMIN'}` });
}
