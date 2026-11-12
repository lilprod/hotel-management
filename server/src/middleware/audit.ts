import { runWithTenant, type Prisma } from '@hm/database';
import type { Request, RequestHandler } from 'express';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const ENTRIES = Symbol('auditEntries');

type AuditableRequest = Request & { [ENTRIES]?: AuditEntry[] };

/** Adds an explicit audit entry (with before/after) for the current request. */
export function recordAudit(req: Request, entry: AuditEntry): void {
  const r = req as AuditableRequest;
  (r[ENTRIES] ??= []).push(entry);
}

function ipOf(req: Request): string | null {
  const ip = req.ip?.replace(/^::ffff:/, '');
  return ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null;
}

/**
 * Audit hook: once a tenant request succeeded (status < 400), writes the explicit entries
 * recorded by services, or a generic `METHOD /route` entry for any mutating request. Entries are
 * append-only (DB trigger). Writes run after the response, in the request's tenant context.
 */
export function auditHook(): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      const tenant = req.tenant;
      if (!tenant || res.statusCode >= 400) return;
      const explicit = (req as AuditableRequest)[ENTRIES] ?? [];
      if (!explicit.length && !MUTATING.has(req.method)) return;
      const route =
        `${req.baseUrl}${(req.route as { path?: string } | undefined)?.path ?? ''}` || req.path;
      const entries: AuditEntry[] = explicit.length
        ? explicit
        : [{ action: `${req.method} ${route}`, entity: 'http', after: { status: res.statusCode } }];
      const { db, logger } = req.services;
      const userId = req.auth?.scope === 'staff' ? req.auth.userId : null;
      const userAgent = req.header('user-agent')?.slice(0, 512) ?? null;
      const ip = ipOf(req);
      runWithTenant(tenant.id, () =>
        db.auditLog.createMany({
          data: entries.map((e) => ({
            tenantId: tenant.id,
            userId,
            action: e.action,
            entity: e.entity,
            entityId: e.entityId ?? null,
            ...(e.before !== undefined ? { before: e.before } : {}),
            ...(e.after !== undefined ? { after: e.after } : {}),
            ip,
            userAgent,
          })),
        }),
      ).catch((err: unknown) =>
        logger.error('audit write failed', { err, requestId: req.requestId }),
      );
    });
    next();
  };
}
