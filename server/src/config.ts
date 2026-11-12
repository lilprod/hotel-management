import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean),
  );

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

/** Environment schema. Every variable the server reads is declared and validated here. */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug', 'silly']).default('info'),
  /** Express `trust proxy` (Traefik in front): number of hops, 0 disables. */
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),

  DATABASE_URL: z.string().url(),
  DATABASE_URL_ADMIN: z.string().url(),
  REDIS_URL: z.string().url(),

  /** HS256 secret of access tokens (>= 32 chars). */
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().default('hm'),
  JWT_AUDIENCE: z.string().default('hm-api'),

  /** Hosts of the Super Admin app/API (no tenant), comma-separated. */
  ADMIN_HOSTS: csv,
  /** Platform hosts without a tenant (marketing, signup, API root), comma-separated. */
  PLATFORM_HOSTS: csv,
  /** Extra CORS origins (platform front-ends), e.g. https://admin.example.com. */
  CORS_ORIGINS: csv,

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),

  TENANT_CACHE_TTL_S: z.coerce.number().int().positive().default(300),
  SUBSCRIPTION_CACHE_TTL_S: z.coerce.number().int().positive().default(60),
  ENTITLEMENTS_CACHE_TTL_S: z.coerce.number().int().positive().default(600),
  PERMISSIONS_CACHE_TTL_S: z.coerce.number().int().positive().default(900),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('hm-files'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Hotel Management <no-reply@localhost>'),
  GOTENBERG_URL: z.string().url().default('http://localhost:3001'),

  /** Outbox relay: repeat interval (ms) and batch size. */
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(2_000),
  OUTBOX_BATCH: z.coerce.number().int().positive().max(1000).default(100),
});

export type Config = z.infer<typeof envSchema> & { isProduction: boolean };

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Parses and validates the environment. Throws ConfigError listing every invalid variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new ConfigError(`Invalid environment:\n${lines.join('\n')}`);
  }
  return { ...parsed.data, isProduction: parsed.data.NODE_ENV === 'production' };
}
