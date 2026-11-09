// Real Loader, Session, authenticated panel and database. Only external
// platform/model requests are replaced; no real WeChat account is contacted.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { bootHost } from '../helpers/host.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startWeixinServer } from '../helpers/weixin-server.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, host, wx, llm, cluster, env, binding, skillId, scriptPath, clockPath;
async function advanceClock(offsetMs) {
  const tmp = clockPath + '.tmp'; await writeFile(tmp, JSON.stringify({ offsetMs })); await rename(tmp, clockPath);
}
const action = (type, input) => host.api('action', { type, requestId: randomUUID(), workspaceBinding: binding, ...input });
const state = () => host.api('weixin', { workspaceBinding: binding });
const inspect = id => host.api('plans.inspect', { id, workspaceBinding: binding });
const detail = runId => host.api('skills.run', { runId, workspaceBinding: binding });
async function until(read, check) {
  const end = Date.now() + 40000;
  while (Date.now() < end) { const value = await read(); if (check(value)) return value; await delay(150); }
  throw new Error('微信计划验收超时：' + JSON.stringify(await read()) + '\n' + JSON.stringify(host.logs()).slice(-6000));
}
async function bindingChange(op) {
  const preview = await action('weixin.change', { action: 'preview', op });
  await action('weixin.change', { action: 'apply', previewId: preview.previewId, confirm: true });
  if (op === 'activate' || op === 'enable') await until(state, value => value.phase === 'polling');
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-wx-plan-'));
  const workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# 隔离微信计划验收\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage,
    mode: 'feishu', ownerOpenId: 'ou_test_owner', folderToken: 'folder', calendarId: 'calendar', tasklistId: 'tasks', enabledWorkers: ['skill'] }) + '\n```\n');
  const larkState = join(root, 'lark.json'), bin = join(root, 'lark-cli');
  await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_test_owner', appId: 'cli_test_app' }));
  await writeFile(bin, '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
  scriptPath = join(root, 'model.json');
  clockPath = join(root, 'clock.json'); await advanceClock(0);
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '微信计划结果：本次只整理文字，无外部业务变更。' }] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json'), recordInputs: true }); wx = await startWeixinServer();
  env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'fixture-secret',
    PA24_LARK_STUB_STATE: larkState, PATH: `${root}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url,
    PA24_TEST_WEIXIN_URL: wx.url, PA24_TEST_CLOCK_FILE: clockPath,
    NODE_OPTIONS: `--import=${resolve('tests/helpers/weixin-fetch-boundary.mjs')} --import=${resolve('tests/helpers/clock-boundary.mjs')}`,
    ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env }); binding = (await host.waitUntil(s => !!s.workspaceBinding && s.transport?.connected)).workspaceBinding;
  const markdown = '---\n' + JSON.stringify({ name: 'wx-plan-business', description: '微信计划结果隔离验收', metadata: { track: 'agent', tools: [],
    pa24: { schemaVersion: 1, mode: 'business', parameters: {}, actions: [], expectedResult: '文字结果', completionCriteria: '保存本次结果' } } }) + '\n---\n整理本次文字结果。';
  const saved = await action('skill.change', { op: 'save', displayName: '微信计划验收', markdown }); skillId = 'managed:' + saved.entry.id;
  await action('workspace.config-update', { config: { extraBusinessSkills: [saved.entry.name] } });
  await action('skill.change', { op: 'publish', id: skillId, expectedRevision: saved.entry.revision, confirm: true });
  await action('weixin.change', { action: 'login' }); await until(state, s => !!s.candidate); await bindingChange('activate');
  const seed = wx.input('/24pa');
  await until(state, s => s.inbox.some(row => row.payload.nativeId === seed.message_id && row.status === 'delivered') && s.deliveries.some(row => row.status === 'sent'));
}, 600000);
afterAll(async () => { await host?.stop(); await wx?.close(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });

it('WX-17/18/21 显式确认固定微信目标，原生触发保存结果后发到该绑定', async () => {
  const original = (await state()).binding, before = wx.sent.length;
  let row = (await action('plan.change', { op: 'save', title: '微信周期结果验收', skillId,
    timing: { type: 'once', at: new Date(Date.now() + 5000).toISOString() }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  expect(preview.authorization.delivery).toMatchObject({ channel: 'weixin', target: 'wx-test-owner', accountId: 'wx-test-bot',
    ownerId: 'wx-test-owner', generation: original.generation, sessionId: original.session_id });
  expect((await inspect(row.id)).plan.task_authorization).toBeNull();
  expect((await inspect(row.id)).triggers.total).toBe(0); expect(wx.sent).toHaveLength(before);
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  const fired = await until(() => inspect(row.id), value => value.triggers.rows.some(trigger => trigger.run_id));
  const runId = fired.triggers.rows[0].run_id, delivered = await until(() => detail(runId), value => value.run.delivery_status === 'sent');
  expect(delivered.run).toMatchObject({ status: 'completed', source_session_id: row.session_id, trigger_kind: 'schedule' });
  expect(row.session_id).not.toBe(original.session_id); expect(delivered.run.result).toContain('微信计划结果');
  const notice = delivered.deliveries[0], outbox = notice.deliveries[0].outbox;
  expect(outbox).toMatchObject({ status: 'sent', channel: 'weixin', binding_generation: original.generation,
    association: { planId: row.id, skillRunId: runId, noticeId: notice.id } });
  expect(JSON.stringify(delivered)).not.toMatch(/test-private|context_token|bot_token/);
  expect(wx.sent).toHaveLength(before + 1); expect(wx.sent.at(-1).to_user_id).toBe('wx-test-owner');
  expect(wx.sent.at(-1).item_list[0].text_item.text).toContain(delivered.run.result);
  expect(llm.requests).toHaveLength(1); expect((await inspect(row.id)).triggers.total).toBe(1);
}, 90000);

it('WX-18 受限首段不妨碍整份普通结果到期留存，后段也不永久挂在待投递', async () => {
  const body = '到期保留而不推送。'.repeat(1300);
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: body }] }));
  let row = (await action('plan.change', { op: 'save', title: '微信过期结果', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  await bindingChange('disable'); const before = wx.sent.length;
  try {
    const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
    const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
    const limited = await until(() => detail(run.id), value => value.run.delivery_status === 'limited');
    expect(limited.deliveries[0].deliveries.map(item => item.outbox.status)).toEqual(['limited', 'pending', 'pending']);
    await advanceClock(61 * 60000);
    const expired = await until(() => detail(run.id), value => value.run.delivery_status === 'expired');
    expect(expired.run).toMatchObject({ status: 'completed', result: body });
    expect(expired.deliveries[0].deliveries.map(item => item.outbox.status)).toEqual(['expired', 'expired', 'expired']);
    expect(wx.sent).toHaveLength(before); expect((await inspect(row.id)).plan.failure_count).toBe(0);
  } finally { await advanceClock(0); await bindingChange('enable'); }
}, 90000);

it('WX-18 微信分段遇未知时停止后段，重启后本人无原生号核对只补未发段', async () => {
  const body = '计划长文结果。'.repeat(1400);
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: body }] }));
  let row = (await action('plan.change', { op: 'save', title: '微信长结果', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  const before = wx.sent.length, requests = llm.requests.length;
  wx.state.sendModes = ['no-id', 'unknown']; wx.state.sendMode = 'no-id';
  const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
  const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
  const partial = await until(() => detail(run.id), value => value.deliveries.some(notice => notice.deliveries.some(item => item.outbox.status === 'unknown')));
  const first = partial.deliveries[0].deliveries;
  expect(partial.run).toMatchObject({ status: 'completed', result: body, delivery_status: 'partial' });
  expect(first).toHaveLength(3); expect(first.map(item => item.outbox.status)).toEqual(['sent', 'unknown', 'pending']);
  expect(first[0].outbox).toMatchObject({ message_id: null, acceptance: { basis: 'explicit_zero' } });
  expect(wx.sent).toHaveLength(before + 2);
  const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root: hostRoot });
  binding = (await host.waitUntil(s => !!s.workspaceBinding && s.transport?.connected)).workspaceBinding;
  const recovered = await detail(run.id), unknown = recovered.deliveries[0].deliveries[1];
  expect(recovered.deliveries[0].deliveries.map(item => item.outbox.status)).toEqual(['sent', 'unknown', 'pending']);
  expect(wx.sent).toHaveLength(before + 2);
  const command = { op: 'review', requestId: randomUUID(), runId: run.id, outboxId: Number(unknown.outbox_id),
    fingerprint: unknown.fingerprint, confirm: true, outcome: 'sent', evidence: '本人在隔离测试会话中核对第二段已收到，平台未提供原生消息号。' };
  await action('plan.delivery', command); await action('plan.delivery', command);
  const final = await until(() => detail(run.id), value => value.run.delivery_status === 'sent');
  expect(final.deliveries[0].deliveries[1].outbox).toMatchObject({ message_id: null, acceptance: { basis: 'owner_visible' } });
  expect(final.deliveries[0].deliveries[1].changes).toHaveLength(1);
  expect(wx.sent).toHaveLength(before + 3);
  expect(new Set(wx.sent.slice(before).map(message => message.client_id)).size).toBe(3);
  expect(llm.requests).toHaveLength(requests + 1); expect((await inspect(row.id)).triggers.total).toBe(1);
  wx.state.sendMode = 'native';
}, 90000);

it('WX-18/19 停用微信不阻断已授权业务，恢复后明确补投不重跑或改投', async () => {
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: Array.from({ length: 3 }, () => ({ text: '微信停用期间业务结果仍然保存。' })) }));
  let row = (await action('plan.change', { op: 'save', title: '离线微信结果', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  await bindingChange('disable'); const sends = wx.sent.length; let lastRun;
  try {
    for (let index = 0; index < 3; index++) {
      const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
      const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
      lastRun = run;
      const result = await until(() => detail(run.id), value => value.run.status === 'completed' && value.deliveries.length > 0
        && !['not_requested', 'pending'].includes(value.run.delivery_status));
      expect(result.run.result).toContain('停用期间业务结果');
      expect(result.run.delivery_status).toBe('limited');
      expect(result.deliveries[0].destination).toEqual(preview.authorization.delivery);
      expect(result.deliveries[0].deliveries.every(item => item.outbox.channel === 'weixin')).toBe(true);
    }
    const final = await inspect(row.id);
    expect(final.plan).toMatchObject({ failure_count: 0, owner_enabled: false, status: 'paused' });
    expect(final.blocks).toEqual([]); expect(final.triggers.total).toBe(3); expect(wx.sent).toHaveLength(sends);
    const limited = await host.api('runs', { workspaceBinding: binding, kind: 'runs', range: 'all', planId: row.id, deliveryStatus: 'limited', includeUnresolved: false });
    expect(limited.total).toBe(3); expect(limited.rows.every(item => item.delivery_status === 'limited')).toBe(true);
    const unresolved = await host.api('runs', { workspaceBinding: binding, kind: 'runs', range: 'all', planId: row.id, attention: 'unresolved' });
    expect(unresolved.total).toBe(3);
  } finally { await bindingChange('enable'); }
  const requests = llm.requests.length, result = await detail(lastRun.id), item = result.deliveries[0].deliveries[0];
  const retry = { op: 'retry', requestId: randomUUID(), runId: lastRun.id, outboxId: Number(item.outbox_id), fingerprint: item.fingerprint, confirm: true };
  await action('plan.delivery', retry); await action('plan.delivery', retry);
  await until(() => detail(lastRun.id), value => value.run.delivery_status === 'sent');
  expect(llm.requests).toHaveLength(requests); expect((await inspect(row.id)).triggers.total).toBe(3);
  expect(wx.sent).toHaveLength(sends + 1);
}, 90000);
