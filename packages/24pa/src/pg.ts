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
  {
    version: 2,
    statements: [
      `create table if not exists pa24.message_route (
        message_id text primary key,
        channel text not null,
        kind text not null,
        work_item_id text,
        inbox_event_id text,
        created_at timestamptz not null default now()
      )`,
      `alter table pa24.work_item add column if not exists recovery_gen int not null default 0`,
    ],
  },
  {
    version: 3,
    statements: [
      `create table if not exists pa24.task (
        id text primary key,
        work_item_id text,
        task_guid text not null unique,
        url text,
        summary text not null,
        due_at timestamptz,
        due_has_time boolean not null default false,
        planned_at timestamptz,
        estimate_minutes int,
        status text not null default 'open',
        external_updated_at timestamptz,
        last_synced_at timestamptz,
        created_at timestamptz not null default now()
      )`,
      `create index if not exists task_status_idx on pa24.task (status)`,
      `create table if not exists pa24.project (
        id text primary key,
        name text not null,
        goal text not null default '',
        status text not null default 'open',
        created_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.project_task (
        project_id text not null references pa24.project (id),
        task_id text not null references pa24.task (id),
        adopted_at timestamptz not null default now(),
        primary key (project_id, task_id)
      )`,
    ],
  },
  {
    version: 4,
    statements: [
      `create table if not exists pa24.calendar_event (
        event_id text primary key,
        calendar_id text not null,
        summary text not null,
        start_time timestamptz not null,
        end_time timestamptz not null,
        is_all_day boolean not null default false,
        timezone text,
        status text not null default 'active',
        recurring boolean not null default false,
        attendees jsonb,
        url text,
        raw jsonb,
        synced_at timestamptz not null default now()
      )`,
      `create index if not exists calendar_event_window_idx on pa24.calendar_event (calendar_id, start_time, end_time)`,
      `create table if not exists pa24.calendar_sync_state (
        calendar_id text primary key,
        window_start timestamptz not null,
        window_end timestamptz not null,
        complete boolean not null default false,
        last_synced_at timestamptz,
        last_error text
      )`,
    ],
  },
  {
    version: 5,
    statements: [
      `create table if not exists pa24.reminder_rule (
        id text primary key,
        kind text not null,
        text text not null,
        record jsonb not null,
        status text not null default 'active',
        next_due_at timestamptz,
        time_zone text not null,
        origin_expression text,
        source text,
        work_item_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists reminder_rule_due_idx on pa24.reminder_rule (status, next_due_at)`,
      `create table if not exists pa24.reminder_occurrence (
        id text primary key,
        rule_id text not null,
        due_at timestamptz not null,
        status text not null default 'pending',
        deferred_until timestamptz,
        origin_occurrence_id text,
        outbox_dedup_key text,
        attempts int not null default 0,
        last_error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists reminder_occurrence_due_idx on pa24.reminder_occurrence (status, due_at)`,
    ],
  },
  {
    version: 6,
    statements: [
      `create sequence if not exists pa24.note_seq start 1`,
      `create table if not exists pa24.note (
        id text primary key,
        title text not null,
        status text not null default 'collecting',
        origin text not null default 'feishu',
        work_item_id text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.note_page (
        id text primary key,
        note_id text not null,
        page_no int not null,
        message_id text not null,
        image_key text,
        media_type text not null,
        byte_size int not null,
        sha256 text not null,
        storage_path text not null,
        source_type text not null default 'image',
        quality text,
        status text not null default 'saved',
        created_at timestamptz not null default now(),
        unique (note_id, page_no)
      )`,
      `create table if not exists pa24.note_version (
        id text primary key,
        note_id text not null,
        version int not null,
        doc_id text,
        doc_url text,
        doc_revision text,
        fingerprint text not null,
        normalized_text text not null,
        content jsonb not null,
        doc_snapshot text not null,
        status text not null default 'pending_review',
        verified_at timestamptz,
        verify_result text,
        verify_fingerprint text,
        created_at timestamptz not null default now(),
        decided_at timestamptz,
        unique (note_id, version)
      )`,
      `create table if not exists pa24.review_token (
        token text primary key,
        note_id text not null,
        version_id text not null,
        action text not null,
        owner_open_id text not null,
        fingerprint text not null,
        expires_at timestamptz not null,
        used_at timestamptz,
        result jsonb
      )`,
      `create table if not exists pa24.review_decision (
        id text primary key,
        note_id text not null,
        version_id text not null,
        decision text not null,
        reviewer_open_id text not null,
        token text not null,
        fingerprint text not null,
        decided_at timestamptz not null default now(),
        doc_sync_status text not null default 'pending',
        doc_sync_error text
      )`,
      `alter table pa24.message_route add column if not exists note_id text`,
    ],
  },
  {
    version: 7,
    statements: [
      `create table if not exists pa24.review_reminder (
        id text primary key,
        note_id text not null,
        version_id text not null,
        kind text not null,
        remind_at timestamptz not null,
        status text not null default 'pending',
        sent_count int not null default 0,
        last_sent_at timestamptz,
        reason text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists review_reminder_due_idx on pa24.review_reminder (status, remind_at)`,
    ],
  },
  {
    version: 8,
    statements: [
      `alter table pa24.reminder_rule add column if not exists link_source_type text`,
      `alter table pa24.reminder_rule add column if not exists link_source_id text`,
      `alter table pa24.reminder_rule add column if not exists link_fingerprint text`,
      `create index if not exists reminder_rule_link_idx on pa24.reminder_rule (link_source_type, link_source_id)`,
      `create table if not exists pa24.outreach (
        id text primary key,
        work_item_id text,
        kind text not null,
        target_open_id text not null,
        target_name text not null,
        content text not null,
        instruction text not null,
        status text not null,
        message_id text,
        task_guid text,
        error text,
        created_at timestamptz not null default now(),
        sent_at timestamptz
      )`,
      `create table if not exists pa24.task_template (
        id text primary key,
        title text not null,
        tasklist_id text not null,
        schedule jsonb not null,
        origin_expression text,
        status text not null default 'active',
        next_due_at timestamptz,
        time_zone text not null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.task_template_instance (
        id text primary key,
        template_id text not null,
        due_at timestamptz not null,
        status text not null default 'pending',
        task_id text,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists task_template_instance_due_idx on pa24.task_template_instance (status, due_at)`,
      `create table if not exists pa24.waiting_item (
        id text primary key,
        title text not null,
        detail text not null default '',
        source_desc text not null default '',
        dedup_key text,
        checkpoint_at timestamptz,
        status text not null default 'waiting',
        result text,
        ask_count int not null default 0,
        last_asked_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create index if not exists waiting_item_due_idx on pa24.waiting_item (status, checkpoint_at)`,
    ],
  },
  {
    version: 9,
    statements: [
      `create table if not exists pa24.digest_plan (
        id text primary key,
        kind text not null,
        title text not null,
        schedule_id text,
        session_id text not null,
        schedule_spec jsonb not null,
        status text not null default 'active',
        last_window text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
      `create table if not exists pa24.digest_occurrence (
        id text primary key,
        plan_id text not null,
        window_key text not null,
        status text not null default 'delivering',
        report jsonb,
        outbox_key text,
        delivered_at timestamptz,
        completed_at timestamptz,
        error text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique (plan_id, window_key)
      )`,
      `create index if not exists digest_occurrence_plan_idx on pa24.digest_occurrence (plan_id, created_at)`,
    ],
  },
  {
    version: 10,
    statements: [
      `create table if not exists pa24.minutes (
        id text primary key,
        work_item_id text,
        event_id text,
        topic text not null,
        memo_id text,
        doc_url text,
        candidates jsonb not null default '[]'::jsonb,
        status text not null default 'draft',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )`,
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
