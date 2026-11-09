// Real Loader, Session, authenticated panel and database. Only external
// platform/model requests are replaced; no real WeChat account is contacted.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { bootHost } from '../helpers/host.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startWeixinServer } from '../helpers/weixin-server.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, host, wx, llm, cluster, env, binding, skillId, scriptPath, clockPath, modelReply;
async function advanceClock(offsetMs) {
  const tmp = clockPath + '.tmp'; await writeFile(tmp, JSON.stringify({ offsetMs })); await rename(tmp, clockPath);
}
const action = (type, input) => host.api('action', { type, requestId: randomUUID(), workspaceBinding: binding, ...input });
const state = () => host.api('weixin', { workspaceBinding: binding });
const inspect = id => host.api('plans.inspect', { id, workspaceBinding: binding });
const detail = runId => host.api('skills.run', { runId, workspaceBinding: binding });
const decode = value => {
  if (typeof value === 'string') { try { return decode(JSON.parse(value)); } catch { return value; } }
  if (Array.isArray(value)) return value.map(decode).find(item => item && typeof item === 'object' && !Array.isArray(item)) ?? value;
  if (value?.type === 'text') return decode(value.text);
  return value;
};
async function localTool(name, input) {
  const local = (await host.api('snapshot')).workspace.localSessionId, start = llm.requests.length;
  const prior = new Set(llm.requests.flatMap(row => row.toolResults));
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', leadTool: { name, input }, leadReply: '已返回隔离验收工具结果。' }));
  await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: local, mode: 'queue',
    content: [{ type: 'text', text: '本人明确执行隔离验收操作：' + JSON.stringify(input) }] } });
  const result = await until(() => Promise.resolve(llm.requests.slice(start).at(-1)?.toolResults.at(-1)), value => value && !prior.has(value));
  return decode(result);
}
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
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json'), recordInputs: true, beforeReply: () => modelReply }); wx = await startWeixinServer();
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

it('WX-17 同身份续期及平台地址变化保留原计划授权与接收目标', async () => {
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '同一微信身份续期后的计划结果。' }] }));
  let row = (await action('plan.change', { op: 'save', title: '续期不改计划目标', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  const original = (await state()).binding, before = wx.sent.length;
  wx.state.base = 'https://renewal.weixin.qq.com';
  await action('weixin.change', { action: 'login' }); await until(state, value => !!value.candidate); await bindingChange('activate');
  expect((await state()).binding).toMatchObject({ generation: original.generation, session_id: original.session_id });
  expect((await inspect(row.id)).plan.task_authorization).toEqual(row.task_authorization);
  const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
  const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
  const result = await until(() => detail(run.id), value => !['not_requested', 'pending'].includes(value.run.delivery_status));
  expect(result.run).toMatchObject({ status: 'completed', delivery_status: 'sent' });
  expect(result.deliveries[0].destination).toEqual(preview.authorization.delivery);
  expect(wx.sent).toHaveLength(before + 1); expect(wx.sent.at(-1).to_user_id).toBe(original.owner_id);
}, 90000);

it('WX-18 接入页可明确放弃受限且未发送的计划结果，保留业务结果与处理状态', async () => {
  const body = '放弃通知不会删除业务结果。'.repeat(900);
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: body }] }));
  let row = (await action('plan.change', { op: 'save', title: '放弃受限通知', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  await bindingChange('disable'); const before = wx.sent.length;
  try {
    const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
    const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
    await until(() => detail(run.id), value => value.run.delivery_status === 'limited');
    const records = (await state()).deliveries.filter(item => item.association?.skillRunId === run.id);
    expect(records).toHaveLength(3);
    for (const record of records) {
      const command = { action: 'delivery', op: 'abandon', id: Number(record.id), revision: record.revision,
        generation: record.binding_generation, requestId: randomUUID(), evidence: '本人确认此段未发送，放弃通知并保留计划结果。', confirm: true };
      await action('weixin.change', command); await action('weixin.change', command);
    }
    const final = await until(() => detail(run.id), value => value.run.delivery_status === 'expired');
    expect(final.run).toMatchObject({ status: 'completed', result: body });
    expect(final.deliveries[0].deliveries.every(item => item.outbox.status === 'expired')).toBe(true);
    const latest = await state();
    for (const record of records) expect(latest.impact.deliveries).not.toContain(Number(record.id));
    for (const record of records) expect(latest.deliveries.find(item => Number(item.id) === Number(record.id)))
      .toMatchObject({ status: 'expired', revision: record.revision + 1, last_error: '主人放弃该次未发送投递，业务结果保留。' });
    expect(wx.sent).toHaveLength(before); expect((await inspect(row.id)).triggers.total).toBe(1);
  } finally { await bindingChange('enable'); }
}, 90000);

it('WX-17 运行中更改默认通知及换绑微信，原计划和在途结果均不改投', async () => {
  await advanceClock(61 * 60000);
  try { await until(state, value => value.deliveries.every(item => ['sent', 'expired'].includes(item.status))); }
  finally { await advanceClock(0); }
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '换绑前已开始的原计划结果。' }] }));
  let row = (await action('plan.change', { op: 'save', title: '在途结果保留原目标', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  const original = (await state()).binding, requests = llm.requests.length; let release;
  modelReply = new Promise(resolve => { release = resolve; });
  try {
    const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
    const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
    await until(() => detail(run.id), value => value.run.status === 'running' && llm.requests.length > requests);
    await action('workspace.config-update', { config: { notifyChannel: 'wecom' } });
    wx.state.bot = 'wx-next-plan-bot'; wx.state.owner = 'wx-next-plan-owner';
    await action('weixin.change', { action: 'login' }); await until(state, value => !!value.candidate); await bindingChange('activate');
    const current = (await state()).binding;
    expect(current.generation).not.toBe(original.generation); expect(current.session_id).not.toBe(original.session_id);
    const seed = wx.input('/24pa');
    await until(state, value => value.inbox.some(item => item.payload.nativeId === seed.message_id && item.status === 'delivered'
      && value.deliveries.some(out => out.association?.inboxEventId === item.event_id && out.status === 'sent')));
    const before = wx.sent.length; release(); modelReply = null;
    const result = await until(() => detail(run.id), value => value.run.delivery_status === 'limited');
    expect(result.run).toMatchObject({ status: 'completed', result: '换绑前已开始的原计划结果。', source_session_id: row.session_id });
    expect(result.run.plan.authorization.delivery).toEqual(preview.authorization.delivery);
    expect(result.deliveries[0].destination).toEqual(preview.authorization.delivery);
    expect(result.deliveries[0].deliveries[0].outbox).toMatchObject({ target: original.owner_id, binding_generation: original.generation });
    expect((await inspect(row.id)).plan.task_authorization).toEqual(row.task_authorization);
    expect(wx.sent).toHaveLength(before);
  } finally { release(); modelReply = null; await action('workspace.config-update', { config: { notifyChannel: 'feishu' } }); }
}, 90000);

it('WX-21 新微信计划分段与未知记录可联合备份、校验和隔离恢复，且不重新发送', async () => {
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '恢复保留原计划结果。'.repeat(600) }] }));
  let row = (await action('plan.change', { op: 'save', title: '微信通知恢复验收', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  wx.state.sendModes = ['native', 'unknown'];
  const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
  const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
  const original = await until(() => detail(run.id), value => value.deliveries.some(notice => notice.deliveries.some(item => item.outbox.status === 'unknown')));
  const unknown = original.deliveries[0].deliveries.find(item => item.outbox.status === 'unknown'), before = wx.sent.length;
  const saved = await localTool('pa24_maintenance', { action: 'backup_create', requestId: randomUUID(), targetDir: join(root, 'backups') });
  expect(saved.record, JSON.stringify(saved)).toMatchObject({ status: 'succeeded' });
  const verified = await localTool('pa24_maintenance', { action: 'backup_verify', requestId: randomUUID(), backupDir: saved.backupDir });
  expect(verified.complete, JSON.stringify(verified)).toBe(true);
  expect(verified.steps.find(step => step.id === 'ledger').evidence.counts.task_plan_delivery).toBeGreaterThanOrEqual(2);
  const restore = await localTool('pa24_maintenance', { action: 'backup_preview', backupDir: saved.backupDir });
  const restored = await localTool('pa24_maintenance', { action: 'backup_restore_check', requestId: randomUUID(), backupDir: saved.backupDir,
    targetDir: join(root, 'restore'), previewToken: restore.previewToken, confirm: true });
  expect(restored.complete, JSON.stringify(restored)).toBe(true); expect(restored.productionReady).toBe(false);
  const pending = restored.steps.find(step => step.id === 'remote-reconciliation').evidence.outbox;
  expect(pending.some(item => Number(item.id) === Number(unknown.outbox_id) && item.status === 'unknown' && item.target === preview.authorization.delivery.ownerId)).toBe(true);
  expect((await detail(run.id)).deliveries).toEqual(original.deliveries);
  expect(wx.sent).toHaveLength(before); expect((await inspect(row.id)).triggers.total).toBe(1);
}, 180000);

it('WX-18 本人免打扰期间普通结果到期留存，明确预约的投递才可覆盖', async () => {
  const revision = (await host.api('memory', { workspaceBinding: binding })).revision;
  const saved = await localTool('pa24_memory', { action: 'put', id: 'wx-quiet-test', category: 'preference', topic: '休假',
    content: '本人休假期间暂停普通结果推送。', source: '本人隔离验收', status: 'confirmed', confirmation: '本人明确要求休假期间免打扰。',
    validUntil: new Date(Date.now() + 2 * 3600000).toISOString(), expectedRevision: revision, reason: '本人验证免打扰' });
  expect(saved.revision, JSON.stringify(saved)).toBe(revision + 1);
  try {
    for (const overrideQuiet of [false, true]) {
      await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '免打扰期间保存的完整结果。' }] }));
      let row = (await action('plan.change', { op: 'save', title: '微信免打扰验收', skillId,
        timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet } })).plan;
      const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
      row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
      row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
      const before = wx.sent.length, check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
      const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
      if (overrideQuiet) {
        const sent = await until(() => detail(run.id), value => value.run.delivery_status === 'sent');
        expect(sent.run).toMatchObject({ status: 'completed', result: '免打扰期间保存的完整结果。' });
        expect(wx.sent).toHaveLength(before + 1);
      } else {
        const held = await until(() => detail(run.id), value => value.deliveries.some(notice => notice.deliveries.some(item => item.outbox.last_error?.includes('免打扰'))));
        expect(held.run).toMatchObject({ status: 'completed', delivery_status: 'pending' });
        expect(held.deliveries[0].deliveries[0].outbox.attempts).toBe(0);
        await advanceClock(61 * 60000);
        const expired = await until(() => detail(run.id), value => value.run.delivery_status === 'expired');
        expect(expired.run.result).toBe('免打扰期间保存的完整结果。'); expect(wx.sent).toHaveLength(before);
        await advanceClock(0);
      }
      expect((await inspect(row.id)).triggers.total).toBe(1);
    }
  } finally {
    await advanceClock(0);
    await localTool('pa24_memory', { action: 'delete', id: 'wx-quiet-test', expectedRevision: (await host.api('memory', { workspaceBinding: binding })).revision, reason: '本人结束隔离免打扰验收' });
  }
}, 90000);

it('WX-18 免打扰权威暂不可读时保留未发送结果，不把读取失败当作允许推送', async () => {
  const revision = (await host.api('memory', { workspaceBinding: binding })).revision;
  await localTool('pa24_memory', { action: 'put', id: 'wx-quiet-unreadable', category: 'preference', topic: '休假',
    content: '本人休假期间暂停普通结果推送。', source: '本人隔离验收', status: 'confirmed', confirmation: '本人明确要求休假期间免打扰。',
    validUntil: new Date(Date.now() + 2 * 3600000).toISOString(), expectedRevision: revision, reason: '本人验证偏好读取异常' });
  const path = join(env.PA24_WORKSPACE, '.24pa/memory.json'), original = await readFile(path);
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '偏好读取异常期间保存的结果。' }] }));
  let row = (await action('plan.change', { op: 'save', title: '不可读偏好不放行通知', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: false } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  const requests = llm.requests.length, before = wx.sent.length; let release, run;
  modelReply = new Promise(resolve => { release = resolve; });
  try {
    const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
    run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
    await until(() => detail(run.id), value => value.run.status === 'running' && llm.requests.length > requests);
    await writeFile(path, '{incomplete'); release(); modelReply = null;
    const result = await until(() => detail(run.id), value => value.deliveries.some(notice => notice.deliveries.some(item => item.outbox.status === 'sent' || item.outbox.last_error)));
    expect(result.run).toMatchObject({ status: 'completed', result: '偏好读取异常期间保存的结果。', delivery_status: 'pending' });
    expect(result.deliveries[0].deliveries[0].outbox).toMatchObject({ status: 'pending', attempts: 0, message_id: null });
    expect(result.deliveries[0].deliveries[0].outbox.last_error).toContain('免打扰'); expect(wx.sent).toHaveLength(before);
  } finally {
    release(); modelReply = null; await writeFile(path, original);
    if (run) for (const notice of (await detail(run.id)).deliveries) for (const item of notice.deliveries) {
      const out = item.outbox;
      if (['pending', 'limited', 'failed'].includes(out.status) && !out.acceptance && !out.message_id) await action('weixin.change', {
        action: 'delivery', op: 'abandon', id: Number(out.id), revision: out.revision, generation: out.binding_generation,
        evidence: '本人结束隔离读取异常测试，放弃测试通知，保留结果。', confirm: true });
    }
    await localTool('pa24_memory', { action: 'delete', id: 'wx-quiet-unreadable', expectedRevision: (await host.api('memory', { workspaceBinding: binding })).revision, reason: '本人结束隔离读取异常验收' });
  }
}, 90000);

it('WX-19 回复上下文缺失时业务照常完成，恢复同一上下文后只补投原结果', async () => {
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '上下文缺失期间保存的业务结果。' }] }));
  let row = (await action('plan.change', { op: 'save', title: '微信上下文验收', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  const path = join(env.PA24_WORKSPACE, '.24pa/weixin/secrets.json'), original = await readFile(path), credentials = JSON.parse(original);
  for (const value of Object.values(credentials.bindings)) delete value.context;
  const before = wx.sent.length, requests = llm.requests.length;
  try {
    await writeFile(path + '.fixture', JSON.stringify(credentials)); await rename(path + '.fixture', path);
    const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
    const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
    const limited = await until(() => detail(run.id), value => value.run.delivery_status === 'limited');
    expect(limited.run).toMatchObject({ status: 'completed', result: '上下文缺失期间保存的业务结果。' });
    const delivery = limited.deliveries[0].deliveries[0];
    expect(delivery.outbox).toMatchObject({ status: 'limited', attempts: 0, message_id: null });
    expect(delivery.outbox.last_error).toContain('上下文'); expect(wx.sent).toHaveLength(before);
    expect((await inspect(row.id)).plan.failure_count).toBe(0);
    await writeFile(path + '.fixture', original); await rename(path + '.fixture', path);
    await action('plan.delivery', { op: 'retry', runId: run.id, outboxId: Number(delivery.outbox_id), fingerprint: delivery.fingerprint, confirm: true });
    const sent = await until(() => detail(run.id), value => value.run.delivery_status === 'sent');
    expect(sent.run.result).toBe(limited.run.result); expect(wx.sent).toHaveLength(before + 1);
    expect(llm.requests).toHaveLength(requests + 1); expect((await inspect(row.id)).triggers.total).toBe(1);
  } finally { await writeFile(path + '.fixture', original); await rename(path + '.fixture', path); }
}, 90000);

it('WX-18 核对操作必须是明确名称，数组不能把未知投递改回待发送', async () => {
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '只用于核对输入格式的结果。' }] }));
  let row = (await action('plan.change', { op: 'save', title: '微信核对操作验收', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  wx.state.sendModes = ['unknown']; const before = wx.sent.length;
  const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
  const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
  const result = await until(() => detail(run.id), value => value.run.delivery_status === 'unknown'), out = result.deliveries[0].deliveries[0].outbox;
  const command = { action: 'delivery', id: Number(out.id), revision: out.revision, generation: out.binding_generation,
    evidence: '本人核对隔离测试的原投递，不授权重发。', confirm: true };
  try {
    for (const op of [['received'], ['retry'], ['abandon']]) await expect(action('weixin.change', { ...command, op })).rejects.toThrow(/操作.*无效/);
    expect((await detail(run.id)).deliveries[0].deliveries[0].outbox).toMatchObject({ status: 'unknown', revision: out.revision, acceptance: null });
    expect(wx.sent).toHaveLength(before + 1);
  } finally {
    const current = (await detail(run.id)).deliveries[0].deliveries[0].outbox;
    if (current.status === 'unknown') await action('weixin.change', { ...command, revision: current.revision, op: 'received' });
  }
}, 90000);

it('WX-19 平台明确凭据失效时停止重复发送，保留受限结果并要求重新登录', async () => {
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '凭据失效后仍保留的业务结果。' }] }));
  let row = (await action('plan.change', { op: 'save', title: '微信凭据失效验收', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  wx.state.sendMode = 'invalid-token'; const before = wx.sent.length, requests = llm.requests.length;
  try {
    const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
    const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
    const result = await until(() => detail(run.id), value => ['failed', 'limited'].includes(value.run.delivery_status));
    expect(result.run).toMatchObject({ status: 'completed', result: '凭据失效后仍保留的业务结果。', delivery_status: 'limited' });
    expect(result.deliveries[0].deliveries[0].outbox).toMatchObject({ status: 'limited', attempts: 1, message_id: null });
    expect((await state()).phase).toBe('needs_login'); expect(wx.sent).toHaveLength(before + 1);
    expect((await inspect(row.id)).plan.failure_count).toBe(0);
    wx.state.sendMode = 'native';
    await action('weixin.change', { action: 'login' }); await until(state, value => !!value.candidate); await bindingChange('activate');
    const out = (await detail(run.id)).deliveries[0].deliveries[0];
    await action('plan.delivery', { op: 'retry', runId: run.id, outboxId: Number(out.outbox_id), fingerprint: out.fingerprint, confirm: true });
    await until(() => detail(run.id), value => value.run.delivery_status === 'sent');
    expect(wx.sent).toHaveLength(before + 2); expect(llm.requests).toHaveLength(requests + 1);
  } finally { wx.state.sendMode = 'native'; }
}, 90000);

it.each(['rate-limit', 'http-error', 'network-error', 'rejected'])('WX-19 平台异常 %s 保留业务结果，未知不自动重发、明确拒绝有界停止', async mode => {
  await writeFile(scriptPath, JSON.stringify({ onlySkillRuns: true, steps: [{ text: '平台异常时保留的完整业务结果。' }] }));
  let row = (await action('plan.change', { op: 'save', title: '微信平台异常验收', skillId,
    timing: { type: 'daily', time: '09:00:00' }, delivery: { channel: 'weixin', overrideQuiet: true } })).plan;
  const preview = await host.api('plans.preview', { id: row.id, workspaceBinding: binding });
  row = (await action('plan.change', { op: 'enable', id: row.id, expectedRevision: row.revision, confirm: true, fingerprint: preview.fingerprint })).plan;
  row = (await action('plan.change', { op: 'pause', id: row.id, expectedRevision: row.revision })).plan;
  wx.state.sendMode = mode; const before = wx.sent.length, requests = llm.requests.length;
  try {
    const check = await host.api('plans.run-preview', { id: row.id, workspaceBinding: binding });
    const run = (await action('plan.change', { op: 'run', id: row.id, confirm: true, fingerprint: check.fingerprint })).run;
    const expected = mode === 'rejected' ? 'failed' : 'unknown', attempts = mode === 'rejected' ? 3 : 1;
    const result = await until(() => detail(run.id), value => value.run.delivery_status === expected), out = result.deliveries[0].deliveries[0];
    expect(result.run).toMatchObject({ status: 'completed', result: '平台异常时保留的完整业务结果。' });
    expect(out.outbox).toMatchObject({ status: expected, attempts, acceptance: null, message_id: null });
    expect(wx.sent).toHaveLength(before + attempts); expect(llm.requests).toHaveLength(requests + 1);
    expect((await inspect(row.id)).plan.failure_count).toBe(0);
    if (expected === 'unknown') {
      await action('plan.delivery', { op: 'review', runId: run.id, outboxId: Number(out.outbox_id), fingerprint: out.fingerprint, confirm: true,
        outcome: 'not_sent', evidence: '隔离平台仅记录请求并返回错误，没有向真实微信发送；明确不补投。' });
    }
    const current = (await detail(run.id)).deliveries[0].deliveries[0].outbox;
    await action('weixin.change', { action: 'delivery', op: 'abandon', id: Number(current.id), revision: current.revision,
      generation: current.binding_generation, confirm: true, evidence: '结束隔离平台异常测试，放弃该次未发送投递，保留业务结果。' });
    expect(wx.sent).toHaveLength(before + attempts);
  } finally { wx.state.sendMode = 'native'; }
}, 90000);
