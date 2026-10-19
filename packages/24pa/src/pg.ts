import { runCliProcess } from './cli-gateway.js';
import pg from 'pg';
import { MIGRATIONS } from './db.js';
import type { BackupPart, PaDb } from './db.js';

// Business ledger lives in a dedicated `pa24` schema of the configured
// PostgreSQL instance. The DSN itself comes from the environment variable
// named by AGENTS.md (`pgDsnEnv`); credentials never enter workspace files.

export const SCHEMA_NAME = 'pa24';



export interface PaPoolOptions {
  max?: number;
  connectTimeoutMs?: number;
}

export class PaDatabase implements PaDb {
  readonly kind = 'postgres' as const;
  private readonly pool: pg.Pool;
  /** Kept for pg_dump (backup); never logged. */
  private readonly dsn: string;
  private closed = false;

  constructor(dsn: string, options: PaPoolOptions = {}) {
    this.dsn = dsn;
    this.pool = new pg.Pool({
      connectionString: dsn,
      max: options.max ?? 5,
      connectionTimeoutMillis: options.connectTimeoutMs ?? 8000,
      idleTimeoutMillis: 10_000,
      allowExitOnIdle: false,
    });
    this.pool.on('error', () => {
      // Idle-client errors must not crash the Host; queries surface failures
      // through their own rejects and the readiness check reports them.
    });
  }

  async check(): Promise<void> {
    await this.pool.query('select 1');
  }

  async migrate(): Promise<number> {
    await this.pool.query(`create schema if not exists ${SCHEMA_NAME}`);
    await this.pool.query(`create table if not exists ${SCHEMA_NAME}.schema_migrations (version int primary key, applied_at timestamptz not null default now())`);
    const current = await this.pool.query<{ version: number }>(`select coalesce(max(version), 0) as version from ${SCHEMA_NAME}.schema_migrations`);
    let applied = current.rows[0]!.version;
    for (const migration of MIGRATIONS) {
      if (migration.version <= applied) continue;
      const client = await this.pool.connect();
      try {
        await client.query('begin');
        for (const statement of migration.statements) await client.query(statement);
        await client.query(`insert into ${SCHEMA_NAME}.schema_migrations (version) values ($1)`, [migration.version]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
      applied = migration.version;
    }
    return applied;
  }

  async schemaVersion(): Promise<number> {
    const result = await this.pool.query<{ version: number }>(`select coalesce(max(version), 0) as version from ${SCHEMA_NAME}.schema_migrations`);
    return result.rows[0]!.version;
  }

  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: readonly unknown[]): Promise<pg.QueryResult<T> & { rowCount: number }> {
    if (this.closed) throw new Error('数据库连接池已关闭。');
    const result = await this.pool.query<T>(text, values as any[]);
    // PaDb contract: rowCount is always a number (the driver leaves it null
    // only in cases our repos never rely on).
    if (result.rowCount == null) return { ...result, rowCount: 0 } as pg.QueryResult<T> & { rowCount: number };
    return result as pg.QueryResult<T> & { rowCount: number };
  }

  async withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async nextNoteSeq(): Promise<number> {
    const result = await this.pool.query<{ next: string }>(`select nextval('pa24.note_seq') as next`);
    return Number(result.rows[0]!.next);
  }

  /** F28: pg_dump of the pa24 schema only; the DSN is redacted from any
   *  surfaced stderr so credentials stay out of diagnostics. */
  async backup(): Promise<BackupPart[]> {
    const result = await runCliProcess({
      bin: 'pg_dump', argv: ['--schema=pa24', '--no-owner', '--no-privileges', '--dbname', this.dsn],
      timeoutMs: 10 * 60_000, stdoutLimitBytes: 256 * 1024 * 1024,
      fail: kind => new Error(`pg_dump 未完成（${kind}）；备份期限 10 分钟、输出上限 256MiB，请核对后重试。`),
    });
    if (result.exitCode !== 0) throw new Error(`pg_dump 退出码 ${result.exitCode}：${result.stderr.split(this.dsn).join('[已隐藏]').slice(0, 300) || '无诊断输出'}`);
    const bytes = result.stdoutBytes;
    return [{ id: 'postgres', name: 'pa24.sql', bytes }];
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}

export function resolveDsn(envName: string, env: Record<string, string | undefined> = process.env): string {
  const dsn = env[envName];
  if (!dsn || !dsn.trim()) throw new Error(`环境变量 ${envName} 未提供 PostgreSQL 连接串。`);
  return dsn.trim();
}
