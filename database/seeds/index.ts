/**
 * Idempotent seeds: platform catalog, Togo parameters and three demo tenants
 * (Hôtel 2 Février — PREMIUM, Jess Hôtel — MEDIUM, Hôtel Collines Vertes à Kpalimé — STANDARD).
 *
 * Run with the admin client (DATABASE_URL_ADMIN):
 *   pnpm --filter @hm/database db:seed
 *
 * Environment:
 *   SEED_SUPERADMIN_EMAIL / SEED_SUPERADMIN_PASSWORD  platform Super Admin (skipped if missing)
 *   SEED_DEMO_PASSWORD                                owners of the demo tenants (skipped if missing)
 */
import { pathToFileURL } from 'node:url';
import { createAdminClient, type AdminClient } from '../src/index.js';
import { seedDemoJess } from './demo-jess.js';
import { seedDemoKpalime } from './demo-kpalime.js';
import { seedDemoLome } from './demo-lome.js';
import { seedPlatform } from './platform.js';
import { silentLog, type Logger } from './common.js';
import { seedTogo } from './togo.js';

export interface SeedOptions {
  superAdminEmail?: string;
  superAdminPassword?: string;
  demoPassword?: string;
  log?: Logger;
}

export interface SeedSummary {
  platform: Awaited<ReturnType<typeof seedPlatform>>;
  togo: Awaited<ReturnType<typeof seedTogo>>;
  lome: Awaited<ReturnType<typeof seedDemoLome>>;
  kpalime: Awaited<ReturnType<typeof seedDemoKpalime>>;
  jess: Awaited<ReturnType<typeof seedDemoJess>>;
}

export function seedOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): SeedOptions {
  return {
    superAdminEmail: env.SEED_SUPERADMIN_EMAIL,
    superAdminPassword: env.SEED_SUPERADMIN_PASSWORD,
    demoPassword: env.SEED_DEMO_PASSWORD,
  };
}

/** Runs every seed section in order. Safe to call repeatedly. */
export async function runSeeds(
  admin: AdminClient,
  options: SeedOptions = {},
): Promise<SeedSummary> {
  const log = options.log ?? silentLog;
  const platform = await seedPlatform(admin, {
    superAdminEmail: options.superAdminEmail,
    superAdminPassword: options.superAdminPassword,
    log,
  });
  const togo = await seedTogo(admin, log);
  const lome = await seedDemoLome(admin, { demoPassword: options.demoPassword, log });
  const kpalime = await seedDemoKpalime(admin, { demoPassword: options.demoPassword, log });
  const jess = await seedDemoJess(admin, { demoPassword: options.demoPassword, log });
  return { platform, togo, lome, kpalime, jess };
}

// CLI entry point (pnpm db:seed).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const admin = createAdminClient();
  try {
    await runSeeds(admin, { ...seedOptionsFromEnv(), log: (m) => process.stdout.write(`${m}\n`) });
    process.stdout.write('seeds: done\n');
  } catch (err) {
    process.stderr.write(`seeds failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await admin.$disconnect();
  }
}
