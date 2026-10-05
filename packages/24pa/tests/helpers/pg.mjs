// Isolated PostgreSQL cluster for tests: initdb into a temp dir, start on a
// random port, create a dedicated non-superuser app role (mirroring the
// production "restricted account" requirement), and tear everything down.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const run = promisify(execFile);

export async function freePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => {
      const { port } = probe.address();
      probe.close(() => resolvePort(port));
    });
  });
}

export async function startPgCluster() {
  const binDir = process.env.PA24_PG_BIN || '/opt/homebrew/bin';
  const dir = await mkdtemp(join(tmpdir(), 'pa24-pg-'));
  const port = await freePort();
  await run(join(binDir, 'initdb'), ['-D', dir, '--no-locale', '-E', 'UTF8'], { timeout: 120_000 });
  await run(
    join(binDir, 'pg_ctl'),
    ['-D', dir, '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`, '-w', '-t', '60', '-l', join(dir, 'pg.log'), 'start'],
    { timeout: 120_000 },
  );
  const psql = (sql) => run(join(binDir, 'psql'), ['-h', '127.0.0.1', '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
  await psql('create database pa24_test');
  await psql("create role pa24_app login password 'pa24_app'");
  await psql('grant all on database pa24_test to pa24_app');
  const dsn = `postgresql://pa24_app:pa24_app@127.0.0.1:${port}/pa24_test`;
  const superDsn = `postgresql://127.0.0.1:${port}/pa24_test`;
  let stopped = false;
  return {
    dsn,
    superDsn,
    port,
    dir,
    async query(sql) {
      const { stdout } = await run(join(binDir, 'psql'), ['-h', '127.0.0.1', '-p', String(port), '-d', 'pa24_test', '-At', '-c', sql]);
      return stdout;
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      await run(join(binDir, 'pg_ctl'), ['-D', dir, '-m', 'immediate', 'stop']).catch(() => {});
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };
}
