import { randomUUID } from 'node:crypto';
import type { Services } from '../../core/container.js';
import { AppError } from '../../lib/errors.js';
import { newRefreshToken, parseRefreshToken, REFRESH_TTL_S, safeEqual, sha256 } from './tokens.js';

/**
 * Refresh-token sessions of guests (portal) and platform users, kept in Redis: the `sessions`
 * table references `users` only (reported schema gap). One record per session = one token
 * family; rotation replaces the stored hash, a replayed hash revokes the family.
 */
export type RedisScope = 'portal' | 'platform';

export interface RedisSession {
  id: string;
  scope: RedisScope;
  subject: string;
  tenantId: string | null;
  hash: string;
  ip: string | null;
  userAgent: string | null;
  mfa: boolean;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
}

const key = (scope: RedisScope, sid: string) => `hm:rs:${scope}:${sid}`;
const indexKey = (scope: RedisScope, tenantId: string | null, subject: string) =>
  `hm:rs-idx:${scope}:${tenantId ?? 'platform'}:${subject}`;

export async function createRedisSession(
  services: Services,
  s: Pick<RedisSession, 'scope' | 'subject' | 'tenantId' | 'ip' | 'userAgent' | 'mfa'>,
  ttlS = REFRESH_TTL_S,
) {
  const id = randomUUID();
  const { token, hash } = newRefreshToken(id);
  const now = new Date();
  const record: RedisSession = {
    ...s,
    id,
    hash,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlS * 1000).toISOString(),
  };
  await services.redis
    .multi()
    .set(key(s.scope, id), JSON.stringify(record), 'EX', ttlS)
    .sadd(indexKey(s.scope, s.tenantId, s.subject), id)
    .expire(indexKey(s.scope, s.tenantId, s.subject), ttlS)
    .exec();
  return { session: record, token };
}

async function load(services: Services, scope: RedisScope, sid: string) {
  const raw = await services.redis.get(key(scope, sid));
  return raw ? (JSON.parse(raw) as RedisSession) : null;
}

export async function revokeRedisSession(services: Services, scope: RedisScope, sid: string) {
  const s = await load(services, scope, sid);
  await services.redis.del(key(scope, sid));
  if (s) await services.redis.srem(indexKey(scope, s.tenantId, s.subject), sid);
  await services.revocations.revoke(sid);
}

export async function revokeAllRedisSessions(
  services: Services,
  scope: RedisScope,
  tenantId: string | null,
  subject: string,
  exceptId?: string,
) {
  const ids = await services.redis.smembers(indexKey(scope, tenantId, subject));
  for (const id of ids) if (id !== exceptId) await revokeRedisSession(services, scope, id);
}

export class RefreshError extends AppError {
  constructor(readonly reason: string) {
    super('UNAUTHENTICATED', 'Session expired', { meta: { reason } });
  }
}

/**
 * Rotates a refresh token. Throws RefreshError(REFRESH_MISSING | SESSION_REVOKED |
 * REFRESH_REUSED); on reuse the session (family) is revoked and `onReuse` is called.
 */
export async function rotateRedisSession(
  services: Services,
  scope: RedisScope,
  rawToken: string | undefined,
  expectTenantId: string | null,
  onReuse?: (s: RedisSession) => Promise<void>,
) {
  const parsed = parseRefreshToken(rawToken);
  if (!parsed) throw new RefreshError('REFRESH_MISSING');
  const s = await load(services, scope, parsed.sessionId);
  if (!s || s.tenantId !== expectTenantId) throw new RefreshError('SESSION_REVOKED');
  if (!safeEqual(sha256(parsed.token), s.hash)) {
    await revokeRedisSession(services, scope, s.id);
    await onReuse?.(s);
    throw new RefreshError('REFRESH_REUSED');
  }
  const { token, hash } = newRefreshToken(s.id);
  const next: RedisSession = { ...s, hash, lastSeenAt: new Date().toISOString() };
  const ttl = Math.max(Math.floor((Date.parse(s.expiresAt) - Date.now()) / 1000), 1);
  // Compare-and-set: a concurrent rotation of the same token is treated as reuse.
  const swapped = (await services.redis.eval(
    `local v = redis.call('get', KEYS[1])
     if not v then return 0 end
     if cjson.decode(v).hash ~= ARGV[1] then return 0 end
     redis.call('set', KEYS[1], ARGV[2], 'EX', ARGV[3])
     return 1`,
    1,
    key(scope, s.id),
    s.hash,
    JSON.stringify(next),
    String(ttl),
  )) as number;
  if (swapped !== 1) throw new RefreshError('REFRESH_REUSED');
  return { session: next, token, remainingS: ttl };
}
