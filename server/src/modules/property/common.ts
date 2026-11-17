import { runWithTenant, type AppClient } from '@hm/database';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { z } from 'zod';
import type { Services } from '../../core/container.js';
import { PermissionService, type UserGrants } from '../../core/permissions.js';
import { loadGrants } from '../../http/helpers.js';
import { AppError, forbidden, notFound } from '../../lib/errors.js';

/** Request-scoped context handed to services: the tenant always comes from the resolved Host. */
export interface Ctx {
  services: Services;
  db: AppClient;
  tenantId: string;
  userId: string;
  grants: UserGrants;
}

/** Runs `fn` inside the RLS tenant context of the request. */
export async function withCtx<T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  const tenantId = req.tenant?.id;
  if (!tenantId) throw notFound('Unknown tenant');
  const grants = await loadGrants(req);
  return runWithTenant(tenantId, () =>
    fn({ services: req.services, db: req.services.db, tenantId, userId: grants.userId, grants }),
  );
}

/** Property scope for id-based routes (checked once the entity is loaded). */
export function assertPropertyAccess(ctx: Ctx, propertyId: string): void {
  if (!PermissionService.reachesProperty(ctx.grants, propertyId))
    throw forbidden('Property not in your scope', { propertyId });
}

/** `can(..., { property })` extractor: property id from query or body (pre-validation). */
export function propertyFromRequest(req: Request): string | undefined {
  const q = (req.query as Record<string, unknown> | undefined)?.propertyId;
  const b = (req.body as Record<string, unknown> | undefined)?.propertyId;
  const v = typeof q === 'string' ? q : typeof b === 'string' ? b : undefined;
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined;
}

/** Runs an Express middleware (e.g. checkQuota) from inside a handler, after validation. */
export function runGuard(guard: RequestHandler, req: Request, res: Response): Promise<void> {
  return new Promise((resolve, reject) => {
    const next: NextFunction = (err?: unknown) => (err ? reject(err) : resolve());
    try {
      guard(req, res, next);
    } catch (e) {
      reject(e);
    }
  });
}

// ─────────────────────────── shared Zod building blocks ───────────────────────────

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDay(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

export function formatDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Calendar day `YYYY-MM-DD` (a night is a DATE, arrival included, departure excluded). */
export const dayString = z
  .string()
  .regex(DAY_RE, 'Expected YYYY-MM-DD')
  .refine((s) => formatDay(parseDay(s)) === s, 'Invalid calendar date');

/** Integer amount in minor units (XOF has no decimals). Never a float. */
export const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const currencyCode = z.string().regex(/^[A-Z]{3}$/);

/** BigInt column → JSON number (amounts stay safe integers). */
export const num = (v: bigint | number): number => Number(v);

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: uuid.optional(),
});

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Cursor pagination: `rows` were fetched with `take: limit + 1` (see pageArgs). */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null };
}

export const pageArgs = (q: { limit: number; cursor?: string | undefined }) => ({
  take: q.limit + 1,
  ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().uuid().nullable() });

export function conflict(detail: string, meta?: Record<string, unknown>): AppError {
  return new AppError('CONFLICT', undefined, { detail, ...(meta ? { meta } : {}) });
}

export function invalid(path: string, message: string, code = 'custom'): AppError {
  return new AppError('VALIDATION_ERROR', undefined, { errors: [{ path, message, code }] });
}

/** Loads a tenant row or throws 404 (RLS already hides other tenants' rows). */
export function must<T>(row: T | null | undefined, what: string): T {
  if (!row) throw notFound(`${what} not found`);
  return row;
}
