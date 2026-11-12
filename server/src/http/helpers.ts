import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { z } from 'zod';
import { PermissionService } from '../core/permissions.js';
import { AppError, forbidden, unauthenticated } from '../lib/errors.js';
import './types.js';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => unknown;

/** Wraps an async middleware/handler so rejections reach the error handler (Express 4). */
export function asyncHandler(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    try {
      const r = fn(req, res, next);
      if (r && typeof (r as Promise<unknown>).then === 'function')
        (r as Promise<unknown>).catch(next);
    } catch (err) {
      next(err);
    }
  };
}

export interface ValidationSchemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/**
 * Validates body / query / params with Zod. Parsed values land in `req.valid` (and replace
 * `req.body`). A failure throws the ZodError, rendered as VALIDATION_ERROR with the field list;
 * paths are prefixed with the request part (`body.email`, `query.limit`).
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    req.valid ??= {};
    const issues: z.core.$ZodIssue[] = [];
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(req[part] ?? (part === 'body' ? {} : undefined));
      if (result.success) {
        req.valid[part] = result.data;
        if (part === 'body') req.body = result.data;
      } else {
        for (const issue of result.error.issues)
          issues.push({ ...issue, path: [part, ...issue.path] });
      }
    }
    if (issues.length) return next(new ValidationIssues(issues));
    next();
  };
}

/** Validation failure collected across request parts. */
export class ValidationIssues extends Error {
  override readonly name = 'ValidationIssues';
  constructor(readonly issues: z.core.$ZodIssue[]) {
    super('Validation failed');
  }
}

/** Requires an authenticated principal (any scope unless given). */
export function requireAuth(...scopes: ('staff' | 'portal' | 'platform')[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthenticated());
    if (scopes.length && !scopes.includes(req.auth.scope))
      return next(forbidden('Token scope not allowed on this route', { scope: req.auth.scope }));
    next();
  };
}

export interface CanOptions {
  /** Property scope: returns the target property id (checked against `user_properties`). */
  property?: (req: Request) => string | undefined;
}

/**
 * Staff permission check with the shared `hasPermission` (wildcards supported). Grants are
 * loaded per user and cached by `perm_ver`. Portal/platform tokens are always refused.
 */
export function can(permission: string, opts: CanOptions = {}): RequestHandler {
  const handler = asyncHandler(async (req, _res, next) => {
    const auth = req.auth;
    if (!auth) throw unauthenticated();
    if (auth.scope !== 'staff' || !auth.tenantId) throw forbidden('Staff token required');
    const grants = await loadGrants(req);
    if (!PermissionService.allows(grants, permission))
      throw forbidden(`Missing permission ${permission}`, { permission });
    if (opts.property) {
      const propertyId = opts.property(req);
      if (propertyId && !PermissionService.reachesProperty(grants, propertyId))
        throw forbidden('Property not in your scope', { propertyId });
    }
    next();
  });
  return Object.assign(handler, { permission });
}

/** Explicit opt-out of can() for routes open to any authenticated staff member (e.g. whoami). */
export function anyStaff(): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    if (!req.auth) throw unauthenticated();
    if (req.auth.scope !== 'staff') throw forbidden('Staff token required');
    await loadGrants(req);
    next();
  });
}

export async function loadGrants(req: Request) {
  if (req.grants) return req.grants;
  const auth = req.auth;
  if (!auth?.tenantId) throw unauthenticated();
  const grants = await req.services.permissions.load(auth.tenantId, auth.userId, auth.permVer);
  // Unknown / disabled user in this tenant (RLS-scoped lookup): the token is not usable.
  if (!grants) throw unauthenticated('User not found or inactive');
  req.grants = grants;
  return grants;
}

function tenantOf(req: Request): string {
  const id = req.tenant?.id;
  if (!id) throw new AppError('NOT_FOUND', undefined, { detail: 'Unknown tenant' });
  return id;
}

/** Requires a feature in the tenant's effective entitlements (plan ∪ add-ons ∪ overrides ∪ rollouts). */
export function requireFeature(featureKey: string): RequestHandler {
  const handler = asyncHandler(async (req, _res, next) => {
    const ok = await req.services.entitlements.has(tenantOf(req), featureKey);
    if (!ok)
      throw new AppError('FEATURE_NOT_IN_PLAN', undefined, {
        detail: `Feature ${featureKey} is not included in your subscription`,
        meta: { feature: featureKey },
      });
    next();
  });
  return Object.assign(handler, { feature: featureKey });
}

export interface QuotaCheck {
  /** Current usage (e.g. count of active users). */
  used: (req: Request) => Promise<number> | number;
  /** Units the request will add (default 1). */
  adding?: (req: Request) => number;
}

/** Creation-time quota check (doc 02 §1: never retroactive). */
export function checkQuota(quotaKey: string, check: QuotaCheck): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    const limit = await req.services.entitlements.limit(tenantOf(req), quotaKey);
    if (limit === null) return next();
    const used = await check.used(req);
    const adding = check.adding?.(req) ?? 1;
    if (used + adding > limit)
      throw new AppError('QUOTA_EXCEEDED', undefined, {
        detail: `Quota ${quotaKey} reached (${used}/${limit})`,
        meta: { quota: quotaKey, limit, used },
      });
    next();
  });
}
