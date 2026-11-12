import winston from 'winston';
import { getTenantId } from '@hm/database';
import { getRequestContext } from './request-context.js';

export type Logger = winston.Logger;

/** Keys whose values are always masked (passwords, tokens, secrets, identity numbers, phones). */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|otp|totp|id[-_]?(number|no|num)|document[-_]?(number|no)|passport|national[-_]?id|phone|msisdn|mobile/i;

export const REDACTED = '[REDACTED]';

/** Patterns masked inside free-text strings. */
const STRING_PATTERNS: [RegExp, string][] = [
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/g, `Bearer ${REDACTED}`],
  [/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, REDACTED],
  // International or long local phone numbers (+228 90 12 34 56, 0022890123456 ...).
  [/(?<![\w-])\+\d[\d .-]{6,}\d(?![\w-])/g, REDACTED],
];

export function redactString(value: string): string {
  let out = value;
  for (const [re, rep] of STRING_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Deep copy of `value` with sensitive keys and string patterns masked. */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      ...(value.stack ? { stack: redactString(value.stack) } : {}),
    };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] =
      SENSITIVE_KEY.test(k) && v !== undefined && v !== null
        ? REDACTED
        : redact(v, depth + 1, seen);
  }
  return out;
}

const contextAndRedact = winston.format((info) => {
  const record = info as Record<string | symbol, unknown>;
  for (const key of Object.keys(record)) {
    if (key === 'level') continue;
    record[key] = SENSITIVE_KEY.test(key) && record[key] != null ? REDACTED : redact(record[key]);
  }
  const ctx = getRequestContext();
  const tenantId = getTenantId() ?? ctx?.tenantId;
  if (ctx?.requestId && record.requestId === undefined) record.requestId = ctx.requestId;
  if (ctx?.jobId && record.jobId === undefined) record.jobId = ctx.jobId;
  if (tenantId && record.tenantId === undefined) record.tenantId = tenantId;
  if (ctx?.userId && record.userId === undefined) record.userId = ctx.userId;
  return info;
});

export interface LoggerOptions {
  level?: string;
  service?: string;
  silent?: boolean;
  /** Replaces the default Console transport (tests use a memory transport). */
  transports?: winston.transport[];
}

/** JSON logger (one line per entry) carrying request/tenant ids, with sensitive data masked. */
export function createLogger(opts: LoggerOptions = {}): Logger {
  return winston.createLogger({
    level: opts.level ?? 'info',
    silent: opts.silent ?? false,
    defaultMeta: { service: opts.service ?? 'hm-server' },
    format: winston.format.combine(
      winston.format.errors({ stack: true }),
      contextAndRedact(),
      winston.format.timestamp(),
      winston.format.json(),
    ),
    transports: opts.transports ?? [new winston.transports.Console()],
  });
}
