import { ERROR_CODES, type ErrorCode, type Problem } from '@hm/shared';

export interface AppErrorOptions {
  detail?: string | undefined;
  status?: number;
  errors?: Problem['errors'];
  meta?: Record<string, unknown>;
  cause?: unknown;
}

const DEFAULT_TITLES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Validation failed',
  BAD_REQUEST: 'Bad request',
  UNAUTHENTICATED: 'Authentication required',
  FORBIDDEN: 'Permission denied',
  TENANT_MISMATCH: 'Token does not belong to this tenant',
  FEATURE_NOT_IN_PLAN: 'Feature not included in the subscription',
  QUOTA_EXCEEDED: 'Quota exceeded',
  SUBSCRIPTION_SUSPENDED: 'Subscription suspended',
  NOT_FOUND: 'Not found',
  CONFLICT: 'Conflict',
  IDEMPOTENCY_CONFLICT: 'Idempotency key conflict',
  PRECONDITION_FAILED: 'Precondition failed',
  RATE_LIMITED: 'Too many requests',
  MFA_REQUIRED: 'Multi-factor authentication required',
  ACCOUNT_LOCKED: 'Account locked',
  INTERNAL_ERROR: 'Internal server error',
  SERVICE_UNAVAILABLE: 'Service unavailable',
};

/** Application error, rendered as an RFC 7807 problem by the central error handler. */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail?: string;
  readonly errors?: Problem['errors'];
  readonly meta?: Record<string, unknown>;

  constructor(code: ErrorCode, title?: string, opts: AppErrorOptions = {}) {
    super(
      title ?? DEFAULT_TITLES[code],
      opts.cause === undefined ? undefined : { cause: opts.cause },
    );
    this.code = code;
    this.status = opts.status ?? ERROR_CODES[code];
    if (opts.detail !== undefined) this.detail = opts.detail;
    if (opts.errors !== undefined) this.errors = opts.errors;
    if (opts.meta !== undefined) this.meta = opts.meta;
  }
}

export function defaultTitle(code: ErrorCode): string {
  return DEFAULT_TITLES[code];
}

export const notFound = (detail?: string) => new AppError('NOT_FOUND', undefined, { detail });
export const forbidden = (detail?: string, meta?: Record<string, unknown>) =>
  new AppError('FORBIDDEN', undefined, { detail, ...(meta ? { meta } : {}) });
export const unauthenticated = (detail?: string) =>
  new AppError('UNAUTHENTICATED', undefined, { detail });
