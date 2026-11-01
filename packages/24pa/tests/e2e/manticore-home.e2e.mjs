// Real Loader and SQLite. Only platform and model processes are substituted.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { appendFile, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootHost } from '../helpers/host.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { localDay } from '../../lib/calendar-time.js';

let root, host, llm, workspace, larkState, wecomState, binding, scriptPath;
const zone = 'Asia/Shanghai', day = localDay(new Date(), zone), previous = localDay(new Date(Date.now() - 86400000), zone);
const sources = { version: 1, entries: [
  { id: 'personal-calendar', domain: 'calendar', platform: 'feishu', name: '个人日历', purpose: 'personal', ownerId: 'ou_home_test', resourceKind: 'calendar', resourceId: 'personal-cal', filter: 'all', access: 'readwrite', enabled: true },
  { id: 'personal-todo', domain: 'todo', platform: 'feishu', name: '个人待办', purpose: 'personal', ownerId: 'ou_home_test', resourceKind: 'tasklist', resourceId: 'personal-list', filter: 'all', access: 'readwrite', enabled: true },
], defaults: { calendar: 'personal-calendar', todo: 'personal-todo' }, mappings: [], meetingDurationMinutes: 30 };
const journal = async path => (await readFile(path, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-home-e2e-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  await writeFile(join(workspace, 'AGENTS.md'), '# 首页组合快照验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage: 'sqlite', mode: 'feishu', ownerOpenId: 'ou_home_test', timeZone: zone,
    folderToken: 'folder', tasklistId: 'personal-list', calendarId: 'personal-cal', enabledWorkers: ['calendar', 'tasks', 'reminders', 'digest'], sources }) + '\n```\n');
  const bin = join(root, 'bin'); await mkdir(bin); larkState = join(root, 'lark.json'); wecomState = join(root, 'wecom.json'); scriptPath = join(root, 'script.json');
  await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_home_test', appId: 'cli_home_test' })); await writeFile(wecomState, '{}'); await writeFile(scriptPath, JSON.stringify({ steps: [] }));
  for (const name of ['lark', 'wecom']) {
    await writeFile(join(bin, name + '-cli'), '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-' + name + '-cli.mjs')) + ');\n');
    await chmod(join(bin, name + '-cli'), 0o755);
  }
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'model-requests.json') });
  host = await bootHost({ env: { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_home_test', PA24_FEISHU_APP_SECRET: 'home-test-secret',
    PA24_LARK_STUB_STATE: larkState, PA24_WECOM_STUB_STATE: wecomState, PATH: `${bin}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'home-test-key', DEEPSEEK_BASE_URL: llm.url } });
  binding = (await host.waitUntil(row => !!row.workspaceBinding && !!row.workspace?.localSessionId && row.transport?.connected, { label: '首页工作区就绪' })).workspaceBinding;
  for (const event of [
    { event_id: 'home-current', calendar_id: 'personal-cal', summary: '首页评审', start: new Date(Date.now() - 15 * 60000).toISOString(), end: new Date(Date.now() + 45 * 60000).toISOString(), status: 'active' },
    { event_id: 'home-later', calendar_id: 'personal-cal', summary: '项目同步', start: new Date(Date.now() + 2 * 3600000).toISOString(), end: new Date(Date.now() + 3 * 3600000).toISOString(), status: 'active' },
  ]) await appendFile(larkState + '.events.jsonl', JSON.stringify(event) + '\n');
  for (const task of [
    { guid: 'home-overdue', summary: '逾期待办', tasklistId: 'personal-list', due: previous.date, status: 'open' },
    { guid: 'home-today', summary: '今日待办', tasklistId: 'personal-list', due: day.date, status: 'open' },
    { guid: 'home-undated', summary: '无截止待办', tasklistId: 'personal-list', due: null, status: 'open' },
  ]) await appendFile(larkState + '.tasks.jsonl', JSON.stringify(task) + '\n');
  await host.api('action', { type: 'calendar.verify', workspaceBinding: binding, limit: 1 });
  await host.api('action', { type: 'todos.verify', workspaceBinding: binding, limit: 1 });
}, 600000);
afterAll(async () => { await host?.stop(); await llm?.close(); if (root) await rm(root, { recursive: true, force: true }); });

it('home 复用同一过滤计数与来源证据，预览分页不改变总量', async () => {
  const [home, calendar, todos, review, plans, runs] = await Promise.all([
    host.api('home', { workspaceBinding: binding }), host.api('calendar', { workspaceBinding: binding, period: 'day', offset: 0, limit: 50 }),
    host.api('todos', { workspaceBinding: binding, status: 'open', deadline: 'all', offset: 0, limit: 50 }),
    host.api('notes.queue'), host.api('plans.summary', { workspaceBinding: binding }), host.api('runs.summary', { workspaceBinding: binding }),
  ]);
  expect(home.workspaceBinding).toBe(binding); expect(home.observedAt).toEqual(expect.any(String));
  expect(home.calendar).toEqual(calendar); expect(home.todos).toEqual(todos); expect(home.review).toEqual(review);
  expect(home.plans).toEqual(plans); expect({ ...home.runs, observedAt: null, from: null }).toEqual({ ...runs, observedAt: null, from: null });
  expect(home.calendar.count).toBe(2); expect(home.calendar.events).toHaveLength(2); expect(home.calendar.complete).toBe(true);
  expect(home.todos.counts).toMatchObject({ open: 3, overdue: 1, today: 1, undated: 1 }); expect(home.todos.tasks).toHaveLength(3);
  expect(home.review.count).toBe(0); expect(home.plans.total).toBe(0);
});

it('首页普通读取不新增模型或平台调用，并拒绝旧工作区绑定', async () => {
  const beforeCalls = (await journal(larkState + '.calls.jsonl')).length, beforeModels = llm.requests.length;
  const home = await host.api('home', { workspaceBinding: binding });
  expect(home.calendar.fresh).toBe(false); expect(home.todos.fresh).toBe(false);
  expect((await journal(larkState + '.calls.jsonl')).length).toBe(beforeCalls); expect(llm.requests.length).toBe(beforeModels);
  await expect(host.api('home', { workspaceBinding: 'stale-workspace' })).rejects.toThrow(/工作区已切换/);
});
