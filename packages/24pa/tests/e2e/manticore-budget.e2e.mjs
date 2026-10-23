import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
let root, workspace, host, llm, cluster, binding, env, scriptPath, reusableBusiness, latestRun;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-budget-e2e-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# 隔离预算验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, enabledWorkers: ['memo','skill','reminders','digest'], budget: { ...DEFAULT_CONFIG.budget, maxRequests: 0 } }) + '\n```\n');
  scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json'), recordInputs: true });
  env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env }); binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
}, 600000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
const until = async (read, check) => { const deadline = Date.now() + 25000; while (Date.now() < deadline) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 100)); } const value = await read(); const last = latestRun ? await detail(latestRun.id) : null; throw Error('预算验证超时：' + JSON.stringify({ value, last, logs: host.logs() })); };
const detail = runId => host.api('skills.run', { runId, workspaceBinding: binding });
const summary = () => host.api('budget', { workspaceBinding: binding });
const start = async (steps, mode = 'local', tools = []) => {
  await writeFile(scriptPath, JSON.stringify({ steps, onlySkillRuns: true }));
  const name = 'budget-' + randomUUID();
  const markdown = '---\n' + JSON.stringify({ name, description: '预算输入恢复验证', metadata: { track: 'agent', tools, pa24: { schemaVersion: 1, mode, parameters: { subject: { type: 'string', required: true } }, actions: [], expectedResult: '保留完整输入完成', completionCriteria: '原运行不重复' } } }) + '\n---\n\n保留原输入和所有资料；完成后返回结论。';
  const created = await host.api('action', { type: 'skill.change', op: 'save', requestId: randomUUID(), workspaceBinding: binding, displayName: '预算输入恢复', markdown });
  const id = 'managed:' + created.entry.id;
  if (mode === 'business') await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [created.entry.name] } });
  await host.api('action', { type: 'skill.change', op: 'publish', requestId: randomUUID(), workspaceBinding: binding, id, expectedRevision: created.entry.revision, confirm: true });
  const input = { id, versionId: created.entry.draft_version, parameters: { subject: '完整输入：逐字保留 甲乙丙\n第二行' }, workspaceBinding: binding };
  const preview = await host.api('skills.preview', input);
  latestRun = (await host.api('action', { type: 'skill.run', ...input, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true })).run;
  return latestRun;
};
const grant = async run => host.api('action', { type: 'budget.release', workspaceBinding: binding, requestId: randomUUID(), confirm: true, scope: 'next-model-request', runId: run.id, workId: run.work_item_id, sessionId: run.session_id });
const restart = async () => { const reuse = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: reuse }); binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding; };
const requestsFor = run => llm.requests.filter(request => JSON.stringify(request.inputs).includes('[24PA skill run: ' + run.id + ']'));
it.each(['local','business'])('真实 Loader %s：首输入预算拦截、重启同 Run 放行、计量重启去重', async mode => {
  const run = await start([{ text: 'BUDGET_RECOVERED：完整原输入已完成。' }], mode);
  if (mode === 'business') reusableBusiness = run;
  const waiting = await until(() => detail(run.id), value => value.run.status === 'waiting');
  expect(waiting.execution.blocks).toMatchObject([{ kind: 'budget' }]); expect(requestsFor(run)).toHaveLength(0);
  expect(waiting.inputs.filter(row => row.accepted && row.message.source?.kind === 'user')).toHaveLength(1);
  const original = waiting.inputs.find(row => row.accepted && row.message.source?.kind === 'user').message;
  await restart(); const cold = await detail(run.id); expect(cold.run.status).toBe('waiting'); expect(cold.execution.executionMs).toBe(0);
  await grant(run);
  const done = await until(() => detail(run.id), value => !['running','waiting','pending'].includes(value.run.status));
  expect(done.run.status, JSON.stringify(done)).toBe('completed'); expect(done.run.result).toContain('BUDGET_RECOVERED');
  expect(done.run.session_id).toBe(run.session_id); expect(done.run.work_item_id).toBe(run.work_item_id);
  expect(done.inputs.find(row => row.message_id === original.id)?.message).toEqual(original);
  expect(requestsFor(run)).toHaveLength(1); expect(JSON.stringify(requestsFor(run)[0].inputs)).toContain('逐字保留');
  expect(done.execution.executionMs).toBeGreaterThan(0); expect(done.execution.waitingMs).toBeGreaterThan(0);
  const before = await summary(); expect(before.records.find(row => row.run_id === run.id)?.record.actual).toEqual({ provider: 'deepseek-official', model: 'deepseek-flash' });
  expect(before.tokens).toBeGreaterThan(0); expect(before.estimatedCost).toBeNull();
  await restart(); expect((await summary()).requests).toBe(before.requests);
}, 600000);
it('一次放行仅派发一次，后续步骤再次等待；停止后迟到放行不复活', async () => {
  const run = await start([{ tool: { name: 'bash', input: { description: '读取隔离目录', command: 'pwd', workdir: workspace } } }, { text: 'MUST_NOT_RUN' }], 'local', ['bash']);
  await until(() => detail(run.id), value => value.run.status === 'waiting'); await grant(run);
  const waiting = await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.length > 0);
  expect(requestsFor(run)).toHaveLength(1); expect(waiting.calls[0].status).toBe('returned');
  const before = waiting.execution.executionMs; await new Promise(resolve => setTimeout(resolve, 600)); expect((await detail(run.id)).execution.executionMs).toBe(before);
  await host.api('action', { type: 'skill.run', op: 'stop', runId: run.id, workspaceBinding: binding });
  await expect(grant(run)).rejects.toThrow(/结束|停止/); expect((await detail(run.id)).run.status).toBe('stopped'); expect(requestsFor(run)).toHaveLength(1);
}, 600000);
it('预算和主人等待同时存在时，放行保留主人等待；补充后同运行完成', async () => {
  const run = await start([{ tool: { name: 'pa24_run', input: { action: 'wait', reason: '需要会议日期' } } }, { text: 'BUDGET_AND_INPUT_DONE' }], 'local', ['pa24_run']);
  await until(() => detail(run.id), value => value.run.status === 'waiting'); await grant(run);
  const waiting = await until(() => detail(run.id), value => value.run.status === 'waiting' && value.execution.blocks.some(block => block.kind === 'input'));
  // Resume records the owner's exact supplement; the next pre-step rechecks budget.
  await host.api('action', { type: 'skill.run', op: 'resume', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, instruction: '日期：10月30日', confirm: true });
  await until(() => detail(run.id), value => value.execution.blocks.some(block => block.kind === 'budget'));
  await grant(run); const done = await until(() => detail(run.id), value => value.run.status === 'completed');
  expect(done.run.id).toBe(run.id); expect(requestsFor(run)).toHaveLength(2); expect(JSON.stringify(requestsFor(run).at(-1))).toContain('10月30日');
}, 600000);

it('普通交办预算等待冷恢复保留原执行身份，两次放行分别覆盖两次请求', async () => {
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: 'memo', title: '预算下普通交办', instruction: '保留原交办输入：丁戊己', completionCriteria: '给出原结果' }, workerTool: { name: 'pa24_run', input: { action: 'progress', stage: '核对完成', completed: '丁戊己输入', next: '返回结果' } }, workerReply: 'WORKER_BUDGET_DONE' }));
  const parent = (await host.api('snapshot')).workspace.localSessionId;
  await host.remote('session/prompt', { request: { sessionId: parent, requestId: randomUUID(), mode: 'queue', content: [{ type: 'text', text: '建立预算下普通交办' }] } });
  const state = await host.waitUntil(value => value.work.some(work => work.title === '预算下普通交办' && work.status === 'waiting_input'));
  const work = state.work.find(work => work.title === '预算下普通交办');
  const read = () => host.api('worker.run', { runId: work.active_worker_run_id, workspaceBinding: binding });
  const first = await read(); expect(first.execution.blocks).toMatchObject([{ kind: 'budget' }]); expect(first.inputs[0].message.content.some(part => part.text.includes('丁戊己'))).toBe(true);
  const count = () => llm.requests.filter(req => JSON.stringify(req.inputs).includes('[24PA execution: ' + work.execution_id + ']')).length;
  expect(count()).toBe(0); await restart(); expect((await read()).run.status).toBe('waiting');
  const permit = () => host.api('action', { type: 'budget.release', workspaceBinding: binding, requestId: randomUUID(), confirm: true, scope: 'next-model-request', runId: first.run.id, workId: work.id, sessionId: work.id });
  await permit(); await until(read, value => value.run.status === 'waiting' && value.calls.length === 1); expect(count()).toBe(1);
  await permit(); const done = await until(read, value => value.run.status === 'completed'); expect(done.run.result).toContain('WORKER_BUDGET_DONE'); expect(done.inputs).toHaveLength(1);expect(count()).toBe(2);
  expect(done.run.id).toBe(first.run.id);expect(done.deliveries[0].target).toBe(parent);
}, 600000);
it('计划主人暂停保持；预算放行只继续在途原运行，确定性模板不经过模型预算', async () => {
  await writeFile(scriptPath, JSON.stringify({ steps: [{ text: 'PLANNED_BUDGET_DONE' }], onlySkillRuns: true }));
  const change = (op, extra) => host.api('action', { type: 'plan.change', op, requestId: randomUUID(), workspaceBinding: binding, ...extra });
  const plan = (await change('save', { title: '预算计划', skillId: 'managed:' + reusableBusiness.skill_id, parameters: { subject: '固定计划输入' }, timing: { type: 'once', at: new Date(Date.now()+600000).toISOString() }, delivery: { channel: 'none' } })).plan;
  const enablePreview = await host.api('plans.preview', { id: plan.id, workspaceBinding: binding });
  const enabled = (await change('enable', { id: plan.id, expectedRevision: plan.revision, fingerprint: enablePreview.fingerprint, confirm: true })).plan;
  const preview = await host.api('plans.run-preview', { id: plan.id, workspaceBinding: binding });
  const run = (await change('run', { id: plan.id, fingerprint: preview.fingerprint, confirm: true })).run;
  await until(() => detail(run.id), value => value.run.status === 'waiting'); await change('pause', { id: plan.id, expectedRevision: enabled.revision });
  await grant(run); const done = await until(() => detail(run.id), value => value.run.status === 'completed'); expect(done.run.id).toBe(run.id);expect(done.run.result).toContain('PLANNED_BUDGET_DONE');
  expect((await host.api('plans.inspect',{id:plan.id,workspaceBinding:binding})).plan.owner_enabled).toBe(false);
  const template = (await change('save', { title: '零模型模板', skillId: 'builtin:digest-morning', timing: { type: 'once', at: new Date(Date.now()+600000).toISOString() }, delivery: { channel: 'none' } })).plan;
  const templateEnable = await host.api('plans.preview',{id:template.id,workspaceBinding:binding});
  await change('enable',{id:template.id,expectedRevision:template.revision,fingerprint:templateEnable.fingerprint,confirm:true});
  const before = (await summary()).requests;const templatePreview = await host.api('plans.run-preview',{id:template.id,workspaceBinding:binding});
  const templateRun = (await change('run',{id:template.id,fingerprint:templatePreview.fingerprint,confirm:true})).run;
  expect((await until(()=>detail(templateRun.id), value=>value.run.status==='completed')).run.mode).toBe('template');expect((await summary()).requests).toBe(before);
}, 600000);

it.each([false, true])('原生子任务的模型也受预算控制，主子同时等待后冷恢复=%s仍回原运行', async cold => {
  const run = await start([], 'local', ['subagent', 'bash']);
  await writeFile(scriptPath, JSON.stringify({ mode: 'native-run', rootStep: { tool: { name: 'subagent', input: { description: '预算子任务', prompt: '[NATIVE_CHILD] 只返回预算子任务结果。' } } }, childStep: { tool: { name: 'bash', input: { description: '子任务原预算下读取', command: 'pwd', workdir: workspace } } } }));
  await until(() => detail(run.id), value => value.run.status === 'waiting');
  let released = [];
  if (cold) {
    await grant(run);
    await until(summary, value => value.waiting.filter(item => item.run_id === run.id).length === 2);
    await restart();
    const restored = await detail(run.id);
    expect(restored.run.status, JSON.stringify(restored)).toBe('waiting');
    expect(restored.native.some(row => row.recovery_data?.kind === 'budget-paused' && row.end_data === null)).toBe(true);
  }
  for (let i = 0; i < 6; i++) {
    const row = await until(summary, value => value.waiting.some(item => item.run_id === run.id));
    const waiter = row.waiting.find(item => item.run_id === run.id && item.session_id !== run.session_id) ?? row.waiting.find(item => item.run_id === run.id);released.push(waiter.session_id);
    const requestId = randomUUID();
    await host.api('action', { type: 'budget.release', workspaceBinding: binding, requestId, confirm: true, scope: 'next-model-request', runId: run.id, workId: run.work_item_id, sessionId: waiter.session_id });
    await until(summary, value => value.releases.some(row => row.id === requestId && row.status === 'used'));
    const value = await until(() => detail(run.id), value => value.run.status !== 'running' && ((value.run.status !== 'waiting') || value.execution.blocks.some(block => block.kind === 'budget')));
    if (value.run.status === 'completed') { expect(value.run.result).toContain('ROOT_RESULT'); break; }
    expect(value.run.status).toBe('waiting');
  }
  const completed = await detail(run.id);
  expect(completed.run.status).toBe('completed');expect(released.some(id=>id!==run.session_id)).toBe(true);
  expect(completed.calls.find(row => row.tool === 'bash')).toMatchObject({ status: 'returned' });
  if (cold) {
    await restart(); expect((await detail(run.id)).run.status).toBe('completed');
    const preview = await host.api('skills.preview', { rerunId: run.id, configuration: 'original', workspaceBinding: binding });
    expect(preview.fingerprint).toBeTruthy(); // Paused old epochs do not become phantom unknown actions.
  }
}, 600000);
