import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { closeServices, createServices } from './core/container.js';
import { QueueFactory, startWorkers } from './jobs/index.js';
import { MODULES } from './modules/index.js';
import { createRealtime } from './realtime/socket.js';

/** BullMQ workers entry point (outbox relay, domain events, module jobs). */
export async function runWorker(): Promise<void> {
  const config = loadConfig();
  const services = createServices(config, { modules: MODULES });
  // Emit-only Socket.io instance: broadcasts reach clients through the Redis adapter.
  const realtime = createRealtime(services);
  services.realtime = realtime.emitter;
  const queues = new QueueFactory(config.REDIS_URL);
  await startWorkers(services, queues);
  services.logger.info('workers started', { jobs: services.modules.jobs().map((j) => j.name) });

  const shutdown = async (signal: string) => {
    services.logger.info('stopping workers', { signal });
    await queues.close();
    await realtime.close();
    await closeServices(services);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  runWorker().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
