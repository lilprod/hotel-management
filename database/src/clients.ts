import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import type { Prisma } from './generated/prisma/client.js';
import { requireTenantId } from './context.js';

export type AdminClient = PrismaClient;
export type TransactionClient = Prisma.TransactionClient;

export interface ClientOptions {
  /** Connection string; defaults to DATABASE_URL_ADMIN (admin) or DATABASE_URL (app). */
  url?: string;
  /** Max pool size of the pg driver (default: pg default, 10). */
  max?: number;
}

export interface TenantTransactionOptions {
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

function makeBase(url: string | undefined, envName: string, max?: number): PrismaClient {
  if (!url) throw new Error(`${envName} is not set`);
  const adapter = new PrismaPg({ connectionString: url, ...(max ? { max } : {}) });
  return new PrismaClient({ adapter });
}

/**
 * Platform/admin client: owner role (DATABASE_URL_ADMIN), SUPERUSER or BYPASSRLS, so RLS does
 * not apply. Reserved for /api/v1/admin/*, migrations, cross-tenant jobs and fixtures.
 */
export function createAdminClient(options: ClientOptions = {}): AdminClient {
  return makeBase(options.url ?? process.env.DATABASE_URL_ADMIN, 'DATABASE_URL_ADMIN', options.max);
}

const setTenant = (tx: TransactionClient | PrismaClient, tenantId: string) =>
  tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

/**
 * Tenant client: hm_app role (DATABASE_URL, NOBYPASSRLS). Every operation — model queries and
 * raw queries — runs in a transaction that first executes
 * `SELECT set_config('app.tenant_id', <tenant>, true)` with the tenant of the current
 * runWithTenant() context; RLS policies then restrict rows to that tenant. Calling it outside
 * runWithTenant throws TenantContextError.
 *
 * Interactive transactions: `app.$transaction(async (tx) => ...)` opens one transaction, sets
 * the tenant once and hands a (non-extended) transaction client to the callback.
 * The array form `$transaction([...])` is not supported.
 */
export function createAppClient(options: ClientOptions = {}) {
  const base = makeBase(options.url ?? process.env.DATABASE_URL, 'DATABASE_URL', options.max);

  return base.$extends({
    name: 'hm-tenant-rls',
    query: {
      async $allOperations({ args, query }) {
        const tenantId = requireTenantId();
        const [, result] = await base.$transaction([setTenant(base, tenantId), query(args)]);
        return result;
      },
    },
    client: {
      async $transaction<R>(
        fn: (tx: TransactionClient) => Promise<R>,
        txOptions?: TenantTransactionOptions,
      ): Promise<R> {
        if (typeof fn !== 'function') {
          throw new TypeError(
            'App client: use $transaction(async (tx) => ...); the array form is not supported',
          );
        }
        const tenantId = requireTenantId();
        return base.$transaction(async (tx) => {
          await setTenant(tx, tenantId);
          return fn(tx);
        }, txOptions);
      },
    },
  });
}

export type AppClient = ReturnType<typeof createAppClient>;

let adminSingleton: AdminClient | undefined;

/**
 * Lazily-instantiated admin client (DATABASE_URL_ADMIN is read on first use, not at import).
 */
export const prisma: AdminClient = new Proxy({} as AdminClient, {
  get(_target, prop) {
    adminSingleton ??= createAdminClient();
    const value: unknown = Reflect.get(adminSingleton, prop, adminSingleton);
    return typeof value === 'function'
      ? (value as (...a: unknown[]) => unknown).bind(adminSingleton)
      : value;
  },
});
