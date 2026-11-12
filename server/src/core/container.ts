import { createAdminClient, createAppClient, type AdminClient, type AppClient } from '@hm/database';
import type { Config } from '../config.js';
import { createLogger, type Logger } from '../lib/logger.js';
import { createRedis, JsonCache, type Redis } from '../lib/redis.js';
import type { RealtimeEmitter } from '../realtime/socket.js';
import { EntitlementsService } from './entitlements.js';
import { ModuleRegistry, type ModuleDefinition } from './module.js';
import { PermissionService } from './permissions.js';
import { SessionRevocations } from './revocations.js';
import { SettingsService } from './settings.js';
import { TenantDirectory } from './tenants.js';

/** Long-lived services shared by the HTTP app, Socket.io and workers. */
export interface Services {
  config: Config;
  logger: Logger;
  redis: Redis;
  cache: JsonCache;
  /** Platform client (BYPASSRLS): tenant_domains, plans, subscriptions, cross-tenant jobs. */
  admin: AdminClient;
  /** Tenant client (RLS): every tenant data access, inside runWithTenant. */
  db: AppClient;
  tenants: TenantDirectory;
  entitlements: EntitlementsService;
  permissions: PermissionService;
  revocations: SessionRevocations;
  settings: SettingsService;
  modules: ModuleRegistry;
  /** Set once Socket.io is created (HTTP process) or the emit-only instance (worker). */
  realtime?: RealtimeEmitter;
}

export interface CreateServicesOptions {
  modules: readonly ModuleDefinition[];
  logger?: Logger;
  /** Pool size of each Prisma client. */
  dbPoolMax?: number;
}

export function createServices(config: Config, opts: CreateServicesOptions): Services {
  const logger = opts.logger ?? createLogger({ level: config.LOG_LEVEL });
  const redis = createRedis(config.REDIS_URL);
  const cache = new JsonCache(redis);
  const poolOpts = opts.dbPoolMax ? { max: opts.dbPoolMax } : {};
  const admin = createAdminClient({ url: config.DATABASE_URL_ADMIN, ...poolOpts });
  const db = createAppClient({ url: config.DATABASE_URL, ...poolOpts });
  const modules = new ModuleRegistry(opts.modules);
  return {
    config,
    logger,
    redis,
    cache,
    admin,
    db,
    modules,
    tenants: new TenantDirectory(admin, cache, {
      adminHosts: config.ADMIN_HOSTS,
      platformHosts: config.PLATFORM_HOSTS,
      hostTtlSeconds: config.TENANT_CACHE_TTL_S,
      subscriptionTtlSeconds: config.SUBSCRIPTION_CACHE_TTL_S,
    }),
    entitlements: new EntitlementsService(admin, cache, config.ENTITLEMENTS_CACHE_TTL_S),
    permissions: new PermissionService(db, cache, config.PERMISSIONS_CACHE_TTL_S),
    revocations: new SessionRevocations(redis),
    settings: new SettingsService(db, modules.settings, logger),
  };
}

export async function closeServices(s: Services): Promise<void> {
  await Promise.allSettled([s.admin.$disconnect(), s.db.$disconnect(), s.redis.quit()]);
}
