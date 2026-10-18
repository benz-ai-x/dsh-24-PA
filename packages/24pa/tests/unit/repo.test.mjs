import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { startPgCluster } from '../helpers/pg.mjs';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { defineRepoEquivalenceSuite } from '../helpers/repo-scenarios.mjs';

// These tests run against a real, isolated PostgreSQL cluster (initdb in a
// temp dir) — the same boundary production uses, just locally provisioned.
// The business-behavior scenarios live in the shared equivalence table
// (repo-scenarios.mjs); what stays here is PostgreSQL-only: raw-SQL time
// fixtures and migration-shape assertions written in PG dialect.
defineRepoEquivalenceSuite(
  { describe, it, expect, beforeAll, afterAll },
  async () => {
    const cluster = await startPgCluster();
    const db = new PaDatabase(cluster.dsn);
    return { db, cleanup: () => cluster.stop() };
  },
);

describe('PostgreSQL 专属（裸 SQL 时间夹具与迁移形态）', () => {
  let cluster, db, repos;

  beforeAll(async () => {
    cluster = await startPgCluster();
    db = new PaDatabase(cluster.dsn);
    await db.migrate();
    repos = createRepos(db);
  });

  afterAll(async () => {
    await db.close();
    await cluster.stop();
  });

  it('F28 workspace_state：latestPath 取最近更新的工作区', async () => {
    await repos.workspaceState.save('/tmp/ws-f28-a', { localSessionId: 'a' });
    await repos.workspaceState.save('/tmp/ws-f28-b', { localSessionId: 'b' });
    // updated_at 显式拨序，避免 PG now() 微秒精度导致两条 save 同拍
    await db.query(`update pa24.workspace_state set updated_at = now() - interval '1 hour' where path = '/tmp/ws-f28-a'`);
    expect(await repos.workspaceState.latestPath()).toBe('/tmp/ws-f28-b');
    await db.query(`update pa24.workspace_state set updated_at = now() where path = '/tmp/ws-f28-a'`);
    expect(await repos.workspaceState.latestPath()).toBe('/tmp/ws-f28-a');
  });

  it('F28 reminder：cancelPendingOccurrences(unclaimedOnly) 保留已到期实例', async () => {
    const due = new Date(Date.now() - 60_000);
    await repos.reminders.insertRule({ id: 'rr-f28', kind: 'daily', text: '试验提醒', record: {}, status: 'active', next_due_at: due, time_zone: 'Asia/Shanghai', origin_expression: 'daily 9:00', source: 'test' });
    await repos.reminders.insertOccurrence({ id: 'occ-elapsed', ruleId: 'rr-f28', dueAt: due });
    await repos.reminders.insertOccurrence({ id: 'occ-later', ruleId: 'rr-f28', dueAt: new Date(Date.now() + 7200_000) });
    // occ-later 处于延期窗口内（未来）→ 未被领取；occ-elapsed 的延期已过 → 视为派发中
    await db.query(`update pa24.reminder_occurrence set deferred_until = now() - interval '1 minute' where id = 'occ-elapsed'`);
    await db.query(`update pa24.reminder_occurrence set deferred_until = now() + interval '1 hour' where id = 'occ-later'`);
    const canceled = await repos.reminders.cancelPendingOccurrences('rr-f28', true);
    expect(canceled).toBe(1); // 只取消 occ-later
    const all = await db.query(`select id, status from pa24.reminder_occurrence where rule_id = 'rr-f28'`);
    const byId = Object.fromEntries(all.rows.map(r => [r.id, r.status]));
    expect(byId['occ-elapsed']).toBe('pending');
    expect(byId['occ-later']).toBe('canceled');
  });

  it('v12 形态行（skill 空串）按 kind 映射内置名，其余字段不动', async () => {
    // 直接以 v12 形态裸插三行，再执行 v13 的映射语句——验证回填 SQL 语义
    await db.query(`insert into pa24.digest_plan (id, kind, title, session_id, schedule_spec, status, last_window, voice, skill)
      values ('mig-a', 'morning', '旧晨报', 's', '{}', 'active', '2026-10-01', true, ''),
             ('mig-b', 'meeting_prep', '旧会前', 's', '{}', 'active', null, false, ''),
             ('mig-c', 'once', '一次性', 's', '{}', 'stopped', null, false, 'custom-x')`, []);
    await db.query(`update pa24.digest_plan set skill = case when kind = 'meeting_prep' then 'meeting-prep' else 'digest-' || kind end where skill = '' and kind in ('morning', 'evening', 'weekly', 'meeting_prep')`, []);
    const rows = await db.query('select id, skill, voice, status, last_window from pa24.digest_plan where id like \'mig-%\'');
    const byId = Object.fromEntries(rows.rows.map(r => [r.id, r]));
    expect(byId['mig-a']).toMatchObject({ skill: 'digest-morning', voice: true, status: 'active', last_window: '2026-10-01' });
    expect(byId['mig-b'].skill).toBe('meeting-prep');
    expect(byId['mig-c'].skill).toBe('custom-x'); // 已有绑定不动
  });
});
