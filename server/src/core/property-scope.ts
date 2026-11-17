import type { Request } from 'express';
import { loadGrants } from '../http/helpers.js';
import { forbidden } from '../lib/errors.js';

/**
 * Per-property scoping (doc 05 §2: RBAC with a scope per property, `user_properties`).
 * Holders of `*` reach every property; others only the properties they are attached to.
 * Reusable by every module that stores `property_id`.
 */
export interface PropertyScope {
  all: boolean;
  propertyIds: string[];
}

export async function propertyScope(req: Request): Promise<PropertyScope> {
  const grants = await loadGrants(req);
  return { all: grants.permissions.includes('*'), propertyIds: grants.propertyIds };
}

/**
 * Prisma `where` fragment restricting a query to the caller's properties:
 * `findMany({ where: { ...(await propertyWhere(req)), status: 'OPEN' } })`.
 */
export async function propertyWhere<F extends string = 'propertyId'>(
  req: Request,
  field: F = 'propertyId' as F,
): Promise<Partial<Record<F, { in: string[] }>>> {
  const scope = await propertyScope(req);
  if (scope.all) return {};
  return { [field]: { in: scope.propertyIds } } as Record<F, { in: string[] }>;
}

export async function canReachProperty(req: Request, propertyId: string): Promise<boolean> {
  const scope = await propertyScope(req);
  return scope.all || scope.propertyIds.includes(propertyId);
}

/** Throws 403 when `propertyId` is outside the caller's scope. */
export async function assertPropertyAccess(req: Request, propertyId: string): Promise<void> {
  if (!(await canReachProperty(req, propertyId)))
    throw forbidden('Property not in your scope', { propertyId });
}

/** Keeps only the reachable ids of a list (e.g. a filter sent by the client). */
export async function filterReachable(req: Request, propertyIds: readonly string[]) {
  const scope = await propertyScope(req);
  return scope.all ? [...propertyIds] : propertyIds.filter((p) => scope.propertyIds.includes(p));
}

/** Extractors for `can(permission, { property })`. */
export const propertyFrom = {
  param:
    (name = 'propertyId') =>
    (req: Request) =>
      req.params[name],
  query:
    (name = 'propertyId') =>
    (req: Request) => {
      const v = req.query[name];
      return typeof v === 'string' ? v : undefined;
    },
  body:
    (name = 'propertyId') =>
    (req: Request) => {
      const v = (req.body as Record<string, unknown> | undefined)?.[name];
      return typeof v === 'string' ? v : undefined;
    },
};
