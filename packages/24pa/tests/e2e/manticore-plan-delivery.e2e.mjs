// Actual Loader and native Skill sessions. Platform identity and message
// delivery use isolated local doubles; no real owner account is contacted.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, workspace, host, llm, cluster, binding, env, skillId;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-plan-delivery-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# 隔离结果投递验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage,
    mode: 'feishu', ownerOpenId: 'ou_test_owner', folderToken: 'folder', calendarId: 'calendar', tasklistId: 'tasks', enabledWorkers: ['skill'] }) + '\n```\n');
  const bin = join(root, 'bin'); await mkdir(bin); const larkState = join(root, 'lark.json');
  await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_test_owner', appId: 'cli_test_app' }));
  await writeFile(join(bin, 'lark-cli'), '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n');
  await chmod(join(bin, 'lark-cli'), 0o755);
  const scriptPath = join(root, 'script.json');
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: Array.from({ length: 8 }, () => ({ text: '固定日报正文：项目进度正常。' })) }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json'), recordInputs: true });
  env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'test_secret',
    PA24_LARK_STUB_STATE: larkState, PATH: `${bin}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url,
    ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env }); await ready();
  const markdown = '---\n' + JSON.stringify({ name: 'delivery-business', description: '隔离结果验证', metadata: { track: 'agent', tools: [],
    pa24: { schemaVersion: 1, mode: 'business', parameters: {}, actions: [], expectedResult: '日报', completionCriteria: '生成本次结果' } } }) + '\n---\n生成固定日报正文。';
  const saved = await action('skill.change', { op: 'save', displayName: '投递验证', markdown }); skillId = 'managed:' + saved.entry.id;
  await action('workspace.config-update', { config: { extraBusinessSkills: [saved.entry.name] } });
  await action('skill.change', { op: 'publish', id: skillId, expectedRevision: saved.entry.revision, confirm: true });
}, 600000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
const ready = async () => { binding = (await host.waitUntil(value => !!value.workspaceBinding && value.transport?.connected)).workspaceBinding; };
const action = (type, input) => host.api('action', { type, requestId: randomUUID(), workspaceBinding: binding, ...input });
const detail = runId => host.api('skills.run', { runId, workspaceBinding: binding });
const until = async (read, check) => {
  const end = Date.now() + 60000;
  while (Date.now() < end) { const value = await read(); if (check(value)) return value; await new Promise(resolve => setTimeout(resolve, 150)); }
  throw new Error('投递验证等待超时：' + JSON.stringify(await read()) + '\n' + host.logs().slice(-4000));
};
const plan = async delivery => {
  let row = (await action('plan.change', { op: 'save', title: '计划日报', skillId, timing: { type: 'daily', time: '09:00:00' }, delivery })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  return (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
};
const run = async row => {
  const preview = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
  return (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: preview.fingerprint })).run;
};

it('保存完整结果再投递，重启后相同正文保持静默且不重复原通知', async () => {
  const row = await plan({ channel: 'feishu', mode: 'changed', overrideQuiet: true }), one = await run(row);
  const sent = await until(() => detail(one.id), value => value.run.delivery_status === 'sent');
  expect(sent.run.status).toBe('completed'); expect(sent.run.result).toContain('固定日报正文');
  expect(sent.deliveries[0].deliveries[0].outbox.target).toBe('ou_test_owner'); expect(llm.requests).toHaveLength(1);
  const oldRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: oldRoot }); await ready();
  const two = await run(row), repeated = await until(() => detail(two.id), value => value.run.delivery_status === 'suppressed');
  expect(repeated.run.status).toBe('completed'); expect(repeated.run.result).toBe(sent.run.result); expect(repeated.deliveries[0].deliveries).toHaveLength(0);
  expect((await detail(one.id)).deliveries[0].deliveries[0].outbox.message_id).toBe(sent.deliveries[0].deliveries[0].outbox.message_id);
  expect(llm.requests).toHaveLength(2);
}, 600000);

it('文本送达而语音失败显示部分成功，公开补投入口不新增 Run 或模型请求', async () => {
  const row = await plan({ channel: 'feishu', voice: true, overrideQuiet: true }), one = await run(row);
  const terminal = value => value.deliveries.some(notice => notice.deliveries.find(item => item.component === 'audio')?.outbox.status === 'failed');
  const first = await until(() => detail(one.id), terminal), requestCount = llm.requests.length;
  expect(first.run).toMatchObject({ status: 'completed', delivery_status: 'partial' });
  const text = first.deliveries[0].deliveries.find(item => item.component === 'text'), audio = first.deliveries[0].deliveries.find(item => item.component === 'audio');
  expect(text.outbox.status).toBe('sent'); expect(audio.outbox.attempts).toBe(3);
  const input = { op: 'retry', runId: one.id, outboxId: Number(audio.outbox.id), fingerprint: audio.fingerprint, confirm: true, requestId: randomUUID() };
  await action('plan.delivery', input); await action('plan.delivery', input);
  const second = await until(() => detail(one.id), terminal);
  expect(second.deliveries[0].deliveries.find(item => item.component === 'text').outbox.message_id).toBe(text.outbox.message_id);
  expect(second.deliveries[0].deliveries.find(item => item.component === 'audio').changes).toHaveLength(1);
  expect(llm.requests).toHaveLength(requestCount);
  expect((await host.api('plans.inspect', { id: row.id, workspaceBinding: binding })).triggers.total).toBe(1);
}, 120000);
