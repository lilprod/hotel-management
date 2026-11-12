import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  type RouteConfig,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import { PROBLEM_CONTENT_TYPE, problemSchema } from '@hm/shared';
import type { MountedRouter } from '../core/module.js';
import { ModuleRouter } from '../core/router.js';

// Enables `.openapi({...})` metadata on Zod schemas (examples, refs) for every module.
extendZodWithOpenApi(z);

export const API_PREFIX = '/api/v1';

/** Express path `/a/:id` → OpenAPI path `/a/{id}`. */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

export function createOpenApiRegistry(): OpenAPIRegistry {
  const registry = new OpenAPIRegistry();
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });
  return registry;
}

const problemResponse = (description: string) => ({
  description,
  content: { [PROBLEM_CONTENT_TYPE]: { schema: problemSchema } },
});

/** Registers every route of the mounted module routers (each module documents its own routes). */
export function registerModuleRoutes(registry: OpenAPIRegistry, mounted: readonly MountedRouter[]) {
  for (const m of mounted) {
    if (!(m.router instanceof ModuleRouter)) continue;
    for (const r of m.router.routes) {
      const path = toOpenApiPath(
        `${API_PREFIX}/${m.surface}${m.basePath}${r.path}`.replace(/\/+$/, ''),
      );
      const responses: RouteConfig['responses'] = {};
      for (const [status, resp] of Object.entries(r.responses ?? { 200: { description: 'OK' } })) {
        responses[status] = resp.schema
          ? {
              description: resp.description,
              content: { 'application/json': { schema: resp.schema } },
            }
          : { description: resp.description };
      }
      responses.default = problemResponse('Error (RFC 7807 problem details)');
      const request: RouteConfig['request'] = {};
      if (r.request?.params) request.params = r.request.params as never;
      if (r.request?.query) request.query = r.request.query as never;
      if (r.request?.body)
        request.body = { content: { 'application/json': { schema: r.request.body } } };
      const permission = r.middleware
        ?.map((h) => (h as { permission?: string }).permission)
        .find(Boolean);
      const feature = r.middleware?.map((h) => (h as { feature?: string }).feature).find(Boolean);
      registry.registerPath({
        method: r.method,
        path,
        tags: r.tags ?? [m.module.key],
        ...(r.summary ? { summary: r.summary } : {}),
        ...(r.description ? { description: r.description } : {}),
        ...(r.public ? {} : { security: [{ bearerAuth: [] }] }),
        request,
        responses,
        ...(permission ? { 'x-permission': permission } : {}),
        ...(feature ? { 'x-feature': feature } : {}),
      } as RouteConfig);
    }
  }
}

export type OpenApiDocument = ReturnType<OpenApiGeneratorV3['generateDocument']>;

export function generateOpenApiDocument(
  registry: OpenAPIRegistry,
  version = '0.0.0',
): OpenApiDocument {
  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: '3.0.3',
    info: { title: 'Hotel Management API', version },
    servers: [{ url: '/' }],
  });
}
