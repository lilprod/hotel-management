/**
 * Throwaway local `redis-server` on a free port (no Docker), for integration tests.
 * `const r = await startTestRedis(); ...; await r.stop();`
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TestRedis {
  port: number;
  url: string;
  stop(): Promise<void>;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') srv.close(() => resolve(addr.port));
      else reject(new Error('no port'));
    });
  });
}

export async function startTestRedis(
  bin = process.env.REDIS_SERVER_BIN ?? 'redis-server',
): Promise<TestRedis> {
  const port = await freePort();
  const dir = mkdtempSync(join(tmpdir(), 'hm-redis-'));
  const child: ChildProcess = spawn(
    bin,
    [
      '--port',
      String(port),
      '--bind',
      '127.0.0.1',
      '--save',
      '',
      '--appendonly',
      'no',
      '--dir',
      dir,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  await new Promise<void>((resolve, reject) => {
    let out = '';
    const timer = setTimeout(
      () => reject(new Error(`redis-server did not start:\n${out}`)),
      10_000,
    );
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (out.includes('Ready to accept connections')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`redis-server exited with ${code}:\n${out}`));
    });
  });

  return {
    port,
    url: `redis://127.0.0.1:${port}`,
    async stop() {
      if (child.exitCode === null) {
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          child.kill('SIGTERM');
        });
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
