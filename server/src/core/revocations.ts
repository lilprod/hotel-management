import type { Redis } from '../lib/redis.js';

const key = (sid: string) => `hm:sid-revoked:${sid}`;
const idleKey = (sid: string) => `hm:sid-idle:${sid}`;

/**
 * Session revocation denylist checked on every authenticated request. The auth modules (logout,
 * refresh-token reuse detection, deactivation) call `revoke`; entries live as long as an access
 * token can (15 min by default, longer for impersonation tokens).
 */
export class SessionRevocations {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 15 * 60,
  ) {}

  async revoke(sessionId: string, ttlSeconds = this.ttlSeconds): Promise<void> {
    await this.redis
      .multi()
      .set(key(sessionId), '1', 'EX', Math.max(ttlSeconds, this.ttlSeconds))
      .del(idleKey(sessionId))
      .exec();
  }

  async revokeMany(sessionIds: readonly string[], ttlSeconds?: number): Promise<void> {
    await Promise.all(sessionIds.map((s) => this.revoke(s, ttlSeconds)));
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(key(sessionId))) === 1;
  }

  /** Starts / renews the idle timer of a session (login, refresh). */
  async markActive(sessionId: string, idleMinutes: number): Promise<void> {
    await this.redis.set(idleKey(sessionId), '1', 'EX', idleMinutes * 60);
  }

  /** Renews the idle timer; false when it already elapsed (session idle-expired). */
  async touch(sessionId: string, idleMinutes: number): Promise<boolean> {
    return (await this.redis.expire(idleKey(sessionId), idleMinutes * 60)) === 1;
  }

  async isActive(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(idleKey(sessionId))) === 1;
  }
}
