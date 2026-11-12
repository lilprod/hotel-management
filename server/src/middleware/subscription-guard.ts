import type { RequestHandler } from 'express';
import { API_PREFIX } from '../lib/openapi.js';
import { asyncHandler } from '../http/helpers.js';
import { AppError } from '../lib/errors.js';
import type { EffectiveSubscriptionStatus } from '../core/tenants.js';

/**
 * Doc 02 §2 status → access:
 * - TRIALING / ACTIVE / PAST_DUE: full access;
 * - SUSPENDED (or no subscription, or tenant suspended): read only (GET/HEAD/OPTIONS) + export
 *   + payment page — writes only on whitelisted paths;
 * - CANCELLED: export only.
 */
export const SUSPENDED_WRITE_WHITELIST = [
  `${API_PREFIX}/t/auth`,
  `${API_PREFIX}/t/billing`,
  `${API_PREFIX}/t/exports`,
  `${API_PREFIX}/portal/auth`,
] as const;

export const CANCELLED_WHITELIST = [`${API_PREFIX}/t/auth`, `${API_PREFIX}/t/exports`] as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const matches = (path: string, prefixes: readonly string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

export type AccessLevel = 'full' | 'read_only' | 'export_only';

export function accessLevel(
  subscription: EffectiveSubscriptionStatus,
  tenantStatus: string,
): AccessLevel {
  if (subscription === 'CANCELLED') return 'export_only';
  if (subscription === 'SUSPENDED' || subscription === 'NONE' || tenantStatus === 'SUSPENDED')
    return 'read_only';
  return 'full';
}

export interface SubscriptionGuardOptions {
  suspendedWriteWhitelist?: readonly string[];
  cancelledWhitelist?: readonly string[];
}

export function subscriptionGuard(opts: SubscriptionGuardOptions = {}): RequestHandler {
  const suspended = opts.suspendedWriteWhitelist ?? SUSPENDED_WRITE_WHITELIST;
  const cancelled = opts.cancelledWhitelist ?? CANCELLED_WHITELIST;
  return asyncHandler(async (req, res, next) => {
    if (!req.tenant || (req.surface !== 't' && req.surface !== 'portal')) return next();
    const status = await req.services.tenants.subscriptionStatus(req.tenant.id);
    res.setHeader('X-Subscription-Status', status);
    const level = accessLevel(status, req.tenant.status);
    const path = req.path;
    if (level === 'full') return next();
    if (level === 'read_only' && (SAFE_METHODS.has(req.method) || matches(path, suspended)))
      return next();
    if (level === 'export_only' && matches(path, cancelled)) return next();
    throw new AppError('SUBSCRIPTION_SUSPENDED', undefined, {
      detail:
        level === 'export_only'
          ? 'Subscription cancelled: only data export is available'
          : 'Subscription suspended: read-only access until payment',
      meta: { subscriptionStatus: status, access: level },
    });
  });
}
