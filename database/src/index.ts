export const DATABASE_NAME = '@hm/database';

export { createAdminClient, createAppClient, prisma } from './clients.js';
export type {
  AdminClient,
  AppClient,
  ClientOptions,
  TenantTransactionOptions,
  TransactionClient,
} from './clients.js';
export {
  runWithTenant,
  getTenantId,
  requireTenantId,
  tenantStorage,
  TenantContextError,
} from './context.js';
export type { TenantContext } from './context.js';

// Generated Prisma client: PrismaClient, Prisma namespace, enums and model types.
export * from './generated/prisma/client.js';
