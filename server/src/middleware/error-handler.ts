import type { ErrorRequestHandler, RequestHandler, Response } from 'express';
import { createProblem, PROBLEM_CONTENT_TYPE, type Problem } from '@hm/shared';
import { TenantContextError } from '@hm/database';
import { ZodError, type z } from 'zod';
import { AppError, defaultTitle } from '../lib/errors.js';
import { ValidationIssues } from '../http/helpers.js';
import type { Logger } from '../lib/logger.js';

/** Postgres SQLSTATEs mapped to CONFLICT: unique, exclusion, append-only trigger (HM001). */
const CONFLICT_SQLSTATES = new Set(['23505', '23P01', 'HM001']);
const CONFLICT_KINDS = new Set(['UniqueConstraintViolation']);
const CONFLICT_PRISMA_CODES = new Set(['P2002']);

function issuesToErrors(issues: readonly z.core.$ZodIssue[]): NonNullable<Problem['errors']> {
  return issues.map((i) => ({
    path: i.path.map(String).join('.'),
    message: i.message,
    code: i.code,
  }));
}

/** Walks an error (and its cause/meta chain) looking for database conflict markers. */
export function isDbConflict(err: unknown, depth = 0, seen = new Set<unknown>()): boolean {
  if (!err || typeof err !== 'object' || depth > 6 || seen.has(err)) return false;
  seen.add(err);
  const e = err as Record<string, unknown>;
  for (const k of ['code', 'originalCode', 'sqlState']) {
    const v = e[k];
    if (typeof v === 'string' && (CONFLICT_SQLSTATES.has(v) || CONFLICT_PRISMA_CODES.has(v)))
      return true;
  }
  if (typeof e.kind === 'string' && CONFLICT_KINDS.has(e.kind)) return true;
  for (const k of ['cause', 'meta', 'driverAdapterError', 'error']) {
    if (isDbConflict(e[k], depth + 1, seen)) return true;
  }
  return false;
}

function isPrismaNotFound(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'P2025';
}

/** Converts any thrown value into a problem document. */
export function toProblem(err: unknown, opts: { production: boolean }): Problem {
  if (err instanceof AppError) {
    return createProblem(err.code, err.message, {
      status: err.status,
      ...(err.detail ? { detail: err.detail } : {}),
      ...(err.errors ? { errors: err.errors } : {}),
      ...(err.meta ? { meta: err.meta } : {}),
    });
  }
  if (err instanceof ValidationIssues)
    return createProblem('VALIDATION_ERROR', defaultTitle('VALIDATION_ERROR'), {
      errors: issuesToErrors(err.issues),
    });
  if (err instanceof ZodError)
    return createProblem('VALIDATION_ERROR', defaultTitle('VALIDATION_ERROR'), {
      errors: issuesToErrors(err.issues),
    });
  const e = err as { type?: string; status?: number; code?: string; name?: string } | undefined;
  // body-parser
  if (e?.type === 'entity.parse.failed') return createProblem('BAD_REQUEST', 'Malformed JSON body');
  if (e?.type === 'entity.too.large')
    return createProblem('BAD_REQUEST', 'Request body too large', { status: 413 });
  // multer
  if (e?.name === 'MulterError')
    return createProblem('BAD_REQUEST', 'Invalid upload', {
      status: e.code === 'LIMIT_FILE_SIZE' ? 413 : 400,
      detail: e.code,
    });
  if (isDbConflict(err))
    return createProblem('CONFLICT', defaultTitle('CONFLICT'), {
      detail: 'The resource conflicts with an existing one',
    });
  if (isPrismaNotFound(err)) return createProblem('NOT_FOUND', defaultTitle('NOT_FOUND'));
  if (err instanceof TenantContextError)
    return createProblem('INTERNAL_ERROR', defaultTitle('INTERNAL_ERROR'));

  const problem = createProblem('INTERNAL_ERROR', defaultTitle('INTERNAL_ERROR'));
  if (!opts.production && err instanceof Error)
    problem.meta = { error: err.message, stack: err.stack?.split('\n').slice(0, 15) };
  return problem;
}

export function sendProblem(res: Response, problem: Problem): void {
  res.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(JSON.stringify(problem));
}

/** Central error handler → application/problem+json (RFC 7807). No stack traces in production. */
export function errorHandler(logger: Logger, production: boolean): ErrorRequestHandler {
  return (err, req, res, next) => {
    if (res.headersSent) return next(err);
    const problem = toProblem(err, { production });
    problem.instance = req.originalUrl.split('?')[0];
    if (req.requestId) problem.requestId = req.requestId;
    if (problem.status >= 500) logger.error('request failed', { err, path: problem.instance });
    else logger.debug('request rejected', { code: problem.code, path: problem.instance });
    sendProblem(res, problem);
  };
}

/** Fallback for unmatched routes. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND', undefined, { detail: 'Route not found' }));
};
