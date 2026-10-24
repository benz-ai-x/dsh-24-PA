import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { SqliteDb } from './sqlite.js';
import type { PaDb, PaQueryer } from './db.js';
import { runCliProcess } from './cli-gateway.js';

export interface IsolatedLedger extends PaQueryer {
  kind: 'sqlite' | 'postgres';
  close(): Promise<void>;
  integrity(): Promise<string[]>;
  versions: Record<string, string>;
}

/** Restore only to a newly created local cluster, never to a supplied DSN.
 * The application role cannot run server programs; psql's random restricted
 * key prevents dump meta-commands from escaping to the local shell. */
export async function openBackupLedger(directory: string, storage: string): Promise<IsolatedLedger> {
  if (storage === 'sqlite') {
    const db = new SqliteDb(join(directory, 'pa24.db'));
    return { kind: 'sqlite', query: db.query.bind(db), close: () => db.close(), versions: { node: process.version },
      integrity: async () => {
        const checked = await db.query('pragma integrity_check');
        const foreign = await db.query('pragma foreign_key_check');
        return [...checked.rows.flatMap(row => Object.values(row).filter(value => value !== 'ok').map(String)), ...foreign.rows.map(() => '外键完整性失败')];
      } };
  }
  if (storage !== 'postgres') throw new Error('备份未声明支持的账本类型。');
  if (process.platform === 'win32') throw new Error('PostgreSQL 隔离演练需要提供 initdb、pg_ctl、psql 的本地 Unix 环境；此环境未检查。');
  // Short private socket path avoids platform Unix-domain path limits.
  const clusterRoot = await mkdtemp(join(tmpdir(), 'pa24-restore-pg-'));
  const data = join(clusterRoot, 'data');
  const socket = clusterRoot;
  const port = String(40000 + randomBytes(2).readUInt16BE() % 20000);
  const env: Record<string, string | undefined> = Object.fromEntries(Object.keys(process.env).filter(name => /^PG/.test(name)).map(name => [name, undefined]));
  Object.assign(env, { PGHOST: socket, PGPORT: port, PGDATABASE: 'pa24_restore', PGUSER: 'pa24_restore', PGPASSFILE: join(clusterRoot, 'no-passfile'), PSQLRC: join(clusterRoot, 'no-psqlrc') });
  let started = false, pool: pg.Pool | undefined;
  const run = async (bin: string, argv: string[], overrides: Record<string, string | undefined> = {}) => {
    const result = await runCliProcess({ bin, argv, env: { ...env, ...overrides }, timeoutMs: 120_000, stdoutLimitBytes: 1024 * 1024,
      fail: kind => new Error(`隔离 PostgreSQL ${bin} 未完成（${kind}）；请核对本机恢复工具，未连接现场账本。`) });
    if (result.exitCode !== 0) throw new Error(`隔离 PostgreSQL ${bin} 退出码 ${result.exitCode}；导入或兼容性检查未通过，未修改现场账本。`);
    return result.stdout.trim();
  };
  const cleanup = async () => {
    await pool?.end();
    if (started) await run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    await rm(clusterRoot, { recursive: true, force: true });
  };
  try {
    const clientVersion = await run('psql', ['--version']);
    const help = await run('psql', ['--help=commands']);
    if (!help.includes('\\restrict')) throw new Error('本机 psql 不支持受限恢复模式；请升级到含安全修复的 PostgreSQL 客户端后重试。');
    await run('initdb', ['-D', data, '--no-locale', '-E', 'UTF8', '-A', 'trust', '-U', 'pa24_restore_admin']);
    const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
    await run('pg_ctl', ['-D', data, '-l', join(clusterRoot, 'server.log'), '-o', `-p ${port} -k ${quote(socket)} -c listen_addresses=''`, '-w', '-t', '60', 'start']);
    started = true;
    await run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', 'create role pa24_restore login nosuperuser nocreatedb nocreaterole noinherit'], { PGUSER: 'pa24_restore_admin' });
    await run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', 'postgres', '-c', 'create database pa24_restore owner pa24_restore'], { PGUSER: 'pa24_restore_admin' });
    const bytes = await readFile(join(directory, 'pa24.sql'));
    // latin1 is a byte-preserving transform, not a database encoding choice.
    // pg_dump's SET client_encoding still controls interpretation of COPY data.
    const source = bytes.toString('latin1');
    const keys = [...source.matchAll(/^\\restrict ([A-Za-z0-9]+)\r?$/gm)].map(match => match[1]);
    if (keys.length > 1) throw new Error('备份含多个 psql 受限段，需人工核对格式。');
    let stripped = source;
    if (keys[0]) {
      const key = keys[0];
      const pairs = [...source.matchAll(new RegExp(`^\\\\unrestrict ${key}\\r?$`, 'gm'))];
      if (pairs.length !== 1) throw new Error('备份 psql 受限段未闭合。');
      stripped = stripped.replace(new RegExp(`^\\\\(?:un)?restrict ${key}\\r?\\n?`, 'gm'), '');
    }
    const key = randomBytes(32).toString('hex');
    const wrapped = join(clusterRoot, 'import.sql');
    await writeFile(wrapped, Buffer.concat([Buffer.from(`\\restrict ${key}\n`), Buffer.from(stripped, 'latin1')]), { mode: 0o600, flag: 'wx' });
    await run('psql', ['-X', '-w', '-v', 'ON_ERROR_STOP=1', '-f', wrapped]);
    pool = new pg.Pool({ host: socket, port: Number(port), database: 'pa24_restore', user: 'pa24_restore', max: 1, statement_timeout: 30_000 });
    const version = (await pool.query('select version() as version')).rows[0].version as string;
    const query: PaQueryer['query'] = async (text, values) => {
      const result = await pool!.query(text, values ? [...values] : undefined);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    };
    return { kind: 'postgres', query, close: cleanup, versions: { client: clientVersion, server: version, applicationRole: 'pa24_restore (restricted)' },
      integrity: async () => {
        const row = (await query('select rolsuper, rolcreatedb, rolcreaterole from pg_roles where rolname=current_user')).rows[0];
        return row && !row.rolsuper && !row.rolcreatedb && !row.rolcreaterole ? [] : ['恢复后应用读取未使用受限角色'];
      } };
  } catch (error) { await cleanup().catch(() => {}); throw error; }
}
