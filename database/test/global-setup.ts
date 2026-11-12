import type { TestProject } from 'vitest/node';
import { startTestPostgres } from './pg.js';

declare module 'vitest' {
  export interface ProvidedContext {
    pg: { adminUrl: string; appUrl: string };
  }
}

/** One throwaway cluster (migrated) per `vitest run`; URLs are exposed via inject('pg'). */
export default async function setup(project: TestProject) {
  const pg = await startTestPostgres();
  project.provide('pg', { adminUrl: pg.adminUrl, appUrl: pg.appUrl });
  return async () => {
    await pg.stop();
  };
}
