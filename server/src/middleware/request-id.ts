import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../lib/logger.js';
import { requestContext } from '../lib/request-context.js';

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Accepts a well-formed incoming X-Request-Id (proxy) or generates one, echoes it in the
 * response and opens the request context used by the logger.
 */
export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.header(REQUEST_ID_HEADER);
    const id = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
    req.requestId = id;
    req.valid = {};
    res.setHeader('X-Request-Id', id);
    requestContext.run({ requestId: id }, () => next());
  };
}

/** One access-log line per request (method, path without query, status, duration). */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      logger.http('request', {
        requestId: req.requestId,
        tenantId: req.tenant?.id,
        userId: req.auth?.userId,
        method: req.method,
        path: req.originalUrl.split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(ms * 10) / 10,
      });
    });
    next();
  };
}
