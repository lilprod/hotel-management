import type { Redis } from '../lib/redis.js';

const key = (sid: string) => `hm:sid-revoked:${sid}`;

/**
 * Session revocation denylist checked on every authenticated request. The auth module (logout,
 * refresh-token reuse detection) calls `revoke`; entries live as long as an access token can.
 */
export class SessionRevocations {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds = 15 * 60,
  ) {}

  async revoke(sessionId: string): Promise<void> {
    await this.redis.set(key(sessionId), '1', 'EX', this.ttlSeconds);
  }

  async isRevoked(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(key(sessionId))) === 1;
  }
}
