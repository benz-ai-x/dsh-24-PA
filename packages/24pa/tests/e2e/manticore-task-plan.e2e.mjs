import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, workspace, host, llm, cluster, binding, env, scriptPath, barrierPath, previousExtras;
const writeBarrier = async value => {
  const temporary = barrierPath + '.' + randomUUID(); await writeFile(temporary, JSON.stringify(value)); await rename(temporary, barrierPath);
};
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-task-plan-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  const fixture = join(root, 'barrier-plugin'); await mkdir(fixture);
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'pa24-test-run-control-barrier', version: '0.0.0', type: 'module', exports: { '.': './index.mjs' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(join(fixture, 'cordis.patch.yml'), '- insert:\n    - id: pa24-test-run-control-barrier\n      name: pa24-test-run-control-barrier\n');
  await writeFile(join(fixture, 'index.mjs'), await readFile(new URL('../helpers/run-control-barrier.mjs', import.meta.url)));
  barrierPath = join(root, 'barrier.json'); await writeBarrier({});
  previousExtras = process.env.PA24_E2E_EXTRA_PLUGINS;
  process.env.PA24_E2E_EXTRA_PLUGINS = [previousExtras, fixture].filter(Boolean).join(',');
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# 隔离计划验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage,
    maxWorkers: 1, enabledWorkers: [...new Set([...DEFAULT_CONFIG.enabledWorkers, 'skill', 'reminders', 'digest'])], extraBusinessSkills: [] }) + '\n```\n');
  scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json'), recordInputs: true });
  env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_TEST_RUN_BARRIER: barrierPath, DEEPSEEK_API_KEY: 'test-key',
    DEEPSEEK_BASE_URL: llm.url, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env }); binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
}, 600000);
afterAll(async () => {
  if (barrierPath) await writeBarrier({});
  await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true });
  if (previousExtras === undefined) delete process.env.PA24_E2E_EXTRA_PLUGINS; else process.env.PA24_E2E_EXTRA_PLUGINS = previousExtras;
});
const detail = runId => host.api('skills.run', { runId, workspaceBinding: binding });
const inspect = id => host.api('plans.inspect', { id, workspaceBinding: binding });
const until = async (read, check) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error('计划验证等待超时：' + JSON.stringify(await read()) + '\n' + host.logs().slice(-8000));
};
const change = (op, row, extra = {}) => host.api('action', { type: 'plan.change', op, requestId: randomUUID(), workspaceBinding: binding,
  ...(row ? { id: row.id, expectedRevision: row.revision } : {}), ...extra });
const create = async (skillId = 'builtin:digest-morning', extra = {}) => (await change('save', null, { title: '隔离计划', skillId,
  timing: { type: 'once', at: new Date(Date.now() + 600000).toISOString() }, delivery: { channel: 'none' }, ...extra })).plan;
const enable = async row => {
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  return (await change('enable', row, { confirm: true, fingerprint: preview.fingerprint })).plan;
};
const runNow = async row => {
  const preview = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
  const command = { type: 'plan.change', op: 'run', id: row.id, requestId: randomUUID(), workspaceBinding: binding, confirm: true, fingerprint: preview.fingerprint };
  const [one, two] = await Promise.all([host.api('action', command), host.api('action', command)]);
  expect(one.run.id).toBe(two.run.id); expect([one.repeated, two.repeated].sort()).toEqual([false, true]);
  return one.run;
};
const business = async (tools = [], actions = []) => {
  const markdown = '---\n' + JSON.stringify({ name: 'plan-business-' + randomUUID(), description: '隔离计划执行', metadata: { track: 'agent', tools,
    pa24: { schemaVersion: 1, mode: 'business', parameters: { subject: { type: 'string', required: true } }, actions, expectedResult: '固定计划结果', completionCriteria: '只执行本次任务' } } }) + '\n---\n\n按原运行参数完成。';
  const command = payload => host.api('action', { type: 'skill.change', workspaceBinding: binding, requestId: randomUUID(), ...payload });
  const saved = await command({ op: 'save', displayName: '计划业务验证', markdown }), id = 'managed:' + saved.entry.id;
  const allowed = (await host.api('snapshot')).workspace.config.extraBusinessSkills;
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [...allowed, saved.entry.name] } });
  await command({ op: 'publish', id, expectedRevision: saved.entry.revision, confirm: true });
  return id;
};
const requestsFor = run => llm.requests.filter(request => (request.inputs ?? []).some(message => (message.content ?? []).some(part => part.type === 'text' && part.text === `[24PA skill run: ${run.id}]`)));

it('公开旧计划迁移沿用原生调度，重启后只生成一份模板结果', async () => {
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: 'reminders', title: '迁移原简报计划', instruction: '开启一次原简报' },
    leadReply: '已登记。', workerAction: { action: 'digest_enable', kind: 'once', afterSeconds: 12 }, workerReply: '已保存原计划。' }));
  const snapshot = await host.api('snapshot');
  await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: snapshot.workspace.localSessionId,
    mode: 'queue', content: [{ type: 'text', text: '开启一次原简报以验证迁移。' }], clientTimeZone: 'Asia/Shanghai' } });
  await host.waitUntil(value => value.work.some(work => work.title === '迁移原简报计划' && work.status === 'completed'), { timeoutMs: 15000, label: '原简报计划建立' });
  const row = (await host.api('plans', { workspaceBinding: binding })).rows.find(row => !row.task_config && row.kind === 'once');
  expect(row?.schedule_id).toBeTruthy(); expect(row.schedule_generation).toBeTruthy();
  const before = llm.requests.length;
  const preview = await host.api('plans.migration-preview', { id: row.id, skillId: 'builtin:digest-morning', workspaceBinding: binding });
  const migrated = await change('migrate', row, { skillId: 'builtin:digest-morning', confirm: true, fingerprint: preview.fingerprint });
  expect(migrated.plan).toMatchObject({ id: row.id, schedule_id: row.schedule_id, schedule_generation: row.schedule_generation, owner_enabled: true, schedule_spec: row.schedule_spec });
  const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: hostRoot });
  binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
  const fired = await until(() => inspect(row.id), value => value.triggers.rows.some(trigger => trigger.run_id));
  const result = await until(() => detail(fired.triggers.rows[0].run_id), value => value.run.status === 'completed');
  expect(result.run.result).toContain(row.title); expect(result.run.mode).toBe('template');
  expect((await inspect(row.id)).triggers.total).toBe(1); expect(llm.requests).toHaveLength(before);
  expect((await inspect(row.id)).migration.original.schedule_id).toBe(row.schedule_id);
}, 60000);

it('真实原生时钟触发模板，读取列表不执行，结果保存且零模型请求', async () => {
  const before = llm.requests.length, at = new Date(Date.now() + 4000).toISOString();
  let row = await create('builtin:digest-morning', { timing: { type: 'once', at }, timeZone: 'Pacific/Honolulu' });
  await host.api('plans', { workspaceBinding: binding }); await inspect(row.id);
  expect((await inspect(row.id)).triggers.total).toBe(0); expect(llm.requests).toHaveLength(before);
  row = await enable(row);
  const fired = await until(() => inspect(row.id), value => value.triggers.rows.some(trigger => trigger.run_id));
  const runId = fired.triggers.rows[0].run_id;
  const result = await until(() => detail(runId), value => value.run.status === 'completed');
  expect(result.run).toMatchObject({ plan_id: row.id, trigger_kind: 'schedule', mode: 'template', skill_id: 'builtin:digest-morning', delivery_status: 'not_requested' });
  expect(result.run.plan).toMatchObject({ triggeredAt: at, configuration: { timeZone: 'Pacific/Honolulu' } });
  expect(result.run.result).toContain('晨报'); expect(llm.requests).toHaveLength(before);
  expect((await inspect(row.id)).triggers.total).toBe(1);
}, 60000);

it('暂停后立即运行保持暂停；业务子会话不唤醒父模型，结果与参数留档', async () => {
  const id = await business(), before = llm.requests.length;
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: 'PLANNED_RESULT：主题甲已完成。' }] }));
  let row = await enable(await create(id, { parameters: { subject: '主题甲' } }));
  row = (await change('pause', row)).plan;
  const run = await runNow(row), result = await until(() => detail(run.id), value => value.run.status === 'completed');
  expect(result.run.parameters).toEqual({ subject: '主题甲' }); expect(result.run.result).toContain('PLANNED_RESULT');
  expect(result.run.plan.source).toBe('manual'); expect(result.run.source_session_id).toBe(row.session_id);
  expect((await inspect(row.id)).plan).toMatchObject({ owner_enabled: false, status: 'paused', schedule_id: null });
  expect(requestsFor(run)).toHaveLength(1); expect(llm.requests).toHaveLength(before + 1);
}, 60000);

it('等待时暂停计划并重启，修改全局渠道后原运行仍能沿固定快照继续', async () => {
  const id = await business(['pa24_run']), before = llm.requests.length;
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [
    { tool: { name: 'pa24_run', input: { action: 'wait', reason: '请补充主题' } } }, { text: 'ORIGINAL_PLAN_RESUMED：补充已采用。' },
  ] }));
  let row = await enable(await create(id, { parameters: { subject: '待补充' } }));
  const run = await runNow(row);
  await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.every(call => call.status !== 'running'));
  row = (await change('pause', (await inspect(row.id)).plan)).plan;
  const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: hostRoot });
  binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { calendarChannel: 'wecom', todoChannel: 'wecom' } });
  const waiting = await detail(run.id); expect(waiting.run.status).toBe('waiting');
  await host.api('action', { type: 'skill.run', op: 'resume', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, instruction: '主题：项目验收', confirm: true });
  const result = await until(() => detail(run.id), value => !['pending', 'running', 'waiting'].includes(value.run.status));
  expect(result.run.status, JSON.stringify(result)).toBe('completed'); expect(result.run.result).toContain('ORIGINAL_PLAN_RESUMED');
  expect(result.run.session_id).toBe(run.session_id); expect(result.run.plan).toEqual(waiting.run.plan);
  expect((await inspect(row.id)).plan.owner_enabled).toBe(false); expect((await inspect(row.id)).triggers.total).toBe(1);
  expect(requestsFor(run)).toHaveLength(2);
  await until(() => detail(run.id), value => value.inputs.some(input => input.message.source?.kind === 'subagent-settled'));
  expect(llm.requests).toHaveLength(before + 2);
}, 600000);

it('全局名额占用时另一计划保持排队；暂停取消未启动运行且不影响在途任务', async () => {
  const id = await business(), before = llm.requests.length;
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: 'ACTIVE_PLAN_FINISHED' }] }));
  const one = await enable(await create(id, { parameters: { subject: '在途' } }));
  const two = await enable(await create(id, { parameters: { subject: '排队' } }));
  await writeBarrier({ kind: 'start' });
  try {
    const running = await runNow(one);
    await until(async () => JSON.parse(await readFile(barrierPath, 'utf8')), value => value.entered);
    const queued = await runNow(two); expect((await detail(queued.id)).run.status).toBe('pending');
    await change('pause', (await inspect(two.id)).plan);
    expect((await detail(queued.id)).run.status).toBe('stopped'); expect((await detail(running.id)).run.status).toBe('running');
    await writeBarrier({});
    const result = await until(() => detail(running.id), value => value.run.status === 'completed');
    expect(result.run.result).toContain('ACTIVE_PLAN_FINISHED'); expect(llm.requests).toHaveLength(before + 1);
    expect((await inspect(two.id)).triggers.rows[0].status).toBe('skipped');
  } finally { await writeBarrier({}); }
}, 60000);

it('计划原快照重跑保留时间范围、参数和原交办；当前配置预览读取已确认的新参数', async () => {
  const id = await business();
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: 'ORIGINAL_RESULT' }, { text: 'RERUN_RESULT' }] }));
  let row = await enable(await create(id, { parameters: { subject: '旧参数' } }));
  const first = await runNow(row); await until(() => detail(first.id), value => value.run.status === 'completed');
  row = (await change('pause', (await inspect(row.id)).plan)).plan;
  row = (await change('save', row, { ...(await inspect(row.id)).form, parameters: { subject: '新参数' } })).plan;
  row = (await change('pause', await enable(row))).plan;
  const base = { rerunId: first.id, configuration: 'original', workspaceBinding: binding };
  const preview = await host.api('skills.preview', base), current = await host.api('skills.preview', { ...base, configuration: 'current' });
  expect(preview.parameters).toEqual({ subject: '旧参数' }); expect(current.parameters).toEqual({ subject: '新参数' });
  const command = { type: 'skill.run', ...base, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true };
  const [one, two] = await Promise.all([host.api('action', command), host.api('action', command)]);
  expect(one.run.id).toBe(two.run.id);
  const result = await until(() => detail(one.run.id), value => value.run.status === 'completed');
  expect(result.run.work_item_id).toBe(first.work_item_id); expect(result.run.plan_id).toBe(row.id);
  expect(result.run.plan.triggeredAt).toBe(first.snapshot.plan.triggeredAt); expect(result.run.result).toContain('RERUN_RESULT');
  expect(requestsFor(result.run)).toHaveLength(1); expect((await inspect(row.id)).triggers.total).toBe(2);
}, 60000);

it('尚未支持固定来源的旧待办写入在计划启用前拒绝，不回退全局渠道', async () => {
  const enabled = (await host.api('snapshot')).workspace.config.enabledWorkers;
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { enabledWorkers: [...new Set([...enabled, 'tasks'])] } });
  const id = await business(['pa24_work'], ['task_create']);
  const row = await create(id, { parameters: { subject: '不得误投' } });
  await expect(enable(row)).rejects.toThrow(/尚未接入固定来源/);
  expect((await inspect(row.id)).plan).toMatchObject({ owner_enabled: false, task_authorization: null, schedule_id: null });
  expect((await inspect(row.id)).triggers.total).toBe(0);
}, 60000);

it('公开管理查询与导出保留真实执行、交办和原投递，重启后读取不触发业务', async () => {
  let row = await enable(await create('builtin:digest-morning', { title: '运行档案界面验收', timing: { type: 'daily', time: '09:00:00' } }));
  row = (await change('pause', row)).plan;
  const run = await runNow(row);
  await until(() => detail(run.id), value => value.run.status === 'completed');
  const read = async () => {
    const summary = await host.api('plans.summary', { workspaceBinding: binding });
    expect(summary.total).toBeGreaterThan(0); expect(summary.paused).toBeGreaterThan(0);
    const plans = await host.api('plans', { workspaceBinding: binding, query: row.title });
    expect(plans).toMatchObject({ total: 1 }); expect(plans.rows[0].recentRun).toMatchObject({ id: run.id, status: 'completed' });
    const list = await host.api('runs', { workspaceBinding: binding, planId: row.id, range: 'all' });
    expect(list).toMatchObject({ total: 1, empty: false }); expect(list.rows[0]).toMatchObject({ id: run.id, title: row.title, source: 'manual' });
    const work = await host.api('work.inspect', { workspaceBinding: binding, workId: run.work_item_id });
    expect(work.work.id).toBe(run.work_item_id); expect(work.runs.rows.map(item => item.id)).toEqual([run.id]);
    const exported = JSON.parse((await host.api('runs.export', { workspaceBinding: binding, planId: row.id, range: 'all' })).content);
    expect(exported.total).toBe(1); expect(exported.rows[0].id).toBe(run.id);
    const diagnostic = JSON.parse((await host.api('runs.diagnostics', { workspaceBinding: binding, runId: run.id })).content);
    expect(diagnostic.retentionDays).toBe(90); expect(JSON.stringify(diagnostic)).not.toContain(workspace);
    expect(await host.api('runs', { workspaceBinding: binding, query: '没有这个档案' })).toMatchObject({ total: 0, empty: false });
  };
  const before = llm.requests.length;
  await read(); const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: hostRoot });
  binding = (await host.waitUntil(value => !!value.workspaceBinding)).workspaceBinding;
  await read(); expect(llm.requests.length).toBe(before);
}, 300000);
