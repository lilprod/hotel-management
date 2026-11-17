import { BlockList, isIP } from 'node:net';
import type { Request, RequestHandler } from 'express';
import { asyncHandler } from '../http/helpers.js';
import { AppError, forbidden } from '../lib/errors.js';
import { API_PREFIX } from '../lib/openapi.js';
import { pendingDocuments } from '../modules/legal/service.js';

const STAFF_PREFIX = `${API_PREFIX}/t`;
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Staff paths (relative to /api/v1/t) an impersonating support agent may not write to. */
export const IMPERSONATION_BLOCKED_PREFIXES = [
  '/auth/password',
  '/auth/mfa',
  '/auth/sessions',
  '/iam/users',
  '/iam/roles',
  '/iam/security-policy',
  '/billing',
  '/legal/accept',
] as const;

/** Paths usable before the legal documents are accepted / the password is changed. */
const ALWAYS_OPEN_PREFIXES = ['/auth', '/legal'] as const;

const under = (path: string, prefixes: readonly string[]) =>
  prefixes.some((p) => path === p || path.startsWith(`${p}/`));

function relativeStaffPath(req: Request): string {
  const p = req.path;
  return p.startsWith(STAFF_PREFIX) ? p.slice(STAFF_PREFIX.length) || '/' : p;
}

function clientIp(req: Request): string | null {
  const ip = req.ip?.replace(/^::ffff:/, '');
  return ip && isIP(ip) ? ip : null;
}

/** Builds a BlockList from CIDR / single-address entries (`10.0.0.0/8`, `203.0.113.7`). */
export function buildAllowlist(entries: readonly string[]): BlockList {
  const list = new BlockList();
  for (const raw of entries) {
    const [addr, bits] = raw.trim().split('/');
    const type = isIP(addr ?? '');
    if (!addr || !type) continue;
    const family = type === 6 ? 'ipv6' : 'ipv4';
    if (bits === undefined) list.addAddress(addr, family);
    else list.addSubnet(addr, Number(bits), family);
  }
  return list;
}

export function ipAllowed(entries: readonly string[], ip: string | null): boolean {
  if (!entries.length) return true;
  if (!ip) return false;
  return buildAllowlist(entries).check(ip, isIP(ip) === 6 ? 'ipv6' : 'ipv4');
}

/**
 * Tenant staff-surface gates, after `authenticate`:
 * 1. IP allowlist (TN-15, feature `security.ip_restriction`), login included;
 * 2. impersonation restrictions (doc 05 §4): no password, MFA, users/roles, security or billing
 *    writes while `impersonated_by` is set;
 * 3. forced password change (`mcp` claim: expiry, admin reset) — only /auth and /legal;
 * 4. legal acceptance (EX-04): latest TOS/DPA accepted by the owner, else
 *    403 with `meta.reason = LEGAL_ACCEPTANCE_REQUIRED` (except /auth and /legal).
 */
export function staffGates(): RequestHandler {
  return asyncHandler(async (req, _res, next) => {
    if (!req.tenant || req.surface !== 't') return next();
    const { services } = req;
    const tenantId = req.tenant.id;
    const path = relativeStaffPath(req);

    const policy = await services.securityPolicies.get(tenantId);
    if (
      policy.ipAllowlist.length &&
      (await services.entitlements.has(tenantId, 'security.ip_restriction')) &&
      !ipAllowed(policy.ipAllowlist, clientIp(req))
    )
      throw forbidden('Your IP address is not allowed for this hotel', {
        reason: 'IP_NOT_ALLOWED',
      });

    const auth = req.auth;
    if (!auth || auth.scope !== 'staff') return next();

    if (auth.impersonatedBy && !SAFE.has(req.method) && under(path, IMPERSONATION_BLOCKED_PREFIXES))
      throw forbidden('This action is not allowed while impersonating', {
        reason: 'IMPERSONATION_RESTRICTED',
      });

    if (under(path, ALWAYS_OPEN_PREFIXES)) return next();

    if (auth.mustChangePassword)
      throw forbidden('You must change your password first', {
        reason: 'PASSWORD_CHANGE_REQUIRED',
      });

    const pending = await pendingDocuments(services, tenantId);
    if (pending.length)
      throw new AppError('FORBIDDEN', 'Legal acceptance required', {
        detail: 'The latest terms must be accepted by the account owner',
        meta: {
          reason: 'LEGAL_ACCEPTANCE_REQUIRED',
          pending: pending.map((d) => ({ id: d.id, type: d.type, version: d.version })),
        },
      });
    next();
  });
}
