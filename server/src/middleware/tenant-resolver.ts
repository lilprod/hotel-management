import { runWithTenant } from '@hm/database';
import type { RequestHandler } from 'express';
import { normalizeHost } from '../core/tenants.js';
import { asyncHandler } from '../http/helpers.js';
import type { Surface } from '../http/types.js';
import { AppError } from '../lib/errors.js';
import { getRequestContext } from '../lib/request-context.js';

const SURFACE_RE = /^\/api\/v1\/(t|portal|admin)(?:\/|$)/;

export function surfaceOf(path: string): Surface | undefined {
  return SURFACE_RE.exec(path)?.[1] as Surface | undefined;
}

const unknownTenant = () => new AppError('NOT_FOUND', undefined, { detail: 'Unknown tenant' });

/**
 * Host → tenant. Admin hosts only serve /api/v1/admin; platform hosts serve no tenant surface;
 * any other host must be a verified tenant domain (404 otherwise). On a tenant host the rest of
 * the request runs inside runWithTenant(tenant.id) — the tenant never comes from the client.
 * The staff vs portal surface is the path prefix (/api/v1/t vs /api/v1/portal); `authenticate`
 * then requires the matching token scope.
 */
export function tenantResolver(): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const { tenants } = req.services;
    const host = normalizeHost(req.hostname);
    const kind = tenants.classify(host);
    const surface = surfaceOf(req.path);
    req.hostKind = kind;
    if (surface) req.surface = surface;

    if (kind === 'admin') {
      if (surface === 't' || surface === 'portal') throw unknownTenant();
      return next();
    }
    if (surface === 'admin')
      throw new AppError('NOT_FOUND', undefined, { detail: 'Route not found' });
    if (kind === 'platform') {
      if (surface) throw unknownTenant();
      return next();
    }

    const tenant = await tenants.resolveHost(host);
    if (!tenant) throw unknownTenant();
    req.tenant = tenant;
    const ctx = getRequestContext();
    if (ctx) ctx.tenantId = tenant.id;
    runWithTenant(tenant.id, () => next());
  });
}
