import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { RunHistory, historyFilter } from '../../lib/run-history.js';
import { startPgCluster } from '../helpers/pg.mjs';

for (const backend of ['sqlite', 'postgres']) describe(`全局运行档案 (${backend})`, () => {
  let db, cluster, repos, history, now;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); });
  beforeEach(async () => {
    for (const table of ['skill_run', 'work_item', 'plan_trigger', 'digest_plan', 'digest_occurrence', 'outbox', 'task_plan_delivery']) await db.query(`delete from pa24.${table}`);
    now = new Date();
    for (let i = 0; i < 32; i++) {
      const at = new Date(now.getTime() - (i >= 30 ? 10 * 86400000 : (i + 1) * 1000)), status = [1, 30].includes(i) ? 'failed' : i === 0 ? 'running' : 'completed';
      await repos.workItems.insert({ id: `w${i}`, title: i < 2 ? '目标 %_' : `交办 ${i}`, instruction: '保留的请求', role: 'skill', origin: i % 2 ? 'feishu' : 'local',
        parent_session_id: 'parent', child_session_id: `session${i}`, delivery: 'local', status: i === 2 ? 'waiting_input' : status, skill: null });
      await db.query(`insert into pa24.skill_run (id, request_id, request_hash, work_item_id, skill_id, version_id, source_session_id, session_id,
        workspace_path, mode, trial, snapshot, status, result, plan_id, trigger_kind, created_at, updated_at)
        values ($1,$1,'hash',$2,'builtin:history','v1','parent',$3,'/private/workspace','template',$4,$5,$6,$7,$8,$9,$10,$10)`,
      [`r${i}`, `w${i}`, `session${i}`, i === 3, JSON.stringify({ name: '能力', ...(i === 4 ? { continuation: { fromRunId: 'prior', instruction: '' } } : {}) }), status,
        i === 5 ? 'secret-credentials-123 Bearer token456' : `结果 ${i}`, i < 5 ? 'plan-a' : null, i === 2 ? 'schedule' : null, at]);
    }
    const out = await repos.outbox.enqueue({ dedupKey: 'failed-audio', channel: 'feishu', target: 'private-recipient', kind: 'audio', content: { text: 'private-result' } });
    await repos.outbox.mark(out.row.id, { status: 'failed', error: '合成失败' });
    await db.query("insert into pa24.task_plan_delivery (outbox_id, notice_id, run_id, component, override_quiet) values ($1,'notice','r2','audio',false)", [out.row.id]);
    await db.query("update pa24.skill_run set delivery_status = 'partial' where id = 'r2'");
    const context = () => ({ binding: 'binding', timeZone: 'Asia/Shanghai', repos });
    history = new RunHistory({ context, skills: {}, secretValues: () => ['secret-credentials-123'] });
  });
  const list = extra => history.list({ workspaceBinding: 'binding', ...extra });
  it('默认七天按全部数据准确计数分页，旧未解决失败跨日期保留，搜索转义通配符', async () => {
    const first = await list({}), second = await list({ offset: 20 });
    expect(first.total).toBe(31); expect(first.rows).toHaveLength(20); expect(second.rows).toHaveLength(11);
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(31);
    expect(second.rows.some(row => row.id === 'r30')).toBe(true); expect(second.rows.some(row => row.id === 'r31')).toBe(false);
    expect((await list({ includeUnresolved: false })).total).toBe(30);
    expect((await list({ query: '%_' })).rows.map(row => row.id).sort()).toEqual(['r0', 'r1']);
    expect((await list({ range: '30', offset: 20 })).rows).toHaveLength(12);
  });
  it('来源、计划、版本、执行与投递状态组合筛选，不用仅最近记录推算', async () => {
    expect((await list({ source: 'trial' })).rows.map(row => row.id)).toEqual(['r3']);
    expect((await list({ source: 'rerun' })).rows.map(row => row.id)).toEqual(['r4']);
    expect((await list({ planId: 'plan-a', source: 'schedule', status: 'completed', deliveryStatus: 'partial', versionId: 'v1' })).rows.map(row => row.id)).toEqual(['r2']);
    expect((await list({ workId: 'w29' })).rows.map(row => row.id)).toEqual(['r29']);
    expect((await list({ versionId: 'missing' })).total).toBe(0);
    await expect(list({ offset: Infinity })).rejects.toThrow(/页码/);
    await expect(list({ kind: 'work', deliveryStatus: 'failed' })).rejects.toThrow(/不支持/);
    await expect(list({ workspaceBinding: 'stale' })).rejects.toThrow(/工作区/);
  });
  it('摘要分别计算运行、执行失败、实际投递失败、交办与未执行事件', async () => {
    await db.query("insert into pa24.digest_plan (id, kind, title, session_id, schedule_spec) values ('plan-a','task','统计计划','parent','{}')");
    await db.query("insert into pa24.plan_trigger (id, plan_id, generation, occurrence, source, status, reason, snapshot) values ('t','plan-a','g','occ','schedule','skipped','重叠','{}')");
    const summary = await history.summary({ workspaceBinding: 'binding' });
    expect(summary).toMatchObject({ runs24: 30, failed24: 1, delivery_failed24: 1, unresolved: 3, unexecuted24: 1,
      active_work: 1, waiting_work: 1, failed_work: 2, work24: 32 });
    expect((await list({ kind: 'events' })).rows[0]).toMatchObject({ id: 't', status: 'skipped', summary: '重叠' });
    const detail = await history.work({ workId: 'w2', workspaceBinding: 'binding' });
    expect(detail.work.status).toBe('waiting_input'); expect(detail.runs.total).toBe(1); expect(detail.runs.rows[0].id).toBe('r2');
  });
  it('导出覆盖全部筛选结果并脱敏，旧简报保持独立档案，不伪造新运行', async () => {
    const exported = await history.export({ range: 'all', workspaceBinding: 'binding' });
    expect(exported.total).toBe(32); expect(JSON.parse(exported.content).rows).toHaveLength(32);
    expect(exported.content).not.toContain('secret-credentials-123'); expect(exported.content).not.toContain('token456');
    expect(exported.content).not.toContain('/private/workspace'); expect(exported.content).not.toContain('private-recipient');
    await db.query("insert into pa24.digest_occurrence (id, plan_id, window_key, status, report) values ('old','old-plan','2026-10-01','sent',$1)", [JSON.stringify('原始简报')]);
    const legacy = await list({ kind: 'legacy', range: 'all' });
    expect(legacy.total).toBe(1); expect(legacy.rows[0].report).toBe('原始简报'); expect((await list({ range: 'all' })).total).toBe(32);
  });
});

it('自定义时间按工作区时区解释，夏令时歧义要求明确偏移', () => {
  const filter = historyFilter({ range: 'custom', from: '2026-10-23T00:00', to: '2026-10-24T00:00' }, 'Asia/Shanghai');
  expect(filter.from.toISOString()).toBe('2026-10-22T16:00:00.000Z');
  expect(() => historyFilter({ range: 'custom', from: '2026-11-01T01:30', to: '2026-11-01T03:00' }, 'America/New_York')).toThrow(/歧义/);
  expect(() => historyFilter({ range: 'custom', from: '2026-10-24T00:00', to: '2026-10-23T00:00' }, 'Asia/Shanghai')).toThrow(/开始时间/);
});

it('诊断预览只导出允许的状态与计时，不带原输入、调用参数、回执正文或接收者', async () => {
  const history = new RunHistory({ context: () => ({ binding: 'b', timeZone: 'UTC' }), skills: { inspect: async () => ({
    run: { id: 'run', status: 'completed', delivery_status: 'sent', mode: 'business', skill_id: 's', version_id: 'v',
      parameters: { private: 'original-input' }, result: 'private-result', workspace_path: '/private/workspace' },
    execution: { executionMs: 300, limitMs: 1000, remainingMs: 700, blocks: [{ kind: 'input', reason: 'private-question' }] },
    attempts: [{ number: 1, error: 'private-error' }], calls: [{ tool: 'task_create', status: 'returned', arguments: { private: 'private-argument' }, result: 'private-receipt' }],
    native: [{ kind: 'job', end_data: { status: 'completed', detail: 'private-output' } }],
    deliveries: [{ kind: 'result', deliveryStatus: 'sent', deliveries: [{ component: 'text', outbox: { status: 'sent', attempts: 1, target: 'private-recipient' } }] }],
  }) } });
  const exported = await history.diagnostics({ workspaceBinding: 'b', runId: 'run' });
  expect(exported.content).not.toMatch(/private|original-input/);
  expect(JSON.parse(exported.content)).toMatchObject({ runId: 'run', execution: { executionMs: 300, blockKinds: ['input'] }, calls: [{ tool: 'task_create', status: 'returned' }] });
  expect(exported.message).toContain('预览');
  await expect(history.diagnostics({ workspaceBinding: 'stale', runId: 'run' })).rejects.toThrow(/工作区/);
});
