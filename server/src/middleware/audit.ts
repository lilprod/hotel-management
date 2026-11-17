import type { Prisma } from '@hm/database';
import type { Request, RequestHandler } from 'express';
import { ipOf, writePlatformAudit, writeTenantAudit } from '../modules/audit/service.js';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  before?: Prisma.InputJsonValue | Record<string, unknown>;
  after?: Prisma.InputJsonValue | Record<string, unknown>;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ENTRIES = Symbol('auditEntries');

type AuditableRequest = Request & { [ENTRIES]?: AuditEntry[] };

/**
 * `recordAudit(req, { action, entity, entityId, before, after })`: adds an explicit audit entry
 * for the current request, written once the response succeeded (tenant trail on tenant hosts,
 * platform trail on /api/v1/admin). For entries that must survive a failure, see `auditNow`.
 */
export function recordAudit(req: Request, entry: AuditEntry): void {
  const r = req as AuditableRequest;
  (r[ENTRIES] ??= []).push(entry);
}

/**
 * Audit hook: once a request succeeded (status < 400), writes the explicit entries recorded by
 * services, or a generic `METHOD /route` entry for any mutating request. Tenant entries carry the
 * staff user and the impersonating platform user; admin-surface entries go to
 * `platform_audit_logs`. Both tables are append-only (DB trigger).
 */
export function auditHook(): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      const tenant = req.tenant;
      const platform = !tenant && req.surface === 'admin';
      if ((!tenant && !platform) || res.statusCode >= 400) return;
      const explicit = (req as AuditableRequest)[ENTRIES] ?? [];
      if (!explicit.length && !MUTATING.has(req.method)) return;
      const route =
        `${req.baseUrl}${(req.route as { path?: string } | undefined)?.path ?? ''}` || req.path;
      const entries: AuditEntry[] = explicit.length
        ? explicit
        : [{ action: `${req.method} ${route}`, entity: 'http', after: { status: res.statusCode } }];
      const { logger } = req.services;
      const userAgent = req.header('user-agent') ?? null;
      const ip = ipOf(req);
      const write = tenant
        ? (e: AuditEntry) =>
            writeTenantAudit(req.services, {
              ...e,
              tenantId: tenant.id,
              userId: req.auth?.scope === 'staff' ? req.auth.userId : null,
              impersonatedBy: req.auth?.impersonatedBy ?? null,
              ip,
              userAgent,
            })
        : (e: AuditEntry) =>
            writePlatformAudit(req.services, {
              ...e,
              actorId: req.auth?.scope === 'platform' ? req.auth.userId : null,
              ip,
              userAgent,
            });
      Promise.all(entries.map(write)).catch((err: unknown) =>
        logger.error('audit write failed', { err, requestId: req.requestId }),
      );
    });
    next();
  };
}
