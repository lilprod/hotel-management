import { Router } from 'express';
import { createProblem } from '@hm/shared';
import type { Services } from '../core/container.js';
import { sendProblem } from '../middleware/error-handler.js';

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** GET /health (liveness, no dependency) and GET /ready (PostgreSQL + Redis). */
export function healthRouter(services: Services): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeS: Math.round(process.uptime()) });
  });
  router.get('/ready', async (req, res) => {
    const [db, redis] = await Promise.allSettled([
      withTimeout(services.admin.$queryRaw`SELECT 1`, 2_000),
      withTimeout(services.redis.ping(), 2_000),
    ]);
    const checks = { database: db.status === 'fulfilled', redis: redis.status === 'fulfilled' };
    if (checks.database && checks.redis) return void res.json({ status: 'ready', checks });
    services.logger.warn('readiness check failed', { checks });
    sendProblem(
      res,
      createProblem('SERVICE_UNAVAILABLE', 'Service unavailable', {
        meta: { checks },
        instance: '/ready',
        requestId: req.requestId,
      }),
    );
  });
  return router;
}
