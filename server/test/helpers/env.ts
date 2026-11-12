import { Writable } from 'node:stream';
import { inject } from 'vitest';
import winston from 'winston';
import { loadConfig, type Config } from '../../src/config.js';
import { closeServices, createServices, type Services } from '../../src/core/container.js';
import type { ModuleDefinition } from '../../src/core/module.js';
import { signAccessToken, type TokenScope } from '../../src/lib/jwt.js';
import { createLogger } from '../../src/lib/logger.js';
import { MODULES } from '../../src/modules/index.js';

export const PLATFORM_DOMAIN = 'hm.test';
export const ADMIN_HOST = `admin.${PLATFORM_DOMAIN}`;
export const TEST_JWT_SECRET = 'test-secret-test-secret-test-secret-0123';

export function testConfig(overrides: Record<string, string> = {}): Config {
  const infra = inject('infra');
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    TRUST_PROXY: '0',
    DATABASE_URL: infra.appUrl,
    DATABASE_URL_ADMIN: infra.adminUrl,
    REDIS_URL: infra.redisUrl,
    JWT_ACCESS_SECRET: TEST_JWT_SECRET,
    ADMIN_HOSTS: ADMIN_HOST,
    PLATFORM_HOSTS: PLATFORM_DOMAIN,
    CORS_ORIGINS: `https://${ADMIN_HOST}`,
    RATE_LIMIT_MAX: '100000',
    ...overrides,
  });
}

export interface MemoryLogs {
  transport: winston.transport;
  lines: Record<string, unknown>[];
}

/** In-memory log sink (formatted JSON lines), to assert on redaction. */
export function memoryLogs(): MemoryLogs {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      for (const l of chunk.toString().split('\n').filter(Boolean))
        lines.push(JSON.parse(l) as Record<string, unknown>);
      cb();
    },
  });
  return { transport: new winston.transports.Stream({ stream }), lines };
}

export interface TestEnv {
  services: Services;
  logs: MemoryLogs;
  close(): Promise<void>;
}

export function createTestEnv(
  extraModules: ModuleDefinition[] = [],
  overrides: Record<string, string> = {},
): TestEnv {
  const config = testConfig(overrides);
  const logs = memoryLogs();
  const logger = createLogger({ level: 'debug', transports: [logs.transport] });
  const services = createServices(config, {
    modules: [...MODULES, ...extraModules],
    logger,
    dbPoolMax: 4,
  });
  return { services, logs, close: () => closeServices(services) };
}

export interface MintOptions {
  sub: string;
  tid?: string;
  scope?: TokenScope;
  sid?: string;
  permVer?: number;
  expiresIn?: string | number;
}

/** Test helper minting access tokens (token issuance belongs to the auth module). */
export function mintToken(config: Config, o: MintOptions): Promise<string> {
  const scope = o.scope ?? 'staff';
  return signAccessToken(
    {
      sub: o.sub,
      ...(scope === 'platform' ? {} : { tid: o.tid }),
      sid: o.sid ?? crypto.randomUUID(),
      perm_ver: o.permVer ?? 0,
      scope,
    },
    { secret: config.JWT_ACCESS_SECRET, issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE },
    o.expiresIn ?? '15m',
  );
}
