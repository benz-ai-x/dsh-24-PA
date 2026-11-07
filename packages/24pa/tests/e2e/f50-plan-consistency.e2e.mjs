import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bootHost } from '../helpers/host.mjs';
import { startPgCluster } from '../helpers/pg.mjs';
import { startMockLlm } from '../helpers/mock-llm.mjs';
import { seedLegacyPlan } from '../helpers/legacy-plan-fixture.mjs';
import { DEFAULT_CONFIG } from '../../lib/config.js';

let root, host, llm, cluster, scriptPath, binding, env;
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'pa24-f50-')); const workspace = join(root, 'workspace'), bin = join(root, 'lark-cli'); await mkdir(workspace);
  const storage = process.env.PA24_E2E_STORAGE === 'postgres' ? 'postgres' : 'sqlite';
  if (storage === 'postgres') cluster = await startPgCluster();
  scriptPath = join(root, 'model.json'); await writeFile(scriptPath, '{}');
  llm = await startMockLlm({ scriptPath, logPath: join(root, 'requests.json') });
  const state = join(root, 'lark.json'); await writeFile(state, JSON.stringify({ ownerOpenId: 'ou_f50_owner', appId: 'cli_test_app' }));
  await writeFile(bin, '#!/usr/bin/env node\nawait import(' + JSON.stringify(resolve('tests/helpers/stub-lark-cli.mjs')) + ');\n'); await chmod(bin, 0o755);
  await writeFile(join(workspace, 'AGENTS.md'), '# F50 isolated acceptance\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, storage, mode: 'feishu', ownerOpenId: 'ou_f50_owner',
    folderToken: 'fixture-folder', tasklistId: 'fixture-list', maxWorkers: 3, enabledWorkers: ['skill', 'digest', 'reminders', 'calendar'], extraBusinessSkills: ['daily-planning', 'daily-review'] }) + '\n```\n');
  env = { PA24_WORKSPACE: workspace, PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'cli_test_app', PA24_FEISHU_APP_SECRET: 'fixture-secret',
    PA24_LARK_STUB_STATE: state, PATH: `${root}:${process.env.PATH}`, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: llm.url, ...(cluster ? { PA24_PG_DSN: cluster.dsn } : {}) };
  host = await bootHost({ env }); binding = (await host.waitUntil(s => !!s.workspaceBinding && !!s.workspace?.localSessionId && s.transport?.connected)).workspaceBinding;
}, 600000);
afterAll(async () => { await host?.stop(); await llm?.close(); await cluster?.stop(); if (root) await rm(root, { recursive: true, force: true }); });
const inspect = id => host.api('plans.inspect', { id, workspaceBinding: binding });
const change = (op, row, extra = {}) => host.api('action', { type: 'plan.change', workspaceBinding: binding, requestId: randomUUID(), op,
  ...(row ? { id: row.id, expectedRevision: row.revision } : {}), ...extra });
const decode = text => text.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
async function chat(action, text) {
  const title = '计划核对-' + randomUUID(), before = llm.log.length;
  await writeFile(scriptPath, JSON.stringify({ mode: 'dispatch', delegate: { worker: 'reminders', title, instruction: '按主人本次原文办理，预览与结果如实返回' },
    leadReply: '请核对计划预览。', workerAction: action, workerReply: '计划操作回执已返回。' }));
  const snapshot = await host.api('snapshot');
  await host.remote('session/prompt', { request: { requestId: randomUUID(), sessionId: snapshot.workspace.localSessionId, mode: 'queue', content: [{ type: 'text', text }], clientTimeZone: 'Asia/Shanghai' } });
  await host.waitUntil(s => s.work.some(row => row.title === title && row.status === 'completed'), { timeoutMs: 30000, label: title });
  const result = llm.log.slice(before).filter(request => request.tools.includes('pa24_work') && request.toolResults.length).at(-1);
  expect(result, JSON.stringify(host.logs()).slice(-4000)).toBeTruthy();
  return decode(result.toolResults.join(''));
}
async function confirm(preview) {
  const id = /"previewId":"([^"]+)"/.exec(preview)?.[1]; expect(id, preview).toBeTruthy();
  const instruction = `确认计划 ${id.slice(0, 8)}`;
  return chat({ action: 'digest_control', op: 'confirm', previewId: id, instruction }, instruction);
}
async function setting(row, settings) {
  const preview = await host.api('plans.settings-preview', { id: row.id, settings, workspaceBinding: binding });
  return (await change('settings', row, { settings, confirm: true, fingerprint: preview.fingerprint })).plan;
}

it('PC-01–03/06/07 真实 Loader 的主人消息确认和面板操作共同管理同一语音晨报', async () => {
  const before = (await host.api('plans', { workspaceBinding: binding })).total;
  const preview = await chat({ action: 'digest_enable', kind: 'morning', voice: true }, '新建每天九点的晨报，带语音，先给我核对。');
  expect(preview).toContain('builtin:daily-planning'); expect(preview).toContain('"usesModel":true'); expect(preview).toContain('ou_f50_owner');
  const draft = await host.api('plans.draft', { preset: 'morning', workspaceBinding: binding });
  expect(draft.configuration.skillId).toBe('builtin:daily-planning');
  expect((await host.api('plans', { workspaceBinding: binding })).total).toBe(before);
  const enabled = await confirm(preview); expect(enabled).toContain('"owner_enabled":true');
  let row = (await host.api('plans', { workspaceBinding: binding })).rows.find(row => row.skill === 'daily-planning');
  expect(row).toMatchObject({ voice: true, status: 'active', owner_enabled: true }); const id = row.id, nativeId = row.schedule_id;
  const adjusted = await chat({ action: 'digest_control', planId: id, op: 'adjust', time: '10:00:00' }, '把这份晨报改到十点，其他不改。');
  await confirm(adjusted); row = (await inspect(id)).plan;
  expect(row).toMatchObject({ id, voice: true, schedule_id: nativeId, status: 'active', task_config: { timeZone: 'Asia/Shanghai' } });
  expect(row.schedule_spec.daily.time).toBe('10:00:00');
  row = await setting(row, { time: '11:00:00', voice: false });
  const listed = await chat({ action: 'digest_list', query: id }, '查看这份晨报。');
  expect(listed).toContain(id); expect(listed).toContain('11:00:00'); expect(listed).toContain('"voice":false');
  const pause = '暂停这份晨报。'; await chat({ action: 'digest_control', planId: id, op: 'pause', instruction: pause }, pause);
  expect((await inspect(id)).plan).toMatchObject({ owner_enabled: false, status: 'paused', schedule_id: null });
  const resume = await chat({ action: 'digest_control', planId: id, op: 'resume' }, '恢复刚才的晨报。');
  await confirm(resume); expect((await inspect(id)).plan).toMatchObject({ id, owner_enabled: true, voice: false });
  await confirm(resume); expect((await host.api('plans', { workspaceBinding: binding })).total).toBe(before + 1);
  const duplicate = await chat({ action: 'digest_enable', kind: 'morning' }, '我的晨报计划还在吗？');
  expect(duplicate).toContain('"selectionRequired":true'); expect(duplicate).toContain(id);
  row = (await inspect(id)).plan; await change('pause', row);
}, 180000);

it('PC-04/05/08–10 旧语音计划改时、历史、重启与自愿迁移各自保持原对象', async () => {
  const legacy = await seedLegacyPlan(host, cluster?.dsn, { kind: 'weekly', time: '08:30:00', timeZone: 'Asia/Tokyo', weekdays: [2, 6], voice: true });
  expect((await inspect(legacy.id)).plan).toMatchObject({ task_config: null, task_authorization: null });
  let row = await setting((await inspect(legacy.id)).plan, { time: '10:30:00' });
  expect(row).toMatchObject({ voice: true, skill: 'digest-weekly', task_config: null, schedule_id: legacy.schedule_id,
    schedule_spec: { weekly: { time_zone: 'Asia/Tokyo', weekdays: [2, 6] } } });
  const beforeModel = llm.log.length;
  await host.api('action', { type: 'digest.run-now', planId: legacy.id, workspaceBinding: binding });
  const history = await host.api('runs', { kind: 'legacy', planId: legacy.id, range: 'all', workspaceBinding: binding });
  expect(history.rows[0]).toMatchObject({ execution_status: 'completed' }); expect(llm.log.length).toBe(beforeModel);
  const recent = (await host.api('plans', { query: legacy.id, workspaceBinding: binding })).rows[0].recentRun;
  expect(recent).toMatchObject({ kind: 'legacy', id: history.rows[0].id, status: 'completed' });
  const listed = await chat({ action: 'digest_list', query: legacy.id }, '看看旧周报最近的执行和投递。');
  expect(listed).toContain(history.rows[0].id); expect(listed).toContain('delivery_status');
  row = (await inspect(legacy.id)).plan; await change('pause', row);
  const resume = await host.api('plans.preview', { id: legacy.id, workspaceBinding: binding });
  await change('enable', (await inspect(legacy.id)).plan, { confirm: true, fingerprint: resume.fingerprint });
  const root = host.root; await host.stop({ keepRoot: true }); host = await bootHost({ env, root });
  binding = (await host.waitUntil(s => !!s.workspaceBinding && s.transport?.connected)).workspaceBinding;
  const after = await inspect(legacy.id);
  expect(after.plan).toMatchObject({ id: legacy.id, task_config: null, task_authorization: null, voice: true, skill: 'digest-weekly', status: 'active' });
  expect(after.legacyHistory[0].id).toBe(history.rows[0].id); expect(after.migration).toBeNull();
  const migration = await host.api('plans.migration-preview', { id: legacy.id, skillId: 'builtin:digest-weekly', workspaceBinding: binding });
  const migrated = await change('migrate', after.plan, { skillId: 'builtin:digest-weekly', confirm: true, fingerprint: migration.fingerprint });
  expect(migrated.plan).toMatchObject({ id: legacy.id, schedule_id: after.plan.schedule_id, voice: true, skill: 'digest-weekly', task_config: { timeZone: 'Asia/Tokyo' } });
  expect((await inspect(legacy.id)).legacyHistory[0].id).toBe(history.rows[0].id);
}, 300000);
