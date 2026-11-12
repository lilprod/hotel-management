import cors from 'cors';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { RedisStore, type RedisReply } from 'rate-limit-redis';
import { createProblem } from '@hm/shared';
import type { Services } from '../core/container.js';
import { sendProblem } from './error-handler.js';

/**
 * CORS allowlist: configured platform origins + verified domains of active tenants
 * (tenant_domains, cached). Credentials allowed (refresh cookie).
 */
export function corsAllowlist(services: Services): RequestHandler {
  const platform = new Set(services.config.CORS_ORIGINS);
  return cors({
    credentials: true,
    maxAge: 600,
    exposedHeaders: ['X-Request-Id', 'X-Subscription-Status', 'RateLimit', 'RateLimit-Policy'],
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // same-origin / server-to-server
      if (platform.has(origin.toLowerCase())) return cb(null, true);
      services.tenants.isTenantOrigin(origin).then(
        (ok) => cb(null, ok),
        (err: unknown) => cb(err as Error),
      );
    },
  });
}

/** express-rate-limit with a Redis store (shared across instances). */
export function rateLimiter(services: Services): RequestHandler {
  const { config, redis } = services;
  return rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    limit: config.RATE_LIMIT_MAX,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => req.path === '/health' || req.path === '/ready',
    store: new RedisStore({
      prefix: 'hm:rl:',
      sendCommand: (command: string, ...args: string[]) =>
        redis.call(command, ...args) as Promise<RedisReply>,
    }),
    handler: (req, res) => {
      const problem = createProblem('RATE_LIMITED', 'Too many requests', {
        instance: req.originalUrl.split('?')[0],
        requestId: req.requestId,
      });
      sendProblem(res, problem);
    },
  });
}
