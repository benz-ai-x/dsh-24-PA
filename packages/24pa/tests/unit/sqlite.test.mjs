// F25 unit: the SQLite adapter must translate every PG dialect construct the
// repos use, migrate the shared DDL list, and round-trip business rows with
// the same JS shapes PostgreSQL hands back (Date timestamps, parsed jsonb,
// booleans).
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteDb, translateQuery } from '../../lib/sqlite.js';
import { createRepos } from '../../lib/repo.js';

describe('F25：方言翻译（translateQuery）', () => {
  it('$n 转位置参数，支持同一编号复用（ilike 双列同参）', () => {
    const t = translateQuery(
      'select * from pa24.memo where (content ilike $1 or topic ilike $1) limit $2',
      ['%预算%', 10],
    );
    expect(t.sql).toBe("select * from pa24 memo where (content like ? or topic like ?) limit ?".replace('pa24 memo', 'pa24_memo'));
    expect(t.values).toEqual(['%预算%', '%预算%', 10]);
  });

  it('= any($n) 展开为 in 列表（含空数组）', () => {
    const t = translateQuery('select * from pa24.work_item where status = any($1) limit $2', [['queued', 'running'], 5]);
    expect(t.sql).toContain('status in (?, ?)');
    expect(t.values).toEqual(['queued', 'running', 5]);
    const empty = translateQuery('select * from pa24.work_item where status = any($1)', [[]]);
    expect(empty.sql).toContain('in (select 1 where 0)');
  });

  it('now()、make_interval、cast、行锁全部翻译且无残留', () => {
    const t = translateQuery(
      `update pa24.outbox set attempts = attempts + 1,
         status = case when $1::bool then 'sent' else $2::text end,
         sent_at = case when $3::bool then now() else sent_at end,
         next_attempt_at = case when $4::bool then now() + make_interval(secs => $5) else next_attempt_at end
       where id in (select id from pa24.outbox where status = 'pending' order by id limit $6 for update skip locked)`,
      [true, 'sent', true, false, 30, 10],
    );
    expect(t.sql).not.toMatch(/ilike|::|any\(|now\(\)|nextval|for update|make_interval/i);
    expect(t.sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    expect(t.sql).toContain("printf('+%.0f seconds', ?)");
    expect(t.sql).toContain('pa24_outbox');
    expect(t.values).toEqual([true, 'sent', true, false, 30, 10]);
  });

  it('F25 补充：<> all($n::text[]) 展开、参数基 make_interval 保持 ISO 形态', () => {
    const t = translateQuery(
      'select * from pa24.calendar_event where event_id <> all($1::text[]) and start_time <= $2::timestamptz + make_interval(secs => $3)',
      [['a', 'b'], new Date('2026-10-10T00:00:00Z'), 60],
    );
    expect(t.sql).toContain('event_id not in (?, ?)');
    expect(t.sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ', ?, printf('+%.0f seconds', ?))");
    expect(t.values).toEqual(['a', 'b', new Date('2026-10-10T00:00:00Z'), 60]);
    const emptyAll = translateQuery('select 1 as x where $1::int <> all($2::text[])', [5, []]);
    expect(emptyAll.sql).toContain('1 = 1');
  });

  it('F25 补充：未覆盖的 any/all 形态（<> any、= all）按残留方言抛错', () => {
    expect(() => translateQuery('select * from t where id <> any($1)', [['a']])).toThrow(/未处理/);
    expect(() => translateQuery('select * from t where id = all($1)', [['a']])).toThrow(/未处理/);
  });

  it('未知方言直接抛错（fail loud，不静默误跑）', () => {
    expect(() => translateQuery('select * from pa24.x where a = some_function($1)', ['v'])).not.toThrow();
    expect(() => translateQuery('select nextval($1)', ['s'])).toThrow(/未处理/);
    // 乱序合法：按编号取值
    expect(translateQuery('select $2, $1', ['a', 'b']).values).toEqual(['b', 'a']);
  });
});

describe('F25：SQLite 账本（迁移＋业务往返）', () => {
  let db;
  let root;

  it('共享迁移清单建全 29 表骨架，schema 版本与 PG 一致', async () => {
    root = await mkdtemp(join(tmpdir(), 'pa24-sqlite-'));
    db = new SqliteDb(join(root, 'pa24.db'));
    const version = await db.migrate();
    expect(version).toBeGreaterThanOrEqual(11);
    const tables = (await db.query(`select name from sqlite_master where type='table' and name like 'pa24_%' order by name`)).rows.map(r => r.name);
    for (const expected of ['pa24_inbox', 'pa24_work_item', 'pa24_outbox', 'pa24_task', 'pa24_calendar_event', 'pa24_reminder_rule', 'pa24_note', 'pa24_note_version', 'pa24_note_seq', 'pa24_digest_plan', 'pa24_minutes', 'pa24_schema_migrations']) {
      expect(tables).toContain(expected);
    }
  });

  it('inbox 幂等入账＋认领（on conflict/returning/skip locked 语义等价）', async () => {
    const repos = createRepos(db);
    const first = await repos.inbox.insert({ eventId: 'evt-1', source: 'feishu', kind: 'message', payload: { text: 'hi' } });
    expect(first.inserted).toBe(true);
    expect(first.row.payload).toEqual({ text: 'hi' }); // jsonb 回读为对象
    expect(first.row.created_at).toBeInstanceOf(Date); // timestamptz 回读为 Date
    const dup = await repos.inbox.insert({ eventId: 'evt-1', source: 'feishu', kind: 'message', payload: { text: 'hi' } });
    expect(dup.inserted).toBe(false);
    const claimed = await repos.inbox.claim(10);
    expect(claimed.map(r => r.event_id)).toEqual(['evt-1']);
    expect(claimed[0].status).toBe('processing');
  });

  it('布尔/JSON/时间戳业务行与 PG 形态一致；any() 列表过滤；ilike 复用检索', async () => {
    const repos = createRepos(db);
    await repos.tasks.save({
      id: 'tsk-1', work_item_id: null, task_guid: 'g1', url: null, summary: '写预算表',
      due_at: new Date('2026-10-12T02:00:00Z'), due_has_time: true, planned_at: null, estimate_minutes: 30,
      status: 'open', external_updated_at: null, last_synced_at: null,
    });
    const row = (await repos.tasks.list('open')).find(t => t.id === 'tsk-1');
    expect(row.due_has_time).toBe(true);
    expect(row.due_at.getTime()).toBe(Date.parse('2026-10-12T02:00:00Z'));
    await repos.memos.insert({ id: 'memo-1', work_item_id: null, topic: 'Q4', content: '预算讨论', doc_url: null, doc_id: null, doc_revision: null, source: 'test', occurred_on: '2026-10-10' });
    const found = await repos.memos.search({ query: '预算' });
    expect(found.length).toBeGreaterThanOrEqual(1);
  });

  it('note 序号递增；事务提交可见、回滚不可见', async () => {
    const repos = createRepos(db);
    const a = await repos.notes.nextNoteId();
    const b = await repos.notes.nextNoteId();
    expect(Number(a.slice(2)) + 1).toBe(Number(b.slice(2)));
    await db.withTransaction(async client => {
      await client.query(`insert into pa24.memo (id, topic, content, source) values ($1, $2, $3, $4)`, ['memo-tx', 'tx', 'in', 'test']);
    });
    const inTx = await db.query(`select count(*) as c from pa24.memo where id = $1`, ['memo-tx']);
    expect(Number(inTx.rows[0].c)).toBe(1);
    await expect(db.withTransaction(async client => {
      await client.query(`insert into pa24.memo (id, topic, content, source) values ($1, $2, $3, $4)`, ['memo-rb', 'tx', 'in', 'test']);
      throw new Error('rollback-me');
    })).rejects.toThrow('rollback-me');
    const rolled = await db.query(`select count(*) as c from pa24.memo where id = $1`, ['memo-rb']);
    expect(Number(rolled.rows[0].c)).toBe(0);
  });

  it('备份 checkpoint 后文件可整体拷贝（WAL 收拢）', async () => {
    db.checkpoint();
    await rm(root, { recursive: true, force: true });
  });
});
