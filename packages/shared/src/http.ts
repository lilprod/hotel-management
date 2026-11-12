import { z } from 'zod';

/** Error code catalog: code -> default HTTP status. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 422,
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  TENANT_MISMATCH: 403,
  FEATURE_NOT_IN_PLAN: 402,
  QUOTA_EXCEEDED: 402,
  SUBSCRIPTION_SUSPENDED: 402,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PRECONDITION_FAILED: 412,
  RATE_LIMITED: 429,
  MFA_REQUIRED: 401,
  ACCOUNT_LOCKED: 423,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;
export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

export const errorCodeSchema = z.enum(ERROR_CODE_LIST);

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export function problemTypeUri(code: ErrorCode): string {
  return `urn:hm:problem:${code.toLowerCase().replace(/_/g, '-')}`;
}

/** RFC 7807 problem details, extended with `code` and optional field `errors`. */
export const problemSchema = z.object({
  type: z.string().default('about:blank'),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  code: errorCodeSchema,
  requestId: z.string().optional(),
  errors: z
    .array(z.object({ path: z.string(), message: z.string(), code: z.string().optional() }))
    .optional(),
  /** Extra machine-readable data (e.g. `{ feature: 'spa' }`, `{ quota: 'users', limit: 5 }`). */
  meta: z.record(z.string(), z.unknown()).optional(),
});
export type Problem = z.infer<typeof problemSchema>;

export function createProblem(
  code: ErrorCode,
  title: string,
  extra: Partial<Omit<Problem, 'code' | 'title' | 'status'>> & { status?: number } = {},
): Problem {
  const { status, ...rest } = extra;
  return { type: problemTypeUri(code), title, status: status ?? ERROR_CODES[code], code, ...rest };
}

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

export const uuidSchema = z.string().uuid();

/** Calendar date `YYYY-MM-DD` (nights: arrival included, departure excluded). */
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((s) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Invalid calendar date');
export type DateOnly = z.infer<typeof dateOnlySchema>;

// ---------------------------------------------------------------------------
// Cursor pagination
// ---------------------------------------------------------------------------

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

export const cursorPaginationQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
});
export type CursorPaginationQuery = z.infer<typeof cursorPaginationQuerySchema>;

export function cursorPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    data: z.array(item),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}
export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
