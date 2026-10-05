import pg from 'pg';

// Business ledger lives in a dedicated `pa24` schema of the configured
// PostgreSQL instance. The DSN itself comes from the environment variable
// named by AGENTS.md (`pgDsnEnv`); credentials never enter workspace files.

export const SCHEMA_NAME = 'pa24';

const MIGRATIONS: readonly { version: number; statements: readonly string[] }[] = [
  {
    version: 1,
    statements: [
      `create table if not exists pa24.binding (
        app_id text not null,
        tenant_key text not null,
        owner_open_id text not null,
        lark_profile text not null,
        status text not null default 'active',
        chat_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        primary key (app_id, tenant_key, owner_open_id)
      )`,
      `create table if not exists pa24.workspace_state (
        path text primary key,
        feishu_session_id text,
        local_session_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.inbox (
        event_id text primary key,
        source text not null,
        kind text not null,
        payload jsonb not null,
        status text not null,
        request_id text,
        target_session text,
        error text,
        created_at timestamptz not null default now(),
        processed_at timestamptz
      )`,
      `create table if not exists pa24.work_item (
        id text primary key,
        title text not null,
        role text not null,
        instruction text not null,
        origin text not null,
        parent_session_id text not null,
        child_session_id text,
        delivery text not null,
        status text not null,
        progress text,
        result text,
        result_ref jsonb,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists work_item_status_idx on pa24.work_item (status)`,
      `create table if not exists pa24.action_operation (
        id text primary key,
        work_item_id text not null,
        action text not null,
        params jsonb not null,
        status text not null,
        attempt int not null default 0,
        receipt jsonb,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.outbox (
        id bigserial primary key,
        dedup_key text not null unique,
        channel text not null,
        target text not null,
        kind text not null,
        content jsonb not null,
        status text not null,
        message_id text,
        attempts int not null default 0,
        next_attempt_at timestamptz,
        last_error text,
        created_at timestamptz not null default now(),
        sent_at timestamptz
      )`,
      `create index if not exists outbox_dispatch_idx on pa24.outbox (status, next_attempt_at)`,
      `create table if not exists pa24.memo (
        id text primary key,
        work_item_id text,
        topic text not null,
        content text not null,
        doc_url text,
        doc_id text,
        doc_revision text,
        source text not null,
        occurred_on date,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists memo_topic_idx on pa24.memo (topic)`,
      `create index if not exists memo_occurred_idx on pa24.memo (occurred_on)`,
    ],
  },
];

export interface PaPoolOptions {
  max?: number;
  connectTimeoutMs?: number;
}

export class PaDatabase {
  private readonly pool: pg.Pool;
  private closed = false;

  constructor(dsn: string, options: PaPoolOptions = {}) {
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

  query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: readonly unknown[]): Promise<pg.QueryResult<T>> {
    if (this.closed) return Promise.reject(new Error('数据库连接池已关闭。'));
    return this.pool.query<T>(text, values as any[]);
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
