import { runWithTenant, type Prisma } from '@hm/database';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { createModuleRouter } from '../../core/router.js';
import { can } from '../../http/helpers.js';
import { platformRole } from '../../middleware/platform-guard.js';

const MAX_EXPORT = 50_000;

const filters = z.object({
  action: z.string().trim().max(100).optional(),
  entity: z.string().trim().max(100).optional(),
  entityId: z.string().trim().max(100).optional(),
  userId: z.string().uuid().optional(),
  impersonated: z.enum(['true', 'false']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
const listQuery = filters.extend({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** Opaque cursor = id of the last entry of the previous page (UUID v7, time ordered). */
  cursor: z.string().uuid().optional(),
});
type Filters = z.infer<typeof filters>;

const entry = z.object({
  id: z.string(),
  at: z.string(),
  userId: z.string().nullable(),
  impersonatedBy: z.string().nullable().optional(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
});
const page = z.object({ items: z.array(entry), nextCursor: z.string().nullable() });

function actionWhere(action?: string) {
  if (!action) return {};
  return action.endsWith('*') ? { startsWith: action.slice(0, -1) } : { equals: action };
}

function tenantWhere(f: Filters): Prisma.AuditLogWhereInput {
  return {
    ...(f.action ? { action: actionWhere(f.action) } : {}),
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.impersonated === 'true' ? { impersonatedBy: { not: null } } : {}),
    ...(f.impersonated === 'false' ? { impersonatedBy: null } : {}),
    ...(f.from || f.to
      ? { at: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } }
      : {}),
  };
}

function platformWhere(f: Filters): Prisma.PlatformAuditLogWhereInput {
  return {
    ...(f.action ? { action: actionWhere(f.action) } : {}),
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.userId ? { actorId: f.userId } : {}),
    ...(f.from || f.to
      ? { at: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } }
      : {}),
  };
}

interface Row {
  id: string;
  at: Date;
  action: string;
  entity: string;
  entityId: string | null;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  ip: string | null;
  userAgent: string | null;
  userId?: string | null;
  actorId?: string | null;
  impersonatedBy?: string | null;
}

function serialize(r: Row) {
  return {
    id: r.id,
    at: r.at.toISOString(),
    userId: r.userId ?? r.actorId ?? null,
    ...(r.impersonatedBy !== undefined ? { impersonatedBy: r.impersonatedBy } : {}),
    action: r.action,
    entity: r.entity,
    entityId: r.entityId,
    before: r.before ?? null,
    after: r.after ?? null,
    ip: r.ip,
    userAgent: r.userAgent,
  };
}

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'string' ? v : JSON.stringify(v);
  // CSV / formula injection guard (spreadsheet apps).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSV_COLUMNS = [
  'at',
  'userId',
  'impersonatedBy',
  'action',
  'entity',
  'entityId',
  'ip',
  'userAgent',
  'before',
  'after',
] as const;

function sendCsv(res: Response, filename: string, rows: ReturnType<typeof serialize>[]) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows)
    lines.push(CSV_COLUMNS.map((c) => csvCell((r as Record<string, unknown>)[c])).join(','));
  res
    .status(200)
    .type('text/csv; charset=utf-8')
    .setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(`${String.fromCharCode(0xfeff)}${lines.join('\r\n')}\r\n`);
}

const tags = ['audit'];

async function tenantList(req: Request, q: z.infer<typeof listQuery>) {
  const rows = await runWithTenant(req.tenant!.id, () =>
    req.services.db.auditLog.findMany({
      where: { ...tenantWhere(q), ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    }),
  );
  const items = rows.slice(0, q.limit).map(serialize);
  return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
}

/** Tenant audit trail `/api/v1/t/audit` (TN-17): read-only, filterable, CSV export. */
export const auditRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags,
    summary: 'Audit entries (newest first, cursor pagination)',
    middleware: [can('audit.read')],
    request: { query: listQuery },
    responses: { 200: { description: 'Page', schema: page } },
    handler: (req) => tenantList(req, req.valid.query),
  })
  .route({
    method: 'get',
    path: '/export',
    tags,
    summary: 'CSV export of the filtered audit entries',
    middleware: [can('audit.export')],
    request: { query: filters },
    responses: { 200: { description: 'text/csv' } },
    handler: async (req, res) => {
      const rows = await runWithTenant(req.tenant!.id, () =>
        req.services.db.auditLog.findMany({
          where: tenantWhere(req.valid.query),
          orderBy: { id: 'desc' },
          take: MAX_EXPORT,
        }),
      );
      sendCsv(res, 'audit.csv', rows.map(serialize));
    },
  });

/** Platform audit trail `/api/v1/admin/audit` (SA-41). */
export const platformAuditRouter = createModuleRouter()
  .route({
    method: 'get',
    path: '/',
    tags: ['platform: audit'],
    summary: 'Platform audit entries',
    middleware: [platformRole('SUPPORT', 'FINANCE', 'READ_ONLY')],
    request: { query: listQuery },
    responses: { 200: { description: 'Page', schema: page } },
    handler: async (req) => {
      const q = req.valid.query;
      const rows = await req.services.admin.platformAuditLog.findMany({
        where: { ...platformWhere(q), ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
        orderBy: { id: 'desc' },
        take: q.limit + 1,
      });
      const items = rows.slice(0, q.limit).map(serialize);
      return { items, nextCursor: rows.length > q.limit ? (items.at(-1)?.id ?? null) : null };
    },
  })
  .route({
    method: 'get',
    path: '/export',
    tags: ['platform: audit'],
    summary: 'CSV export of the platform audit',
    middleware: [platformRole('SUPPORT', 'FINANCE', 'READ_ONLY')],
    request: { query: filters },
    handler: async (req, res) => {
      const rows = await req.services.admin.platformAuditLog.findMany({
        where: platformWhere(req.valid.query),
        orderBy: { id: 'desc' },
        take: MAX_EXPORT,
      });
      sendCsv(res, 'platform-audit.csv', rows.map(serialize));
    },
  });
