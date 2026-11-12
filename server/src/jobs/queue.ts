import { Queue, Worker, type Job, type JobsOptions, type WorkerOptions } from 'bullmq';
import { createRedis, type Redis } from '../lib/redis.js';

export const QUEUE_PREFIX = 'hm';

/** Core queue names (doc 03 §5). Modules may create others. */
export const QUEUES = {
  outbox: 'outbox',
  domainEvents: 'domain-events',
  notifications: 'notifications',
  pdfRender: 'pdf-render',
} as const;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },
  removeOnComplete: { age: 24 * 3600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

/**
 * BullMQ queue/worker factory on Redis. Queues share one connection; each worker gets its own
 * (blocking commands). `close()` shuts everything down.
 */
export class QueueFactory {
  private readonly queues = new Map<string, Queue>();
  private readonly workers: Worker[] = [];
  private readonly connections: Redis[] = [];
  private shared?: Redis;

  constructor(
    private readonly redisUrl: string,
    private readonly prefix = QUEUE_PREFIX,
  ) {}

  private connection(): Redis {
    this.shared ??= this.track(createRedis(this.redisUrl));
    return this.shared;
  }

  private track(r: Redis): Redis {
    this.connections.push(r);
    return r;
  }

  queue(name: string): Queue {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue(name, {
        connection: this.connection(),
        prefix: this.prefix,
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      });
      this.queues.set(name, q);
    }
    return q;
  }

  worker(
    name: string,
    processor: (job: Job) => Promise<unknown>,
    opts: Omit<WorkerOptions, 'connection' | 'prefix'> = {},
  ): Worker {
    const w = new Worker(name, processor, {
      concurrency: 5,
      ...opts,
      connection: this.track(createRedis(this.redisUrl)),
      prefix: this.prefix,
    });
    this.workers.push(w);
    return w;
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()));
    await Promise.allSettled([...this.queues.values()].map((q) => q.close()));
    await Promise.allSettled(this.connections.map((c) => c.quit()));
    this.workers.length = 0;
    this.queues.clear();
    this.connections.length = 0;
    this.shared = undefined;
  }
}
