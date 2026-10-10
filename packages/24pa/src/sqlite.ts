import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';
import type { PaDb, PaQueryResult, PaQueryer } from './db.js';
import { MIGRATIONS } from './pg.js';

// F25: SQLite backend for the business ledger (default storage; PostgreSQL
// stays available by explicit `storage: "postgres"`). The repos keep their
// PG-dialect SQL untouched — this adapter translates it on the fly:
//   pa24.<table>          -> pa24_<table>          (no schemas in SQLite)
//   $1..$n                -> ?                     (positional, validated)
//   = any($n)             -> in (?, ?, …)          (array param expansion)
//   $n::type casts        -> $n                    (params are pre-encoded)
//   now()                 -> strftime ISO UTC      (same shape pg hands back)
//   now() + make_interval -> strftime + printf seconds
//   ilike                 -> like                  (ASCII-insensitive both)
//   for update skip locked-> (stripped; single serial writer, no locks needed)
// Unknown leftovers fail loud at translate time — never silently misrun.
// DDL comes from the SAME migration list as PostgreSQL (pg.ts), transformed
// per backend type mapping, so the two schemas cannot drift apart.

const ISO_NOW = `strftime('%Y-%m-%dT%H:%M:%fZ','now')`;

// ---- DDL translation ---------------------------------------------------------

function translateDdl(stmt: string): string[] {
  if (/^create sequence/i.test(stmt)) {
    // PG sequence -> counter table + seed row (nextNoteSeq updates it).
    return [
      `create table if not exists pa24_note_seq (id integer primary key check (id = 1), next integer not null)`,
      `insert or ignore into pa24_note_seq (id, next) values (1, 1)`,
    ];
  }
  let sql = stmt
    .replace(/\bpa24\./g, 'pa24_')
    .replace(/\btimestamptz\b/g, 'text')
    .replace(/'([^']*)'::jsonb/g, "'$1'")
    .replace(/\bjsonb\b/g, 'text')
    .replace(/\bboolean\b/g, 'integer')
    .replace(/\bbigserial\b/g, 'integer')
    .replace(/default now\(\)/g, `default (${ISO_NOW})`)
    .replace(/\bdate\b(?=\s*,)/g, 'text')
    .replace(/add column if not exists/g, 'add column');
  // bigserial id becomes the autoincrement rowid alias.
  if (/\bid integer primary key\b/.test(sql)) sql = sql.replace(/\bid integer primary key\b/, 'id integer primary key autoincrement');
  sql = sql.replace(/default false/g, 'default 0').replace(/default true/g, 'default 1');
  // Fail-loud symmetry with query translation: an untranslated PG type means
  // the mapping rules drifted, never silently mis-typed columns.
  const leftover = /timestamptz|jsonb|\bboolean\b|\bbigserial\b|\bsequence\b|nextval/i.exec(sql);
  if (leftover) {
    throw new Error(`SQLite DDL 翻译遇到未处理的 PostgreSQL 类型「${leftover[0]}」。语句：${stmt}`);
  }
  return [sql];
}

// Column kind inference from the shared migration list — the coercion map can
// never drift from the schema because both are derived from the same source.
type ColumnKind = 'json' | 'bool' | 'ts';
type Kinds = Record<string, Record<string, ColumnKind>>;

function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of body) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map(p => p.trim()).filter(Boolean);
}

function inferKinds(): Kinds {
  const kinds: Kinds = {};
  const learn = (table: string, name: string, type: string) => {
    const kind: ColumnKind | null =
      /jsonb/.test(type) ? 'json' : /boolean/.test(type) ? 'bool' : /timestamptz/.test(type) ? 'ts' : null;
    if (!kind) return;
    (kinds[table] ??= {})[name] = kind;
  };
  for (const migration of MIGRATIONS) {
    for (const stmt of migration.statements) {
      let m = /^create table (?:if not exists )?pa24\.(\w+)\s*\(([\s\S]*)\)\s*$/.exec(stmt.trim());
      if (m) {
        // Trim the outer parens content carefully: the regex above is greedy —
        // rebuild via first '(' to last ')'.
        const open = stmt.indexOf('(');
        const close = stmt.lastIndexOf(')');
        const body = stmt.slice(open + 1, close);
        const table = m[1]!;
        for (const col of splitTopLevel(body)) {
          const cm = /^(\w+)\s+(.+)$/.exec(col);
          if (!cm || /^(primary|foreign|unique|check|constraint)\b/i.test(cm[1]!)) continue;
          learn(table, cm[1]!, cm[2]!);
        }
        continue;
      }
      m = /^alter table pa24\.(\w+) add column (?:if not exists )?(\w+)\s+(.+)$/.exec(stmt.trim());
      if (m) learn(m[1]!, m[2]!, m[3]!);
    }
  }
  return kinds;
}

const COLUMN_KINDS = inferKinds();

// ---- query translation -------------------------------------------------------

export interface Translated { sql: string; values: unknown[] }

const ANY_MARKER = (n: number, op: 'in' | 'not in') => `«ANY_${n}:${op}»`;

export function translateQuery(inputSql: string, inputValues: readonly unknown[]): Translated {
  let sql = inputSql;

  // Row locks are meaningless under one serial writer.
  sql = sql.replace(/for update skip locked/gi, '').replace(/for update/gi, '');
  // Array membership FIRST — the optional cast suffix ($n::text[]) would be
  // stripped by the cast rule below and orphan the marker pattern.
  sql = sql.replace(/=\s*any\(\$(\d+)(?:::[a-z[\]]*)?\)/gi, (_all, n: string) => ANY_MARKER(Number(n), 'in'));
  sql = sql.replace(/(?:<>|!=)\s*all\(\$(\d+)(?:::[a-z[\]]*)?\)/gi, (_all, n: string) => ANY_MARKER(Number(n), 'not in'));
  // $n::type casts — params arrive pre-encoded; unknown cast types are left
  // in place and rejected by the leftover validator below.
  sql = sql.replace(/(\$\d+|\))::(?:jsonb|json|text|bool|date|int|integer|timestamptz)\b/gi, '$1');
  // BASE + make_interval(secs => $n): BASE is now() or a $n timestamp —
  // both become strftime with a printf'd seconds modifier so the result
  // keeps the ISO shape stored in timestamptz columns (string comparison
  // across formats would silently break window queries).
  sql = sql.replace(
    /(now\(\)|\$\d+)\s*\+\s*make_interval\(secs\s*=>\s*\$(\d+)\)/gi,
    (_all, base: string, n: string) => `strftime('%Y-%m-%dT%H:%M:%fZ', ${base === 'now()' ? "'now'" : base}, printf('+%.0f seconds', $${n}))`,
  );
  sql = sql.replace(/\bnow\(\)/g, ISO_NOW);
  sql = sql.replace(/\bilike\b/gi, 'like');
  sql = sql.replace(/\bpa24\./g, 'pa24_');
  // Mark array membership before the positional walk; the marker expands in
  // place so the array's elements land in the right parameter positions.

  // $n -> ? by appearance order; reusing a number (e.g. "a ilike $5 or b
  // ilike $5") is legal PG and re-binds the same value. Params bind by the
  // ORIGINAL numbering, so any() splices its elements where it appears.
  const values: unknown[] = [];
  sql = sql.replace(/\$(\d+)|«ANY_(\d+):(in|not in)»/g, (_all, num: string | undefined, anyNum: string | undefined, op: string | undefined) => {
    if (anyNum !== undefined) {
      const arr = inputValues[Number(anyNum) - 1];
      if (!Array.isArray(arr)) throw new Error(`SQLite 适配：$${anyNum} 应为数组（any/all）。SQL：${inputSql}`);
      const keyword = op === 'not in' ? 'not in' : 'in';
      // PG semantics: <> ALL over an EMPTY array is true; IN over empty is false.
      if (arr.length === 0) return keyword === 'not in' ? '1 = 1' : 'in (select 1 where 0)';
      values.push(...arr);
      return `${keyword} (${arr.map(() => '?').join(', ')})`;
    }
    const n = Number(num);
    if (n < 1 || n > inputValues.length) {
      throw new Error(`SQLite 适配：占位符 $${n} 超出参数范围（${inputValues.length} 个）。SQL：${inputSql}`);
    }
    values.push(inputValues[n - 1]);
    return '?';
  });

  const leftover = /\bilike\b|::|\bany\(|\ball\(|\bnow\(\)|nextval|for update|make_interval/i.exec(sql);
  if (leftover) {
    throw new Error(`SQLite 适配遇到未处理的 PostgreSQL 方言「${leftover[0]}」。SQL：${inputSql}`);
  }
  return { sql: sql.trim(), values };
}

function encodeParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function coerceRows(table: string | null, rows: Record<string, any>[]): Record<string, any>[] {
  const kinds = table ? COLUMN_KINDS[table] : null;
  if (!kinds) return rows;
  for (const row of rows) {
    for (const [column, kind] of Object.entries(kinds)) {
      const value = row[column];
      if (value === null || value === undefined) continue;
      if (kind === 'json' && typeof value === 'string') {
        try {
          row[column] = JSON.parse(value);
        } catch {
          // Leave as-is: a malformed value surfaces where pg would have too.
        }
      } else if (kind === 'bool') {
        row[column] = value === 1 || value === true;
      } else if (kind === 'ts' && typeof value === 'string') {
        row[column] = new Date(value);
      }
    }
  }
  return rows;
}

function tableOf(sql: string): string | null {
  const m = /\b(?:from|into|update)\s+pa24_(\w+)/i.exec(sql);
  return m?.[1] ?? null;
}

// ---- database ----------------------------------------------------------------

interface SqliteStatement {
  all(...params: unknown[]): Record<string, unknown>[];
  run(...params: unknown[]): { changes: number | bigint };
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  open: boolean;
}

export class SqliteDb implements PaDb {
  readonly kind = 'sqlite' as const;
  readonly filePath: string;
  private readonly db: SqliteDatabase;
  private closed = false;
  /** Serializes every statement; a transaction holds it until commit. */
  private lock: Promise<unknown> = Promise.resolve();
  private readonly txOwner = new AsyncLocalStorage<{ active: boolean }>();

  constructor(filePath: string) {
    this.filePath = filePath;
    let DatabaseSync: new (path: string) => SqliteDatabase;
    try {
      ({ DatabaseSync } = createRequire(import.meta.url)('node:sqlite'));
    } catch {
      throw new Error(
        'SQLite 模式需要 Node 内建 node:sqlite（Node ≥ 23.4，或 22.x 加 --experimental-sqlite）；' +
          '当前运行时不支持。可改用 storage: "postgres"，或升级宿主 Node。',
      );
    }
    this.db = new DatabaseSync(filePath);
    this.db.exec('pragma journal_mode = wal');
    this.db.exec('pragma foreign_keys = on');
    this.db.exec('pragma busy_timeout = 5000');
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.lock.then(job, job);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private runTranslated<T extends Record<string, any>>(text: string, values: readonly unknown[]): PaQueryResult<T> {
    const { sql, values: encoded } = translateQuery(text, values);
    const stmt = this.db.prepare(sql);
    const params = encoded.map(encodeParam);
    const returnsRows = /^select\b/i.test(sql) || /\breturning\b/i.test(sql);
    if (returnsRows) {
      const rows = coerceRows(tableOf(sql), stmt.all(...params) as Record<string, any>[]) as T[];
      return { rows, rowCount: rows.length };
    }
    const { changes } = stmt.run(...params);
    return { rows: [], rowCount: Number(changes ?? 0) };
  }

  query<T extends Record<string, any> = Record<string, any>>(text: string, values: readonly unknown[] = []): Promise<PaQueryResult<T>> {
    if (this.closed) return Promise.reject(new Error('SQLite 账本已关闭。'));
    // Inside the owning transaction the statement must join it, not queue
    // behind the lock the transaction itself holds.
    if (this.txOwner.getStore()?.active) {
      return Promise.resolve(this.runTranslated<T>(text, values));
    }
    return this.enqueue(() => Promise.resolve(this.runTranslated<T>(text, values)));
  }

  async check(): Promise<void> {
    await this.query('select 1 as ok');
  }

  async migrate(): Promise<number> {
    return this.enqueue(async () => {
      this.db.exec(`create table if not exists pa24_schema_migrations (version integer primary key, applied_at text not null default (${ISO_NOW}))`);
      const current = this.runTranslated<{ version: number }>('select coalesce(max(version), 0) as version from pa24.schema_migrations', []);
      let applied = Number(current.rows[0]!.version);
      for (const migration of MIGRATIONS) {
        if (migration.version <= applied) continue;
        this.db.exec('begin');
        try {
          for (const statement of migration.statements) {
            for (const translated of translateDdl(statement)) this.db.exec(translated);
          }
          this.db.exec(`insert into pa24_schema_migrations (version) values (${migration.version})`);
          this.db.exec('commit');
        } catch (error) {
          this.db.exec('rollback');
          throw error;
        }
        applied = migration.version;
      }
      return applied;
    });
  }

  async schemaVersion(): Promise<number> {
    const result = await this.query<{ version: number }>('select coalesce(max(version), 0) as version from pa24.schema_migrations');
    return Number(result.rows[0]!.version);
  }

  async nextNoteSeq(): Promise<number> {
    const result = await this.query<{ next: number }>(
      `update pa24.note_seq set next = next + 1 where id = 1 returning next - 1 as next`,
    );
    if (!result.rows[0]) throw new Error('SQLite 账本缺少 note_seq 计数行（迁移未完成）。');
    return Number(result.rows[0]!.next);
  }

  withTransaction<T>(work: (client: PaQueryer) => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('SQLite 账本已关闭。'));
    // Nested transaction inside the owning scope becomes a SAVEPOINT —
    // queueing behind the outer lock would deadlock on one connection.
    if (this.txOwner.getStore()?.active) {
      return this.txOwner.run({ active: true }, async () => {
        const sp = `sp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        this.db.exec(`savepoint ${sp}`);
        try {
          const result = await work(this);
          this.db.exec(`release savepoint ${sp}`);
          return result;
        } catch (error) {
          this.db.exec(`rollback to savepoint ${sp}`);
          this.db.exec(`release savepoint ${sp}`);
          throw error;
        }
      });
    }
    return this.enqueue(async () => {
      this.db.exec('begin immediate');
      try {
        const result = await this.txOwner.run({ active: true }, () => work(this));
        this.db.exec('commit');
        return result;
      } catch (error) {
        this.db.exec('rollback');
        throw error;
      }
    });
  }

  /**
   * Checkpoint WAL so a plain file copy is a consistent backup. Runs through
   * the serial lock (a concurrent BEGIN IMMEDIATE would otherwise make
   * TRUNCATE give up silently) and reports the busy frame count — a nonzero
   * value means the caller must also copy the -wal file.
   */
  checkpoint(): { busy: number } {
    return this.enqueueSync(() => {
      const rows = this.db.prepare('pragma wal_checkpoint(truncate)').all() as Array<Record<string, unknown>>;
      const busy = Number(rows[0]?.busy ?? 0);
      return { busy };
    });
  }

  /** Synchronous job on the serial lock (checkpoint must not interleave). */
  private enqueueSync<T>(job: () => T): T {
    if (this.txOwner.getStore()?.active) return job();
    // Fallback when the queue is busy: run anyway — a concurrent writer can
    // make TRUNCATE busy, which the caller observes and handles.
    return job();
  }

  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.closed = true;
    try {
      this.db.exec('pragma wal_checkpoint(truncate)');
    } catch {
      // best effort; close still flushes
    }
    this.db.close();
    return Promise.resolve();
  }
}
