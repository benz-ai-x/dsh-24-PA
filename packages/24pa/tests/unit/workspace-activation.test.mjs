import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile, readFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PaRuntime } from '../../lib/runtime.js';
import { DEFAULT_CONFIG } from '../../lib/config.js';
import { readSecretStore, writeSecretStore } from '../../lib/secrets.js';
import { FakeFeishuTransport } from '../../lib/feishu.js';
import { startPgCluster } from '../helpers/pg.mjs';

let pg, root;
const runtimes = [];
beforeAll(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'pa24-workspace-activation-'))); pg = await startPgCluster(); });
afterEach(async () => { vi.restoreAllMocks(); for (const runtime of runtimes.splice(0)) await runtime.stop(); });
afterAll(async () => { await pg?.stop(); await rm(root, { recursive: true, force: true }); });

async function workspace(name, patch = {}, secrets = {}) {
  const path = join(root, name); await mkdir(path, { recursive: true });
  await writeFile(join(path, 'AGENTS.md'), '# 主人的稳定规则\n\n```json\n' + JSON.stringify({ ...DEFAULT_CONFIG, ...patch }, null, 2) + '\n```\n');
  await writeSecretStore(path, secrets);
  return path;
}
function runtime(env = {}) {
  const ctx = {
    skills: null, get: () => null,
    workspaceRegistry: { list: () => [], create: async path => ({ id: path, path, title: '24私助' }) },
    sessionController: { create: vi.fn(async () => {}), rename: async () => {}, resolveAgent: async () => null },
  };
  const rt = new PaRuntime(ctx, { stateDirectory: root, workspacePath: '', env, reminderTickMs: 60000, larkCliBin: 'lark-cli', wecomCliBin: 'wecom-cli', cliTimeoutMs: 1000 });
  runtimes.push(rt); return { rt, ctx };
}

describe('工作区激活：公开 bind/update/reload，真实文件与账本', () => {
  it('冷启动先加载目标密钥库：PostgreSQL DSN 只存库即可打开真实 PG', async () => {
    const path = await workspace('pg-cold', { storage: 'postgres', pgDsnEnv: 'TARGET_PG' }, { pgDsn: pg.dsn });
    const { rt } = runtime(); await rt.bind(path);
    expect(rt.config.pgDsnEnv).toBe('TARGET_PG');
    expect(rt.secretValue('pgDsn')).toBe(pg.dsn);
    expect((await rt.repos.workspaceState.get(path)).path).toBe(path);
  });
  it('从 A 切到 B 使用 B 的引用与密钥，环境覆盖仍优先', async () => {
    const a = await workspace('a', {}, { pgDsn: 'invalid-old-dsn', feishuAppSecret: 'old' });
    const b = await workspace('b', { storage: 'postgres', pgDsnEnv: 'B_PG' }, { pgDsn: pg.dsn, feishuAppSecret: 'new' });
    const { rt } = runtime(); await rt.bind(a); await rt.bind(b);
    expect(rt.workspace.statePath).toBe(b);
    expect(rt.secretValue('feishuAppSecret')).toBe('new');
    expect((await rt.repos.workspaceState.get(b)).path).toBe(b);
    const { rt: override } = runtime({ B_PG: pg.dsn });
    const c = await workspace('c', { storage: 'postgres', pgDsnEnv: 'B_PG' }, { pgDsn: 'invalid-store-overridden' });
    await override.bind(c); expect(override.secretStatusSnapshot().pgDsn.source).toBe('env');
  });
  it('PG 有效连接变化拒绝热应用，保留旧账本与磁盘；同值引用可变，显式绑定可换连接', async () => {
    const changedDsn = `${pg.dsn}?application_name=pa24-rebind`;
    const path = await workspace('pg-reload', { storage: 'postgres' }, { pgDsn: pg.dsn });
    const { rt } = runtime({ SAME_PG: pg.dsn, NEXT_PG: changedDsn }); await rt.bind(path);
    const ledger = rt.repos, file = join(path, 'AGENTS.md'), before = await readFile(file, 'utf8');
    await expect(rt.updateWorkspaceConfig({ pgDsnEnv: 'NEXT_PG' })).rejects.toThrow(/重新绑定工作区/);
    expect(await readFile(file, 'utf8')).toBe(before);
    await expect(rt.updateWorkspaceSecrets({ pgDsn: changedDsn })).rejects.toThrow(/重新绑定工作区/);
    expect((await readSecretStore(path)).pgDsn).toBe(pg.dsn);
    expect(rt.secretValue('pgDsn')).toBe(pg.dsn); expect(rt.repos).toBe(ledger);
    await rt.updateWorkspaceConfig({ pgDsnEnv: 'SAME_PG' }); expect(rt.config.pgDsnEnv).toBe('SAME_PG'); expect(rt.repos).toBe(ledger);
    const updated = (await readFile(file, 'utf8')).replace('SAME_PG', 'NEXT_PG'); await writeFile(file, updated);
    await expect(rt.reloadWorkspace()).rejects.toThrow(/重新绑定工作区/);
    expect(rt.config.pgDsnEnv).toBe('SAME_PG'); expect(rt.secretValue('pgDsn')).toBe(pg.dsn);
    expect((await ledger.workspaceState.get(path)).path).toBe(path);
    await rt.bind(path); expect(rt.secretValue('pgDsn')).toBe(changedDsn); expect(rt.repos).not.toBe(ledger);
    expect((await rt.repos.workspaceState.get(path)).path).toBe(path);
  });
  it('开库或会话准备失败时保留原工作区、账本、提醒和配置', async () => {
    const a = await workspace('active'); const bad = await workspace('missing-dsn', { storage: 'postgres' });
    const { rt, ctx } = runtime(); await rt.bind(a);
    const old = { workspace: rt.workspace, config: rt.config, repos: rt.repos, reminders: rt.reminders };
    await expect(rt.bind(bad)).rejects.toThrow(/连接串/);
    const staged = await workspace('session-failure'); ctx.sessionController.create.mockRejectedValueOnce(new Error('session unavailable'));
    await expect(rt.bind(staged)).rejects.toThrow('session unavailable');
    for (const [key, value] of Object.entries(old)) expect(rt[key]).toBe(value);
    expect((await old.repos.workspaceState.get(a)).path).toBe(a);
    await rt.updateWorkspaceConfig({ maxWorkers: 3 }); expect(rt.config.maxWorkers).toBe(3);
  });
  it.each(['activate', 'rollback'])('候选工作区准备中不能读取或修改旧记忆（%s）', async outcome => {
    const a = await workspace(`memory-a-${outcome}`), b = await workspace(`memory-b-${outcome}`, { extraLocalTools: ['subagent_codex'] });
    const memoryFile = join(a, '.24pa', 'memory.json');
    await mkdir(join(a, '.24pa'), { recursive: true });
    const original = JSON.stringify({ schemaVersion: 1, revision: 1, records: [{ id: 'a-private', category: 'fact', topic: 'A', content: 'A private memory', source: 'owner', status: 'confirmed', updatedAt: new Date().toISOString(), updatedBy: 'owner', reason: 'owner instruction' }] });
    await writeFile(memoryFile, original);
    const { rt, ctx } = runtime();
    ctx.fs = { resolve: async path => path, stat: async path => stat(path).catch(() => null), readText: path => readFile(path, 'utf8'), writeText: vi.fn() };
    await rt.bind(a);
    const oldMemory = rt.memory, oldRepos = rt.repos;
    const activeAgent = { id: await rt.openLocalSession(), session: { header: { cwd: a, agentPreset: 'pa24' } }, ctx: {} };
    let candidate, release, ready;
    const entered = new Promise(resolve => { ready = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    ctx.sessionController.create.mockImplementation(async request => {
      if (request.workspaceId !== b || !request.sessionId.endsWith('-local')) return;
      candidate = { id: request.sessionId, session: { header: { cwd: b, agentPreset: 'pa24' } }, ctx: {} };
      ready(); await held;
      if (outcome === 'rollback') throw new Error('candidate session failed');
    });
    const binding = rt.bind(b).then(() => null, error => error);
    await entered;
    try {
      expect(rt.configFor(candidate).extraLocalTools).toEqual(['subagent_codex']);
      expect(rt.roleForToolMount(candidate)).toBe('local-robot'); expect(rt.roleFor(candidate)).toBeNull();
      await expect(rt.memoryTool({ action: 'search' }, candidate)).rejects.toThrow(/绑定的|切换/);
      await expect(rt.memoryTool({ action: 'put', content: 'cross-workspace write', expectedRevision: 1, reason: 'test' }, candidate)).rejects.toThrow(/绑定的|切换/);
      expect(rt.memory).toBe(oldMemory); expect(rt.repos).toBe(oldRepos);
      await expect(rt.memoryTool({ action: 'search' }, activeAgent)).rejects.toThrow(/切换/);
      expect(await readFile(memoryFile, 'utf8')).toBe(original); expect(ctx.fs.writeText).not.toHaveBeenCalled();
    } finally { release(); }
    const error = await binding;
    if (outcome === 'rollback') {
      expect(error?.message).toBe('candidate session failed'); expect(rt.memory).toBe(oldMemory); expect(rt.repos).toBe(oldRepos);
      expect(rt.roleFor(candidate)).toBeNull(); expect(rt.roleForToolMount(candidate)).toBeNull();
      expect((await rt.memoryTool({ action: 'search' }, activeAgent)).records[0].content).toBe('A private memory');
    } else {
      expect(error).toBeNull(); expect(rt.roleFor(candidate)).toBe('local-robot');
      expect((await rt.memoryTool({ action: 'search' }, candidate)).records).toEqual([]);
      await expect(rt.memoryTool({ action: 'search' }, activeAgent)).rejects.toThrow(/绑定的/);
    }
  });
  it('预设冲突保留历史并建立新会话，通知只进入新工作区的账本', async () => {
    const path = await workspace('session-rebound', { ownerOpenId: 'ou_new_owner' }); const { rt, ctx } = runtime();
    ctx.sessionController.create.mockRejectedValueOnce(Object.assign(new Error('preset conflict'), { code: 'agent-preset/conflict' }));
    await rt.bind(path);
    const calls = ctx.sessionController.create.mock.calls;
    expect(calls[1][0].sessionId).not.toBe(calls[0][0].sessionId);
    expect((await rt.repos.workspaceState.get(path)).feishu_session_id).toBe(calls[1][0].sessionId);
    const notices = await rt.repos.outbox.recent();
    expect(notices).toHaveLength(1); expect(notices[0].target).toBe('ou_new_owner');
    expect(notices[0].content.text).toContain(`旧会话 ${calls[0][0].sessionId}`);
  });
  it('凭据引用名改变重建飞书连接；无关密钥更新不打断连接', async () => {
    const path = await workspace('connection', { mode: 'feishu', ownerOpenId: 'ou_owner', folderToken: 'folder', tasklistId: 'list' });
    const { rt } = runtime({ PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'app-old', PA24_FEISHU_APP_SECRET: 'key-old', NEXT_APP: 'app-new', NEXT_KEY: 'key-new' });
    await rt.bind(path); const original = rt.getTransport();
    await rt.updateWorkspaceConfig({ appIdEnv: 'NEXT_APP', appSecretEnv: 'NEXT_KEY' });
    expect(rt.getTransport()).not.toBe(original); expect(rt.secretValue('feishuAppId')).toBe('app-new');
    const active = rt.getTransport(); await rt.updateWorkspaceSecrets({ volcTtsKey: 'tts-only' });
    expect(rt.getTransport()).toBe(active);
  });
  it('非法重载保留原生效配置，参数补丁保留磁盘其它修改与规则', async () => {
    const path = await workspace('patch'); const { rt } = runtime(); await rt.bind(path);
    const file = join(path, 'AGENTS.md'); const before = await readFile(file, 'utf8');
    await writeFile(file, before.replace('"maxWorkers": 2', '"maxWorkers": 99'));
    await expect(rt.reloadWorkspace()).rejects.toThrow(/maxWorkers/); expect(rt.config.maxWorkers).toBe(2);
    await writeFile(file, before.replace('"maxWorkers": 2', '"maxWorkers": 5'));
    await rt.updateWorkspaceConfig({ larkProfile: 'personal' });
    expect(rt.config.maxWorkers).toBe(5); expect(rt.config.larkProfile).toBe('personal');
    expect((await readFile(file, 'utf8')).startsWith('# 主人的稳定规则\n\n')).toBe(true);
  });
  it('嵌套 TTS 补丁保留磁盘上并发修改的其他子字段', async () => {
    const path = await workspace('nested-patch'); const { rt } = runtime(); await rt.bind(path);
    const file = join(path, 'AGENTS.md'), source = await readFile(file, 'utf8');
    await writeFile(file, source.replace('"volcKeyEnv": ""', '"volcKeyEnv": "EXTERNAL_TTS_KEY"'));
    await rt.updateWorkspaceConfig({ tts: { engine: 'melo', meloDir: '/opt/melo' } });
    expect(rt.config.tts).toEqual({ engine: 'melo', meloDir: '/opt/melo', volcKeyEnv: 'EXTERNAL_TTS_KEY', voice: '' });
  });
  it('Worker 路由子字段补丁合并磁盘最新角色与同角色其他字段', async () => {
    const path = await workspace('worker-route-patch', { workerModels: { tasks: { provider: 'old-provider', model: 'old-model', simplePersona: true }, handwriting: { provider: 'vision', model: 'old-vision' } } });
    const { rt } = runtime(); await rt.bind(path);
    const file = join(path, 'AGENTS.md'), source = await readFile(file, 'utf8');
    await writeFile(file, source.replace('old-provider', 'chat-provider').replace('old-vision', 'chat-vision'));
    await rt.updateWorkspaceConfig({ workerModels: { tasks: { model: 'ui-model' } } });
    expect(rt.config.workerModels).toEqual({ tasks: { provider: 'chat-provider', model: 'ui-model', simplePersona: true }, handwriting: { provider: 'vision', model: 'chat-vision' } });
    await rt.updateWorkspaceConfig({ workerModels: { tasks: { model: '', simplePersona: false }, memo: { model: 'memo-model' } } });
    expect(rt.config.workerModels.tasks).toEqual({ provider: 'chat-provider', model: '', simplePersona: false });
    expect(rt.config.workerModels.memo).toEqual({ provider: '', model: 'memo-model' });
    await rt.updateWorkspaceConfig({ workerModels: { tasks: { provider: '' }, memo: null } });
    expect(rt.config.workerModels).toEqual({ handwriting: { provider: 'vision', model: 'chat-vision' } });
    await rt.reloadWorkspace(); expect(rt.config.workerModels).toEqual({ handwriting: { provider: 'vision', model: 'chat-vision' } });
    expect((await readFile(file, 'utf8')).startsWith('# 主人的稳定规则\n\n')).toBe(true);
  });
  it('路由补丁保留校验：非法 provider/model 类型失败且文件不变', async () => {
    const path = await workspace('worker-route-invalid'); const { rt } = runtime(); await rt.bind(path);
    const file = join(path, 'AGENTS.md'), before = await readFile(file, 'utf8');
    for (const patch of [{ model: 42 }, { provider: null }, { simplePersona: 'false' }, { extra: '' }]) {
      await expect(rt.updateWorkspaceConfig({ workerModels: { tasks: patch } })).rejects.toThrow(/Worker 模型配置|simplePersona/);
      expect(await readFile(file, 'utf8')).toBe(before);
    }
  });
  it('飞书连接准备失败不关闭当前连接或应用新的配置', async () => {
    const path = await workspace('connection-rollback', { mode: 'feishu', ownerOpenId: 'ou_owner', folderToken: 'folder', tasklistId: 'list' });
    const { rt } = runtime({ PA24_TRANSPORT: 'fake', PA24_FEISHU_APP_ID: 'old', PA24_FEISHU_APP_SECRET: 'old-key', NEXT_APP: 'new' });
    await rt.bind(path); const old = rt.getTransport(); const config = rt.config;
    vi.spyOn(FakeFeishuTransport.prototype, 'start').mockRejectedValueOnce(new Error('test connection failure'));
    await expect(rt.updateWorkspaceConfig({ appIdEnv: 'NEXT_APP' })).rejects.toThrow(/test connection failure/);
    expect(rt.config).toBe(config); expect(rt.getTransport()).toBe(old);
    // Saved text remains available for an explicit retry, as SPEC §13 requires.
    expect(await readFile(join(path, 'AGENTS.md'), 'utf8')).toContain('NEXT_APP');
    await rt.reloadWorkspace(); expect(rt.getTransport()).not.toBe(old); expect(rt.config.appIdEnv).toBe('NEXT_APP');
  });
});


it('配置与密钥请求在队列执行时核对归属，拒绝 A → B → A 的旧草稿', async () => {
  const a = await workspace('draft-a'), b = await workspace('draft-b', { maxWorkers: 5 });
  const { rt } = runtime(); await rt.bind(a);
  const bindingA = rt.snapshot().workspaceBinding;
  const switching = rt.bind(b);
  const queued = rt.updateWorkspaceConfig({ maxWorkers: 3 }).catch(e => e);
  await switching;
  expect((await queued).message).toMatch(/工作区已切换/);
  await expect(rt.updateWorkspaceSecrets({ feishuAppSecret: 'from-a' }, bindingA)).rejects.toThrow(/工作区已切换/);
  expect(rt.config.maxWorkers).toBe(5);
  expect((await readSecretStore(b)).feishuAppSecret).toBeUndefined();
  await rt.bind(a);
  await expect(rt.updateWorkspaceConfig({ maxWorkers: 4 }, bindingA)).rejects.toThrow(/工作区已切换/);
  await rt.updateWorkspaceConfig({ maxWorkers: 4 }, rt.snapshot().workspaceBinding);
  expect(rt.config.maxWorkers).toBe(4);
});
