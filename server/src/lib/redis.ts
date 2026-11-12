import { Redis, type RedisOptions } from 'ioredis';

export type { Redis };

/**
 * Creates an ioredis client. `maxRetriesPerRequest: null` is required by BullMQ workers and
 * harmless for regular clients (commands wait for reconnection instead of failing fast).
 */
export function createRedis(url: string, opts: RedisOptions = {}): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, ...opts });
}

/** Small JSON cache on top of Redis. Keys are namespaced with `hm:`. */
export class JsonCache {
  constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | undefined> {
    const raw = await this.redis.get(key);
    if (raw === null) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length) await this.redis.del(...keys);
  }

  /** Read-through: returns the cached value or computes, stores and returns it. */
  async wrap<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await compute();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /** Deletes every key matching `pattern` (SCAN, never KEYS). */
  async delPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let count = 0;
    do {
      const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      if (keys.length) count += await this.redis.del(...keys);
    } while (cursor !== '0');
    return count;
  }
}
