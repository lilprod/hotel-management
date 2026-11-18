import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { AppError } from '../../lib/errors.js';

const TTL_DONE_S = 24 * 3600;
const TTL_PENDING_S = 120;
const KEY_RE = /^[A-Za-z0-9._:-]{8,200}$/;

interface Stored {
  hash: string;
  state: 'pending' | 'done';
  status?: number;
  body?: unknown;
}

/**
 * `Idempotency-Key` header (per actor and scope, 24 h): the same key and body replays the
 * first response (`Idempotent-Replayed: true`); the same key with another body →
 * IDEMPOTENCY_CONFLICT; a request still running → CONFLICT. Without the header, `fn` runs.
 */
export async function withIdempotency<T>(
  req: Request,
  res: Response,
  scope: string,
  status: number,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  const key = req.header('idempotency-key');
  if (!key) return fn();
  if (!KEY_RE.test(key))
    throw new AppError('BAD_REQUEST', undefined, { detail: 'Invalid Idempotency-Key header' });
  const { redis } = req.services;
  const actor = req.auth?.userId ?? 'anonymous';
  const redisKey = `hm:idem:${scope}:${actor}:${key}`;
  const hash = createHash('sha256')
    .update(JSON.stringify(req.body ?? null))
    .digest('hex');
  const pending: Stored = { hash, state: 'pending' };
  const claimed = await redis.set(redisKey, JSON.stringify(pending), 'EX', TTL_PENDING_S, 'NX');
  if (claimed !== 'OK') {
    const raw = await redis.get(redisKey);
    const prev = raw ? (JSON.parse(raw) as Stored) : null;
    if (!prev) throw new AppError('CONFLICT', undefined, { detail: 'Request in progress' });
    if (prev.hash !== hash)
      throw new AppError('IDEMPOTENCY_CONFLICT', undefined, {
        detail: 'Idempotency-Key reused with a different request body',
      });
    if (prev.state === 'pending')
      throw new AppError('CONFLICT', undefined, {
        detail: 'A request with this Idempotency-Key is in progress',
      });
    res.setHeader('Idempotent-Replayed', 'true');
    res.status(prev.status ?? status).json(prev.body);
    return undefined;
  }
  try {
    const out = await fn();
    const done: Stored = { hash, state: 'done', status, body: out };
    await redis.set(redisKey, JSON.stringify(done), 'EX', TTL_DONE_S);
    return out;
  } catch (err) {
    await redis.del(redisKey);
    throw err;
  }
}
