import type { TestProject } from 'vitest/node';
import { startTestPostgres } from '../../database/test/pg.js';
import { startTestRedis } from './helpers/redis-server.js';

declare module 'vitest' {
  export interface ProvidedContext {
    infra: { adminUrl: string; appUrl: string; redisUrl: string };
  }
}

/** One migrated PostgreSQL 16 cluster and one redis-server per `vitest run`. */
export default async function setup(project: TestProject) {
  const [pg, redis] = await Promise.all([
    startTestPostgres({ database: 'hm_server_test' }),
    startTestRedis(),
  ]);
  project.provide('infra', { adminUrl: pg.adminUrl, appUrl: pg.appUrl, redisUrl: redis.url });
  return async () => {
    await Promise.allSettled([pg.stop(), redis.stop()]);
  };
}
