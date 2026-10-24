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
const latestTasks = async () => [...new Map((await journal(larkState + '.tasks.jsonl')).map(row => [row.guid, row])).values()];
const sources = () => ({ version: 1, entries: [
  { id: 'personal', name: '个人待办', platform: 'feishu', resourceKind: 'tasklist', resourceId: 'personal-list', purpose: 'personal', ownerId: 'ou_test_owner', filter: 'all' },
  { id: 'project', name: '项目待办', platform: 'feishu', resourceKind: 'tasklist', resourceId: 'project-list', purpose: 'project', ownerId: 'ou_test_owner', filter: 'responsible' },
  { id: 'wecom', name: '企微授权范围', platform: 'wecom', resourceKind: 'authorized_scope', resourceId: 'authorized', purpose: 'personal', ownerId: 'wou_test_owner', filter: 'all' },
].map(row => ({ ...row, domain: 'todo', access: 'readwrite', enabled: true })), defaults: { calendar: null, todo: 'personal' }, mappings: [{ domain: 'todo', kind: 'project', name: '研发', sourceId: 'project' }], meetingDurationMinutes: null });
const ready = async () => {
  const snapshot = await host.waitUntil(s => !!s.workspaceBinding && !!s.workspace?.localSessionId && s.transport?.connected, { label: '多来源待办工作区' });
  binding = snapshot.workspaceBinding; localSessionId = snapshot.workspace.localSessionId;
};
const saveSources = async value => {
  const before = await host.api('sources');
  await host.api('action', { type: 'workspace.config-update', workspaceBinding: binding, expectedSourcesHash: before.configHash, config: { sources: value } });
  await ready();
};
const work = async (action, entry = 'local', instruction = '本人明确委托办理本次待办', expectedStatus = 'completed') => {
  const title = `M04-${randomUUID()}`, before = llm.requests.length;
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: 'tasks', title, instruction }, workerAction: action,
    workerReply: '本次工具返回已记录，请按实际回执汇报。', leadReply: '委托已接纳。' }));
  if (entry === 'local') await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: localSessionId, mode: 'queue', content: [{ type: 'text', text: instruction }], clientTimeZone: zone } });
  else await host.api('action', { type: 'test.inject', event: { eventId: randomUUID(), senderOpenId: 'ou_test_owner', appId: 'cli_test_app', chatType: 'p2p', text: instruction } });
  const snapshot = await host.waitUntil(s => s.work.some(row => row.title === title && ['completed', 'failed', 'needs_reconciliation', 'waiting_input'].includes(row.status)), { label: title, timeoutMs: 60000 });
  const row = snapshot.work.find(row => row.title === title);
  expect(row.status, JSON.stringify(row)).toBe(expectedStatus);
  const receipt = llm.requests.slice(before).filter(r => r.tools.includes('pa24_work')).flatMap(r => r.toolResults).join('\n').replaceAll('\\"', '"');
  return { row, receipt };
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-manticore-todo-')); workspace = join(root, 'workspace'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  await writeFile(join(workspace, 'AGENTS.md'), '# 待办隔离验证\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, mode: 'feishu', ownerOpenId: 'ou_test_owner', folderToken: 'folder', tasklistId: 'list', calendarId: 'old-cal', enabledWorkers: ['tasks', 'calendar', 'reminders', 'digest'] }) + '\n```\n');
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

it('普通卡片查询不调用平台或模型，旧个人来源默认全量', async () => {
  const first = await host.api('sources'); expect(first.entries.find(row => row.domain === 'todo').filter).toBe('all');
  const before = (await journal(larkState + '.calls.jsonl')).length;
  const cached = await host.api('todos', { workspaceBinding: binding }); expect(cached.total).toBeNull(); expect(cached.count).toBe(0);
  expect((await journal(larkState + '.calls.jsonl')).length).toBe(before); expect(llm.requests).toHaveLength(0);
  await saveSources(sources());
});
it('读取非助理待办全部分页，角色覆盖按来源默认；企微范围缺口明确', async () => {
  await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_test_owner', appId: 'cli_test_app', todoPageSize: 2 }));
  const rows = [
    ...Array.from({ length: 5 }, (_, i) => ({ guid: `native-${i}`, summary: `原生待办 ${i}`, tasklistId: 'personal-list' })),
    { guid: 'assigned', summary: '他人分给我的', tasklistId: 'project-list', creator: { id: 'other', type: 'user' } },
    { guid: 'followed', summary: '本人仅关注', tasklistId: 'project-list', members: [{ id: 'other', type: 'user', role: 'assignee' }, { id: 'ou_test_owner', type: 'user', role: 'follower' }] },
  ];
  for (const task of rows) await appendFile(larkState + '.tasks.jsonl', JSON.stringify({ ...task, status: 'open', due: null }) + '\n');
  await appendFile(wecomState + '.todos.jsonl', JSON.stringify({ todo_id: 'native-wc', title: '企微原生待办', status: 'proceed', user_status: 'accept', creator: { userid: 'other' }, followers: [{ userid: 'wou_test_owner', user_status: 'accept' }], deadline: null }) + '\n');
  const verified = await host.api('action', { type: 'todos.verify', workspaceBinding: binding, limit: 2 });
  expect(verified.count).toBe(7); expect(verified.total).toBeNull(); expect(verified.tasks).toHaveLength(2); expect(verified.hasMore).toBe(true);
  expect(verified.sources.find(row => row.sourceId === 'wecom').reason).toMatch(/真实账号/);
  const project = await host.api('action', { type: 'todos.verify', workspaceBinding: binding, sourceId: 'project', role: 'following' });
  expect(project.total).toBe(1); expect(project.tasks[0].guid).toBe('followed'); expect((await host.api('sources')).config.entries.find(row => row.id === 'project').filter).toBe('responsible');
  const personal = await host.api('todos', { workspaceBinding: binding, sourceId: 'personal', offset: 4, limit: 2 }); expect(personal.total).toBe(5); expect(personal.tasks).toHaveLength(1);
});
it('本地和飞书两入口同次创建本人负责，明确项目只写一个来源，不另派执行', async () => {
  const before = (await host.api('snapshot')).work.length;
  const local = await work({ action: 'task_create', summary: '本地本人任务' }, 'local', '记录一个待办：本地本人任务，未设置截止');
  expect(local.row.origin).toBe('local'); expect(local.receipt).toContain('verified'); expect(local.receipt).toContain('记录待办不代表业务已经完成');
  created = (await latestTasks()).find(row => row.summary === '本地本人任务');
  expect(created.members).toEqual([{ id: 'ou_test_owner', type: 'user', role: 'assignee' }]); expect(created.due).toBeUndefined();
  const bot = await work({ action: 'task_create', summary: '项目截止任务', due: day.date, project: '研发' }, 'feishu', '给研发项目记录待办：项目截止任务，明天到期');
  expect(bot.row.origin).toBe('feishu'); expect(bot.receipt).toContain('project-list');
  expect((await latestTasks()).find(row => row.summary === '项目截止任务').tasklists).toEqual([{ tasklist_guid: 'project-list' }]);
  expect((await host.api('snapshot')).work.length - before).toBe(2);
});
it('切换默认后延期、完成、删除仍变更原件，未新建对象', async () => {
  const config = (await host.api('sources')).config; config.defaults.todo = 'project'; await saveSources(config);
  const before = (await latestTasks()).length;
  expect((await work({ action: 'task_update', guid: created.guid, due: day.date })).receipt).toContain('personal-list');
  expect((await work({ action: 'task_complete', guid: created.guid })).receipt).toContain('completed');
  expect((await latestTasks()).find(row => row.guid === created.guid).status).toBe('completed');
  expect((await work({ action: 'task_cancel', guid: created.guid, effect: 'whole', reason: '本人取消此待办' })).receipt).toContain('canceled');
  expect((await latestTasks()).find(row => row.guid === created.guid).deleted).toBe(true); expect((await latestTasks()).length).toBe(before);
});
it('企微写后核验默认本人，延期不重建；完成本人份额保留整体业务状态', async () => {
  const createdWork = await work({ action: 'task_create', sourceId: 'wecom', summary: '企微协作', assigneeIds: ['wou_test_owner', 'other'], instruction: '本人授权分派给我和 other' });
  expect(createdWork.receipt).toContain('verified');
  const row = (await journal(wecomState + '.todos.jsonl')).find(row => row.title === '企微协作');
  await work({ action: 'task_update', sourceId: 'wecom', guid: row.todo_id, due: day.date });
  const finished = await work({ action: 'task_complete', sourceId: 'wecom', guid: row.todo_id, effect: 'self' });
  expect(finished.receipt).toContain('finished'); expect(finished.receipt).toContain('"status":"open"');
  const writeCalls = await journal(wecomState + '.calls.jsonl'); expect(writeCalls.filter(row => row.args[0] === 'todo' && row.args[1] === 'create')).toHaveLength(1);
});
it('只读来源的创建请求保留原输入等待；权限修复后原运行仅创建一次', async () => {
  const config = (await host.api('sources')).config;
  config.entries.find(row => row.id === 'personal').access = 'read'; await saveSources(config);
  const count = (await latestTasks()).length;
  const refused = await work({ action: 'task_create', sourceId: 'personal', summary: '修复权限后的原待办' }, 'local', '请在个人待办清单记录这项任务', 'waiting_input');
  expect(refused.row.progress).toContain('仅登记为读取'); expect((await latestTasks()).length).toBe(count);
  let detail;
  for (let attempt = 0; attempt < 100; attempt++) {
    detail = await host.api('worker.run', { runId: refused.row.active_worker_run_id, workspaceBinding: binding });
    if (detail.calls.length && detail.calls.every(call => call.status !== 'running')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  expect(detail.calls).toHaveLength(1); expect(detail.calls[0].status).toBe('succeeded'); expect(detail.operations).toHaveLength(0);
  config.entries.find(row => row.id === 'personal').access = 'readwrite'; await saveSources(config);
  const continuationScript = JSON.parse(await readFile(scriptPath, 'utf8'));
  continuationScript.workerAfterPreparation = continuationScript.workerAction;
  await writeFile(scriptPath, JSON.stringify(continuationScript));
  const latest = (await host.api('work.inspect', { workId: refused.row.id, workspaceBinding: binding })).work;
  await host.api('action', { type: 'work.change', op: 'supplement', workspaceBinding: binding, workId: latest.id, expectedRevision: latest.revision,
    requestId: randomUUID(), instruction: '个人待办写入权限已修复，请按原请求继续', confirm: true });
  const resumed = await host.waitUntil(s => s.work.some(row => row.id === latest.id && row.status === 'completed'));
  expect(resumed.work.find(row => row.id === latest.id).active_worker_run_id).toBe(refused.row.active_worker_run_id);
  expect((await latestTasks()).length).toBe(count + 1);
});

it('单来源失败保留缓存，双库重启后浏览保留核验缺口且不访问平台', async () => {
  await writeFile(larkState, JSON.stringify({ ownerOpenId: 'ou_test_owner', appId: 'cli_test_app', todoListFailure: 'project-list' }));
  const partial = await host.api('action', { type: 'todos.verify', workspaceBinding: binding });
  expect(partial.total).toBeNull(); expect(partial.sources.find(row => row.sourceId === 'project').state).toBe('failed'); expect(partial.tasks.some(row => row.guid === 'assigned')).toBe(true);
  const hostRoot = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ root: hostRoot, env }); await ready();
  const count = (await journal(larkState + '.calls.jsonl')).length, modelCount = llm.requests.length;
  const restored = await host.api('todos', { workspaceBinding: binding }); expect(restored.tasks.length).toBeGreaterThan(0); expect(restored.total).toBeNull();
  expect((await journal(larkState + '.calls.jsonl')).length).toBe(count); expect(llm.requests).toHaveLength(modelCount);
});
