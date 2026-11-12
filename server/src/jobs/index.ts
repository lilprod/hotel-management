import type { Job } from 'bullmq';
import type { Services } from '../core/container.js';
import { runJob, type AnyJobDefinition } from './context.js';
import { OUTBOX_RELAY_JOB, processDomainEvent, relayOutbox } from './outbox-relay.js';
import { QUEUES, type QueueFactory } from './queue.js';
import { registerRepeatable } from './repeatable.js';

export * from './context.js';
export * from './queue.js';
export * from './repeatable.js';
export * from './outbox-relay.js';

/**
 * Starts every worker: outbox relay (repeatable), domain-events dispatcher and one worker per
 * queue declared by module jobs (dispatching on job name).
 */
export async function startWorkers(services: Services, queues: QueueFactory): Promise<void> {
  const outbox = queues.queue(QUEUES.outbox);
  await registerRepeatable(
    outbox,
    OUTBOX_RELAY_JOB,
    { every: services.config.OUTBOX_POLL_MS },
    {
      name: OUTBOX_RELAY_JOB,
    },
  );
  queues.worker(QUEUES.outbox, () => relayOutbox(services, queues), { concurrency: 1 });
  queues.worker(QUEUES.domainEvents, (job) => processDomainEvent(services, job));

  const byQueue = new Map<string, Map<string, AnyJobDefinition>>();
  for (const def of services.modules.jobs()) {
    const m = byQueue.get(def.queue) ?? new Map<string, AnyJobDefinition>();
    if (m.has(def.name)) throw new Error(`Job ${def.queue}/${def.name} is declared twice`);
    m.set(def.name, def);
    byQueue.set(def.queue, m);
  }
  for (const [queue, defs] of byQueue) {
    if (queue === QUEUES.outbox || queue === QUEUES.domainEvents)
      throw new Error(`Queue ${queue} is reserved by the core`);
    queues.worker(queue, (job: Job) => {
      const def = defs.get(job.name);
      if (!def) throw new Error(`No handler for job ${queue}/${job.name}`);
      return runJob(def, job, services);
    });
  }
}
