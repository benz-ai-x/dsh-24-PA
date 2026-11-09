// The upgrade fixture must be an independently built previous plugin package.
// Both versions use the real Loader, Session and the same persistent workspace.
import { afterEach, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { bootHost } from '../helpers/host.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startWeixinServer } from '../helpers/weixin-server.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, host, cluster, llm, wx;
afterEach(async () => { await host?.stop(); await wx?.close(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });

it.skipIf(!process.env.PA24_E2E_UPGRADE_FROM)('WX-13/21 真实旧版本升级保留计划、绑定和结果，不为缺少来源依据的旧正文补造授权', async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-wx-upgrade-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  const owner = 'wx-upgrade-owner', originalText = '升级前原来源的正文-' + randomUUID();
  await writeFile(join(workspace, 'AGENTS.md'), '# Upgrade owner\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage,
    mode: 'feishu', ownerOpenId: owner, folderToken: 'folder', calendarId: 'calendar', tasklistId: 'tasks',
    enabledWorkers: ['skill', 'reminders', 'digest'] }) + '\n```\n');
  const statePath = join(root, 'lark.json'), bin = join(root, 'lark-cli'), scriptPath = join(root, 'model.json');
  await writeFile(statePath, JSON.stringify({ ownerOpenId: owner, appId: 'cli_test_app' }));
  await writeFile(bin, '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
  const day = new Date().toISOString().slice(0, 10);
  await writeFile(statePath + '.events.jsonl', JSON.stringify({ event_id: 'old-event', calendar_id: 'calendar', summary: originalText,
    start: day + 'T09:00:00+08:00', end: day + 'T09:30:00+08:00' }) + '\n');
  await writeFile(scriptPath, JSON.stringify({ text: '已收到。' }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json') }); wx = await startWeixinServer();
  const env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'fixture-secret',
    PA24_LARK_STUB_STATE: statePath, PATH: `${root}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url,
    PA24_TEST_WEIXIN_URL: wx.url, NODE_OPTIONS: `--import=${resolve('tests/helpers/weixin-fetch-boundary.mjs')}`,
    ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env, packageSpec: process.env.PA24_E2E_UPGRADE_FROM });
  let binding = (await host.waitUntil(s => !!s.workspaceBinding && s.transport?.connected)).workspaceBinding;
  const action = (type, input) => host.api('action', { type, requestId: randomUUID(), workspaceBinding: binding, ...input });
  const state = () => host.api('weixin', { workspaceBinding: binding });
  const until = async (read, check) => {
    const end = Date.now() + 40000;
    while (Date.now() < end) { const value = await read(); if (check(value)) return value; await delay(150); }
    throw new Error('升级流程超时：' + JSON.stringify(await read()));
  };
  await action('weixin.change', { action: 'login' }); await until(state, row => !!row.candidate);
  const wxPreview = await action('weixin.change', { action: 'preview', op: 'activate' });
  await action('weixin.change', { action: 'apply', previewId: wxPreview.previewId, confirm: true });
  await until(state, row => row.phase === 'polling');
  const seed = wx.input('/24pa');
  const originalBinding = (await until(state, row => row.inbox.some(input => input.payload.nativeId === seed.message_id && input.status === 'delivered') && row.deliveries.some(item => item.status === 'sent'))).binding;
  let plan = (await action('plan.change', { op: 'save', title: '升级前的计划', skillId: 'builtin:digest-morning',
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'none' } })).plan;
  const preview = await host.api('plans.preview', { id: plan.id, workspaceBinding: binding });
  plan = (await action('plan.change', { op: 'enable', id: plan.id, expectedRevision: plan.revision, fingerprint: preview.fingerprint, confirm: true })).plan;
  plan = (await action('plan.change', { op: 'pause', id: plan.id, expectedRevision: plan.revision })).plan;
  const check = await host.api('plans.run-preview', { id: plan.id, workspaceBinding: binding });
  const run = (await action('plan.change', { op: 'run', id: plan.id, fingerprint: check.fingerprint, confirm: true })).run;
  const detail = () => host.api('skills.run', { runId: run.id, workspaceBinding: binding });
  const original = await until(detail, row => row.run.status === 'completed');
  expect(original.run.result).toContain(originalText);
  const query = async () => {
    const title = '旧结果查询-' + randomUUID(), before = llm.log.length;
    await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: 'reminders', title, instruction: '按本人原文查询' },
      leadReply: '已安排。', workerAction: { action: 'digest_list', planId: plan.id }, workerReply: '已完成结果查询。' }));
    wx.input(`查询计划 ${plan.id} 的最近结果。`);
    await host.waitUntil(s => s.work.some(work => work.title === title && work.status === 'completed'));
    const value = llm.log.slice(before).filter(row => row.tools.includes('pa24_work') && row.toolResults.length).at(-1);
    expect(value).toBeTruthy();
    return value.toolResults.join('').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  };
  expect(await query()).toContain(originalText);
  const originalAgents = await readFile(join(workspace, 'AGENTS.md'), 'utf8'), profileRoot = host.root;
  await host.stop({ keepRoot: true }); host = await bootHost({ env, root: profileRoot });
  binding = (await host.waitUntil(s => !!s.workspaceBinding && s.transport?.connected)).workspaceBinding;
  const current = await until(state, row => row.phase === 'polling');
  expect(current.binding).toMatchObject({ generation: originalBinding.generation, owner_id: originalBinding.owner_id, session_id: originalBinding.session_id });
  expect((await detail()).run.result).toBe(original.run.result);
  expect((await host.api('plans.inspect', { id: plan.id, workspaceBinding: binding })).plan).toMatchObject({ id: plan.id, status: 'paused', session_id: plan.session_id });
  expect(await readFile(join(workspace, 'AGENTS.md'), 'utf8')).toBe(originalAgents);
  const restricted = await query();
  expect(restricted).not.toContain(originalText); expect(restricted).toContain('"result":null'); expect(restricted).toMatch(/来源|依据|授权/);
  expect((await detail()).run.result).toBe(original.run.result);
}, 600000);
