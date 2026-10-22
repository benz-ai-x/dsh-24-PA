import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, workspace, scriptPath, host, llm, cluster, binding, env;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-run-wait-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# 隔离运行控制验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, enabledWorkers: [...new Set([...DEFAULT_CONFIG.enabledWorkers, 'skill'])], extraBusinessSkills: ['wait-business'] }) + '\n```\n');
  scriptPath = join(root, 'script.json'); await writeFile(scriptPath, JSON.stringify({ steps: [] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json'), recordInputs: true });
  env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env }); binding = (await host.waitUntil(value => !!value.workspaceBinding && !!value.workspace?.localSessionId)).workspaceBinding;
}, 600000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
const detail = runId => host.api('skills.run', { runId, workspaceBinding: binding });
const until = async (read, check) => {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 75)); }
  throw new Error('运行控制等待超时：' + JSON.stringify(await read()));
};
const start = async ({ mode = 'local', tools = ['pa24_run'], executionLimitMs = 900000, steps }) => {
  await writeFile(scriptPath, JSON.stringify({ steps }));
  const markdown = '---\n' + JSON.stringify({ name: mode === 'business' ? 'wait-business' : 'wait-local-' + randomUUID(), description: '等待与执行时限验证', metadata: { track: 'agent', tools, pa24: { schemaVersion: 1, mode, parameters: {}, actions: [], expectedResult: '沿原记录完成', completionCriteria: '不重复已完成步骤' } } }) + '\n---\n\n按工具和原会话回执执行。';
  const created = await host.api('action', { type: 'skill.change', op: 'save', requestId: randomUUID(), workspaceBinding: binding, displayName: '等待恢复验证', markdown });
  const id = 'managed:' + created.entry.id;
  if (mode === 'business') await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [created.entry.name] } });
  await host.api('action', { type: 'skill.change', op: 'publish', requestId: randomUUID(), workspaceBinding: binding, id, expectedRevision: created.entry.revision, confirm: true });
  const base = { id, versionId: created.entry.draft_version, parameters: {}, executionLimitMs, workspaceBinding: binding };
  const preview = await host.api('skills.preview', base);
  return (await host.api('action', { type: 'skill.run', ...base, requestId: randomUUID(), fingerprint: preview.fingerprint, confirm: true })).run;
};
const waitStep = { tool: { name: 'pa24_run', input: { action: 'wait', reason: '请补充会议主题' } } };
const resumeCommand = run => ({ type: 'skill.run', op: 'resume', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, instruction: '会议主题：项目验收', confirm: true });

it.each(['local', 'business'])('真实宿主 %s：等待并重启后在原运行继续，补充双击只消费一次', async mode => {
  const before = llm.requests.length;
  const run = await start({ mode, steps: [waitStep, { text: 'RESUMED_RESULT：主题已收到，沿原记录完成。' }] });
  const waiting = await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.every(call => call.status !== 'running'));
  expect(waiting.execution.blocks).toMatchObject([{ kind: 'input', reason: '请补充会议主题' }]);
  expect(llm.requests.length - before).toBe(1);
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
  expect(llm.requests.length - before).toBe(2);
  await host.api('action', command); expect(llm.requests.length - before).toBe(2);
}, 600000);

it('等待期间停止，迟到补充不能复活原运行', async () => {
  const run = await start({ steps: [waitStep] });
  await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.every(call => call.status !== 'running'));
  await host.api('action', { type: 'skill.run', op: 'stop', runId: run.id, workspaceBinding: binding });
  expect((await detail(run.id)).run.status).toBe('stopped');
  const before = llm.requests.length;
  await expect(host.api('action', resumeCommand(run))).rejects.toThrow(/等待|结束/);
  expect((await detail(run.id)).run.status).toBe('stopped'); expect(llm.requests.length).toBe(before);
}, 60000);

it('补充信息不会清除授权阻断；修复并重新检查才采用已保存输入', async () => {
  const run = await start({ steps: [waitStep, { text: 'RECHECK_RESULT：只采用已保存补充一次。' }] });
  await until(() => detail(run.id), value => value.run.status === 'waiting' && value.calls.every(call => call.status !== 'running'));
  const original = (await host.api('snapshot')).workspace.config.extraBusinessSkills;
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: [...original, 'another-scope'] } });
  const before = llm.requests.length;
  const held = await host.api('action', resumeCommand(run));
  expect(held.run.status).toBe('waiting'); expect(held.execution.blocks.map(block => block.kind)).toEqual(['authorization']);
  expect(llm.requests.length).toBe(before);
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, config: { extraBusinessSkills: original } });
  await host.api('action', { type: 'skill.run', op: 'recheck', runId: run.id, requestId: randomUUID(), workspaceBinding: binding, confirm: true });
  const done = await until(() => detail(run.id), value => value.run.status !== 'running' && value.run.status !== 'waiting');
  expect(done.run.status, JSON.stringify(done)).toBe('completed'); expect(done.run.result).toContain('RECHECK_RESULT');
  expect(done.inputs.filter(input => JSON.stringify(input.message).includes('[24PA resume:') && input.accepted)).toHaveLength(1);
  expect(llm.requests.length - before).toBe(1);
}, 60000);

it('暂时拒绝最多自动重试三次，全部尝试归原运行；下一次模型请求被阻止', async () => {
  const before = llm.requests.length;
  const rejected = { httpError: { status: 429, type: 'rate_limit_error' } };
  const run = await start({ tools: [], steps: [rejected, rejected, rejected, rejected, { text: '不得第五次执行' }] });
  const ended = await until(() => detail(run.id), value => !['running', 'pending'].includes(value.run.status));
  expect(ended.run.status, JSON.stringify(ended)).toBe('failed');
  expect(llm.requests.length - before).toBe(4); expect(ended.attempts).toHaveLength(4);
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
