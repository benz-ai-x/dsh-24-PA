// Real Loader, native local/Feishu Sessions and both persistent ledgers.
// Only the model and platform processes are substituted; no real account calls.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { localDay } from '../../lib/calendar-time.js';

let root, host, cluster, llm, workspace, binding, localSessionId, scriptPath, larkState, wecomState, env, created;
const zone = 'Asia/Shanghai', day = localDay(new Date(), zone, 1), at = time => `${day.date}T${time}:00+08:00`;
const range = { from: day.from.toISOString(), to: day.to.toISOString() };
const journal = async path => (await readFile(path, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
const latestEvents = async () => [...new Map((await journal(larkState + '.events.jsonl')).map(row => [row.event_id, row])).values()];
const sources = () => ({ version: 1, entries: [
  { id: 'personal', name: '个人日历', platform: 'feishu', resourceKind: 'calendar', resourceId: 'personal-cal', purpose: 'personal', ownerId: 'ou_test_owner', filter: 'all' },
  { id: 'project', name: '项目日历', platform: 'feishu', resourceKind: 'calendar', resourceId: 'project-cal', purpose: 'project', ownerId: 'ou_test_owner', filter: 'involved' },
  { id: 'wecom', name: '企微授权范围', platform: 'wecom', resourceKind: 'authorized_scope', resourceId: 'authorized', purpose: 'personal', ownerId: 'wou_test_owner', filter: 'all' },
].map(row => ({ ...row, domain: 'calendar', access: 'readwrite', enabled: true })), defaults: { calendar: 'personal', todo: null }, mappings: [{ domain: 'calendar', kind: 'project', name: '研发', sourceId: 'project' }], meetingDurationMinutes: 45 });
const ready = async () => {
  const snapshot = await host.waitUntil(s => !!s.workspaceBinding && !!s.workspace?.localSessionId && s.transport?.connected, { label: '多日历工作区' });
  binding = snapshot.workspaceBinding; localSessionId = snapshot.workspace.localSessionId;
};
const saveSources = async value => {
  const before = await host.api('sources');
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, expectedSourcesHash: before.configHash, config: { sources: value } });
  await ready();
};
const work = async (action, entry = 'local', instruction = '本人明确委托办理本次日程') => {
  const title = `M03-${randomUUID()}`, before = llm.requests.length;
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: action.action.startsWith('reminder_') ? 'reminders' : 'calendar', title, instruction }, workerAction: action,
    workerReply: '本次工具返回已记录，请按实际回执汇报。', leadReply: '委托已接纳。' }));
  if (entry === 'local') await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: localSessionId, mode: 'queue', content: [{ type: 'text', text: instruction }], clientTimeZone: zone } });
  else await host.api('action', { type: 'test.inject', event: { eventId: randomUUID(), senderOpenId: 'ou_test_owner', appId: 'cli_test_app', chatType: 'p2p', text: instruction } });
  const snapshot = await host.waitUntil(s => s.work.some(row => row.title === title && ['completed', 'failed', 'needs_reconciliation'].includes(row.status)), { label: title, timeoutMs: 60000 });
  const row = snapshot.work.find(row => row.title === title);
  expect(row.status, JSON.stringify(row)).toBe('completed');
  const receipt = llm.requests.slice(before).filter(r => r.tools.includes('pa24_work')).flatMap(r => r.toolResults).join('\n').replaceAll('\\"', '"');
  return { row, receipt };
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-manticore-calendar-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# 日程隔离验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, mode: 'feishu', ownerOpenId: 'ou_test_owner', folderToken: 'folder', tasklistId: 'list', calendarId: 'old-cal', enabledWorkers: ['calendar', 'reminders', 'digest'] }) + '\n```\n');
  const bin = join(root, 'bin'); await mkdir(bin);
  larkState = join(root, 'lark.json'); wecomState = join(root, 'wecom.json'); scriptPath = join(root, 'script.json');
  await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_test_owner', appId: 'cli_test_app' })); await writeFile(wecomState, '{}');
  for (const name of ['lark', 'wecom']) {
    await writeFile(join(bin, name + '-cli'), '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-' + name + '-cli.mjs')) + ');\n');
    await chmod(join(bin, name + '-cli'), 0o755);
  }
  await writeFile(scriptPath, JSON.stringify({ steps: [] }));
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'llm.json') });
  env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'test_secret',
    PA24_LARK_STUB_STATE: larkState, PA24_WECOM_STUB_STATE: wecomState, PATH: `${bin}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url,
    ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env }); await ready();
}, 600000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });

it('旧配置生成稳定登记；普通浏览不调用模型或日历平台，来源保存有并发基线', async () => {
  const first = await host.api('sources'), before = (await journal(larkState + '.calls.jsonl')).length;
  expect(first.legacy).toBe(true); expect(first.entries.find(row => row.domain === 'calendar').resourceId).toBe('old-cal');
  expect((await host.api('sources')).configHash).toBe(first.configHash);
  const cached = await host.api('calendar', { ...range, workspaceBinding: binding });
  expect(cached.fresh).toBe(false); expect(cached.total).toBeNull();
  expect((await journal(larkState + '.calls.jsonl')).length).toBe(before); expect(llm.requests).toHaveLength(0);
  await saveSources(sources());
  await expect(host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, expectedSourcesHash: first.configHash, config: { sources: first.config } })).rejects.toThrow(/来源配置已变更/);
});

it('查询非助理创建日程、分来源角色与冲突；计数先筛选再分页，全部筛选含外部会议', async () => {
  for (const event of [
    { event_id: 'external-personal_0', calendar_id: 'personal-cal', summary: '个人既有安排', start: at('09:00'), end: at('10:00') },
    { event_id: 'external-project_0', calendar_id: 'project-cal', summary: '项目参与会议', start: at('09:30'), end: at('10:30'), organizer: 'ou_colleague', attendees: [{ user_id: 'ou_test_owner' }] },
    { event_id: 'external-other_0', calendar_id: 'project-cal', summary: '其他成员安排', start: at('15:00'), end: at('16:00'), organizer: 'ou_colleague' },
  ]) await appendFile(larkState + '.events.jsonl', JSON.stringify({ ...event, url: 'https://calendar.example/event', status: 'active' }) + '\n');
  await appendFile(wecomState + '.schedules.jsonl', JSON.stringify({ schedule_id: 'outside-wecom', subject: '企微既有安排', begin_time: `${day.date} 13:00:00`, end_time: `${day.date} 13:30:00`, attendees: [], timezone: { timezone_id: zone } }) + '\n');
  const checked = await host.api('action', { type: 'calendar.verify', ...range, limit: 1, workspaceBinding: binding });
  expect(checked.fresh, JSON.stringify(checked)).toBe(true); expect(checked.total).toBe(3); expect(checked.events).toHaveLength(1); expect(checked.hasMore).toBe(true); expect(checked.conflicts.length).toBeGreaterThan(0);
  const all = await host.api('action', { type: 'calendar.verify', ...range, role: 'all', workspaceBinding: binding });
  expect(all.total).toBe(4); expect(all.events.some(event => event.summary === '其他成员安排')).toBe(true);
  expect((await host.api('sources')).config.entries.find(row => row.id === 'project').filter).toBe('involved');
});

it('宿主将空白本地会话改用标准预设后，办理入口保留原会话并打开新的24私助入口', async () => {
  const old = localSessionId;
  const changed = await host.remote('session/create', { request: { sessionId: old, cwd: (await host.api('snapshot')).workspace.path, agentPreset: 'standard' } });
  expect(changed).toMatchObject({ sessionId: old, agentPreset: 'standard' });
  const opened = await host.api('action', { type: 'robot.open', workspaceBinding: binding });
  expect(opened.sessionId).not.toBe(old); localSessionId = opened.sessionId;
  expect((await host.api('snapshot')).workspace.localSessionId).toBe(opened.sessionId);
  expect((await host.api('action', { type: 'robot.open', workspaceBinding: binding })).sessionId).toBe(opened.sessionId);
});

it('本地和飞书两入口创建占位会议，默认时长可追溯，明确项目仅写一个目标', async () => {
  const local = await work({ action: 'calendar_create', start: at('11:00') }, 'local', '明天上午11点帮我安排一个会议');
  expect(local.row.origin).toBe('local'); expect(local.receipt).toContain('45'); expect(local.receipt).toContain('personal-cal');
  created = (await latestEvents()).find(row => row.summary === '会议');
  expect(created).toMatchObject({ calendar_id: 'personal-cal', start: new Date(at('11:00')).toISOString(), end: new Date(at('11:45')).toISOString() });
  expect(created.attendees ?? []).toHaveLength(0);
  const bot = await work({ action: 'calendar_create', start: at('14:00'), project: '研发' }, 'feishu', '给研发项目明天下午2点安排一个会议');
  expect(bot.row.origin).toBe('feishu'); expect(bot.receipt).toContain('project-cal');
  expect((await latestEvents()).filter(row => row.summary === '会议')).toHaveLength(2);
});

it('换默认后仍修改原日程；仅取消本人提醒保留会议，缺权限不转投', async () => {
  const config = (await host.api('sources')).config; config.defaults.calendar = 'project'; await saveSources(config);
  const updated = await work({ action: 'calendar_update', eventId: created.event_id, start: at('11:15'), end: at('12:00') });
  expect(updated.receipt).toContain('personal-cal');
  expect((await latestEvents()).find(row => row.event_id === created.event_id)).toMatchObject({ calendar_id: 'personal-cal', start: new Date(at('11:15')).toISOString() });
  await work({ action: 'calendar_reminders', eventId: created.event_id, reminderMinutes: [] });
  expect((await latestEvents()).find(row => row.event_id === created.event_id)).toMatchObject({ status: 'active', reminders: [] });
  config.entries.find(row => row.id === 'personal').access = 'read'; await saveSources(config);
  const before = (await latestEvents()).length, refused = await work({ action: 'calendar_create', sourceId: 'personal', start: at('17:00') });
  expect(refused.receipt).toContain('仅登记为读取'); expect((await latestEvents()).length).toBe(before);
});

it('单来源失败保留缓存并报告未完整，重启后普通浏览仍保留逐来源证据', async () => {
  await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_test_owner', appId: 'cli_test_app', calendarFailures: ['project-cal'] }));
  const partial = await host.api('action', { type: 'calendar.verify', ...range, workspaceBinding: binding });
  expect(partial.fresh).toBe(false); expect(partial.total).toBeNull();
  expect(partial.sources.find(row => row.sourceId === 'project')).toMatchObject({ state: 'failed', lastCompleteAt: expect.any(String) });
  expect(partial.events.some(event => event.summary === '项目参与会议')).toBe(true);
  const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ root: hostRoot, env }); await ready();
  const count = (await journal(larkState + '.calls.jsonl')).length;
  const restored = await host.api('calendar', { ...range, workspaceBinding: binding });
  expect(restored.events.length).toBeGreaterThan(0); expect(restored.fresh).toBe(false); expect(restored.total).toBeNull();
  expect((await journal(larkState + '.calls.jsonl')).length).toBe(count);
});
