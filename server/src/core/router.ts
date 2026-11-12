import {
  Router,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import type { z } from 'zod';
import { asyncHandler, validate } from '../http/helpers.js';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface RouteResponse {
  description: string;
  schema?: z.ZodType;
}

export interface RouteRequestSchemas<B, Q, P> {
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  params?: z.ZodType<P>;
}

export type TypedRequest<B, Q, P> = Request & { valid: { body: B; query: Q; params: P } };

export interface RouteSpec<B = unknown, Q = unknown, P = unknown> {
  method: HttpMethod;
  /** Express path relative to the module base path (`/whoami`, `/:id`). */
  path: string;
  summary?: string;
  description?: string;
  tags?: string[];
  request?: RouteRequestSchemas<B, Q, P>;
  responses?: Record<number, RouteResponse>;
  /** can(), requireFeature(), checkQuota(), upload()... run before validation. */
  middleware?: RequestHandler[];
  /** Marks the route as public in the OpenAPI document (no bearer). */
  public?: boolean;
  /** Returned value (if any and headers not sent) is sent as JSON with `status` (default 200). */
  handler: (req: TypedRequest<B, Q, P>, res: Response, next: NextFunction) => unknown;
  status?: number;
}

/**
 * Router of a module that keeps route specs so the OpenAPI document is generated from the same
 * Zod schemas used for validation (single source of truth).
 */
export class ModuleRouter {
  readonly router: Router = Router();
  readonly routes: RouteSpec[] = [];

  route<B = unknown, Q = unknown, P = unknown>(spec: RouteSpec<B, Q, P>): this {
    this.routes.push(spec as RouteSpec);
    const chain: RequestHandler[] = [...(spec.middleware ?? [])];
    if (spec.request)
      chain.push(validate(spec.request as RouteRequestSchemas<unknown, unknown, unknown>));
    chain.push(
      asyncHandler(async (req, res, next) => {
        const out = await spec.handler(req as TypedRequest<B, Q, P>, res, next);
        if (out !== undefined && !res.headersSent) res.status(spec.status ?? 200).json(out);
      }),
    );
    this.router[spec.method](spec.path, ...chain);
    return this;
  }
}

export function createModuleRouter(): ModuleRouter {
  return new ModuleRouter();
}
