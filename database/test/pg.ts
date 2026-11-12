/**
 * Throwaway PostgreSQL 16 cluster for integration tests (no Docker).
 *
 * - initdb in a temp dir, pg_ctl start on a free port (unix socket in the same dir);
 * - creates an owner role `hm` (LOGIN CREATEROLE CREATEDB BYPASSRLS, *not* superuser) and the
 *   database, then applies every migration with `prisma migrate deploy`;
 * - gives `hm_app` (created by the migration) a password so the app client can log in.
 *
 * Reusable by later missions: `const pg = await startTestPostgres(); ...; await pg.stop();`
 * When running as root (containers), the cluster is run as the `postgres` OS user.
 */
import { execFile as execFileCb, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, chownSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);
const DATABASE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_OWNER = 'hm';
export const TEST_OWNER_PASSWORD = 'hm_test_owner';
export const TEST_APP_PASSWORD = 'hm_test_app';

export interface TestPostgres {
  port: number;
  database: string;
  /** Owner/admin role (bypasses RLS) — use for fixtures and platform tables. */
  adminUrl: string;
  /** hm_app role (subject to RLS) — use with createAppClient(). */
  appUrl: string;
  /** Run SQL with psql as the owner role; returns stdout. */
  psql(sql: string): Promise<string>;
  stop(): Promise<void>;
}

export interface StartOptions {
  database?: string;
  /** Apply prisma migrations (default true). */
  migrate?: boolean;
}

function findPgBin(): string {
  const fromEnv = process.env.PG_BIN;
  if (fromEnv && existsSync(join(fromEnv, 'initdb'))) return fromEnv;
  try {
    const p = execFileSync('sh', ['-c', 'command -v initdb'], { encoding: 'utf8' }).trim();
    if (p) return dirname(p);
  } catch {
    /* not in PATH */
  }
  const base = '/usr/lib/postgresql';
  if (existsSync(base)) {
    const versions = readdirSync(base)
      .filter((v) => existsSync(join(base, v, 'bin', 'initdb')))
      .sort((a, b) => Number(b) - Number(a));
    if (versions[0]) return join(base, versions[0], 'bin');
  }
  throw new Error('PostgreSQL binaries not found (set PG_BIN to the directory containing initdb)');
}

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        srv.close(() => res(port));
      } else rej(new Error('no port'));
    });
  });
}

export async function startTestPostgres(opts: StartOptions = {}): Promise<TestPostgres> {
  const database = opts.database ?? 'hm_test';
  const bin = findPgBin();
  const root = mkdtempSync(join(tmpdir(), 'hm-pg-'));
  const dataDir = join(root, 'data');
  const port = await freePort();
  const asRoot = process.getuid?.() === 0;

  // initdb refuses to run as root: delegate to the postgres OS user.
  const run = async (cmd: string, args: string[], input?: string) => {
    const full = join(bin, cmd);
    const [file, argv] = asRoot
      ? ['runuser', ['-u', 'postgres', '--', full, ...args]]
      : [full, args];
    if (input !== undefined) {
      const sqlFile = join(root, `in-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
      writeFileSync(sqlFile, input);
      if (asRoot) chownSync(sqlFile, uid('postgres'), gid('postgres'));
      const { stdout } = await execFile(file, [...argv, '-f', sqlFile], {
        env: { ...process.env },
      });
      rmSync(sqlFile, { force: true });
      return stdout;
    }
    const { stdout } = await execFile(file, argv, { env: { ...process.env } });
    return stdout;
  };
  if (asRoot) chownSync(root, uid('postgres'), gid('postgres'));

  await run('initdb', [
    '-D',
    dataDir,
    '-U',
    'postgres',
    '--auth=trust',
    '-E',
    'UTF8',
    '--locale=C',
    '-N',
  ]);
  await run('pg_ctl', [
    '-D',
    dataDir,
    '-l',
    join(root, 'pg.log'),
    '-w',
    '-o',
    `-p ${port} -k ${root} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off`,
    'start',
  ]);

  const superPsql = (sql: string, db = 'postgres') =>
    run(
      'psql',
      ['-h', root, '-p', String(port), '-U', 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-qAt'],
      sql,
    );

  await superPsql(`
    CREATE ROLE ${TEST_OWNER} LOGIN CREATEROLE CREATEDB BYPASSRLS PASSWORD '${TEST_OWNER_PASSWORD}';
    CREATE DATABASE ${database} OWNER ${TEST_OWNER};
  `);
  await superPsql(`ALTER SCHEMA public OWNER TO ${TEST_OWNER};`, database);

  const host = `127.0.0.1:${port}`;
  const adminUrl = `postgresql://${TEST_OWNER}:${TEST_OWNER_PASSWORD}@${host}/${database}`;
  const appUrl = `postgresql://hm_app:${TEST_APP_PASSWORD}@${host}/${database}`;

  const psql = (sql: string) =>
    run(
      'psql',
      [
        '-h',
        root,
        '-p',
        String(port),
        '-U',
        TEST_OWNER,
        '-d',
        database,
        '-v',
        'ON_ERROR_STOP=1',
        '-qAt',
      ],
      sql,
    );

  const stop = async () => {
    try {
      await run('pg_ctl', ['-D', dataDir, '-m', 'immediate', '-w', 'stop']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  };

  try {
    if (opts.migrate !== false) {
      await execFile(join(DATABASE_DIR, 'node_modules', '.bin', 'prisma'), ['migrate', 'deploy'], {
        cwd: DATABASE_DIR,
        env: { ...process.env, DATABASE_URL_ADMIN: adminUrl },
      });
      await psql(`ALTER ROLE hm_app PASSWORD '${TEST_APP_PASSWORD}';`);
    }
  } catch (err) {
    await stop();
    throw err;
  }

  return { port, database, adminUrl, appUrl, psql, stop };
}

function uid(user: string): number {
  return Number(execFileSync('id', ['-u', user], { encoding: 'utf8' }).trim());
}
function gid(user: string): number {
  return Number(execFileSync('id', ['-g', user], { encoding: 'utf8' }).trim());
}
