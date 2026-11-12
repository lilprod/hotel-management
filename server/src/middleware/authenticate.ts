import type { RequestHandler } from 'express';
import { asyncHandler } from '../http/helpers.js';
import type { Surface } from '../http/types.js';
import { AppError } from '../lib/errors.js';
import { verifyAccessToken, type TokenScope } from '../lib/jwt.js';
import { getRequestContext } from '../lib/request-context.js';

const SCOPE_OF_SURFACE: Record<Surface, TokenScope> = {
  t: 'staff',
  portal: 'portal',
  admin: 'platform',
};

/**
 * Verifies the Bearer access token when present (jose, HS256) and sets `req.auth`.
 * - invalid / expired / revoked token → 401 UNAUTHENTICATED;
 * - `tid` ≠ tenant resolved from the Host → 403 TENANT_MISMATCH;
 * - token scope ≠ surface scope (staff on /portal, platform on a tenant host…) → 403 FORBIDDEN.
 * Absence of a token is not an error here: `requireAuth` (applied per module) enforces it.
 */
export function authenticate(): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const header = req.header('authorization');
    if (!header) return next();
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    if (!match?.[1])
      throw new AppError('UNAUTHENTICATED', undefined, {
        detail: 'Malformed Authorization header',
      });
    const { config, revocations } = req.services;
    const claims = await verifyAccessToken(match[1], {
      secret: config.JWT_ACCESS_SECRET,
      issuer: config.JWT_ISSUER,
      audience: config.JWT_AUDIENCE,
    });

    if (req.tenant) {
      if (claims.scope === 'platform')
        throw new AppError('FORBIDDEN', undefined, { detail: 'Platform token on a tenant host' });
      if (claims.tid !== req.tenant.id) throw new AppError('TENANT_MISMATCH');
    } else if (claims.scope !== 'platform') {
      // Staff/portal token on an admin or platform host.
      throw new AppError('TENANT_MISMATCH');
    }
    if (req.surface && SCOPE_OF_SURFACE[req.surface] !== claims.scope)
      throw new AppError('FORBIDDEN', undefined, {
        detail: `A ${SCOPE_OF_SURFACE[req.surface]} token is required on this API`,
      });
    if (await revocations.isRevoked(claims.sid))
      throw new AppError('UNAUTHENTICATED', undefined, { detail: 'Session revoked' });

    req.auth = {
      scope: claims.scope,
      userId: claims.sub,
      ...(claims.tid ? { tenantId: claims.tid } : {}),
      sessionId: claims.sid,
      permVer: claims.perm_ver,
      claims,
    };
    const ctx = getRequestContext();
    if (ctx) ctx.userId = claims.sub;
    next();
  });
}
