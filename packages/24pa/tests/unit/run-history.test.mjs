import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SqliteDb } from '../../lib/sqlite.js';
import { PaDatabase } from '../../lib/pg.js';
import { createRepos } from '../../lib/repo.js';
import { RunHistory, historyFilter } from '../../lib/run-history.js';
import { initializeRunControl } from '../../lib/repo/run-control.js';
import { beginRunAttempt, failRunAttempt } from '../../lib/run-control.js';
import { startPgCluster } from '../helpers/pg.mjs';
import { fixture } from '../helpers/runtime.mjs';
import { writeSecretStore } from '../../lib/secrets.js';

for (const backend of ['sqlite', 'postgres']) describe(`全局运行档案 (${backend})`, () => {
  let db, cluster, repos, history, now;
  beforeAll(async () => {
    if (backend === 'postgres') { cluster = await startPgCluster(); db = new PaDatabase(cluster.dsn); } else db = new SqliteDb(':memory:');
    await db.migrate(); repos = createRepos(db);
  });
  afterAll(async () => { await db?.close(); await cluster?.stop(); });
  beforeEach(async () => {
    for (const table of ['skill_run', 'worker_run', 'work_item', 'plan_trigger', 'task_plan_block', 'digest_plan', 'digest_occurrence', 'outbox', 'task_plan_delivery', 'run_diagnostic']) await db.query(`delete from pa24.${table}`);
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
  it('空档案与筛选无匹配分别提供依据，取消的占位运行不冒充执行档案', async () => {
    expect(await list({ query: 'does-not-exist' })).toMatchObject({ total: 0, empty: false });
    expect(await list({ kind: 'events' })).toMatchObject({ total: 0, empty: true });
    await db.query('delete from pa24.skill_run');
    expect(await list({})).toMatchObject({ total: 0, empty: true });
    expect(await list({ kind: 'work', query: 'does-not-exist' })).toMatchObject({ total: 0, empty: false });
  });
  it('空库存摘要为中性，只有旧简报时仍不冒充空档案', async () => {
    expect((await history.summary({ workspaceBinding: 'binding' })).empty).toBe(false);
    for (const table of ['plan_trigger', 'skill_run', 'worker_run', 'work_item', 'digest_occurrence']) await db.query(`delete from pa24.${table}`);
    expect(await history.summary({ workspaceBinding: 'binding' })).toMatchObject({ empty: true, run_total: 0, work_total: 0, event_total: 0, legacy_total: 0 });
    await db.query("insert into pa24.digest_occurrence (id, plan_id, window_key, status) values ('legacy-only','old-plan','window','sent')");
    expect(await history.summary({ workspaceBinding: 'binding' })).toMatchObject({ empty: false, run_total: 0, work_total: 0, event_total: 0, legacy_total: 1 });
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
    await db.query('update pa24.skill_run set snapshot = $2 where id = $1', ['r29', JSON.stringify({ name: '能力', plan: { title: '可见的计划标题' } })]);
    expect((await list({ query: '可见的计划标题' })).rows.map(row => row.id)).toEqual(['r29']);
  });
  it('暂停取消的未启动排队只计未执行，原始记录仍可核对', async () => {
    await db.query("insert into pa24.digest_plan (id, kind, title, session_id, schedule_spec) values ('plan-a','task','排队计划','parent','{}')");
    await db.query("update pa24.skill_run set status = 'pending' where id = 'r0'");
    await db.query("insert into pa24.plan_trigger (id, plan_id, run_id, generation, occurrence, source, status, snapshot) values ('queued','plan-a','r0','g','occ','schedule','queued','{}')");
    await repos.skillRuns.rejectPendingPlanRun('r0', '主人暂停，未启动');
    expect((await list({ range: 'all' })).total).toBe(31);
    expect((await list({ kind: 'events' })).rows[0]).toMatchObject({ run_id: 'r0', status: 'skipped' });
    expect(await history.summary({ workspaceBinding: 'binding' })).toMatchObject({ runs24: 29, unexecuted24: 1 });
    expect((await repos.skillRuns.get('r0')).status).toBe('stopped');
  });
  it('已投递处理通知的旧权限阻断与过期单次触发跨日保留，修复后才移出待处理范围', async () => {
    await db.query("insert into pa24.digest_plan (id, kind, title, session_id, schedule_spec) values ('plan-a','once','待处理计划','parent','{}')");
    await db.query("insert into pa24.task_plan_block (plan_id, key, kind, reason) values ('plan-a','preflight','authorization','授权失效')");
    await db.query("update pa24.skill_run set status = 'stopped', stop_reason = 'blocked', delivery_status = 'sent' where id = 'r0'");
    const old = new Date(now.getTime() - 10 * 86400000);
    await db.query("insert into pa24.plan_trigger (id, plan_id, run_id, generation, occurrence, source, status, snapshot, created_at) values ('blocked','plan-a','r0','g','occ','schedule','skipped','{}',$1)", [old]);
    await db.query("insert into pa24.plan_trigger (id, plan_id, generation, occurrence, source, status, snapshot, created_at) values ('expired','plan-a','g','older','schedule','expired','{}',$1)", [old]);
    expect((await list({ kind: 'events' })).total).toBe(2);
    expect(await history.summary({ workspaceBinding: 'binding' })).toMatchObject({ unresolved_events: 2, unexecuted24: 0 });
    await db.query("delete from pa24.task_plan_block where plan_id = 'plan-a'");
    expect((await list({ kind: 'events' })).total).toBe(0);
    expect((await list({ kind: 'events', range: 'all' })).total).toBe(2);
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
  it('接续来源的真实拒绝 Worker 记录可作为未执行事件筛选', async () => {
    await repos.workItems.insert({ id: 'continuation-work', title: '接续未执行', instruction: '保留原请求', role: 'memo', origin: 'local',
      parent_session_id: 'parent', child_session_id: 'continuation-session', delivery: 'local', status: 'failed', skill: null });
    await db.query(`insert into pa24.worker_run (id, work_item_id, session_id, source, status, instruction, progress, snapshot)
      values ('continuation-rejected','continuation-work','continuation-session','continuation','rejected','接续请求','接续准入拒绝','{}')`);
    const events = await list({ kind: 'events', source: 'continuation', workId: 'continuation-work', range: 'all' });
    expect(events).toMatchObject({ total: 1, empty: false });
    expect(events.rows[0]).toMatchObject({ id: 'continuation-rejected', run_id: 'continuation-rejected', work_item_id: 'continuation-work',
      record_kind: 'worker', source: 'continuation', status: 'rejected', summary: '接续准入拒绝' });
    expect((await list({ kind: 'runs', workId: 'continuation-work', range: 'all' })).total).toBe(0);
  });
  it('实际投递失败与待核对分别统计，未知仍保留在运行和事件的全量待处理中', async () => {
    expect(await history.summary({ workspaceBinding: 'binding' })).toMatchObject({ delivery_failed24: 1, delivery_unknown24: 0, unresolved: 3, unresolved_events: 0 });
    await repos.workItems.insert({ id: 'worker-unknown-work', title: 'Worker 待核对', instruction: '保留原请求', role: 'memo', origin: 'local',
      parent_session_id: 'parent', child_session_id: 'worker-unknown-session', delivery: 'local', status: 'completed', skill: null });
    const workerOutbox = await repos.outbox.enqueue({ dedupKey: 'worker-unknown-outbox', channel: 'local', target: 'parent', kind: 'text', content: { text: '已保存结果' } });
    await repos.outbox.mark(workerOutbox.row.id, { status: 'unknown', error: '原入口回执丢失' });
    await db.query(`insert into pa24.worker_run (id, work_item_id, session_id, source, status, instruction, snapshot, outbox_key)
      values ('worker-unknown','worker-unknown-work','worker-unknown-session','manual','completed','原请求','{}','worker-unknown-outbox')`);
    await db.query("update pa24.skill_run set plan_id = 'unknown-event-plan' where id = 'r3'");
    await db.query("insert into pa24.digest_plan (id, kind, title, session_id, schedule_spec) values ('unknown-event-plan','task','未知投递事件','parent','{}')");
    await db.query("insert into pa24.plan_trigger (id, plan_id, run_id, generation, occurrence, source, status, reason, snapshot) values ('unknown-event','unknown-event-plan','r3','g','occ','schedule','skipped','未启动','{}')");
    const eventOutbox = await repos.outbox.enqueue({ dedupKey: 'event-unknown-outbox', channel: 'feishu', target: 'private-recipient', kind: 'text', content: { text: '已保存结果' } });
    await repos.outbox.mark(eventOutbox.row.id, { status: 'unknown', error: '平台回执丢失' });
    await db.query("insert into pa24.task_plan_delivery (outbox_id, notice_id, run_id, component, override_quiet) values ($1,'unknown-event-notice','r3','text',false)", [eventOutbox.row.id]);
    const summary = await history.summary({ workspaceBinding: 'binding' });
    expect(summary).toMatchObject({ delivery_failed24: 1, delivery_unknown24: 1, unresolved: 4, unresolved_events: 1, unexecuted24: 1 });
    expect((await list({ workId: 'worker-unknown-work', deliveryStatus: 'unknown', range: 'all' })).rows[0]).toMatchObject({ id: 'worker-unknown', status: 'completed', delivery_status: 'unknown' });
    expect((await list({ workId: 'worker-unknown-work', deliveryStatus: 'failed', range: 'all' })).total).toBe(0);
    const old = new Date(now.getTime() - 10 * 86400000);
    await db.query('update pa24.worker_run set created_at = $2, updated_at = $2 where id = $1', ['worker-unknown', old]);
    await db.query('update pa24.plan_trigger set created_at = $2, updated_at = $2 where id = $1', ['unknown-event', old]);
    expect(await history.summary({ workspaceBinding: 'binding' })).toMatchObject({ delivery_failed24: 1, delivery_unknown24: 0, unresolved: 4, unresolved_events: 1, unexecuted24: 0 });
    expect((await list({ workId: 'worker-unknown-work' })).total).toBe(1);
    expect((await list({ workId: 'worker-unknown-work', includeUnresolved: false })).total).toBe(0);
    expect((await list({ kind: 'events', planId: 'unknown-event-plan' })).total).toBe(1);
    expect((await list({ kind: 'events', planId: 'unknown-event-plan', includeUnresolved: false })).total).toBe(0);
  });
  it('详细诊断按配置期限清理；不删除快照、结果和回执，查看本身不清理', async () => {
    const context = { binding: 'binding', timeZone: 'UTC', repos, diagnosticRetentionDays: 90 };
    history = new RunHistory({ context: () => context });
    const failure = new TypeError('含私密输入的错误消息');
    failure.stack = 'TypeError: 含私密输入的错误消息\n    at execute (file:///Users/alice/private/My Project/src/runner.ts:12:8)\n    at next (C:\\private\\My Project\\runner.js:8:2)\n    at eval (private/path/without-position)';
    await history.capture('r1', 'native-observe', failure); await history.capture('r1', 'native-observe', failure);
    let rows = await repos.runDiagnostics.list('r1', 90);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/alice|private|私密输入/);
    expect(rows[0].detail.frames).toEqual(['    at execute ([路径]/runner.ts:12:8)', '    at next ([路径]/runner.js:8:2)']);
    await db.query('update pa24.run_diagnostic set created_at = $1', [new Date(now.getTime() - 91 * 86400000)]);
    expect(await repos.runDiagnostics.list('r1', 90)).toHaveLength(0);
    expect((await db.query('select * from pa24.run_diagnostic')).rows).toHaveLength(1);
    await history.pruneDiagnostics();
    expect((await db.query('select * from pa24.run_diagnostic')).rows).toHaveLength(0);
    expect((await repos.skillRuns.get('r1')).result).toBe('结果 1');
    expect((await repos.workItems.get('w1')).instruction).toBe('保留的请求');
    await history.capture('r1', 'native-observe', failure);
    await db.query('update pa24.run_diagnostic set created_at = $1', [new Date(now.getTime() - 8 * 86400000)]);
    context.diagnosticRetentionDays = 7;
    await history.pruneDiagnostics();
    expect((await db.query('select * from pa24.run_diagnostic')).rows).toHaveLength(0);
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
  it('交办投影一次查询返回真实运行数，重试等待与未执行事件不重复计数', async () => {
    const addSkillRun = async (id, status) => db.query(`insert into pa24.skill_run
      (id, request_id, request_hash, work_item_id, skill_id, version_id, source_session_id, session_id, workspace_path, mode, trial, snapshot, status, created_at, updated_at)
      values ($1,$1,'hash','w0','builtin:history','v1','parent',$2,'/private/workspace','template',false,$3,$4,$5,$5)`,
    [id, `session-${id}`, JSON.stringify({ name: '能力' }), status, now]);
    await db.query("update pa24.skill_run set status = 'waiting' where id = 'r0'");
    await initializeRunControl(db, 'r0');
    const at = now.getTime() - 5000;
    await repos.runControls.change('r0', state => beginRunAttempt(state, at));
    await repos.runControls.change('r0', state => failRunAttempt(state, '明确未执行的暂时错误', true, at + 1000));
    await repos.runControls.change('r0', state => beginRunAttempt(state, at + 2000));
    expect((await repos.runControls.get('r0')).state.attempts).toHaveLength(2);
    await addSkillRun('r-extra', 'completed');
    await addSkillRun('r-rejected', 'rejected');
    await addSkillRun('r-skipped', 'stopped');
    await db.query("insert into pa24.worker_run (id, work_item_id, session_id, source, status, instruction, snapshot) values ('worker-real','w0','worker-real-session','local','waiting','原请求','{}')");
    await db.query("insert into pa24.worker_run (id, work_item_id, session_id, source, status, instruction, snapshot) values ('worker-rejected','w0','worker-rejected-session','local','rejected','未接纳','{}')");
    await db.query("insert into pa24.digest_plan (id, kind, title, session_id, schedule_spec) values ('plan-a','task','运行数计划','parent','{}')");
    await db.query("insert into pa24.plan_trigger (id, plan_id, run_id, generation, occurrence, source, status, reason, snapshot) values ('skipped-w0','plan-a','r-skipped','g','occ','schedule','skipped','主人暂停，未启动',$1)",
      [JSON.stringify({ configuration: { skillId: 'builtin:history' } })]);
    await repos.workItems.update('w0', { progress: '等待主人确认', progress_detail: { stage: '等待主人确认', completed: '原资料已核对', next: '交付结果和出处' } });
    const query = db.query.bind(db); let readQueries = 0, projection;
    db.query = (...args) => { readQueries++; return query(...args); };
    try { projection = await list({ kind: 'work', workId: 'w0', range: 'all' }); } finally { db.query = query; }
    expect(readQueries).toBe(2);
    expect(projection.rows).toHaveLength(1); expect(Number(projection.rows[0].run_count)).toBe(3);
    expect(projection.rows[0].progress_detail).toMatchObject({ stage: '等待主人确认', completed: '原资料已核对', next: '交付结果和出处' });
    expect((await list({ kind: 'runs', workId: 'w0', range: 'all' })).rows.map(row => row.id).sort()).toEqual(['r-extra', 'r0', 'worker-real']);
    expect((await list({ kind: 'work', workId: 'w0', planId: 'plan-a', skillId: 'builtin:history', source: 'local', query: '目标 %_', range: 'all' })).rows.map(row => row.id)).toEqual(['w0']);
    expect((await list({ kind: 'events', workId: 'w0', planId: 'plan-a', skillId: 'builtin:history', source: 'schedule', status: 'skipped', range: 'all' })).rows[0]).toMatchObject({ run_id: 'r-skipped', record_kind: 'skill', skill_id: 'builtin:history', summary: '主人暂停，未启动' });
    const exported = JSON.parse((await history.export({ kind: 'work', workId: 'w0', range: 'all', workspaceBinding: 'binding' })).content);
    expect(exported.total).toBe(1); expect(Number(exported.rows[0].run_count)).toBe(3);
  });
});

it('自定义时间按工作区时区解释，夏令时歧义要求明确偏移', () => {
  const filter = historyFilter({ range: 'custom', from: '2026-10-23T00:00', to: '2026-10-24T00:00' }, 'Asia/Shanghai');
  expect(filter.from.toISOString()).toBe('2026-10-22T16:00:00.000Z');
  expect(() => historyFilter({ range: 'custom', from: '2026-11-01T01:30', to: '2026-11-01T03:00' }, 'America/New_York')).toThrow(/歧义/);
  expect(() => historyFilter({ range: 'custom', from: '2026-10-24T00:00', to: '2026-10-23T00:00' }, 'Asia/Shanghai')).toThrow(/开始时间/);
});

it('真实运行时按实际凭据引用与密钥库脱敏，包含引号、反斜杠和换行的值不会逃逸', async () => {
  const secrets = ['quote-"value', 'line-one\nline-two', 'slash-\\value', 'tts-key-123456'];
  const f = await fixture({ env: { AUTH_VALUE: secrets[0], DB_VALUE: secrets[1], APP_VALUE: secrets[2] } });
  try {
    const path = await f.workspace('export', { appSecretEnv: 'AUTH_VALUE', pgDsnEnv: 'DB_VALUE', appIdEnv: 'APP_VALUE' });
    await writeSecretStore(path, { volcTtsKey: secrets[3] }); await f.rt.bind(path);
    await f.rt.db.query("insert into pa24.digest_occurrence (id, plan_id, window_key, report) values ('legacy','plan','window',$1)", [JSON.stringify(secrets.join(' | '))]);
    const result = await f.rt.runHistory.export({ workspaceBinding: f.rt.workspaceBinding, kind: 'legacy', range: 'all' });
    expect(JSON.parse(result.content).rows[0].report).toBe(secrets.map(() => '[已脱敏]').join(' | '));
  } finally { await f.cleanup(); }
});

it('诊断预览只导出允许的状态与计时，不带原输入、调用参数、回执正文或接收者', async () => {
  const history = new RunHistory({ context: () => ({ binding: 'b', timeZone: 'UTC', repos: { workerRuns: { get: async () => null }, runDiagnostics: { list: async () => [] } } }), skills: { inspect: async () => ({
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
