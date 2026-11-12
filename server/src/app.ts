import express, { Router, type Express } from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { Services } from './core/container.js';
import { ModuleRouter } from './core/router.js';
import { requireAuth } from './http/helpers.js';
import './http/types.js';
import type { Surface } from './http/types.js';
import {
  API_PREFIX,
  createOpenApiRegistry,
  generateOpenApiDocument,
  registerModuleRoutes,
  type OpenApiDocument,
} from './lib/openapi.js';
import { auditHook } from './middleware/audit.js';
import { authenticate } from './middleware/authenticate.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestId, requestLogger } from './middleware/request-id.js';
import { corsAllowlist, rateLimiter } from './middleware/security.js';
import { subscriptionGuard } from './middleware/subscription-guard.js';
import { tenantResolver } from './middleware/tenant-resolver.js';
import { healthRouter } from './routes/health.js';

const SCOPE: Record<Surface, 'staff' | 'portal' | 'platform'> = {
  t: 'staff',
  portal: 'portal',
  admin: 'platform',
};

export interface AppBundle {
  app: Express;
  openapi: OpenApiDocument;
}

/**
 * Builds the Express application (no listen): global middlewares in the order of doc 03 §3,
 * module routers under /api/v1/{t,portal,admin}, OpenAPI, central problem+json errors.
 */
export function createApp(services: Services): AppBundle {
  const { config, logger, modules } = services;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY > 0 ? config.TRUST_PROXY : false);

  app.use((req, _res, next) => {
    req.services = services;
    next();
  });
  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(corsAllowlist(services));
  app.use(rateLimiter(services));

  // Host-independent endpoints.
  app.use(healthRouter(services));
  const registry = createOpenApiRegistry();
  const mounted = modules.routers();
  registerModuleRoutes(registry, mounted);
  const openapi = generateOpenApiDocument(registry);
  app.get('/api/openapi.json', (_req, res) => void res.json(openapi));
  app.use(
    '/api/docs',
    swaggerUi.serveFiles(undefined, { swaggerOptions: { url: '/api/openapi.json' } }),
    swaggerUi.setup(undefined, { swaggerOptions: { url: '/api/openapi.json' } }),
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(tenantResolver());
  app.use(authenticate());
  app.use(subscriptionGuard());
  app.use(auditHook());

  const surfaces = new Map<Surface, Router>();
  for (const m of mounted) {
    let surfaceRouter = surfaces.get(m.surface);
    if (!surfaceRouter) {
      surfaceRouter = Router();
      surfaces.set(m.surface, surfaceRouter);
    }
    const guard = m.module.auth === 'optional' ? [] : [requireAuth(SCOPE[m.surface])];
    const router = m.router instanceof ModuleRouter ? m.router.router : m.router;
    surfaceRouter.use(m.basePath, ...guard, router);
  }
  for (const [surface, router] of surfaces) app.use(`${API_PREFIX}/${surface}`, router);

  app.use(notFoundHandler);
  app.use(errorHandler(logger, config.isProduction));
  return { app, openapi };
}
