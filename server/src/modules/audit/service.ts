import { runWithTenant, type Prisma } from '@hm/database';
import type { Request } from 'express';
import type { Services } from '../../core/container.js';

export interface AuditInput {
  action: string;
  entity: string;
  entityId?: string | null | undefined;
  before?: unknown;
  after?: unknown;
}

export interface TenantAuditInput extends AuditInput {
  tenantId: string;
  userId?: string | null | undefined;
  impersonatedBy?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

export interface PlatformAuditInput extends AuditInput {
  actorId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
}

/** Keys never written to the audit trail (secrets, hashes, tokens). */
const SECRET_KEY_RE =
  /^(password|current_?password|new_?password|backup_?codes|secret|token)$|(hash|secret|secretenc|token)$/i;

/** Removes secrets recursively and converts values to JSON (BigInt → string, Date → ISO). */
export function sanitize(value: unknown, depth = 0): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null as unknown as Prisma.InputJsonValue;
  if (depth > 8) return '[depth]';
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((v) => sanitize(v, depth + 1) ?? null) as Prisma.InputJsonValue;
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue;
      const s = sanitize(v, depth + 1);
      if (s !== undefined) out[k] = s;
    }
    return out as Prisma.InputJsonValue;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    return value;
  return String(value as never);
}

/**
 * JSON diff (doc 05 §7): keeps only the top-level keys whose value changed. Returns
 * `{ before, after }` ready for an audit entry.
 */
export function diffJson(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before?: Record<string, unknown>; after?: Record<string, unknown> } {
  if (!before || !after) return { ...(before ? { before } : {}), ...(after ? { after } : {}) };
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const x = JSON.stringify(sanitize(before[k]) ?? null);
    const y = JSON.stringify(sanitize(after[k]) ?? null);
    if (x !== y) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}

export function ipOf(req: Request): string | null {
  const ip = req.ip?.replace(/^::ffff:/, '');
  return ip && /^[0-9a-f.:]+$/i.test(ip) ? ip : null;
}

const json = (v: unknown) => {
  const s = sanitize(v);
  return s === undefined || s === null ? {} : { v: s };
};

/** Writes a tenant audit entry immediately (append-only `audit_logs`, RLS context). */
export async function writeTenantAudit(services: Services, e: TenantAuditInput): Promise<void> {
  const before = json(e.before);
  const after = json(e.after);
  await runWithTenant(e.tenantId, () =>
    services.db.auditLog.create({
      data: {
        tenantId: e.tenantId,
        userId: e.userId ?? null,
        impersonatedBy: e.impersonatedBy ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        ...('v' in before ? { before: before.v } : {}),
        ...('v' in after ? { after: after.v } : {}),
        ip: e.ip ?? null,
        userAgent: e.userAgent?.slice(0, 512) ?? null,
      },
    }),
  );
}

/** Writes a platform audit entry immediately (append-only `platform_audit_logs`). */
export async function writePlatformAudit(services: Services, e: PlatformAuditInput): Promise<void> {
  const before = json(e.before);
  const after = json(e.after);
  await services.admin.platformAuditLog.create({
    data: {
      actorId: e.actorId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      ...('v' in before ? { before: before.v } : {}),
      ...('v' in after ? { after: after.v } : {}),
      ip: e.ip ?? null,
      userAgent: e.userAgent?.slice(0, 512) ?? null,
    },
  });
}

/**
 * Immediate audit from a request: tenant trail on tenant hosts (staff actor, impersonator),
 * platform trail on the admin surface. Used for authentication events that must be kept even
 * when the request fails (failed logins, lockouts, token reuse).
 */
export async function auditNow(
  req: Request,
  entry: AuditInput & { userId?: string | null; tenantId?: string },
): Promise<void> {
  const services = req.services;
  const ip = ipOf(req);
  const userAgent = req.header('user-agent') ?? null;
  const tenantId = entry.tenantId ?? req.tenant?.id;
  try {
    if (tenantId) {
      await writeTenantAudit(services, {
        ...entry,
        tenantId,
        userId: entry.userId ?? (req.auth?.scope === 'staff' ? req.auth.userId : null),
        impersonatedBy: req.auth?.impersonatedBy ?? null,
        ip,
        userAgent,
      });
    } else {
      await writePlatformAudit(services, {
        ...entry,
        actorId: entry.userId ?? (req.auth?.scope === 'platform' ? req.auth.userId : null),
        ip,
        userAgent,
      });
    }
  } catch (err) {
    services.logger.error('audit write failed', { err, requestId: req.requestId });
  }
}
