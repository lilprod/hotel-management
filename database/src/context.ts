import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/** Thrown when a tenant-scoped database operation runs without a tenant in context. */
export class TenantContextError extends Error {
  override readonly name = 'TenantContextError';
  constructor(message = 'No tenant in context: wrap the call in runWithTenant(tenantId, fn)') {
    super(message);
  }
}

/**
 * Runs `fn` with `tenantId` as the current tenant. Every operation of an app client
 * (createAppClient) executed inside `fn` — including in awaited callbacks — is scoped to it.
 * The tenant id must come from the server-side context (resolved Host / verified JWT),
 * never from client input.
 */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  if (!UUID_RE.test(tenantId))
    throw new TenantContextError(`Invalid tenant id: ${JSON.stringify(tenantId)}`);
  return tenantStorage.run({ tenantId }, () => {
    const result = fn();
    // Prisma promises are lazy: they execute when `.then()` is first called. Subscribe here,
    // inside the context, so `runWithTenant(id, () => app.guest.findMany())` awaited by the
    // caller still runs with the tenant set.
    if (isThenable(result))
      return new Promise((resolve, reject) => result.then(resolve, reject)) as T;
    return result;
  });
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return (
    typeof v === 'object' && v !== null && typeof (v as { then?: unknown }).then === 'function'
  );
}

/** Current tenant id, or undefined outside runWithTenant. */
export function getTenantId(): string | undefined {
  return tenantStorage.getStore()?.tenantId;
}

/** Current tenant id; throws TenantContextError outside runWithTenant. */
export function requireTenantId(): string {
  const id = getTenantId();
  if (!id) throw new TenantContextError();
  return id;
}
