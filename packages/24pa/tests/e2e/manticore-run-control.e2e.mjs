import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, workspace, scriptPath, host, llm, cluster, binding, env, barrierPath, previousExtras;
const writeBarrier = async value => { const temporary = barrierPath + '.' + randomUUID(); await writeFile(temporary, JSON.stringify(value)); await rename(temporary, barrierPath); };
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-run-wait-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  const fixture = join(root, 'barrier-plugin'); await mkdir(fixture);
  await writeFile(join(fixture, 'package.json'), JSON.stringify({ name: 'pa24-test-run-control-barrier', version: '0.0.0', type: 'module', exports: { '.': './index.mjs' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }));
  await writeFile(join(fixture, 'cordis.patch.yml'), '- insert:\n    - id: pa24-test-run-control-barrier\n      name: pa24-test-run-control-barrier\n');
  await writeFile(join(fixture, 'index.mjs'), await readFile(new URL('../helpers/run-control-barrier.mjs', import.meta.url)));
  barrierPath = join(root, 'barrier.json'); await writeBarrier({});
  previousExtras = process.env.PA24_E2E_EXTRA_PLUGINS;
  process.env.PA24_E2E_EXTRA_PLUGINS = [previousExtras, fixture].filter(Boolean).join(',');
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# 隔离运行控制验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, enabledWorkers: [...new Set([...DEFAULT_CONFIG.enabledWorkers, 'skill'])], extraBusinessSkills: ['wait-business'] }) + '\n```\n');
  scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json'), recordInputs: true,
    sequenceKey: body => body.messages.flatMap(message => message.content ?? []).map(part => part.type === 'text' ? part.text?.match(/固定版本：([^；\n]+)/)?.[1] : null).find(Boolean) });
  env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_TEST_RUN_BARRIER: barrierPath, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env }); binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
}, 600000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true });
  if (previousExtras === undefined) delete process.env.PA24_E2E_EXTRA_PLUGINS; else process.env.PA24_E2E_EXTRA_PLUGINS = previousExtras; });
const detail = runId => host.api('skills.run', { runId, workspaceBinding: binding });
const until = async (read, check) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error('运行控制等待超时：' + JSON.stringify(await read()));
};
const settledStepMs = async sessionId => {
  const archive = join(root, 'step-evidence.zip');
  await writeFile(archive, await host.exportSession(sessionId));
  const { stdout } = await promisify(execFile)('unzip', ['-p', archive, 'session*.jsonl']);
  const events = stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const end = events.findLast(event => event.type === 'step/end');
  if (!end) return null;
  const start = events.find(event => event.type === 'step/start' && event.data.turn === end.data.turn && event.data.step === end.data.step);
  if (!start || typeof start.time !== 'number' || typeof end.time !== 'number') throw new Error('原生步骤缺少可核验的起止时间。');
  return end.time - start.time;
};
const start = async ({ mode = 'local', tools = ['pa24_run'], executionLimitMs = 900000, steps }) => {
  const markdown = '---\n' + JSON.stringify({ name: mode === 'business' ? 'wait-business' : 'wait-local-' + randomUUID(), description: '等待与执行时限验证', metadata: { track: 'agent', tools, pa24: { schemaVersion: 1, mode, parameters: {}, actions: [], expectedResult: '沿原记录完成', completionCriteria: '不重复已完成步骤' } } }) + '\n---\n\n按工具和原会话回执执行。';
  const created = await host.api('action', { type: 'skill.change', op: 'save', requestId: randomUUID(), workspaceBinding: binding, displayName: '等待恢复验证', markdown });
  await llm.setSequence(created.entry.draft_version, steps);
  const id = 'managed:' + created.entry.id;
  if (mode === 'business') await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [created.entry.name] } });
  await host.api('action', { type: 'skill.change', op: 'publish', requestId: randomUUID(), workspaceBinding: binding, id, expectedRevision: created.entry.revision, confirm: true });
  const base = { id, versionId: created.entry.draft_version, parameters: {}, executionLimitMs, workspaceBinding: binding };
  const preview = await host.api('skills.preview', base);
  return (await host.api('action', { type: 'skill.run', ...base, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true })).run;
};
const waitStep = { tool: { name: 'pa24_run', input: { action: 'wait', reason: '请补充会议主题' } } };
const resumeCommand = run => ({ type: 'skill.run', op: 'resume', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, instruction: '会议主题：项目验收', confirm: true });
const requestsFor = run => llm.requests.filter(request => (request.inputs ?? []).some(message => (message.content ?? []).some(part => part.type === 'text' && part.text === `[24PA skill run: ${run.id}]`)));
const restart = async (crash = false) => {
  const hostRoot = host.root;
  if (crash) { host.child.kill('SIGKILL'); await new Promise(resolve => host.child.once('exit', resolve)); }
  await host.stop({ keepRoot: true }); await writeBarrier({}); host = await bootHost({ env, root: hostRoot });
  binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
};

it.each(['local', 'business'])('%s 补充已被接纳但尚未采用时崩溃，重启采用原消息一次', async mode => {
  const before = llm.requests.length;
  const run = await start({ mode, steps: [waitStep, { text: 'ADOPTED_ORIGINAL：项目验收已处理。' }] });
  await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.every(call => call.status !== 'running'));
  await writeBarrier({ kind: 'resume' });
  await host.api('action', resumeCommand(run));
  const parked = await until(async () => JSON.parse(await readFile(barrierPath, 'utf8')), value => value.entered);
  expect(requestsFor(run)).toHaveLength(1);
  const originalId = parked.messages.find(message => message.content.some(part => part.text?.includes('[24PA resume:'))).id;
  await restart(true);
  const done = await until(() => detail(run.id), value => !['running', 'pending', 'waiting'].includes(value.run.status));
  expect(done.run.status, JSON.stringify(done)).toBe('completed');
  expect(done.run.session_id).toBe(run.session_id); expect(done.run.result).toContain('ADOPTED_ORIGINAL');
  expect(requestsFor(run)).toHaveLength(2);
  expect(done.inputs.filter(input => JSON.stringify(input.message).includes('[24PA resume:'))).toMatchObject([{ message_id: originalId, accepted: true }]);
  expect(done.inputs.find(input => input.message_id === originalId)?.adopted).toBe(true);
  expect(JSON.stringify(requestsFor(run).at(-1))).toContain('会议主题：项目验收');
}, 600000);

it.each(['local', 'business'])('%s 补充提交后、采用前权限阻断，修复后保留原补充', async mode => {
  const run = await start({ mode, steps: [waitStep, { text: 'PERMISSION_RESTORED：项目验收已处理。' }] });
  await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.every(call => call.status !== 'running'));
  const original = (await host.api('snapshot')).workspace.config.extraBusinessSkills;
  await writeBarrier({ kind: 'resume' });
  await host.api('action', resumeCommand(run));
  const parked = await until(async () => JSON.parse(await readFile(barrierPath, 'utf8')), value => value.entered);
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [...original, 'changed-after-acceptance'] } });
  await writeBarrier({});
  await until(() => detail(run.id), value => value.run.status === 'waiting' && value.execution.blocks.some(block => block.kind === 'authorization'));
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: original } });
  await host.api('action', { type: 'skill.run', op: 'recheck', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, confirm: true });
  const done = await until(() => detail(run.id), value => !['running', 'waiting'].includes(value.run.status));
  expect(done.run.status, JSON.stringify(done)).toBe('completed');
  expect(done.inputs.filter(input => JSON.stringify(input.message).includes('[24PA resume:'))).toHaveLength(1);
  expect(done.inputs.some(input => input.message_id === parked.messages.find(message => message.content.some(part => part.text?.includes('[24PA resume:'))).id)).toBe(true);
  expect(JSON.stringify(requestsFor(run).at(-1))).toContain('会议主题：项目验收');
}, 600000);

it.each(['local', 'business'])('%s 首条输入在模型前阻断，重新检查采用原请求而非空泛接续', async mode => {
  await writeBarrier({ kind: 'start' });
  const run = await start({ mode, tools: [], steps: [{ text: 'FIRST_INPUT_RECOVERED：原请求已完成。' }] });
  const parked = await until(async () => JSON.parse(await readFile(barrierPath, 'utf8')), value => value.entered);
  const original = (await host.api('snapshot')).workspace.config.extraBusinessSkills;
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [...original, 'initial-input-block'] } });
  await writeBarrier({});
  await until(() => detail(run.id), value => value.run.status === 'waiting');
  expect(requestsFor(run)).toHaveLength(0);
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: original } });
  await host.api('action', { type: 'skill.run', op: 'recheck', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, confirm: true });
  const done = await until(() => detail(run.id), value => !['running', 'waiting'].includes(value.run.status));
  expect(done.run.status, JSON.stringify(done)).toBe('completed'); expect(done.run.result).toContain('FIRST_INPUT_RECOVERED');
  expect(done.inputs.find(input => input.message_id === parked.messages.find(message => message.content.some(part => part.text === `[24PA skill run: ${run.id}]`)).id)?.adopted).toBe(true);
  expect(requestsFor(run)).toHaveLength(1);
}, 600000);

it('在原生会话取消已接纳但未采用的本地输入，重启也不自动复活', async () => {
  await writeBarrier({ kind: 'start' });
  const run = await start({ tools: [], steps: [{ text: 'MUST_NOT_RUN_AFTER_CANCEL' }] });
  await until(async () => JSON.parse(await readFile(barrierPath, 'utf8')), value => value.entered);
  try { expect(await host.remote('session/cancel', { request: { sessionId: run.session_id } })).toMatchObject({ accepted: true }); }
  finally { await writeBarrier({}); }
  const stopped = await until(() => detail(run.id), value => value.run.status === 'stopped');
  expect(stopped.inputs.some(input => input.adopted === true)).toBe(false);
  expect(requestsFor(run)).toHaveLength(0);
  await restart();
  expect((await detail(run.id)).run.status).toBe('stopped');
  expect(requestsFor(run)).toHaveLength(0);
}, 600000);

it.each(['local', 'business'])('%s SQL 恢复已认领、原生采用前取消，不执行也不清除取消证据', async mode => {
  await writeBarrier({ kind: 'start' });
  const run = await start({ mode, tools: [], steps: [{ text: 'MUST_NOT_EXECUTE_RECOVERY_AFTER_CANCEL' }] });
  await until(async () => JSON.parse(await readFile(barrierPath, 'utf8')), value => value.entered);
  const original = (await host.api('snapshot')).workspace.config.extraBusinessSkills;
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [...original, 'recovery-cancel-test'] } });
  await writeBarrier({});
  await until(() => detail(run.id), value => value.run.status === 'waiting');
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: original } });
  await writeBarrier({ kind: 'recover' });
  try {
    await host.api('action', { type: 'skill.run', op: 'recheck', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, confirm: true });
    const held = await until(async () => JSON.parse(await readFile(barrierPath, 'utf8')), value => value.entered);
    await writeBarrier({ ...held, interrupt: true });
    await until(() => detail(run.id), value => value.run.status === 'stopped');
    expect(requestsFor(run)).toHaveLength(0);
    await restart();
    expect((await detail(run.id)).run.status).toBe('stopped'); expect(requestsFor(run)).toHaveLength(0);
  } finally { await writeBarrier({}); }
}, 600000);

it.each(['local', 'business'])('真实宿主 %s：等待并重启后在原运行继续，补充双击只消费一次', async mode => {
  const before = llm.requests.length;
  const run = await start({ mode, steps: [waitStep, { text: 'RESUMED_RESULT：主题已收到，沿原记录完成。' }] });
  const waiting = await until(async () => {
    const elapsed = await settledStepMs(run.session_id);
    if (elapsed === null) return null;
    const current = await detail(run.id);
    return current.run.status === 'waiting' && current.calls.every(call => call.status !== 'running') && current.execution.executionMs >= elapsed ? current : null;
  }, value => value);
  expect(waiting.execution.blocks).toMatchObject([{ kind: 'input', reason: '请补充会议主题' }]);
  expect(requestsFor(run)).toHaveLength(1);
  const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: hostRoot });
  binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
  const restored = await detail(run.id);
  expect(restored.run.status, JSON.stringify(restored)).toBe('waiting');
  expect(restored.execution.executionMs).toBe(waiting.execution.executionMs);
  const command = resumeCommand(run);
  await Promise.all([host.api('action', command), host.api('action', command)]);
  const done = await until(() => detail(run.id), value => ['completed', 'needs_reconciliation', 'failed'].includes(value.run.status));
  expect(done.run.status, JSON.stringify(done)).toBe('completed');
  expect(done.run.session_id).toBe(run.session_id); expect(done.run.work_item_id).toBe(run.work_item_id);
  expect(done.run.result).toContain('RESUMED_RESULT'); expect(done.attempts).toHaveLength(1);
  expect(done.execution.executionMs).toBeGreaterThanOrEqual(waiting.execution.executionMs);
  expect(done.execution.waitingMs).toBeGreaterThan(0);
  expect(done.inputs.filter(input => JSON.stringify(input.message).includes('[24PA resume:') && input.accepted)).toHaveLength(1);
  expect(requestsFor(run)).toHaveLength(2);
  await host.api('action', command); expect(requestsFor(run)).toHaveLength(2);
}, 600000);

it('等待期间停止，迟到补充不能复活原运行', async () => {
  const run = await start({ steps: [waitStep] });
  await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.every(call => call.status !== 'running'));
  await host.api('action', { type: 'skill.run', op: 'stop', runId: run.id, workspaceBinding: binding });
  expect((await detail(run.id)).run.status).toBe('stopped');
  const before = requestsFor(run).length;
  await expect(host.api('action', resumeCommand(run))).rejects.toThrow(/等待|结束/);
  expect((await detail(run.id)).run.status).toBe('stopped'); expect(requestsFor(run)).toHaveLength(before);
}, 60000);

it('补充信息不会清除授权阻断；修复并重新检查才采用已保存输入', async () => {
  const run = await start({ steps: [waitStep, { text: 'RECHECK_RESULT：只采用已保存补充一次。' }] });
  await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.every(call => call.status !== 'running'));
  const original = (await host.api('snapshot')).workspace.config.extraBusinessSkills;
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [...original, 'another-scope'] } });
  const before = requestsFor(run).length;
  const held = await host.api('action', resumeCommand(run));
  expect(held.run.status).toBe('waiting'); expect(held.execution.blocks.map(block => block.kind)).toEqual(['authorization']);
  expect(requestsFor(run)).toHaveLength(before);
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: original } });
  await host.api('action', { type: 'skill.run', op: 'recheck', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, confirm: true });
  const done = await until(() => detail(run.id), value => value.run.status !== 'running' && value.run.status !== 'waiting');
  expect(done.run.status, JSON.stringify(done)).toBe('completed'); expect(done.run.result).toContain('RECHECK_RESULT');
  expect(done.inputs.filter(input => JSON.stringify(input.message).includes('[24PA resume:') && input.accepted)).toHaveLength(1);
  expect(requestsFor(run).length - before).toBe(1);
}, 60000);

it('暂时拒绝最多自动重试三次，全部尝试归原运行；下一次模型请求被阻止', async () => {
  const before = llm.requests.length;
  const rejected = { httpError: { status: 429, type: 'rate_limit_error' } };
  const run = await start({ tools: [], steps: [rejected, rejected, rejected, rejected, { text: '不得第五次执行' }] });
  const ended = await until(() => detail(run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(ended.run.status, JSON.stringify(ended)).toBe('failed');
  expect(requestsFor(run)).toHaveLength(4); expect(ended.attempts).toHaveLength(4);
  expect(ended.attempts.every(attempt => attempt.endedAt !== null)).toBe(true);
  expect(ended.execution.executionMs).toBeGreaterThan(0);
}, 60000);

it('两次暂时拒绝后成功，保存三次尝试并且只产生一份结果', async () => {
  const rejected = { httpError: { status: 503, type: 'overloaded_error' } };
  const run = await start({ tools: [], steps: [rejected, rejected, { text: 'RETRY_SUCCESS：第三次成功。' }] });
  const ended = await until(() => detail(run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(ended.run.status, JSON.stringify(ended)).toBe('completed');
  expect(ended.run.result).toContain('RETRY_SUCCESS'); expect(ended.attempts).toHaveLength(3);
}, 60000);

it('累计执行时限会停止正在执行的工具；已完成动作与未知结果仍保存', async () => {
  const run = await start({ tools: ['bash'], executionLimitMs: 1000, steps: [
    { tool: { name: 'bash', input: { description: '验证执行时限', command: "printf 'before-timeout\\n' >> timeout-actions.txt; sleep 5; printf 'after-timeout\\n' >> timeout-actions.txt", workdir: workspace, timeoutMs: 10000 } } },
    { text: '不得超时后继续' },
  ] });
  const timedOut = await until(() => detail(run.id), value => value.run.status === 'timed_out' && value.calls.every(call => call.status !== 'running') && value.native.every(item => item.end_data));
  expect(timedOut.execution.executionMs).toBeGreaterThanOrEqual(1000);
  expect(timedOut.execution.remainingMs).toBe(0); expect(timedOut.calls.some(call => call.status === 'unknown')).toBe(true);
  expect(await readFile(join(workspace, 'timeout-actions.txt'), 'utf8')).toBe('before-timeout\n');
  await expect(host.api('action', resumeCommand(run))).rejects.toThrow(/等待|结束/);
  const reviewed = await host.api('action', { type: 'skill.run', op: 'review', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, fingerprint: timedOut.fingerprint, confirm: true,
    summary: '已核对进程停止和文件内容', completed: 'before-timeout 已写入', remaining: 'after-timeout 未写入',
    calls: timedOut.calls.filter(call => ['running', 'unknown'].includes(call.status)).map(call => ({ sessionId: call.session_id, callId: call.call_id, outcome: 'partial', evidence: '实际文件只包含 before-timeout' })),
    native: timedOut.native.filter(item => !item.end_data || item.end_data.producerReported === false).map(item => ({ kind: item.kind, ownerId: item.owner_id, nativeId: item.native_id, evidence: '宿主已停止此作业，文件只有 before-timeout' })) });
  expect(reviewed.reviewed).toBe(true); expect(reviewed.run.status).toBe('timed_out');
}, 60000);

it('配置变更等待长工具时，累计时限仍终止实际执行并保存回执', async () => {
  const started = Date.now();
  const run = await start({ tools: ['bash'], executionLimitMs: 1000, steps: [
    { tool: { name: 'bash', input: { description: '验证配置与超时并发', command: "printf 'before\\n' >> config-timeout.txt; sleep 6; printf 'after\\n' >> config-timeout.txt", workdir: workspace, timeoutMs: 10000 } } },
    { text: '不应继续' },
  ] });
  await until(() => detail(run.id), value => value.calls.some(call => call.status === 'running'));
  const old = (await host.api('snapshot')).workspace.config.maxWorkers;
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { maxWorkers: old === 2 ? 3 : 2 } });
  const ended = await until(() => detail(run.id), value => value.run.status === 'timed_out' && value.execution.stop?.settledAt);
  expect(Date.now() - started).toBeLessThan(5000);
  expect(await readFile(join(workspace, 'config-timeout.txt'), 'utf8')).toBe('before\n');
  expect(ended.execution.executionMs).toBeGreaterThanOrEqual(1000);
  expect(ended.calls.some(call => call.status === 'unknown')).toBe(true);
}, 60000);
