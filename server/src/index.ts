import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { closeServices, createServices } from './core/container.js';
import { MODULES } from './modules/index.js';
import { createRealtime } from './realtime/socket.js';

export { createApp } from './app.js';
export { loadConfig } from './config.js';
export { createServices, closeServices } from './core/container.js';
export type { Services } from './core/container.js';
export { defineModule } from './core/module.js';
export { createModuleRouter } from './core/router.js';
export { defineSetting } from './core/settings.js';

/** HTTP + Socket.io entry point. */
export async function main(): Promise<void> {
  const config = loadConfig();
  const services = createServices(config, { modules: MODULES });
  const { app } = createApp(services);
  const server = createServer(app);
  const realtime = createRealtime(services, server);
  services.realtime = realtime.emitter;

  await new Promise<void>((resolve) => server.listen(config.PORT, resolve));
  services.logger.info('server listening', { port: config.PORT, env: config.NODE_ENV });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    services.logger.info('shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    await realtime.close(); // closes the HTTP server too
    await closeServices(services);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const isEntry = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
